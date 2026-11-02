// ============================================================
// services/notifyService.js
// แจ้งเตือน 1 ครั้ง = กระดิ่งในระบบ (Notification) + อีเมลเข้าคิว (EmailOutbox)
// ส่งจริงโดย services/emailWorker.js — ถ้า SMTP ล่ม การกดปุ่มของผู้ใช้ไม่พัง
//
// เฟส 1 (เรื่องด่วน 4 เรื่อง ตาม MMS — Email Notification Spec):
//   notifyJobRejected            worker ปฏิเสธงาน          → Requester + MP
//   checkOverdueResponses        เลยกำหนดตอบรับ (responseDays) → Requester + MP
//   notifyCheckInFailed          ตรวจก่อนเดินทางไม่ผ่าน      → Requester + MP + safety_manager + PE
//   notifyMatchExceptionsRequested ขอ PE อนุมัติ % Match ไม่ครบ → PE ทุกคน (อีเมลอย่างเดียว —
//                                 กระดิ่งมีอยู่แล้วใน matchExceptionService ผ่าน notifyRole)
//
// ผู้รับตาม role นับทั้ง role หลักและ role เสริม (UserRole) · ไม่แจ้งตัวผู้ทำเอง
// อีเมลห้ามมีค่าผลตรวจสุขภาพ / รหัสผ่าน / PIN
// ============================================================
import crypto from "crypto";
import prisma from "../config/prisma.js";
import { renderEmail, fmtDateTimeTH, fmtMob } from "./emailTemplates.js";

export const ROLE = {
  MP: ["manpower_supply"],
  PE: ["project_engineer"],
  SAFETY_MANAGER: ["safety_manager"],
};

const emailEnabled = () => String(process.env.EMAIL_ENABLED || "").toLowerCase() === "true";

// ── หา user จาก id + role (หลักหรือเสริม) ──
async function resolveRecipients({ userIds = [], roles = [], exclude = [] }) {
  const or = [];
  const ids = userIds.filter(Boolean);
  if (ids.length) or.push({ id: { in: ids } });
  if (roles.length) {
    or.push({ role: { name: { in: roles } } });
    or.push({ extraRoles: { some: { role: { name: { in: roles } } } } });
  }
  if (!or.length) return [];
  const users = await prisma.user.findMany({
    where: { OR: or },
    select: { id: true, email: true, name: true },
  });
  const skip = new Set(exclude.filter(Boolean));
  return users.filter((u) => !skip.has(u.id));
}

/**
 * แจ้งเตือนทั่วไป — สร้างกระดิ่ง + คิวอีเมล ต่อผู้รับ 1 คน
 * dedupeKey: เหตุการณ์เดียวกันส่งให้คนเดิมได้ครั้งเดียว (ทั้งกระดิ่งและอีเมล)
 */
export async function notify({
  type,
  priority = "now",
  userIds,
  roles,
  exclude,
  title,
  message,
  link,
  email, // args ของ renderEmail()
  dedupeKey,
  inApp = true, // false = อีเมลอย่างเดียว (จุดที่มีกระดิ่งของเดิมอยู่แล้ว)
}) {
  const recipients = await resolveRecipients({ userIds, roles, exclude });
  if (!recipients.length) return { sent: 0 };

  const mail = email ? renderEmail(email) : null;
  let count = 0;

  for (const u of recipients) {
    if (dedupeKey && u.email) {
      const dup = await prisma.emailOutbox.findFirst({
        where: { dedupeKey, toEmail: u.email },
        select: { id: true },
      });
      if (dup) continue;
    }
    try {
      await prisma.$transaction(async (tx) => {
        if (inApp) {
          await tx.notification.create({
            data: { userId: u.id, type, title, message: message || null, link: link || null },
          });
        }
        if (mail && u.email) {
          await tx.emailOutbox.create({
            data: {
              type,
              priority,
              toEmail: u.email,
              userId: u.id,
              subject: mail.subject,
              html: mail.html,
              text: mail.text,
              dedupeKey: dedupeKey || null,
              // ปิดอีเมลอยู่ → เก็บเป็น disabled (ยังกันส่งซ้ำได้ และไม่ถูกส่งย้อนหลังตอนเปิด)
              status: emailEnabled() ? "queued" : "disabled",
            },
          });
        }
      });
      count++;
    } catch (err) {
      // P2002 = มีคนส่งเหตุการณ์เดียวกันพร้อมกัน — ถือว่าแจ้งแล้ว
      if (err.code !== "P2002") console.error(`[notify] ${type} → ${u.email}:`, err.message);
    }
  }
  return { sent: count };
}

// ════════════════════════════════════════════════════════════
// ข้อมูลประกอบอีเมล: project / ตำแหน่ง / พนักงาน / วัน MOB
// ════════════════════════════════════════════════════════════
const onCode = (project) => project?.masterProjectRecord?.projectCode || null;
const projectLabel = (project) =>
  [onCode(project), project?.name].filter(Boolean).join(" ") || "—";
const refOf = (project, positionName) =>
  [onCode(project) || project?.name, positionName].filter(Boolean).join(" · ");
const personOf = (e) => [e?.fullName, e?.empId || e?.empCode].filter(Boolean).join(" · ");

// วัน MOB จริงจาก Worker Schedule ถ้ามี ไม่งั้นใช้วันเริ่มงานของ requirement
async function mobDateOf(employeeId, project) {
  if (!project?.id) return null;
  const asg = await prisma.assignment.findFirst({
    where: { employeeId, projectId: project.id },
    orderBy: { createdAt: "desc" },
    select: { mobDate: true },
  });
  return asg?.mobDate || project.startDate || null;
}

const REQUEST_INCLUDE = {
  position: { select: { name: true } },
  project: {
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      responseDays: true,
      masterProjectRecord: { select: { projectCode: true } },
    },
  },
};

const EMPLOYEE_SELECT = { id: true, fullName: true, empId: true, empCode: true };

async function loadCandidate(candidateId) {
  return prisma.candidate.findUnique({
    where: { id: candidateId },
    include: {
      employee: { select: EMPLOYEE_SELECT },
      decision: { select: { createdAt: true } },
      round: { include: { request: { include: REQUEST_INCLUDE } } },
    },
  });
}

// ════════════════════════════════════════════════════════════
// 1) worker ปฏิเสธงาน — ด่วน
// ════════════════════════════════════════════════════════════
export async function notifyJobRejected(candidateId, note) {
  const c = await loadCandidate(candidateId);
  const req = c?.round?.request;
  if (!req) return;
  const project = req.project;
  const mob = await mobDateOf(c.employeeId, project);
  const link = `/allocation?projectId=${project.id}`;

  await notify({
    type: "job_rejected",
    priority: "urgent",
    userIds: [req.requestedById],
    roles: ROLE.MP,
    title: `พนักงานปฏิเสธงาน — ${c.employee?.fullName || ""}`,
    message: `${refOf(project, req.position?.name)} · ต้องหาคนแทน`,
    link,
    dedupeKey: `job_rejected:${candidateId}`,
    email: {
      label: "urgent",
      topic: "พนักงานปฏิเสธงาน",
      ref: refOf(project, req.position?.name),
      lead: `พนักงานปฏิเสธงานผ่าน Worker App เมื่อ ${fmtDateTimeTH(new Date())}`,
      rows: [
        ["Project", projectLabel(project)],
        ["ตำแหน่ง", `${req.position?.name || "—"} (ต้องการ ${req.quantity} คน)`],
        ["พนักงาน", personOf(c.employee)],
        ["เหตุผล", note || "—"],
        ["MOB", fmtMob(mob)],
      ],
      todo: "เสนอชื่อคนแทนที่ Assign Names ก่อนวัน MOB",
      button: { label: "เปิด Assign Names", path: link },
    },
  });
}

// ════════════════════════════════════════════════════════════
// 2) เลยกำหนดตอบรับแล้วยังไม่ตอบ — ด่วน (emailWorker เรียกทุกชั่วโมง)
//    กำหนด = วันที่ approve + Project.responseDays (ค่าเริ่มต้น 10 เหมือน Worker App)
//    ข้ามงานที่จบไปแล้ว (endDate ผ่านมาแล้ว) · แจ้งครั้งเดียวต่อ candidate
// ════════════════════════════════════════════════════════════
const DEFAULT_RESPONSE_DAYS = 10; // ค่าเดียวกับ workerJobsController

export async function checkOverdueResponses() {
  const now = new Date();
  const cands = await prisma.candidate.findMany({
    where: {
      workerConfirmStatus: "pending",
      status: "approved",
      decision: { status: "approved" },
    },
    include: {
      employee: { select: EMPLOYEE_SELECT },
      decision: { select: { createdAt: true } },
      round: { include: { request: { include: REQUEST_INCLUDE } } },
    },
  });

  let n = 0;
  for (const c of cands) {
    const req = c.round?.request;
    const project = req?.project;
    if (!req || !project || !c.decision?.createdAt) continue;
    if (project.endDate && new Date(project.endDate) < now) continue;

    const days = project.responseDays ?? DEFAULT_RESPONSE_DAYS;
    if (!(days > 0)) continue;
    const deadline = new Date(c.decision.createdAt);
    deadline.setDate(deadline.getDate() + days);
    if (deadline > now) continue;

    const mob = await mobDateOf(c.employeeId, project);
    const link = `/allocation?projectId=${project.id}`;
    const r = await notify({
      type: "job_response_overdue",
      priority: "urgent",
      userIds: [req.requestedById],
      roles: ROLE.MP,
      title: `เลยกำหนดตอบรับงาน — ${c.employee?.fullName || ""}`,
      message: `${refOf(project, req.position?.name)} · ยังไม่ตอบใน Worker App`,
      link,
      dedupeKey: `job_overdue:${c.id}`,
      email: {
        label: "urgent",
        topic: "พนักงานยังไม่ตอบรับงาน — เลยกำหนดแล้ว",
        ref: refOf(project, req.position?.name),
        lead: `พนักงานยังไม่กดตอบรับหรือปฏิเสธงานใน Worker App เลยกำหนด ${days} วันนับจากวันที่ Approve`,
        rows: [
          ["Project", projectLabel(project)],
          ["ตำแหน่ง", req.position?.name || "—"],
          ["พนักงาน", personOf(c.employee)],
          ["Approve เมื่อ", fmtDateTimeTH(c.decision.createdAt)],
          ["กำหนดตอบรับ", fmtDateTimeTH(deadline)],
          ["MOB", fmtMob(mob)],
        ],
        todo: "ติดต่อพนักงาน หรือเสนอชื่อคนแทนที่ Assign Names",
        button: { label: "เปิด Assign Names", path: link },
      },
    });
    n += r.sent;
  }
  return n;
}

// ════════════════════════════════════════════════════════════
// 3) ตรวจก่อนเดินทาง (Check In) ไม่ผ่าน — ด่วน
//    เรียกเมื่อรายการเปลี่ยนเป็น fail เท่านั้น (ไม่ใช่ทุกครั้งที่บันทึก)
//    ไม่ระบุว่าตรวจอะไร / ค่าที่วัด — เป็นข้อมูลสุขภาพ ให้ดูในระบบ
// ════════════════════════════════════════════════════════════
export async function notifyCheckInFailed(taskId, actorUserId) {
  const task = await prisma.mobilizationTask.findUnique({
    where: { id: taskId },
    include: {
      booking: {
        include: {
          employee: { select: EMPLOYEE_SELECT },
          request: { include: REQUEST_INCLUDE },
        },
      },
    },
  });
  const req = task?.booking?.request;
  if (!req) return;
  const project = req.project;
  const emp = task.booking.employee;
  const mob = await mobDateOf(emp.id, project);
  const link = `/mobilization?projectId=${project.id}`;
  const day = new Date().toISOString().slice(0, 10);

  await notify({
    type: "checkin_failed",
    priority: "urgent",
    userIds: [req.requestedById],
    roles: [...ROLE.MP, ...ROLE.SAFETY_MANAGER, ...ROLE.PE],
    exclude: [actorUserId],
    title: `Check In ไม่ผ่าน — ${emp.fullName || ""}`,
    message: `${refOf(project, req.position?.name)} · ต้องหาคนแทนก่อนเดินทาง`,
    link,
    dedupeKey: `checkin_failed:${taskId}:${day}`,
    email: {
      label: "urgent",
      topic: "พนักงานไม่ผ่านการตรวจก่อนเดินทาง",
      ref: refOf(project, req.position?.name),
      lead: `บันทึกผลตรวจก่อนเดินทาง (Check In) ว่าไม่ผ่าน เมื่อ ${fmtDateTimeTH(new Date())}`,
      rows: [
        ["Project", projectLabel(project)],
        ["ตำแหน่ง", req.position?.name || "—"],
        ["พนักงาน", personOf(emp)],
        ["ผล", "ไม่ผ่านการตรวจก่อนเดินทาง — รายละเอียดดูในระบบ"],
        ["MOB", fmtMob(mob)],
      ],
      todo: "ตรวจสอบผลที่ Worker Schedule และหาคนแทนก่อนเรือออก",
      button: { label: "เปิด Worker Schedule", path: link },
    },
  });
}

// ════════════════════════════════════════════════════════════
// 4) ขอ PE อนุมัติพนักงานที่ % Match ไม่ครบ — ต้องดำเนินการ → PE ทุกคน
//    เรียกจาก matchExceptionService.createRequests หลังส่งคำขอ (MP ส่งหลายคนพร้อมกันได้)
//    ส่ง 1 ฉบับต่อการกดส่ง 1 ครั้ง · อีเมลอย่างเดียว (กระดิ่งมีของเดิมแล้ว)
// ════════════════════════════════════════════════════════════
export async function notifyMatchExceptionsRequested(exceptionIds, actorUserId) {
  const ids = [...new Set((exceptionIds || []).filter(Boolean))];
  if (!ids.length) return;
  const rows = await prisma.matchExceptionRequest.findMany({
    where: { id: { in: ids }, status: "pending" },
    include: {
      employee: { select: EMPLOYEE_SELECT },
      requestedBy: { select: { name: true, titlePrefix: true } },
      manpowerRequest: { include: REQUEST_INCLUDE },
    },
    orderBy: { matchPct: "desc" },
  });
  if (!rows.length) return;

  const first = rows[0];
  const req = first.manpowerRequest;
  const project = req?.project;
  const requester =
    `${first.requestedBy?.titlePrefix || ""}${first.requestedBy?.name || ""}` || "—";
  const pctOf = (r) => Math.round(Number(r.matchPct) || 0);
  const missingOf = (r) => (Array.isArray(r.missingTrainings) ? r.missingTrainings : []);

  const workerRows = rows.map((r) => {
    const miss = missingOf(r);
    return [
      personOf(r.employee),
      `${pctOf(r)}%${miss.length ? ` — ขาด ${miss.length}: ${miss.join(", ")}` : ""}`,
    ];
  });

  // ไม่อนุมัติแล้วขอใหม่ = record เดิมถูกเขียนทับ → รวม updatedAt เข้า key เพื่อแยกรอบ
  const dedupeKey = `match_exception:${crypto
    .createHash("sha1")
    .update(rows.map((r) => `${r.id}@${new Date(r.updatedAt).getTime()}`).sort().join("|"))
    .digest("hex")}`;

  const single = rows.length === 1;
  const link = "/pe-approvals";

  await notify({
    type: "match_exception_requested",
    priority: "urgent",
    roles: ROLE.PE,
    exclude: [actorUserId],
    inApp: false,
    title: "",
    dedupeKey,
    email: {
      label: "action",
      topic: single
        ? `ขออนุมัติพนักงาน % Match ${pctOf(first)}%`
        : `ขออนุมัติพนักงาน % Match ไม่ครบ ${rows.length} คน`,
      ref: refOf(project, req?.position?.name),
      lead: `${requester} ขอใช้พนักงานที่ training ไม่ครบตาม matrix`,
      rows: [
        ["Project", projectLabel(project)],
        ["ตำแหน่ง", `${req?.position?.name || "—"} (ต้องการ ${req?.quantity ?? "—"} คน)`],
        ...workerRows,
        ["เหตุผลที่ขอ", first.reason || "—"],
      ],
      todo: "อนุมัติหรือไม่อนุมัติที่ PE Approvals",
      button: { label: "เปิด PE Approvals", path: link },
    },
  });
}
