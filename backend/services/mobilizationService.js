import { PrismaClient } from "@prisma/client";
import { getActiveBanMap } from "./employeeBanService.js"; // ← เพิ่มบรรทัดนี้
import { notifyCheckInFailed } from "./notifyService.js";

const prisma = new PrismaClient();

const DEMOB_DAYS = 28; // rotation 4 สัปดาห์
const norm = (s) => (s || "").replace(/\s+/g, "").toLowerCase();
// ข้อความสั้นจากฟอร์ม → trim + จำกัดความยาว · ว่าง = null
const cleanText = (v, max = 100) => {
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  return s || null;
};

// ── Pre-Mob Checklist: 6 ไฟล์ตามที่พี่บอยส่งมา ──
const CHECKLIST_TASK_TYPES = [
  "alcohol_test",
  "drug_test",
  "ppe_inspection",
  "pre_field_training",
  "baggage_inspection",
  "blood_pressure_check",
];

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// status อิงวันที่ (ให้ตรงกับ roster import): planned / active / completed
function statusByDate(mob, demob) {
  const now = Date.now();
  if (new Date(mob).getTime() > now) return "planned";
  if (demob && new Date(demob).getTime() >= now) return "active";
  return "completed";
}

// ════════════════════════════════════════════════════════════════
// COMPATIBILITY SHIM — หา/สร้าง Booking สำหรับ employee+request นี้
//
// MobilizationTask (checklist 6 ไฟล์) ผูกกับ bookingId ตาม schema เดิม
// แต่ flow ปัจจุบัน (Allocation approve) ไม่เคยสร้าง Booking record
// ฟังก์ชันนี้หา Booking ที่มีอยู่ก่อน ถ้าไม่มีค่อยสร้างให้ (status: approved)
// ใช้เป็น "ที่เก็บ" checklist เท่านั้น — ไม่เกี่ยวกับ Assignment/Deploy
// ซึ่งยังทำงานแบบ bookingId=null (roster) เหมือนเดิมทุกอย่าง
// ════════════════════════════════════════════════════════════════
async function findOrCreateBooking(requestId, employeeId) {
  let booking = await prisma.booking.findFirst({
    where: { requestId, employeeId },
  });
  if (!booking) {
    booking = await prisma.booking.create({
      data: { requestId, employeeId, status: "approved" },
    });
  }
  return booking;
}

// ── seed checklist task ที่ยังไม่มีให้ booking นี้ ──
async function seedChecklistTasks(bookingId, existingTasks) {
  const existingTypes = new Set(existingTasks.map((t) => t.taskType));
  const missing = CHECKLIST_TASK_TYPES.filter((t) => !existingTypes.has(t));
  if (missing.length === 0) return existingTasks;

  await prisma.mobilizationTask.createMany({
    data: missing.map((taskType) => ({
      bookingId,
      taskType,
      status: "pending",
    })),
  });

  return prisma.mobilizationTask.findMany({
    where: { bookingId, taskType: { in: CHECKLIST_TASK_TYPES } },
    orderBy: { createdAt: "asc" },
  });
}

// ════════════════════════════════════════════════════════════════
// GET — approved workers ของ project (ต่อจาก Allocation) + project info
// กรองเฉพาะ status = "approved" + medical + assignment เดิม (ถ้าเคย deploy)
// + seed/แนบ pre-mob checklist (6 ไฟล์) ให้แต่ละคน
// ════════════════════════════════════════════════════════════════
export async function getMobilizationList(projectId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      contract: { include: { client: true } },
      masterProjectRecord: { select: { projectCode: true } }, // ON Number = Traveling Team No.
    },
  });
  if (!project) return null;

  const requests = await prisma.manpowerRequest.findMany({
    where: { projectId },
    include: {
      position: true,
      rounds: {
        orderBy: { round: "desc" },
        take: 1,
        include: {
          candidates: {
            where: { status: "approved" },
            include: {
              employee: {
                include: {
                  position: true,
                  medicalChecks: {
                    select: { checkType: true, expiryDate: true, status: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  // ← แก้: สรุปความคืบหน้าต่อ position request — ต้องรู้ทั้ง approved (จาก Allocation)
  // และ deployed (จริงในหน้านี้) เพื่อให้ badge/dropdown สื่อสถานะ deploy ตรงกับงานจริง
  const positionSummary = await Promise.all(
    requests.map(async (req) => {
      const candidateEmployeeIds = (req.rounds[0]?.candidates ?? []).map(
        (c) => c.employeeId,
      );
      const deployedCount = candidateEmployeeIds.length
        ? await prisma.assignment.count({
            where: {
              projectId,
              employeeId: { in: candidateEmployeeIds },
              bookingId: null, // roster-style assignment เหมือนที่ใช้ตรวจ r.deployed ฝั่ง frontend
            },
          })
        : 0;

      return {
        requestId: req.id,
        positionName: req.position?.name || null,
        quantity: req.quantity,
        approvedCount: req.rounds[0]?.candidates?.length ?? 0,
        deployedCount, // ← ใหม่
      };
    }),
  );

  // ── รวบ employeeId ทั้งหมดล่วงหน้า ──
  const allCandidateEmployeeIds = [];
  for (const req of requests) {
    for (const c of req.rounds[0]?.candidates ?? []) {
      allCandidateEmployeeIds.push(c.employeeId);
    }
  }

  // assignment เดิมของ project นี้ (คนที่ deploy ไปแล้ว)
  const assignments = await prisma.assignment.findMany({
    where: { projectId },
  });
  const asgByEmp = new Map(assignments.map((a) => [a.employeeId, a]));

  // ← assignment ล่าสุด "นอก" project นี้ ของทุกคนใน list — ใช้ suggest ค่า From
  const priorAssignments = await prisma.assignment.findMany({
    where: {
      employeeId: { in: allCandidateEmployeeIds },
      projectId: { not: projectId },
      demobDate: { not: null },
    },
    orderBy: { demobDate: "desc" },
  });
  const priorPlatformByEmp = new Map();
  for (const a of priorAssignments) {
    if (!priorPlatformByEmp.has(a.employeeId)) {
      priorPlatformByEmp.set(a.employeeId, a.platform ?? null);
    }
  }

  const banMap = await getActiveBanMap(allCandidateEmployeeIds); // ← ย้ายมาไว้ตรงนี้ ก่อน loop

  const seen = new Set();
  const workers = [];

  for (const req of requests) {
    const cands = req.rounds[0]?.candidates ?? [];
    for (const c of cands) {
      if (seen.has(c.employeeId)) continue; // กันซ้ำ (คน approved หลาย request)
      seen.add(c.employeeId);

      const e = c.employee;
      const medical =
        e.medicalChecks?.find((m) => norm(m.checkType) === "medicalcheckup") ||
        null;
      const asg = asgByEmp.get(c.employeeId) || null;

      // ── หา/สร้าง booking แล้ว seed checklist 6 ไฟล์ ──
      const booking = await findOrCreateBooking(req.id, e.id);
      const existingTasks = await prisma.mobilizationTask.findMany({
        where: {
          bookingId: booking.id,
          taskType: { in: CHECKLIST_TASK_TYPES },
        },
        orderBy: { createdAt: "asc" },
      });
      const checklist = await seedChecklistTasks(booking.id, existingTasks);

      workers.push({
        bookingId: booking.id,
        candidateId: c.id,
        employeeId: e.id,
        empCode: e.empCode,
        empId: e.empId,
        fullName: e.fullName,
        position: e.position?.name || req.position?.name || null,
        employeePosition: e.position?.name || null,
        requestedPosition: req.position?.name || null,
        birthDate: e.birthDate,
        requestId: req.id,

        workerConfirmStatus: c.workerConfirmStatus,

        healthRisk: e.healthRisk ?? null,
        medicalExpiry: medical?.expiryDate ?? null,
        medicalStatus: medical?.status ?? null,
        assignment: asg
          ? {
              mobDate: asg.mobDate,
              demobDate: asg.demobDate,
              platform: asg.platform,
              fromLocation: asg.fromLocation,
              field: asg.field,
              travelTeamNo: asg.travelTeamNo,
              travelOut: asg.travelOut,
              travelBack: asg.travelBack,
              status: asg.status,
              createdAt: asg.createdAt,
              updatedAt: asg.updatedAt,
            }
          : null,
        previousPlatform: priorPlatformByEmp.get(e.id) ?? null,
        checklist,
        activeBan: banMap.has(e.id)
          ? {
              id: banMap.get(e.id).id, // ← ต้องมีบรรทัดนี้ ถ้ายังไม่มี
              bannedUntil: banMap.get(e.id).bannedUntil,
              reason: banMap.get(e.id).reason,
            }
          : null,
      });
    }
  }

  return {
    project: {
      id: project.id,
      name: project.name,
      location: project.location || null,
      projectCode: project.masterProjectRecord?.projectCode || null,
      startDate: project.startDate,
      endDate: project.endDate, // Working end → ค่าตั้งต้น D-MOB
      client: project.contract?.client?.name || null,
    },
    demobDays: DEMOB_DAYS,
    positionSummary,
    workers,
  };
}

// ════════════════════════════════════════════════════════════════
// PATCH — อัปเดตผล checklist ทีละรายการ (คนหน้างาน/manpower ติ๊ก)
// ════════════════════════════════════════════════════════════════
export async function updateChecklistTask(
  taskId,
  { resultStatus, measuredValue, itemsChecked, notes, userId, userName },
) {
  const data = {
    // ── field เหล่านี้เซฟได้เสมอ ไม่ว่าจะมี resultStatus มาด้วยหรือไม่ ──
    itemsChecked: itemsChecked ?? undefined,
    measuredValue: measuredValue ?? undefined,
    notes: notes ?? undefined,
  };

  // ── field เหล่านี้ผูกกับ "การตัดสินผลจริง" เท่านั้น
  //    อัปเดตเฉพาะตอนที่ resultStatus ถูกส่งมา ป้องกันการ mark
  //    "completed" ทั้งที่แค่พิมพ์ค่า/ติ๊ก checkbox บางส่วน (ยังไม่ครบ) ──
  if (resultStatus !== undefined && resultStatus !== null) {
    data.resultStatus = resultStatus;
    data.checkedById = userId ?? null;
    data.checkedAt = new Date();
    data.status = "completed";
    data.completedAt = new Date();
    data.completedBy = userName ?? userId ?? null;
  }

  // ผลก่อนบันทึก — แจ้งเตือนเฉพาะตอนเปลี่ยนเป็น "fail" (บันทึกซ้ำ / แก้หมายเหตุ ไม่แจ้งซ้ำ)
  const before = await prisma.mobilizationTask.findUnique({
    where: { id: taskId },
    select: { resultStatus: true },
  });

  const updated = await prisma.mobilizationTask.update({
    where: { id: taskId },
    data,
  });

  if (resultStatus === "fail" && before?.resultStatus !== "fail") {
    notifyCheckInFailed(taskId, userId).catch((err) =>
      console.error("[notify] checkin_failed:", err.message),
    );
  }

  return updated;
}

// ════════════════════════════════════════════════════════════════
// POST — Deploy to Site (Step 11) → สร้าง Assignment
// deployments: [{ employeeId, mobDate, demobDate, platform, fromLocation,
//                 field, travelTeamNo, travelOut, travelBack }]
//   field / travelTeamNo / travelOut / travelBack = ข้อมูลการเดินทางของทีม
//   (กรอกครั้งเดียวที่หน้า Mobilization — ตรงกับใบแจ้งการเดินทางของ HR)
//   D-MOB = mobDate + 28 (คำนวณ backend)
//   idempotent: ลบ assignment เดิม (bookingId=null) ของ employee+project ก่อน
//
//   ⚠ เพิ่มใหม่: snapshot positionId ของพนักงาน ณ เวลา deploy ลงใน Assignment
//   เพื่อให้ CV "Project References" แสดงตำแหน่งที่ถูกต้องตอนนั้น
//   (ตำแหน่งพนักงานอาจเปลี่ยนในอนาคต แต่ประวัติ deploy ต้องคงเดิม)
// ════════════════════════════════════════════════════════════════
export async function deployToSite({ projectId, deployments }) {
  const created = [];

  for (const d of deployments) {
    if (!d.employeeId || !d.mobDate || !d.platform) continue;

    const mob = new Date(d.mobDate);
    const demob = d.demobDate
      ? new Date(d.demobDate)
      : addDays(mob, DEMOB_DAYS);
    const status = statusByDate(mob, demob);

    const employee = await prisma.employee.findUnique({
      where: { id: d.employeeId },
      select: { positionId: true },
    });

    await prisma.assignment.deleteMany({
      where: { employeeId: d.employeeId, projectId, bookingId: null },
    });

    const asg = await prisma.assignment.create({
      data: {
        employeeId: d.employeeId,
        projectId,
        positionId: employee?.positionId ?? null,
        mobDate: mob,
        demobDate: demob,
        platform: d.platform,
        fromLocation: d.fromLocation ?? null, // ← ใหม่
        field: cleanText(d.field),
        travelTeamNo: cleanText(d.travelTeamNo),
        travelOut: cleanText(d.travelOut),
        travelBack: cleanText(d.travelBack),
        status,
      },
    });
    created.push(asg);
  }

  return { deployed: created.length, assignments: created };
}

// ════════════════════════════════════════════════════════════════
// POST — Undeploy → ลบ Assignment (เฉพาะ roster bookingId=null)
//   ไม่แตะ assignment จริงจาก booking flow (bookingId != null)
// ════════════════════════════════════════════════════════════════
export async function undeployWorker({ projectId, employeeId }) {
  if (!projectId || !employeeId) return { count: 0 };
  const result = await prisma.assignment.deleteMany({
    where: { employeeId, projectId, bookingId: null },
  });
  return { count: result.count };
}

// ════════════════════════════════════════════════════════════════
// DEV TOOL — ลบ Assignment ทั้งหมดของ project (bookingId=null เท่านั้น)
// ════════════════════════════════════════════════════════════════
export async function clearProjectDeployments(projectId) {
  if (!projectId) return { count: 0 };
  const result = await prisma.assignment.deleteMany({
    where: { projectId, bookingId: null },
  });
  return { count: result.count };
}

// ════════════════════════════════════════════════════════════════
// POST/DELETE — จัดการรูปแนบของ checklist task (เช่น Baggage inspection)
// เก็บ path รูปไว้ใน itemsChecked.photos (array of string)
// ════════════════════════════════════════════════════════════════
export async function addTaskPhoto(taskId, photoPath) {
  const task = await prisma.mobilizationTask.findUnique({
    where: { id: taskId },
  });
  if (!task) {
    const e = new Error("Task not found");
    e.code = "P2025";
    throw e;
  }

  const current = task.itemsChecked || {};
  const photos = Array.isArray(current.photos) ? current.photos : [];

  return prisma.mobilizationTask.update({
    where: { id: taskId },
    data: {
      itemsChecked: {
        ...current,
        photos: [...photos, photoPath],
      },
    },
  });
}

export async function removeTaskPhoto(taskId, photoPath) {
  const task = await prisma.mobilizationTask.findUnique({
    where: { id: taskId },
  });
  if (!task) {
    const e = new Error("Task not found");
    e.code = "P2025";
    throw e;
  }

  const current = task.itemsChecked || {};
  const photos = Array.isArray(current.photos) ? current.photos : [];

  return prisma.mobilizationTask.update({
    where: { id: taskId },
    data: {
      itemsChecked: {
        ...current,
        photos: photos.filter((p) => p !== photoPath),
      },
    },
  });
}
