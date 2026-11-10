import { PrismaClient } from "@prisma/client";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const prisma = new PrismaClient();

// ── helper: แปลง roster + personal-detail fields ให้ปลอดภัย (ใช้ทั้ง create/update) ──
// คืนเฉพาะ key ที่ "ส่งมาใน body" เพื่อไม่เผลอทับค่าเดิมด้วย null ตอน update
//
// address/gender/height/weight/religion/language/education สำหรับ Personal Details ใน CV Summary
function buildRosterData(data) {
  const out = {};
  if ("birthDate" in data)
    out.birthDate = data.birthDate ? new Date(data.birthDate) : null;
  if ("isPermanent" in data) out.isPermanent = !!data.isPermanent;
  if ("healthRisk" in data) out.healthRisk = data.healthRisk || null;
  if ("healthNote" in data) out.healthNote = data.healthNote || null;
  if ("sseLevel" in data) out.sseLevel = data.sseLevel || null;
  if ("sseCompleted" in data)
    out.sseCompleted =
      data.sseCompleted === null || data.sseCompleted === undefined
        ? null
        : !!data.sseCompleted;

  // ── CV Personal Details ──
  if ("address" in data) out.address = data.address || null;
  if ("gender" in data) out.gender = data.gender || null;
  if ("height" in data)
    out.height =
      data.height === "" || data.height === null || data.height === undefined
        ? null
        : Number(data.height);
  if ("weight" in data)
    out.weight =
      data.weight === "" || data.weight === null || data.weight === undefined
        ? null
        : Number(data.weight);
  if ("religion" in data) out.religion = data.religion || null;
  if ("language" in data) out.language = data.language || null;
  if ("education" in data) out.education = data.education || null;

  return out;
}

// ── helper: หาเลข EXPT สูงสุดใน DB ──
async function computeNextExptNumber() {
  const emps = await prisma.employee.findMany({
    where: { empCode: { startsWith: "EXPT-" } },
    select: { empCode: true },
  });
  let max = 0;
  for (const e of emps) {
    const m = /^EXPT-(\d+)$/.exec(e.empCode || "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

function formatEmpCode(n) {
  return `EXPT-${String(n).padStart(3, "0")}`;
}

// ── ส่งรหัส EXPT ถัดไปให้ frontend แสดงในฟอร์ม ──
export async function getNextEmpCode() {
  const next = await computeNextExptNumber();
  return formatEmpCode(next);
}

// ============================================================
// Cert matching → mobilizationStatus / availabilityStatus
// ============================================================
const PRIMARY_CLIENT_NAME = "Chevron";
const MANDATORY_REQUIREMENT_TYPES = ["required", "mandatory"];

export async function computeMatchPercent(employeeId) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      trainings: {
        where: { isLatest: true },
        select: { globalTrainingId: true, expiryDate: true },
      },
      medicalChecks: {
        select: { expiryDate: true },
      },
    },
  });

  if (!employee || !employee.positionId) return null;

  const client = await prisma.client.findFirst({
    where: { name: PRIMARY_CLIENT_NAME },
  });
  if (!client) return null;

  const contract = await prisma.contract.findFirst({
    where: { clientId: client.id, isActive: true },
    orderBy: { createdAt: "desc" },
  });
  if (!contract) return null;

  const requirements = await prisma.positionRequirement.findMany({
    where: {
      positionId: employee.positionId,
      contractId: contract.id,
      requirementType: { in: MANDATORY_REQUIREMENT_TYPES },
    },
    include: { clientTraining: { select: { globalTrainingId: true } } },
  });

  if (requirements.length === 0) return null;

  const requiredIds = new Set(
    requirements.map((r) => r.clientTraining.globalTrainingId),
  );
  const completedIds = new Set(
    employee.trainings.map((t) => t.globalTrainingId).filter(Boolean),
  );

  const required = requiredIds.size;
  const completed = [...requiredIds].filter((id) =>
    completedIds.has(id),
  ).length;
  const score = required > 0 ? Math.round((completed / required) * 100) : 0;

  const now = new Date();
  const hasExpiredCert =
    employee.trainings.some(
      (t) => t.expiryDate && new Date(t.expiryDate) < now,
    ) ||
    employee.medicalChecks.some(
      (m) => m.expiryDate && new Date(m.expiryDate) < now,
    );

  return { required, completed, score, hasExpiredCert };
}

export async function recomputeMobilizationAndAvailability(employeeId) {
  const current = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { mobilizationStatus: true },
  });
  if (!current) return;

  if (current.mobilizationStatus === "on_site") return;

  const match = await computeMatchPercent(employeeId);
  if (!match) return;

  const mobilizationStatus =
    match.score === 100 && !match.hasExpiredCert ? "ready" : "pending";
  const availabilityStatus = "available";

  await prisma.employee.update({
    where: { id: employeeId },
    data: { mobilizationStatus, availabilityStatus },
  });
}

export async function getWorkers() {
  return prisma.employee.findMany({
    include: { position: true },
    orderBy: { fullName: "asc" },
  });
}

export async function getWorkerById(id) {
  return prisma.employee.findUnique({
    where: { id },
    include: {
      position: true,
      passport: true,
      medicalChecks: true,
      trainings: {
        where: { isLatest: true },
        include: { globalTraining: true },
      },
      // ← เพิ่มใหม่: ประวัติ deploy (ทั้งของจริงจาก Mobilization และ manual/historical
      //   entry ที่ HR กรอกเอง) — ใช้แสดง/แก้ไขใน EditWorker.jsx section ใหม่
      assignments: {
        orderBy: { mobDate: "desc" },
        include: { position: true },
      },
      medicalExamRecords: {
        orderBy: { examDate: "desc" },
      },
    },
  });
}

export async function createWorker(data) {
  let empCode = (data.empCode || "").trim();
  if (!empCode) {
    empCode = formatEmpCode(await computeNextExptNumber());
  }

  const buildData = (code) => ({
    empCode: code,
    fullName: data.fullName,
    // ชื่ออังกฤษที่หน้า Workers / dropdown ค้นหาใช้ = ชื่อตาม passport (fullName)
    fullNameEN: data.fullName || undefined, // ไม่ส่ง fullName มา = ไม่แตะ
    fullNameTH: data.fullNameTH || null, // ← เพิ่ม
    empId: data.empId || null, // ← เพิ่ม
    nationality: data.nationality || null,
    phone: data.phone || null,
    email: data.email || null,
    notes: data.notes || null,
    positionId: data.positionId || null,
    division: data.division || null,
    startWorkDate: data.startWorkDate ? new Date(data.startWorkDate) : null,
    status: data.status || "active",
    availabilityStatus: data.availabilityStatus || "available",
    mobilizationStatus: data.mobilizationStatus || "pending",
    isOffshore: data.isOffshore || false,
    ...buildRosterData(data),
  });

  const MAX_RETRY = 5;
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    try {
      return await prisma.employee.create({ data: buildData(empCode) });
    } catch (error) {
      const isEmpCodeClash =
        error.code === "P2002" &&
        (error.meta?.target?.includes?.("empCode") ||
          error.meta?.target?.[0] === "empCode");

      if (isEmpCodeClash && /^EXPT-\d+$/.test(empCode)) {
        empCode = formatEmpCode(await computeNextExptNumber());
        continue;
      }
      throw error;
    }
  }

  throw new Error("ไม่สามารถสร้างรหัสพนักงานที่ไม่ซ้ำได้ กรุณาลองอีกครั้ง");
}

// upsert เพราะ Passport ผูกกับ employee 1-to-1
export async function createPassport(employeeId, data) {
  return prisma.passport.upsert({
    where: { employeeId },
    update: {
      passportNo: data.passportNo || null,
      expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
      workPermitNo: data.workPermitNo || null,
      workPermitExpiryDate: data.workPermitExpiryDate
        ? new Date(data.workPermitExpiryDate)
        : null,
    },
    create: {
      employeeId,
      passportNo: data.passportNo || null,
      expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
      workPermitNo: data.workPermitNo || null,
      workPermitExpiryDate: data.workPermitExpiryDate
        ? new Date(data.workPermitExpiryDate)
        : null,
    },
  });
}

export async function createTraining(employeeId, data) {
  const result = await prisma.employeeTraining.create({
    data: {
      employeeId,
      globalTrainingId: data.globalTrainingId || null,
      completedDate: data.completedDate ? new Date(data.completedDate) : null,
      expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
      status: "completed",
      source: data.source || "manual",
      isLatest: true,
      version: 1,
    },
  });
  await recomputeMobilizationAndAvailability(employeeId);
  return result;
}

export async function updateTraining(trainingId, data) {
  const result = await prisma.employeeTraining.update({
    where: { id: trainingId },
    data: {
      globalTrainingId: data.globalTrainingId || null,
      completedDate: data.completedDate ? new Date(data.completedDate) : null,
      expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
    },
  });
  await recomputeMobilizationAndAvailability(result.employeeId);
  return result;
}

export async function deleteTraining(trainingId) {
  const existing = await prisma.employeeTraining.findUnique({
    where: { id: trainingId },
    select: { employeeId: true },
  });
  const result = await prisma.employeeTraining.delete({
    where: { id: trainingId },
  });
  if (existing) {
    await recomputeMobilizationAndAvailability(existing.employeeId);
  }
  return result;
}

export async function createMedical(employeeId, data) {
  const checkType = data.checkType || "Medical Check up";
  const fields = {
    hospital: data.hospital || null,
    issuedDate: data.issuedDate ? new Date(data.issuedDate) : null,
    expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
    status: data.status || "pending",
    notes: data.notes || null,
  };

  // มี checkType เดียวกันอยู่แล้ว → อัปเดตใบเดิม ไม่สร้างใบซ้ำ
  // (unique key มี medicalRequirementId ที่เป็น null ได้ DB จึงกันซ้ำให้ไม่ได้)
  const existing = await prisma.medicalCheck.findFirst({
    where: { employeeId, checkType },
    orderBy: { expiryDate: "desc" },
  });
  if (existing) {
    return prisma.medicalCheck.update({
      where: { id: existing.id },
      data: fields,
    });
  }

  return prisma.medicalCheck.create({
    data: { employeeId, checkType, ...fields },
  });
}

export async function updateMedical(medicalId, data) {
  return prisma.medicalCheck.update({
    where: { id: medicalId },
    data: {
      checkType: data.checkType || "Medical Check up",
      hospital: data.hospital || null,
      issuedDate: data.issuedDate ? new Date(data.issuedDate) : null,
      expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
      status: data.status || "pending",
      notes: data.notes || null,
    },
  });
}

// ════════════════════════════════════════════════════════════════
// Past Deployment (Project References) — manual/historical entry
// สร้าง Assignment ที่ไม่ผูก Booking/Project จริง (bookingId=null, projectId=null)
// ใช้ backfill ประวัติเก่าที่ไม่เคยอยู่ในระบบ (ก่อนเริ่มใช้ Mobilization flow)
// ════════════════════════════════════════════════════════════════
// ช่องข้อความของประวัติเดินทาง (ตามไฟล์ "แจ้งการเดินทางกลับ" ของ HR)
//   travelTeamNo = Traveling Team No. (ON Number) · field = Field · travelOut = ขาไป · travelBack = ขากลับ · remark = หมายเหตุ
const cleanText = (v, max = 200) => {
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  return s || null;
};

function buildDeploymentData(data) {
  return {
    positionId: data.positionId || null,
    // ตำแหน่ง ณ รอบนั้นตามที่ HR กรอก — แยกจากตำแหน่งปัจจุบันของพนักงาน
    positionLabel: cleanText(data.positionLabel, 200),
    projectLabel: data.projectLabel || null,
    platform: data.platform || null,
    mobDate: data.mobDate ? new Date(data.mobDate) : null,
    demobDate: data.demobDate ? new Date(data.demobDate) : null,
    field: cleanText(data.field, 100), // Field เช่น BENCHAMAS (แยกจาก projectLabel)
    travelTeamNo: cleanText(data.travelTeamNo, 100),
    travelOut: cleanText(data.travelOut, 100),
    travelBack: cleanText(data.travelBack, 100),
    remark: cleanText(data.remark, 500),
  };
}

export async function createDeployment(employeeId, data) {
  return prisma.assignment.create({
    data: {
      employeeId,
      bookingId: null,
      projectId: null,
      ...buildDeploymentData(data),
      status: "completed", // ของเก่าถือว่าจบไปแล้วเสมอ
    },
  });
}

export async function updateDeployment(deploymentId, data) {
  return prisma.assignment.update({
    where: { id: deploymentId },
    data: buildDeploymentData(data),
  });
}

export async function deleteDeployment(deploymentId) {
  return prisma.assignment.delete({ where: { id: deploymentId } });
}

// ════════════════════════════════════════════════════════════════
// Medical Exam Record (PE tracking) — CRUD + auto-sync Employee.healthRisk
// ════════════════════════════════════════════════════════════════

// ── ฟังก์ชันกลาง: หา record ที่ examDate ล่าสุดจริงๆ ในบรรดา record
// ทั้งหมดของ employee คนนี้ แล้วตั้ง isLatest ให้ตรงกับตัวนั้นตัวเดียว
// พร้อม sync Employee.healthRisk ตาม — เรียกใช้หลัง create/update/delete
// ทุกครั้ง เพื่อให้ผลลัพธ์ถูกต้องเสมอไม่ว่าจะแก้ไข/ลบ/เพิ่ม record ไหนก่อนหลัง
//
// record ที่ไม่มี examDate (ไม่ควรเกิดเพราะ frontend บังคับกรอก แต่กันไว้
// เผื่อข้อมูลเก่า) จะถูกนับว่าเก่าที่สุดเสมอ ไม่มีทางถูกเลือกเป็น latest
// ถ้ามี record อื่นที่มี examDate อยู่
async function recomputeLatestMedicalExam(employeeId) {
  const records = await prisma.medicalExamRecord.findMany({
    where: { employeeId },
  });

  // ไม่เหลือ record เลย → healthRisk กลับเป็น null (fallback โหมดกรอกมือ)
  if (records.length === 0) {
    await prisma.employee.update({
      where: { id: employeeId },
      data: { healthRisk: null },
    });
    return null;
  }

  let winner = records[0];
  for (const r of records) {
    const rTime = r.examDate ? new Date(r.examDate).getTime() : -Infinity;
    const wTime = winner.examDate
      ? new Date(winner.examDate).getTime()
      : -Infinity;
    if (rTime > wTime) winner = r;
  }

  await prisma.$transaction([
    prisma.medicalExamRecord.updateMany({
      where: { employeeId, NOT: { id: winner.id } },
      data: { isLatest: false },
    }),
    prisma.medicalExamRecord.update({
      where: { id: winner.id },
      data: { isLatest: true },
    }),
    prisma.employee.update({
      where: { id: employeeId },
      data: { healthRisk: winner.healthRisk || null },
    }),
  ]);

  return winner;
}

// สร้าง record ใหม่ → แล้ว recompute ว่า record ไหนควรเป็น isLatest จริงๆ
// (ไม่ใช่ตั้ง isLatest=true ให้ record ใหม่เสมอเหมือนเดิม — เพราะถ้า examDate
// ที่กรอกเข้ามาเก่ากว่า record ที่มีอยู่แล้ว ก็ไม่ควรกลายเป็น latest)
export async function createMedicalExam(employeeId, data) {
  const latestSoFar = await prisma.medicalExamRecord.findFirst({
    where: { employeeId, isLatest: true },
  });

  const created = await prisma.medicalExamRecord.create({
    data: {
      ...data,
      examDate: data.examDate ? new Date(data.examDate) : null,
      commentDate: data.commentDate ? new Date(data.commentDate) : null,
      employeeId,
      version: (latestSoFar?.version ?? 0) + 1,
      isLatest: false, // ← จะถูก recompute ด้านล่างให้ถูกต้องอีกที
      source: "manual",
    },
  });

  await recomputeLatestMedicalExam(employeeId);

  // ดึงกลับมาใหม่ เพราะ isLatest อาจถูก recompute เปลี่ยนไปจากตอน create
  return prisma.medicalExamRecord.findUnique({ where: { id: created.id } });
}

// แก้ไข record ที่มีอยู่แล้ว (รวมถึงกรณีแก้ examDate ให้ใหม่กว่า/เก่ากว่าเดิม)
// แล้ว recompute ว่า record ไหนควรเป็น latest จริงๆ หลังแก้เสร็จ
// ครอบคลุมทั้ง 2 เคส:
//   - แก้ record ที่ไม่ใช่ latest ให้มี examDate ใหม่กว่า latest ปัจจุบัน → ต้องสลับ
//   - แก้ record ที่เป็น latest อยู่ ให้มี examDate เก่ากว่า record อื่น → ต้องสลับ
export async function updateMedicalExam(examId, data) {
  const existing = await prisma.medicalExamRecord.findUnique({
    where: { id: examId },
  });
  if (!existing) throw new Error("Medical exam record not found");

  await prisma.medicalExamRecord.update({
    where: { id: examId },
    data: {
      ...data,
      examDate: data.examDate ? new Date(data.examDate) : null,
      commentDate: data.commentDate ? new Date(data.commentDate) : null,
    },
  });

  await recomputeLatestMedicalExam(existing.employeeId);

  return prisma.medicalExamRecord.findUnique({ where: { id: examId } });
}

// ลบ record — แล้ว recompute ว่า record ที่เหลือ (ถ้ามี) ตัวไหนควรเป็น latest
export async function deleteMedicalExam(examId) {
  const record = await prisma.medicalExamRecord.delete({
    where: { id: examId },
  });

  await recomputeLatestMedicalExam(record.employeeId);

  return record;
}

export async function updateWorker(id, data) {
  // เช็คค่าก่อนหน้า เพื่อรู้ว่านี่คือ "การเปลี่ยนเป็น on_site ครั้งแรก" หรือเปล่า
  const before = await prisma.employee.findUnique({
    where: { id },
    select: { mobilizationStatus: true },
  });

  const isNewlyOnSite =
    before?.mobilizationStatus !== "on_site" &&
    data.mobilizationStatus === "on_site";

  const result = await prisma.employee.update({
    where: { id },
    data: {
      empCode: data.empCode,
      fullName: data.fullName,
      // แก้ชื่อที่หน้า EditWorker แล้วต้องเปลี่ยนชื่ออังกฤษตามด้วย
      // (เดิม fullNameEN มาจาก Data Import แล้วไม่เคยถูกแก้ → หน้า Workers ยังโชว์ชื่อเก่า)
      fullNameEN: data.fullName || undefined, // ไม่ส่ง fullName มา = ไม่แตะ
      fullNameTH: data.fullNameTH || null,
      empId: data.empId || null,
      nationality: data.nationality || null,
      phone: data.phone || null,
      email: data.email || null,
      notes: data.notes || null,
      positionId: data.positionId || null,
      division: data.division || null,
      startWorkDate: data.startWorkDate ? new Date(data.startWorkDate) : null,
      status: data.status || "active",
      availabilityStatus: data.availabilityStatus || "available",
      mobilizationStatus: data.mobilizationStatus || "pending",
      isOffshore: data.isOffshore || false,
      ...(isNewlyOnSite ? { onSiteAt: new Date() } : {}), // ← เพิ่มบรรทัดนี้
      ...buildRosterData(data),
    },
  });
  await recomputeMobilizationAndAvailability(id);
  return result;
}

// ════════════════════════════════════════════════════════════════
// Photo Upload — บันทึก path ไฟล์รูปที่ multer เซฟไว้แล้ว ลง Employee.photoUrl
// (multer จัดการ save ไฟล์ลง disk ให้แล้วใน middleware — ฟังก์ชันนี้แค่ผูก path เข้า DB)
// ════════════════════════════════════════════════════════════════
export async function updateWorkerPhoto(id, photoUrl) {
  return prisma.employee.update({
    where: { id: String(id) },
    data: { photoUrl },
  });
}

// ════════════════════════════════════════════════════════════════
// Certification File Upload — บันทึก path ไฟล์ cert ที่ multer เซฟไว้แล้ว
// ลง EmployeeTraining.certFileUrl (เหมือน pattern updateWorkerPhoto)
// ════════════════════════════════════════════════════════════════
export async function updateTrainingCertFile(
  trainingId,
  certFileUrl,
  certFileName,
) {
  return prisma.employeeTraining.update({
    where: { id: trainingId },
    data: { certFileUrl, certFileName },
  });
}

export async function deleteTrainingCertFile(trainingId) {
  const existing = await prisma.employeeTraining.findUnique({
    where: { id: trainingId },
    select: { certFileUrl: true },
  });
  if (!existing) throw new Error("Training record not found");

  if (existing.certFileUrl) {
    const filePath = path.join(
      __dirname,
      "..",
      existing.certFileUrl.replace(/^\//, ""),
    );
    fs.existsSync(filePath) && fs.unlinkSync(filePath);
  }

  return prisma.employeeTraining.update({
    where: { id: trainingId },
    data: { certFileUrl: null, certFileName: null },
  });
}

export async function deleteWorker(id) {
  return prisma.employee.update({
    where: { id: String(id) },
    data: { status: "inactive" },
  });
}

export async function getDivisions() {
  const rows = await prisma.employee.findMany({
    where: { division: { not: null } },
    distinct: ["division"],
    select: { division: true },
    orderBy: { division: "asc" },
  });
  return rows.map((r) => r.division).filter(Boolean);
}

export async function deleteMedical(medicalId) {
  return prisma.medicalCheck.delete({
    where: { id: medicalId },
  });
}

export async function getHealthRiskOptions() {
  const results = await prisma.employee.findMany({
    where: { healthRisk: { not: null } },
    select: { healthRisk: true },
    distinct: ["healthRisk"],
    orderBy: { healthRisk: "asc" },
  });
  return results.map((r) => r.healthRisk).filter(Boolean);
}
