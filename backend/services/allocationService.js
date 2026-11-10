import { PrismaClient } from "@prisma/client";
import { getActiveBanMap } from "./employeeBanService.js"; // ← เพิ่มบรรทัดนี้

const prisma = new PrismaClient();

// อายุเกษียณ (ให้ตรงกับ frontend Allocation.jsx)
const RETIREMENT_AGE = 60;

// ── ค่า requirementType ที่นับเป็น "Mandatory" (สัญลักษณ์ X) ──
// เหมือนกับที่ใช้ใน complianceService.js — "required" (bulk import) และ
// "mandatory" (แก้ผ่าน MatrixEditor) เป็นความหมายเดียวกันสำหรับ Chevron
const MANDATORY_REQUIREMENT_TYPES = ["required", "mandatory"];

export async function getProjectsForDropdown() {
  return prisma.project.findMany({
    include: {
      contract: { include: { client: true } },
      requests: { include: { position: true } },
      masterProjectRecord: { select: { projectCode: true } }, // ← เพิ่ม
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getProjectAllocationDetail(projectId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      contract: { include: { client: true } },
      requests: {
        include: {
          position: true,
          rounds: {
            orderBy: { round: "desc" },
            take: 1,
            include: {
              candidates: {
                include: {
                  employee: { include: { position: true } },
                  decision: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!project) return null;
  return {
    project,
    requests: project.requests.map((req) => ({
      id: req.id,
      position: req.position,
      quantity: req.quantity,
      status: req.status,
      candidates: req.rounds[0]?.candidates ?? [],
    })),
  };
}

// ─── Step 8: Find workers + Eligibility check ───
export async function findWorkers({
  positionId,
  matrixPositionId, // ตำแหน่งที่ใช้เทียบ Matrix (= ตำแหน่งของ request) — ถ้าไม่ส่งมาใช้ positionId
  requestId,
  contractId,
  employeeIds,
}) {
  const where = {
    status: "active",
    availabilityStatus: "available",
  };

  // ── ถ้ามี employeeIds ระบุมา (จาก quick search) — ดึงเฉพาะคนกลุ่มนี้ ไม่กรองด้วย positionId ──
  if (employeeIds?.length > 0) {
    where.id = { in: employeeIds };
  } else if (positionId) {
    where.positionId = positionId;
  }

  // Exclude employees already shortlisted for this request
  if (requestId) {
    where.NOT = {
      candidates: { some: { round: { requestId } } },
    };
  }

  // auto-filter คนที่เกษียณแล้ว
  const retirementCutoff = new Date();
  retirementCutoff.setFullYear(retirementCutoff.getFullYear() - RETIREMENT_AGE);
  where.OR = [{ birthDate: null }, { birthDate: { gt: retirementCutoff } }];

  const employees = await prisma.employee.findMany({
    where,
    include: {
      position: true,
      trainings: {
        where: { isLatest: true },
        include: { globalTraining: true },
      },
      // Assignment ล่าสุด → Day Off + platform
      assignments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          mobDate: true,
          demobDate: true,
          platform: true,
          status: true,
        },
      },
      // medical → status + expiry (โชว์ในคอลัมน์ MEDICAL)
      medicalChecks: {
        select: { checkType: true, expiryDate: true, status: true },
      },
      // ← เพิ่มใหม่: PE / Medical Exam record ล่าสุด — เอาแค่ note มาใช้แสดงใน
      // คอลัมน์ HEALTH RISK แทน healthNote (ให้สอดคล้องกับ healthRisk ที่ sync
      // จาก PE record อยู่แล้วใน recomputeLatestMedicalExam)
      medicalExamRecords: {
        where: { isLatest: true },
        select: { note: true },
        take: 1,
      },
    },
    orderBy: [{ mobilizationStatus: "asc" }, { fullName: "asc" }],
  });

  // ── required trainings จาก Training Matrix ──
  // เฉพาะ requirementType ที่เป็น Mandatory (required + mandatory) — ไม่นับ assigned
  // (ให้ % Match ที่นี่ตรงกับคอลัมน์ CHEVRON MATCH ในหน้า Compliance)
  let requiredTrainings = [];
  let hasMatrix = false; // ← ใหม่: แยก "ไม่มี Matrix เลย" ออกจาก "มี Matrix แต่ไม่มี mandatory"

  const matrixPosId = matrixPositionId || positionId;
  if (matrixPosId && contractId) {
    // ดึงทุก requirement ของ position+contract นี้ก่อน (ไม่กรอง type) เพื่อเช็คว่ามี Matrix ตั้งไว้หรือยัง
    const allRequirements = await prisma.positionRequirement.findMany({
      where: { positionId: matrixPosId, contractId },
      include: {
        clientTraining: { include: { globalTraining: true } },
      },
    });

    hasMatrix = allRequirements.length > 0;

    const requirements = allRequirements.filter((r) =>
      MANDATORY_REQUIREMENT_TYPES.includes(r.requirementType),
    );

    requiredTrainings = requirements.map((r) => ({
      globalTrainingId: r.clientTraining.globalTrainingId,
      trainingName:
        r.clientTraining.globalTraining?.name ??
        r.clientTraining.nameAlias ??
        "Unknown",
    }));
  }

  const now = Date.now();
  const norm = (s) => (s || "").replace(/\s+/g, "").toLowerCase();

  // ← เพิ่ม: ดึง active ban ของทุกคนใน list ล่วงหน้าเป็น Map เดียว (กัน N+1 query)
  const candidateEmployeeIds = employees.map((e) => e.id);
  const banMap = await getActiveBanMap(candidateEmployeeIds);

  return employees.map((emp) => {
    const empTrainingIds = emp.trainings
      .filter((t) => t.globalTraining && t.status === "completed")
      .map((t) => t.globalTrainingId);

    const certifications = emp.trainings
      .filter((t) => t.globalTraining)
      .map((t) => t.globalTraining.name);

    const missingTrainings = requiredTrainings
      .filter((req) => !empTrainingIds.includes(req.globalTrainingId))
      .map((req) => req.trainingName);

    const matchPct =
      requiredTrainings.length > 0
        ? Math.round(
            ((requiredTrainings.length - missingTrainings.length) /
              requiredTrainings.length) *
              100,
          )
        : hasMatrix
          ? 100 // มี Matrix ตั้งไว้แล้ว แต่ไม่มี mandatory requirement เลย → ถือว่าผ่าน 100%
          : null; // ไม่มี Matrix เลย → ไม่ทราบ (frontend จะโชว์ "No Matrix")

    const eligibility = missingTrainings.length === 0;

    // ── Day Off: จาก Assignment ล่าสุด (today − demobDate) ──
    const latest = emp.assignments?.[0] || null;
    const demob = latest?.demobDate ? new Date(latest.demobDate) : null;
    const dayOff = demob
      ? Math.floor((now - demob.getTime()) / 86400000)
      : null;

    // ── Medical Check up ล่าสุด (tolerant checkType) ──
    const medical =
      emp.medicalChecks?.find((m) => norm(m.checkType) === "medicalcheckup") ||
      null;

    return {
      id: emp.id,
      empCode: emp.empCode,
      empId: emp.empId,
      fullName: emp.fullName,
      position: emp.position,
      startWorkDate: emp.startWorkDate,
      birthDate: emp.birthDate,
      mobilizationStatus: emp.mobilizationStatus,
      availabilityStatus: emp.availabilityStatus,
      certifications,
      eligibility,
      missingTrainings,
      matchPct, // ← ไม่แตะ ยังคำนวณตามจริงเหมือนเดิม
      hasMatrix,

      // ── roster (คนติดตัว) ──
      isPermanent: emp.isPermanent,
      healthRisk: emp.healthRisk,
      healthNote: emp.healthNote,
      latestExamNote: emp.medicalExamRecords?.[0]?.note ?? null,
      sseLevel: emp.sseLevel,
      sseCompleted: emp.sseCompleted,

      // ── medical ──
      medicalExpiry: medical?.expiryDate ?? null,
      medicalStatus: medical?.status ?? null,

      // ── deployment ล่าสุด ──
      dayOff,
      platform: latest?.platform ?? null,
      mobDate: latest?.mobDate ?? null,
      demobDate: latest?.demobDate ?? null,

      // ← เพิ่มบรรทัดนี้
      activeBan: banMap.has(emp.id)
        ? {
            id: banMap.get(emp.id).id,
            bannedUntil: banMap.get(emp.id).bannedUntil,
            reason: banMap.get(emp.id).reason,
          }
        : null,
    };
  });
}

export async function addToShortlist({ requestId, employeeIds }) {
  // ── ตรวจฝั่ง server: ต้อง % Match 100% หรือ PE อนุมัติแล้ว และไม่ถูกแบน ──
  const request = await prisma.manpowerRequest.findUnique({
    where: { id: requestId },
    select: { positionId: true, project: { select: { contractId: true } } },
  });
  if (!request) {
    throw Object.assign(new Error("ไม่พบ position request"), { status: 404 });
  }

  const rows = await findWorkers({
    positionId: request.positionId,
    matrixPositionId: request.positionId,
    requestId,
    contractId: request.project.contractId,
    employeeIds,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  const approvedIds = new Set(
    (
      await prisma.matchExceptionRequest.findMany({
        where: {
          manpowerRequestId: requestId,
          employeeId: { in: employeeIds },
          status: "approved",
        },
        select: { employeeId: true },
      })
    ).map((r) => r.employeeId),
  );

  const blocked = employeeIds.filter((id) => {
    const w = byId.get(id);
    if (!w || w.activeBan) return true;
    return !(w.matchPct === 100 || approvedIds.has(id));
  });
  if (blocked.length > 0) {
    const names = blocked
      .map((id) => byId.get(id)?.fullName)
      .filter(Boolean)
      .join(", ");
    throw Object.assign(
      new Error(
        `เพิ่มไม่ได้ ${blocked.length} คน${names ? ` (${names})` : ""} — ต้อง % Match ครบ 100% หรือ PE อนุมัติแล้ว และไม่ถูกแบน`,
      ),
      { status: 400 },
    );
  }

  let round = await prisma.candidateRound.findFirst({
    where: { requestId },
    orderBy: { round: "desc" },
  });

  if (!round) {
    round = await prisma.candidateRound.create({
      data: { requestId, round: 1 },
    });
  }

  const candidates = await Promise.all(
    employeeIds.map((employeeId) =>
      prisma.candidate.create({
        data: {
          roundId: round.id,
          employeeId,
          sourceType: "internal",
          status: "proposed",
          totalScore: 0,
          matchPct: null,
        },
        include: { employee: { include: { position: true } } },
      }),
    ),
  );

  await prisma.manpowerRequest.update({
    where: { id: requestId },
    data: { status: "proposing" },
  });

  return { round, candidates };
}

export async function getShortlist(projectId) {
  const requests = await prisma.manpowerRequest.findMany({
    where: { projectId },
    include: {
      position: true,
      rounds: {
        orderBy: { round: "desc" },
        take: 1,
        include: {
          candidates: {
            include: {
              employee: { include: { position: true } },
              decision: true,
            },
          },
        },
      },
    },
  });

  // คำขออนุมัติ PE ของทุก position request ในโปรเจกต์นี้ (query เดียว)
  const exceptions = await prisma.matchExceptionRequest.findMany({
    where: { manpowerRequest: { projectId } },
    select: {
      manpowerRequestId: true,
      employeeId: true,
      status: true,
      matchPct: true,
      decisionNote: true,
            employee: {
        select: {
          fullName: true,
          empId: true,
          positionId: true,
          position: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return requests.map((req) => {
    const ex = exceptions.filter((e) => e.manpowerRequestId === req.id);
    const peApprovedIds = new Set(
      ex.filter((e) => e.status === "approved").map((e) => e.employeeId),
    );
    return {
      requestId: req.id,
      position: req.position,
      quantity: req.quantity,
      status: req.status,
      // viaPeApproval = เข้ามาจาก PE อนุมัติ → frontend ไม่แสดงในรายชื่อ Step 9
      candidates: (req.rounds[0]?.candidates ?? []).map((c) => ({
        ...c,
        viaPeApproval: peApprovedIds.has(c.employeeId),
      })),
      peExceptions: {
        pending: ex.filter((e) => e.status === "pending"),
        rejected: ex.filter((e) => e.status === "rejected"),
      },
    };
  });
}

export async function approveWorkers({ candidateIds, requestId }) {
  await prisma.candidate.updateMany({
    where: { id: { in: candidateIds } },
    data: { status: "approved" },
  });

  const firstUser = await prisma.user.findFirst();

  await Promise.all(
    candidateIds.map((candidateId) =>
      prisma.clientApproval.upsert({
        where: { candidateId },
        update: { status: "approved" },
        create: {
          candidateId,
          requestId,
          status: "approved",
          decidedById: firstUser?.id ?? null,
        },
      }),
    ),
  );

  if (requestId) {
    await prisma.manpowerRequest.update({
      where: { id: requestId },
      data: { status: "approved" },
    });
  }

  return { approved: candidateIds.length };
}

// ── กันยกเลิก Approve / เอาออกจากรายชื่อ ขณะที่คนนั้นยัง deploy อยู่ในโปรเจกต์ ──
// (เดิมทำได้ → ข้อมูลลงงาน (Assignment) ค้าง ขึ้นใน Manpower Calendar ทั้งที่ไม่อยู่ในทีมแล้ว)
async function assertNotDeployed(candidateIds) {
  const candidates = await prisma.candidate.findMany({
    where: { id: { in: candidateIds } },
    select: {
      employeeId: true,
      employee: { select: { fullName: true } },
      round: { select: { requestId: true } },
    },
  });
  const requests = await prisma.manpowerRequest.findMany({
    where: { id: { in: [...new Set(candidates.map((c) => c.round?.requestId).filter(Boolean))] } },
    select: { id: true, projectId: true },
  });
  const projectByRequest = new Map(requests.map((r) => [r.id, r.projectId]));
  const pairs = candidates
    .map((c) => ({
      employeeId: c.employeeId,
      projectId: projectByRequest.get(c.round?.requestId),
      name: c.employee?.fullName,
    }))
    .filter((x) => x.projectId);
  if (pairs.length === 0) return;

  const deployed = await prisma.assignment.findMany({
    where: {
      OR: pairs.map(({ employeeId, projectId }) => ({ employeeId, projectId })),
    },
    select: { employeeId: true, projectId: true },
  });
  if (deployed.length === 0) return;

  const key = (e, p) => `${e}:${p}`;
  const deployedKeys = new Set(deployed.map((a) => key(a.employeeId, a.projectId)));
  const names = pairs
    .filter((x) => deployedKeys.has(key(x.employeeId, x.projectId)))
    .map((x) => x.name)
    .filter(Boolean);
  throw Object.assign(
    new Error(
      `${names.join(", ") || "พนักงานคนนี้"} deploy แล้ว — Undeploy ที่ Worker Schedule ก่อน`,
    ),
    { status: 409 },
  );
}

// ── ยกเลิก approve → กลับเป็น proposed (ล้างให้ตรงกับ approveWorkers) ──
export async function unapproveWorkers({ candidateIds, requestId }) {
  if (!candidateIds?.length) return { count: 0 };
  await assertNotDeployed(candidateIds);

  // 1) status กลับเป็น proposed
  const result = await prisma.candidate.updateMany({
    where: { id: { in: candidateIds } },
    data: { status: "proposed" },
  });

  // 2) ลบ ClientApproval ที่ approveWorkers สร้างไว้ (กัน record ค้าง)
  await prisma.clientApproval.deleteMany({
    where: { candidateId: { in: candidateIds } },
  });

  // 3) ถ้า request นี้ไม่เหลือ candidate ที่ approved → revert status กลับเป็น proposing
  if (requestId) {
    const stillApproved = await prisma.candidate.count({
      where: { status: "approved", round: { requestId } },
    });
    if (stillApproved === 0) {
      await prisma.manpowerRequest.update({
        where: { id: requestId },
        data: { status: "proposing" },
      });
    }
  }

  return { count: result.count };
}

export async function removeFromShortlist(candidateId) {
  await assertNotDeployed([candidateId]);
  return prisma.candidate.delete({ where: { id: candidateId } });
}

// ============================================================
// Eligibility check รายคน — แยก 3 กลุ่มต่อ client
//   mandatory : PositionRequirement ที่ requirementType อยู่ใน MANDATORY_REQUIREMENT_TYPES
//   assigned  : PositionRequirement ที่ requirementType = "assigned"
//   others    : training ที่พนักงานมี แต่ไม่อยู่ใน matrix (mandatory+assigned) ของ client นั้นเลย
// matchPct / eligible ของแต่ละ client อิงจากกลุ่ม mandatory เท่านั้น
// (ตรงกับตรรกะเดียวกับ complianceService.js)
// ============================================================
export async function getWorkerEligibility(
  employeeId,
  { positionId, contractId } = {},
) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      position: true,
      trainings: {
        where: { isLatest: true, status: "completed" },
        include: { globalTraining: true },
      },
    },
  });

  if (!employee) return null;

  const employeeTrainingByGlobalId = new Map();
  for (const t of employee.trainings) {
    if (t.globalTrainingId) {
      employeeTrainingByGlobalId.set(
        t.globalTrainingId,
        t.globalTraining?.name,
      );
    }
  }
  const empTrainingIds = new Set(employeeTrainingByGlobalId.keys());

  // ── ถ้ามี positionId ระบุมา (เช่น เปิดจาก quick search ที่เลือก Position Request ไว้แล้ว)
  //    ให้เทียบกับตำแหน่งนั้นแทนตำแหน่งปัจจุบันของพนักงานเอง ──
  const targetPositionId = positionId || employee.positionId;

  // หาชื่อตำแหน่งเป้าหมาย เผื่อไม่ตรงกับตำแหน่งปัจจุบันของพนักงาน (ใช้แสดงใน "Matched: ...")
  const targetPosition =
    targetPositionId === employee.positionId
      ? employee.position
      : await prisma.position.findUnique({
          where: { id: targetPositionId },
        });

  const contracts = await prisma.contract.findMany({
    where: {
      isActive: true,
      ...(contractId ? { id: contractId } : {}),
    },
    include: {
      client: true,
      positionRequirements: {
        where: { positionId: targetPositionId },
        include: {
          clientTraining: { include: { globalTraining: true } },
        },
      },
    },
  });

  const clientResults = contracts
    .filter((c) => c.positionRequirements.length > 0)
    .map((contract) => {
      const mandatory = { required: [], completed: [], missing: [] };
      const assigned = { required: [], completed: [], missing: [] };
      const matrixIds = new Set();

      for (const r of contract.positionRequirements) {
        const name =
          r.clientTraining.globalTraining?.name ?? r.clientTraining.nameAlias;
        const gtId = r.clientTraining.globalTrainingId;
        matrixIds.add(gtId);

        let group = null;
        if (MANDATORY_REQUIREMENT_TYPES.includes(r.requirementType)) {
          group = mandatory;
        } else if (r.requirementType === "assigned") {
          group = assigned;
        }
        if (!group) continue;

        group.required.push(name);
        const entry = { name, trainingId: gtId };
        if (empTrainingIds.has(gtId)) {
          group.completed.push(entry);
        } else {
          group.missing.push(entry);
        }
      }

      // Others — training ที่พนักงานมีจริง แต่ไม่อยู่ใน matrix ของ client นี้เลย
      const others = { completed: [] };
      for (const [gtId, name] of employeeTrainingByGlobalId) {
        if (!matrixIds.has(gtId)) {
          others.completed.push(name);
        }
      }

      const matchPct =
        mandatory.required.length > 0
          ? Math.round(
              (mandatory.completed.length / mandatory.required.length) * 100,
            )
          : 100;

      return {
        contractId: contract.id,
        contractName: contract.name,
        clientName: contract.client.name,
        positionMatched: targetPosition?.name,
        mandatory,
        assigned,
        others,
        matchPct,
        eligible: mandatory.missing.length === 0,
      };
    });

  return {
    employeeId,
    fullName: employee.fullName,
    empCode: employee.empCode,
    empId: employee.empId,
    position: employee.position?.name,
    mobilizationStatus: employee.mobilizationStatus,
    clients: clientResults,
  };
}

// ════════════════════════════════════════════════════════════════
// CV Summary — เวอร์ชันใหม่: หน้าตาตรงกับเรซูเม่จริงที่ส่งลูกค้า
// (แทนที่ getCvSummary เดิมในไฟล์ allocationService.js — ฟังก์ชันอื่นเหมือนเดิม)
//
// โครงสร้าง candidate แต่ละคนตอนนี้แบ่งเป็น 3 ส่วนเหมือนเรซูเม่:
//   personal            — Personal Details (address, gender, height ฯลฯ)
//   trainedCourses      — list ของ training เรียงวันที่ล่าสุดก่อน
//   professional        — { company, currentPosition, responsibilities[], projectReferences[] }
//
// ⚠ ต้อง migrate schema ก่อน (Employee.address/gender/height/weight/religion/
//   language/education/photoUrl, Position.responsibilities, Assignment.positionId,
//   Project.cvLabel) ไม่งั้น query พวกนี้จะพัง
// ════════════════════════════════════════════════════════════════
export async function getCvSummary(projectId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { contract: { include: { client: true } } },
  });
  if (!project) return null;

  const requests = await prisma.manpowerRequest.findMany({
    where: { projectId },
    include: {
      position: true,
      rounds: {
        include: {
          candidates: {
            where: { status: { not: "rejected" } },
            include: {
              employee: {
                include: {
                  position: true, // ตำแหน่งปัจจุบัน — ใช้เป็น fallback + หา responsibilities
                  passport: true,
                  medicalChecks: {
                    select: { checkType: true, expiryDate: true, status: true },
                  },
                  trainings: {
                    where: { isLatest: true },
                    include: { globalTraining: true },
                    orderBy: { completedDate: "desc" },
                  },
                  // ประวัติ deploy ทั้งหมด (ทุก project) → "Project References"
                  assignments: {
                    orderBy: { mobDate: "desc" },
                    include: {
                      position: true, // ตำแหน่ง ณ ตอน deploy รอบนั้น (snapshot)
                      project: {
                        include: { contract: { include: { client: true } } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const norm = (s) => (s || "").replace(/\s+/g, "").toLowerCase();

  const groups = requests
    .map((req) => {
      const byEmp = new Map();
      for (const round of [...req.rounds].sort((a, b) => a.round - b.round)) {
        for (const c of round.candidates) byEmp.set(c.employeeId, c);
      }

      const candidates = [...byEmp.values()].map((c) => {
        const e = c.employee;

        const medical =
          e.medicalChecks?.find(
            (m) => norm(m.checkType) === "medicalcheckup",
          ) || null;

        // ── Trained Courses ──
        const trainedCourses = e.trainings
          .filter((t) => t.globalTraining || t.rawTrainingName)
          .map((t) => ({
            name: t.globalTraining?.name ?? t.rawTrainingName,
            completedDate: t.completedDate,
            institute: t.institute ?? null,
          }));

        // ── Professional Experience ──
        const currentPosition = e.position?.name || req.position?.name || null;
        const responsibilities = e.position?.responsibilities
          ? e.position.responsibilities
              .split("\n")
              .filter((line) => line.trim())
          : [];

        const projectReferences = e.assignments
          .filter((a) => a.mobDate) // ข้าม record ที่ยังไม่มีวันที่ (ไม่พร้อมแสดงในเรซูเม่)
          .map((a) => ({
            projectLabel:
              a.project?.cvLabel ||
              a.project?.name ||
              a.projectLabel || // ← เพิ่ม — สำหรับ manual/historical entry
              (a.platform ? `Deployment at ${a.platform}` : "—"),
            position: a.positionLabel || a.position?.name || currentPosition, // ตำแหน่ง ณ รอบนั้น (ประวัติลงงาน) ก่อน
            mobDate: a.mobDate,
            demobDate: a.demobDate,
            platform: a.platform,
          }));

        return {
          fullName: e.fullName,
          empCode: e.empCode,
          position: currentPosition,
          nationality: e.nationality || null,
          birthDate: e.birthDate,
          startWorkDate: e.startWorkDate,
          status: c.status,

          // ── Personal Details (ส่วนใหม่) ──
          personal: {
            address: e.address || null,
            gender: e.gender || null,
            height: e.height ?? null,
            weight: e.weight ?? null,
            religion: e.religion || null,
            language: e.language || null,
            education: e.education || null,
            photoUrl: e.photoUrl || null,
            phone: e.phone || null,
            email: e.email || null,
          },

          trainedCourses,

          professional: {
            company: "Experteam Co., Ltd.",
            currentPosition,
            responsibilities,
            projectReferences,
          },

          // ── ของเดิม (ยังใช้อยู่ในการ์ดสรุป/eligibility อื่น) ──
          certifications: e.trainings
            .filter((t) => t.globalTraining)
            .map((t) => ({
              name: t.globalTraining.name,
              expiryDate: t.expiryDate,
              status: t.status,
            })),
          medical: medical
            ? { expiryDate: medical.expiryDate, status: medical.status }
            : null,
          passport: e.passport
            ? {
                passportNo: e.passport.passportNo,
                expiryDate: e.passport.expiryDate,
              }
            : null,
        };
      });

      return {
        position: req.position?.name,
        quantity: req.quantity,
        candidates,
      };
    })
    .filter((g) => g.candidates.length > 0);

  return {
    project: {
      name: project.name,
      location: project.location || null,
      client: project.contract?.client?.name || null,
      contractNo: project.contract?.contractNo || null,
    },
    generatedAt: new Date().toISOString(),
    groups,
  };
}

// ════════════════════════════════════════════════════════════════
// Roster (MOB/D-MOB) — export แยกต่างหาก สำหรับสรุปรอบ mobilize
// ตรงกับ sheet "Day off (x-x-xx)" ที่ HR ทำมือใน Excel ทุกวันนี้
//
// ⚠ 2 field ที่ยังไม่มีใน schema เลย — คืนเป็น null แล้วให้ frontend
//   เปิดช่องกรอกเองก่อน export/print:
//   - "from" (ในตัวอย่าง Excel เป็น "STH" — ยังไม่ทราบว่ามาจากไหน)
//   - "remark" (เช่น "ขึ้นด่วน", "ติดงาน Project")
// ════════════════════════════════════════════════════════════════
export async function getRoster(projectId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { contract: { include: { client: true } } },
  });
  if (!project) return null;

  const requests = await prisma.manpowerRequest.findMany({
    where: { projectId },
    include: {
      position: true,
      rounds: {
        include: {
          candidates: {
            where: { status: { not: "rejected" } },
            include: { employee: { include: { position: true } } },
          },
        },
      },
    },
  });

  // dedupe ต่อ employee เหมือน getCvSummary (round ใหม่ทับเก่า)
  const employeeMap = new Map(); // employeeId -> { employee, positionName }
  for (const req of requests) {
    for (const round of [...req.rounds].sort((a, b) => a.round - b.round)) {
      for (const c of round.candidates) {
        employeeMap.set(c.employeeId, {
          employee: c.employee,
          positionName: c.employee.position?.name || req.position?.name || null,
        });
      }
    }
  }

  const employeeIds = [...employeeMap.keys()];

  if (employeeIds.length === 0) {
    return {
      project: {
        name: project.name,
        location: project.location || null,
        client: project.contract?.client?.name || null,
        startDate: project.startDate || null,
      },
      rows: [],
    };
  }

  // โหลด Assignment ทั้งหมดของคนกลุ่มนี้ (ทั้งของ project นี้ + รอบก่อนหน้า)
  // เรียง mobDate desc ล่วงหน้า เพื่อให้ .find() ด้านล่างได้ตัวล่าสุดเสมอ
  const assignments = await prisma.assignment.findMany({
    where: { employeeId: { in: employeeIds } },
    orderBy: { mobDate: "desc" },
  });

  const workingDay = project.startDate || null;
  const workingDayMs = workingDay ? new Date(workingDay).getTime() : Date.now();

  const rows = employeeIds.map((empId) => {
    const { employee, positionName } = employeeMap.get(empId);
    const empAssignments = assignments.filter((a) => a.employeeId === empId);

    // TO — assignment ที่ผูกกับ project นี้โดยตรง (ถ้ามีการสร้างไว้แล้ว)
    const currentAssignment =
      empAssignments.find((a) => a.projectId === projectId) || null;

    // Previous — assignment ล่าสุดที่ "ไม่ใช่" ของ project นี้ และ demob ไปแล้วจริง
    // (มาจาก array ที่เรียง mobDate desc แล้ว → เจอตัวแรกคือล่าสุด)
    const previousAssignment =
      empAssignments.find((a) => a.projectId !== projectId && a.demobDate) ||
      null;

    const dayOff = previousAssignment?.demobDate
      ? Math.floor(
          (workingDayMs - new Date(previousAssignment.demobDate).getTime()) /
            86400000,
        )
      : null;

    return {
      employeeId: empId,
      fullName: employee.fullName,
      empCode: employee.empCode,
      position: positionName,
      company: "Experteam",
      from: currentAssignment?.fromLocation ?? null, // ← แก้: ไม่ fallback ไป previousAssignment.platform แล้ว
      to: currentAssignment?.platform ?? null,
      mobDate: previousAssignment?.mobDate ?? null,
      demobDate: previousAssignment?.demobDate ?? null,
      workingDay,
      dayOff,
      previousLocation: previousAssignment?.platform ?? null,
      remark: null,
    };
  });

  return {
    project: {
      name: project.name,
      location: project.location || null,
      client: project.contract?.client?.name || null,
      startDate: workingDay,
    },
    rows,
  };
}

// ════════════════════════════════════════════════════════════════
// Skill Matrix — export แยกต่างหาก แบบ pivot (แถว=คน, คอลัมน์=training)
// ตรงกับ sheet "Skill matrix (All)" — columns มาจาก union ของ
// PositionRequirement (mandatory+assigned) ของทุกตำแหน่งที่มีคนอยู่ใน
// shortlist รอบนี้ ภายใต้ contract ของ project นี้
// ════════════════════════════════════════════════════════════════
export async function getSkillMatrix(projectId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { contract: { include: { client: true } } },
  });
  if (!project) return null;

  const requests = await prisma.manpowerRequest.findMany({
    where: { projectId },
    include: {
      position: true,
      rounds: {
        include: {
          candidates: {
            where: { status: { not: "rejected" } },
            include: {
              employee: {
                include: {
                  position: true,
                  trainings: {
                    where: { isLatest: true },
                    include: { globalTraining: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  // dedupe ต่อ employee + เก็บ positionId ไว้หา PositionRequirement
  const employeeMap = new Map(); // employeeId -> employee (with trainings, position)
  const positionIds = new Set();
  for (const req of requests) {
    for (const round of [...req.rounds].sort((a, b) => a.round - b.round)) {
      for (const c of round.candidates) {
        employeeMap.set(c.employeeId, c.employee);
        if (c.employee.positionId) positionIds.add(c.employee.positionId);
      }
    }
  }

  if (employeeMap.size === 0) {
    return {
      project: {
        name: project.name,
        client: project.contract?.client?.name || null,
      },
      trainings: [],
      rows: [],
    };
  }

  // ── columns: union training (mandatory + assigned) ของทุกตำแหน่งในกลุ่มนี้ ──
  const positionRequirements = await prisma.positionRequirement.findMany({
    where: {
      contractId: project.contractId,
      positionId: { in: [...positionIds] },
    },
    include: { clientTraining: { include: { globalTraining: true } } },
  });

  const trainingMap = new Map(); // globalTrainingId -> name
  for (const r of positionRequirements) {
    const gtId = r.clientTraining.globalTrainingId;
    const name =
      r.clientTraining.globalTraining?.name ?? r.clientTraining.nameAlias;
    if (gtId && !trainingMap.has(gtId)) trainingMap.set(gtId, name);
  }
  const trainings = [...trainingMap.entries()].map(([id, name]) => ({
    id,
    name,
  }));

  // ── rows: ต่อ employee — cell = completed/expiry/status ของ training นั้น (ถ้ามี) ──
  const rows = [...employeeMap.entries()].map(([empId, employee]) => {
    const byGlobalId = new Map();
    for (const t of employee.trainings) {
      if (t.globalTrainingId) byGlobalId.set(t.globalTrainingId, t);
    }

    const cells = trainings.map((tr) => {
      const t = byGlobalId.get(tr.id);
      return {
        trainingId: tr.id,
        completedDate: t?.completedDate ?? null,
        expiryDate: t?.expiryDate ?? null,
        status: t?.status ?? null, // completed | overdue | due_soon | if_required | null (ไม่มีข้อมูล)
      };
    });

    return {
      employeeId: empId,
      fullName: employee.fullName,
      empCode: employee.empCode,
      position: employee.position?.name ?? null,
      cells,
    };
  });

  return {
    project: {
      name: project.name,
      client: project.contract?.client?.name || null,
    },
    trainings,
    rows,
  };
}

// ════════════════════════════════════════════════════════════════
// Per-Worker Export — CV Summary / Roster History / Skill Matrix
// ใช้กับ WorkerDetail.jsx (export ของพนักงานคนเดียว ไม่ผูกกับ project)
// ════════════════════════════════════════════════════════════════

export async function getCvSummaryForWorker(employeeId) {
  const e = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      position: true,
      passport: true,
      medicalChecks: {
        select: { checkType: true, expiryDate: true, status: true },
      },
      trainings: {
        where: { isLatest: true },
        include: { globalTraining: true },
        orderBy: { completedDate: "desc" },
      },
      assignments: {
        orderBy: { mobDate: "desc" },
        include: {
          position: true,
          project: { include: { contract: { include: { client: true } } } },
        },
      },
    },
  });
  if (!e) return null;

  const norm = (s) => (s || "").replace(/\s+/g, "").toLowerCase();
  const medical =
    e.medicalChecks?.find((m) => norm(m.checkType) === "medicalcheckup") ||
    null;

  const trainedCourses = e.trainings
    .filter((t) => t.globalTraining || t.rawTrainingName)
    .map((t) => ({
      name: t.globalTraining?.name ?? t.rawTrainingName,
      completedDate: t.completedDate,
      institute: t.institute ?? null,
    }));

  const currentPosition = e.position?.name || null;
  const responsibilities = e.position?.responsibilities
    ? e.position.responsibilities.split("\n").filter((l) => l.trim())
    : [];

  // ประวัติ deploy ทั้งหมด (ไม่ผูก project เดียวแบบตอนสร้าง CV ระดับ project)
  const projectReferences = e.assignments
    .filter((a) => a.mobDate)
    .map((a) => ({
      projectLabel:
        a.project?.cvLabel ||
        a.project?.name ||
        a.projectLabel ||
        (a.platform ? `Deployment at ${a.platform}` : "—"),
      position: a.positionLabel || a.position?.name || currentPosition, // ตำแหน่ง ณ รอบนั้น (ประวัติลงงาน) ก่อน
      mobDate: a.mobDate,
      demobDate: a.demobDate,
      platform: a.platform,
    }));

  return {
    fullName: e.fullName,
    empCode: e.empCode,
    position: currentPosition,
    nationality: e.nationality || null,
    birthDate: e.birthDate,
    startWorkDate: e.startWorkDate,

    personal: {
      address: e.address || null,
      gender: e.gender || null,
      height: e.height ?? null,
      weight: e.weight ?? null,
      religion: e.religion || null,
      language: e.language || null,
      education: e.education || null,
      photoUrl: e.photoUrl || null,
      phone: e.phone || null,
      email: e.email || null,
    },

    trainedCourses,

    professional: {
      company: "Experteam Co., Ltd.",
      currentPosition,
      responsibilities,
      projectReferences,
    },

    medical: medical
      ? { expiryDate: medical.expiryDate, status: medical.status }
      : null,
    passport: e.passport
      ? { passportNo: e.passport.passportNo, expiryDate: e.passport.expiryDate }
      : null,
  };
}

// ── Roster History: ประวัติ mob/demob ทั้งหมดของพนักงานคนเดียว (ไม่ใช่แค่ 1 project) ──
export async function getRosterForWorker(employeeId) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { position: true },
  });
  if (!employee) return null;

  // เรียง mobDate desc — ใหม่สุดก่อน
  const assignments = await prisma.assignment.findMany({
    where: { employeeId },
    orderBy: { mobDate: "desc" },
  });

  const rows = assignments.map((a, idx) => {
    // record ถัดไปใน array (เพราะเรียง desc) = รอบก่อนหน้าตามเวลาจริง
    const prev = assignments[idx + 1] || null;

    // ── แถวล่าสุด (idx=0) ที่ completed แล้ว (มีทั้ง mobDate/demobDate) ──
    // ตีความแบบเดียวกับ getRoster (project-level): ถือเป็น "ที่มาก่อนหน้า"
    // ของรอบถัดไปที่ยังไม่เกิดขึ้น ไม่ใช่ deployment ปัจจุบันที่ยังอยู่
    // ⚠ trade-off: ถ้ามีหลาย assignment แถวบนสุดจะไม่โชว์ "to" ของตัวเอง
    // (ตรงกับพฤติกรรมหน้า Allocation.jsx ตอนนี้)
    const isLatest = idx === 0;
    const isCompleted = a.mobDate && a.demobDate;

    if (isLatest && isCompleted) {
      return {
        fullName: employee.fullName,
        empCode: employee.empCode,
        position: employee.position?.name ?? null,
        company: "Experteam",
        from: a.fromLocation ?? null,
        to: null,
        mobDate: a.mobDate ?? null,
        demobDate: a.demobDate ?? null,
        previousLocation: a.platform ?? null,
        remark: a.remark ?? null,
      };
    }

    return {
      fullName: employee.fullName,
      empCode: employee.empCode,
      position: employee.position?.name ?? null,
      company: "Experteam",
      from: a.fromLocation ?? null,
      to: a.platform ?? null,
      mobDate: a.mobDate ?? null,
      demobDate: a.demobDate ?? null,
      previousLocation: prev?.platform ?? null,
      remark: a.remark ?? null,
    };
  });

  return {
    employee: { fullName: employee.fullName, empCode: employee.empCode },
    rows,
  };
}

// ── Skill Matrix: เทียบกับ position requirement ของพนักงานคนเดียว
//    contractId เป็น optional — ไม่ระบุ = รวมทุก contract ที่มี matrix ของ position นี้ ──
export async function getSkillMatrixForWorker(employeeId, contractId) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      position: true,
      trainings: {
        where: { isLatest: true },
        include: { globalTraining: true },
      },
    },
  });
  if (!employee || !employee.positionId) return null;

  const positionRequirements = await prisma.positionRequirement.findMany({
    where: {
      positionId: employee.positionId,
      ...(contractId ? { contractId } : {}),
    },
    include: {
      clientTraining: { include: { globalTraining: true } },
      contract: { include: { client: true } },
    },
  });

  const trainingMap = new Map();
  for (const r of positionRequirements) {
    const gtId = r.clientTraining.globalTrainingId;
    const name =
      r.clientTraining.globalTraining?.name ?? r.clientTraining.nameAlias;
    if (gtId && !trainingMap.has(gtId)) trainingMap.set(gtId, name);
  }
  const trainings = [...trainingMap.entries()].map(([id, name]) => ({
    id,
    name,
  }));

  const byGlobalId = new Map();
  for (const t of employee.trainings) {
    if (t.globalTrainingId) byGlobalId.set(t.globalTrainingId, t);
  }

  const cells = trainings.map((tr) => {
    const t = byGlobalId.get(tr.id);
    return {
      trainingId: tr.id,
      completedDate: t?.completedDate ?? null,
      expiryDate: t?.expiryDate ?? null,
      status: t?.status ?? null,
    };
  });

  return {
    employee: {
      fullName: employee.fullName,
      empCode: employee.empCode,
      position: employee.position?.name ?? null,
    },
    trainings,
    rows: [
      {
        employeeId,
        fullName: employee.fullName,
        empCode: employee.empCode,
        position: employee.position?.name ?? null,
        cells,
      },
    ],
  };
}
