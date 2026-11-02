// ============================================================
// matchExceptionService.js
// คำขออนุมัติให้ใช้พนักงานที่ % Match ไม่ครบ 100%
//   MP ส่งคำขอ (หน้า Allocation) → PE อนุมัติ / ไม่อนุมัติ (หน้า PE Approvals)
//   อนุมัติแล้ว → เข้า Shortlist (Approved) อัตโนมัติ → ไปหน้า Mobilization ทันที
// ============================================================
import { PrismaClient } from "@prisma/client";
import { findWorkers } from "./allocationService.js";
import { notifyRole } from "./notificationService.js";
import { notifyMatchExceptionsRequested } from "./notifyService.js";
import { USER_ROLES_LIGHT_INCLUDE, hasAnyRole } from "../utils/roles.js";

const prisma = new PrismaClient();

// role ที่กดอนุมัติ / ไม่อนุมัติได้ — เช็กทุก role ของ user (หลัก + เสริม)
// ผู้ขอที่มี role เสริม project_engineer อนุมัติคำขอของตัวเองได้ (ตามที่ตกลงไว้ — Audit Log เก็บทั้งผู้ขอและผู้อนุมัติ)
export const DECIDER_ROLES = ["project_engineer", "admin"];

const httpError = (status, message) =>
  Object.assign(new Error(message), { status });

const projectLabel = (project) =>
  project?.masterProjectRecord?.projectCode
    ? `[${project.masterProjectRecord.projectCode}] ${project.name}`
    : (project?.name ?? "");

async function loadManpowerRequest(requestId) {
  return prisma.manpowerRequest.findUnique({
    where: { id: requestId },
    include: {
      position: true,
      project: {
        include: { masterProjectRecord: { select: { projectCode: true } } },
      },
    },
  });
}

// ── MP: ส่งคำขอ (หลายคนพร้อมกันได้) ──
export async function createRequests({
  requestId,
  employeeIds,
  reason,
  userId,
}) {
  if (!requestId || !Array.isArray(employeeIds) || employeeIds.length === 0) {
    throw httpError(400, "ต้องระบุ requestId และ employeeIds");
  }
  if (!reason?.trim()) throw httpError(400, "กรุณาระบุเหตุผลที่ขออนุมัติ");

  const request = await loadManpowerRequest(requestId);
  if (!request) throw httpError(404, "ไม่พบ position request");

  // คำนวณ % Match ฝั่ง server เสมอ (ไม่เชื่อค่าจาก frontend)
  // เทียบกับ Matrix ของตำแหน่งที่ request ต้องการ
  const rows = await findWorkers({
    positionId: request.positionId,
    matrixPositionId: request.positionId,
    requestId,
    contractId: request.project.contractId,
    employeeIds,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  const existing = await prisma.matchExceptionRequest.findMany({
    where: { manpowerRequestId: requestId, employeeId: { in: employeeIds } },
  });
  const existingById = new Map(existing.map((e) => [e.employeeId, e]));

  const created = [];
  const skipped = [];

  for (const employeeId of employeeIds) {
    const w = byId.get(employeeId);
    const skip = (why) =>
      skipped.push({ employeeId, name: w?.fullName ?? null, reason: why });

    if (!w) {
      skip(
        "ไม่อยู่ในรายชื่อที่เลือกได้ (อาจอยู่ใน shortlist แล้ว หรือไม่ available)",
      );
      continue;
    }
    if (w.activeBan) {
      skip("พนักงานถูกแบนอยู่");
      continue;
    }
    if (w.matchPct === null) {
      skip("ตำแหน่งนี้ยังไม่มี Training Matrix");
      continue;
    }
    if (w.matchPct === 100) {
      skip("% Match ครบแล้ว ไม่ต้องขออนุมัติ");
      continue;
    }

    const prev = existingById.get(employeeId);
    if (prev?.status === "pending") {
      skip("มีคำขอที่รอ PE อนุมัติอยู่แล้ว");
      continue;
    }
    if (prev?.status === "approved") {
      skip("PE อนุมัติแล้ว");
      continue;
    }

    // เคยไม่อนุมัติ → ส่งใหม่ได้ (reset เป็น pending)
    const data = {
      matchPct: w.matchPct,
      missingTrainings: w.missingTrainings ?? [],
      reason: reason.trim(),
      status: "pending",
      requestedById: userId,
      decidedById: null,
      decidedAt: null,
      decisionNote: null,
    };
    const row = await prisma.matchExceptionRequest.upsert({
      where: {
        manpowerRequestId_employeeId: {
          manpowerRequestId: requestId,
          employeeId,
        },
      },
      update: data,
      create: { manpowerRequestId: requestId, employeeId, ...data },
    });
    created.push(row);
  }

  if (created.length > 0) {
    // ไม่แจ้งตัวผู้ขอเอง (กรณีผู้ขอมี role เสริม project_engineer)
    await notifyRole(
      "project_engineer",
      {
        type: "match_exception_pending",
        title: `ขออนุมัติพนักงานที่ % Match ไม่ครบ (${created.length} คน)`,
        message: `${request.position?.name ?? ""} · ${projectLabel(request.project)}`,
        link: "/pe-approvals",
      },
      { excludeUserIds: [userId] },
    );
    // อีเมลถึง PE ทุกคน (1 ฉบับต่อการส่ง 1 ครั้ง) — ไม่รอ และไม่ให้ error กระทบผู้ขอ
    notifyMatchExceptionsRequested(
      created.map((r) => r.id),
      userId,
    ).catch((err) => console.error("[notify] match_exception:", err.message));
  }

  return { created: created.length, skipped };
}

// ── PE: รายการคำขอ ──
export async function listRequests({ status } = {}) {
  return prisma.matchExceptionRequest.findMany({
    where: status && status !== "all" ? { status } : {},
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          empId: true,
          empCode: true,
          position: { select: { name: true } },
        },
      },
      manpowerRequest: {
        select: {
          id: true,
          quantity: true,
          position: { select: { name: true } },
          project: {
            select: {
              id: true,
              name: true,
              masterProjectRecord: { select: { projectCode: true } },
            },
          },
        },
      },
      requestedBy: { select: { name: true, titlePrefix: true } },
      decidedBy: { select: { name: true, titlePrefix: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
}

export async function countPending() {
  return prisma.matchExceptionRequest.count({ where: { status: "pending" } });
}

// ── Allocation: สถานะคำขอของ position request เดียว ──
export async function listForManpowerRequest(requestId) {
  return prisma.matchExceptionRequest.findMany({
    where: { manpowerRequestId: requestId },
    select: {
      id: true,
      employeeId: true,
      status: true,
      matchPct: true,
      decisionNote: true,
      decidedAt: true,
      decidedBy: { select: { name: true } },
    },
  });
}

// ── PE: อนุมัติ / ไม่อนุมัติ ──
// อนุมัติ = เพิ่มเข้า shortlist ในสถานะ approved ทันที → ไปหน้า Mobilization ได้เลย
// (เหมือน MP กด Add to Shortlist + Approve ให้ — MP ไม่ต้องทำซ้ำ)
export async function decide(id, { decision, note, userId }) {
  if (!["approved", "rejected"].includes(decision)) {
    throw httpError(400, "decision ต้องเป็น approved หรือ rejected");
  }
  if (decision === "rejected" && !note?.trim()) {
    throw httpError(400, "กรุณาระบุเหตุผลที่ไม่อนุมัติ");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: USER_ROLES_LIGHT_INCLUDE,
  });
  if (!hasAnyRole(user, DECIDER_ROLES)) {
    throw httpError(403, "เฉพาะ PE (Project Engineer) เท่านั้นที่อนุมัติได้");
  }

  const current = await prisma.matchExceptionRequest.findUnique({
    where: { id },
  });
  if (!current) throw httpError(404, "ไม่พบคำขอ");
  if (current.status !== "pending") {
    throw httpError(409, "คำขอนี้ถูกพิจารณาไปแล้ว");
  }

  // ถูกแบนระหว่างรอ PE → อนุมัติไม่ได้
  if (decision === "approved") {
    const ban = await prisma.employeeBan.findFirst({
      where: {
        employeeId: current.employeeId,
        isActive: true,
        bannedUntil: { gt: new Date() },
      },
    });
    if (ban) throw httpError(409, "พนักงานคนนี้ถูกแบนอยู่ อนุมัติไม่ได้");
  }

  await prisma.$transaction(async (tx) => {
    // อัปเดตเฉพาะที่ยัง pending — กัน PE 2 คนกดพร้อมกัน
    const result = await tx.matchExceptionRequest.updateMany({
      where: { id, status: "pending" },
      data: {
        status: decision,
        decidedById: userId,
        decidedAt: new Date(),
        decisionNote: note?.trim() || null,
      },
    });
    if (result.count === 0) {
      throw httpError(409, "คำขอนี้ถูกพิจารณาไปแล้ว");
    }
    if (decision !== "approved") return;

    // ── เข้า shortlist + approved (แบบเดียวกับ addToShortlist + approveWorkers) ──
    const requestId = current.manpowerRequestId;
    let candidate = await tx.candidate.findFirst({
      where: { employeeId: current.employeeId, round: { requestId } },
    });
    if (!candidate) {
      let round = await tx.candidateRound.findFirst({
        where: { requestId },
        orderBy: { round: "desc" },
      });
      if (!round) {
        round = await tx.candidateRound.create({
          data: { requestId, round: 1 },
        });
      }
      candidate = await tx.candidate.create({
        data: {
          roundId: round.id,
          employeeId: current.employeeId,
          sourceType: "internal",
          status: "approved",
          totalScore: 0,
          matchPct: current.matchPct,
        },
      });
    } else if (candidate.status !== "approved") {
      await tx.candidate.update({
        where: { id: candidate.id },
        data: { status: "approved" },
      });
    }

    await tx.clientApproval.upsert({
      where: { candidateId: candidate.id },
      update: { status: "approved", decidedById: userId },
      create: {
        candidateId: candidate.id,
        requestId,
        status: "approved",
        decidedById: userId,
      },
    });

    await tx.manpowerRequest.update({
      where: { id: requestId },
      data: { status: "approved" },
    });
  });

  const row = await prisma.matchExceptionRequest.findUnique({
    where: { id },
    include: {
      employee: { select: { fullName: true } },
      manpowerRequest: {
        include: {
          position: true,
          project: {
            include: { masterProjectRecord: { select: { projectCode: true } } },
          },
        },
      },
    },
  });

  // แจ้งผลกลับคนที่ขอ (ข้ามถ้าผู้ขอเป็นคนพิจารณาเอง)
  const approved = decision === "approved";
  if (row.requestedById === userId) return row;
  await prisma.notification.create({
    data: {
      userId: row.requestedById,
      type: "match_exception_decided",
      title: approved
        ? `PE อนุมัติ ${row.employee.fullName} — ส่งไป Mobilization แล้ว`
        : `PE ไม่อนุมัติ ${row.employee.fullName}`,
      message: [
        row.manpowerRequest.position?.name,
        projectLabel(row.manpowerRequest.project),
        row.decisionNote,
      ]
        .filter(Boolean)
        .join(" · "),
      link: approved
        ? `/mobilization?projectId=${row.manpowerRequest.projectId}`
        : `/allocation?projectId=${row.manpowerRequest.projectId}`,
    },
  });

  return row;
}
