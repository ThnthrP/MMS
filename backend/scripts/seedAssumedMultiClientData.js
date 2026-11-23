// ============================================================
// scripts/seedAssumedMultiClientData.js
// ข้อมูลสมมติสำหรับพัฒนาโหมด multi-client: พนักงาน + training record + project ของ Erawan / PTT / Valeura
// ใช้บนเครื่อง dev เท่านั้น ห้ามรันบน server (ไม่รันถ้า NODE_ENV=production)
//
// ต้องรัน seedAssumedClientTrainings.js --apply ก่อน (training record สร้างจาก training ที่ผูกกับลูกค้านั้น)
//
// สร้างอะไร (ทุกอย่างมีเครื่องหมายไว้ลบทีหลัง)
//   พนักงาน      5 คน / ลูกค้า   empCode ขึ้นต้น ASM-  · notes = [ASSUMED] · ชื่อ "Demo Worker ER-01"
//   training     ต่อพนักงาน       source = assumed_demo · มีทั้งปกติ / ใกล้หมด / หมดอายุ / ไม่มี
//   ON Number    2–3 / ลูกค้า     MasterProjectRecord.projectCode ขึ้นต้น DEMO- · sourceFile = [ASSUMED]
//   requirement  1 ต่อ ON         Project.notes = [ASSUMED] · ตำแหน่งที่ขอ 2 ตำแหน่ง (ManpowerRequest)
//   ประวัติลงงาน  ใน project ที่จบแล้ว  Assignment.remark = [ASSUMED]
//
// วิธีรัน (ใน container dev)
//   docker exec chevron-backend node scripts/seedAssumedMultiClientData.js                 # dry run
//   docker exec chevron-backend node scripts/seedAssumedMultiClientData.js --apply
//   docker exec chevron-backend node scripts/seedAssumedMultiClientData.js --undo          # ดูว่าจะลบอะไร
//   docker exec chevron-backend node scripts/seedAssumedMultiClientData.js --undo --apply
//
// --undo ลบเฉพาะข้อมูลที่มีเครื่องหมายข้างบน ถ้าข้อมูลสมมติถูกใช้ต่อในหน้าจอ (เช่น ใส่ชื่อใน Assign Names,
// จอง training, ตั้ง PIN) รายการนั้นจะถูกข้ามและแจ้งว่าติดอะไร — ลบรายการที่ติดในหน้าจอก่อน หรือกู้คืนจาก backup
// ============================================================
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const UNDO = process.argv.includes("--undo");
const MARK = "[ASSUMED]";
const EMP_PREFIX = "ASM-";
const CODE_PREFIX = "DEMO-";
const TRAINING_SOURCE = "assumed_demo";
const PER_CLIENT = 5;
const DAY = 86400000;

// ลูกค้า (aliases = ชื่อที่อาจใช้ใน DB) และ project สมมติ — วันที่นับจากวันนี้
const CLIENTS = [
  {
    key: "ER", aliases: ["Erawan"],
    projects: [
      { tag: "01", title: "Platform maintenance", location: "Field A (สมมติ)", start: -30, end: 60 },
      { tag: "02", title: "Shutdown support", location: "Field B (สมมติ)", start: 20, end: 50 },
      { tag: "03", title: "Scaffolding campaign", location: "Field A (สมมติ)", start: -120, end: -60, completed: true },
    ],
  },
  {
    key: "PTT", aliases: ["PTTEP", "PTT"],
    projects: [
      { tag: "01", title: "Offshore manpower supply", location: "Field C (สมมติ)", start: -10, end: 80 },
      { tag: "02", title: "Painting and blasting", location: "Field D (สมมติ)", start: -150, end: -90, completed: true },
    ],
  },
  {
    key: "VAL", aliases: ["Valeura"],
    projects: [
      { tag: "01", title: "Field support", location: "Field E (สมมติ)", start: -45, end: 15 },
      { tag: "02", title: "Turnaround", location: "Field F (สมมติ)", start: 60, end: 120 },
    ],
  },
];

const day = (n) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + n * DAY);
};

function guard() {
  if (process.env.NODE_ENV === "production") {
    console.error("✗ NODE_ENV=production — script นี้ใช้บนเครื่อง dev เท่านั้น");
    process.exit(1);
  }
}

const findClient = (aliases) =>
  prisma.client.findFirst({
    where: { OR: aliases.map((a) => ({ name: { equals: a, mode: "insensitive" } })) },
    include: { contracts: { where: { isActive: true }, orderBy: { createdAt: "asc" }, take: 1 } },
  });

// ตำแหน่งที่ใช้กับพนักงาน / requirement สมมติ: ตำแหน่งที่มีใน Training Matrix มากที่สุด
async function pickPositions(n) {
  const rows = await prisma.positionRequirement.groupBy({
    by: ["positionId"],
    _count: { positionId: true },
    orderBy: { _count: { positionId: "desc" } },
    take: n,
  });
  let ids = rows.map((r) => r.positionId);
  if (ids.length < n) {
    const more = await prisma.position.findMany({
      where: { id: { notIn: ids } }, orderBy: { name: "asc" }, take: n - ids.length, select: { id: true },
    });
    ids = ids.concat(more.map((p) => p.id));
  }
  return prisma.position.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
}

// สถานะ cert แบบกระจาย (ไม่สุ่ม — รันซ้ำได้ผลเดิม): 20% ไม่มี · 10% หมดอายุ · 10% ใกล้หมด · 60% ปกติ
function certFor(i, j, std) {
  const r = (i * 7 + j * 3) % 10;
  if (r <= 1) return null;
  if (std?.isNoExpiry) return { status: "completed", completedDate: day(-400), expiryDate: null };
  const validity = std?.validityDays || 730;
  const expiry = r === 2 ? day(-30) : r === 3 ? day(45) : day(200 + j * 5);
  return {
    status: r === 2 ? "overdue" : r === 3 ? "due_soon" : "completed",
    completedDate: new Date(expiry.getTime() - validity * DAY),
    expiryDate: expiry,
  };
}

async function seed() {
  const existing = await prisma.employee.count({ where: { empCode: { startsWith: EMP_PREFIX } } });
  if (existing) {
    console.log(`มีพนักงานสมมติอยู่แล้ว ${existing} คน — รัน --undo --apply ก่อนถ้าจะสร้างใหม่`);
    return;
  }
  const requester = await prisma.user.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  if (!requester) throw new Error("ไม่พบ user สำหรับเป็นผู้ขอ requirement");
  const positions = await pickPositions(PER_CLIENT);
  console.log(`ตำแหน่งที่ใช้: ${positions.map((p) => p.name).join(", ")}`);
  console.log(`ผู้ขอ requirement: ${requester.name}`);

  for (const c of CLIENTS) {
    const client = await findClient(c.aliases);
    const contract = client?.contracts?.[0];
    if (!client || !contract) {
      console.log(`\n── ${c.aliases[0]}: ไม่พบ client หรือ active contract — ข้าม`);
      continue;
    }
    const links = await prisma.clientTraining.findMany({
      where: { contractId: contract.id },
      include: { globalTraining: { select: { name: true } }, trainingStandard: { select: { validityDays: true, isNoExpiry: true } } },
      orderBy: { globalTraining: { name: "asc" } },
    });

    const workers = Array.from({ length: PER_CLIENT }, (_, i) => {
      const no = String(i + 1).padStart(2, "0");
      const certs = links
        .map((l, j) => ({ l, cert: certFor(i, j, l.trainingStandard) }))
        .filter((x) => x.cert);
      return { no, code: `${EMP_PREFIX}${c.key}-${no}`, position: positions[i % positions.length], certs };
    });
    const year = new Date().getFullYear();

    console.log(`\n── ${client.name} (contract: ${contract.name}) · training ที่ผูกกับลูกค้านี้ ${links.length} รายการ`);
    workers.forEach((w) =>
      console.log(`   + พนักงาน ${w.code} · ${w.position?.name || "—"} · training ${w.certs.length} รายการ`),
    );
    c.projects.forEach((p) =>
      console.log(`   + ON ${CODE_PREFIX}${c.key}-${p.tag}/${year} · ${p.title}${p.completed ? " (จบแล้ว · ลงงาน 2 คน)" : ""}`),
    );
    if (!links.length) console.log("   ⚠ ยังไม่มี training ผูกกับลูกค้านี้ — รัน seedAssumedClientTrainings.js --apply ก่อน");
    if (!APPLY) continue;

    const created = [];
    for (const w of workers) {
      const emp = await prisma.employee.create({
        data: {
          empCode: w.code,
          fullName: `Demo Worker ${c.key}-${w.no}`,
          fullNameEN: `Demo Worker ${c.key}-${w.no}`,
          fullNameTH: `พนักงานสมมติ ${c.key}-${w.no}`,
          nationality: "Thai",
          isOffshore: true,
          workplace: `${client.name} (สมมติ)`,
          positionId: w.position?.id || null,
          startWorkDate: day(-900),
          notes: MARK,
        },
      });
      created.push(emp);
      if (w.certs.length) {
        await prisma.employeeTraining.createMany({
          data: w.certs.map(({ l, cert }) => ({
            employeeId: emp.id,
            globalTrainingId: l.globalTrainingId,
            clientTrainingId: l.id,
            contractId: contract.id,
            rawTrainingName: l.globalTraining.name,
            status: cert.status,
            completedDate: cert.completedDate,
            expiryDate: cert.expiryDate,
            source: TRAINING_SOURCE,
            sourceFile: MARK,
          })),
        });
      }
    }

    for (const p of c.projects) {
      const record = await prisma.masterProjectRecord.create({
        data: {
          year,
          projectCode: `${CODE_PREFIX}${c.key}-${p.tag}/${year}`,
          jobTitle: `${client.name} - ${p.title} (สมมติ)`,
          customerName: "Demo Customer",
          company: client.name,
          team: "Demo",
          owner: MARK,
          sourceFile: MARK,
        },
      });
      const project = await prisma.project.create({
        data: {
          name: `${client.name} - ${p.title} (สมมติ)`,
          contractId: contract.id,
          masterProjectRecordId: record.id,
          location: p.location,
          isOffshore: true,
          startDate: day(p.start),
          endDate: day(p.end),
          status: p.completed ? "completed" : "active",
          notes: MARK,
        },
      });
      await prisma.manpowerRequest.createMany({
        data: positions.slice(0, 2).map((pos, k) => ({
          projectId: project.id,
          positionId: pos.id,
          quantity: 2 + k,
          startDate: day(p.start),
          endDate: day(p.end),
          isOffshore: true,
          status: "submitted",
          requestedById: requester.id,
        })),
      });
      if (p.completed) {
        await prisma.assignment.createMany({
          data: created.slice(0, 2).map((emp) => ({
            employeeId: emp.id,
            projectId: project.id,
            status: "completed",
            mobDate: day(p.start),
            demobDate: day(p.end),
            positionId: emp.positionId,
            remark: MARK,
          })),
        });
      }
    }
  }
}

// relation ของพนักงานที่ถ้ามีข้อมูลจากหน้าจอ (ไม่ใช่ข้อมูลสมมติ) จะไม่ลบพนักงานคนนั้น
const EMP_BLOCKERS = [
  "medicalChecks", "skills", "safetyChecks", "candidates", "bookings", "subcontractorHires",
  "trainingRequestItems", "medicalExamRecords", "medicalRequestItems", "bans", "reviews",
  "leaveRequests", "ppeRequests", "safetyExamAttempts", "matchExceptions",
];
const REQ_BLOCKERS = ["rounds", "bookings", "clientApproval", "sseRecords", "subcontractorRequests", "matchExceptions", "WorkflowLog"];

async function undo() {
  const emps = await prisma.employee.findMany({
    where: { empCode: { startsWith: EMP_PREFIX }, notes: MARK },
    select: {
      id: true, empCode: true,
      passport: { select: { id: true } }, user: { select: { id: true } }, pin: { select: { id: true } },
      _count: {
        select: {
          ...Object.fromEntries(EMP_BLOCKERS.map((k) => [k, true])),
          // training / ประวัติลงงานที่เพิ่มจากหน้าจอ (ไม่ใช่ของสมมติ)
          trainings: { where: { NOT: { source: TRAINING_SOURCE } } },
          assignments: { where: { NOT: { remark: MARK } } },
        },
      },
    },
  });
  const projects = await prisma.project.findMany({
    where: { notes: MARK, masterProjectRecord: { sourceFile: MARK } },
    select: {
      id: true, name: true, masterProjectRecordId: true,
      requests: { select: { id: true, _count: { select: Object.fromEntries(REQ_BLOCKERS.map((k) => [k, true])) } } },
      _count: { select: { reviews: true, messages: true, assignments: { where: { NOT: { remark: MARK } } } } },
    },
  });
  const blockersOf = (counts, extra = []) =>
    Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).concat(extra);

  const empPlan = emps.map((e) => ({
    ...e,
    block: blockersOf(e._count, [e.passport && "passport", e.user && "user", e.pin && "pin"].filter(Boolean)),
  }));
  const projPlan = projects.map((p) => {
    const reqBlock = p.requests.flatMap((r) => blockersOf(r._count));
    return { ...p, block: blockersOf(p._count, reqBlock) };
  });
  const records = await prisma.masterProjectRecord.findMany({
    where: { projectCode: { startsWith: CODE_PREFIX }, sourceFile: MARK },
    select: { id: true, projectCode: true },
  });
  const assumedTrainings = await prisma.employeeTraining.count({ where: { source: TRAINING_SOURCE } });
  const assumedAssignments = await prisma.assignment.count({ where: { remark: MARK } });

  console.log(`พนักงานสมมติ ${emps.length} คน · training สมมติ ${assumedTrainings} · ประวัติลงงานสมมติ ${assumedAssignments}`);
  console.log(`requirement สมมติ ${projects.length} · ON Number สมมติ ${records.length}`);
  const blocked = [...empPlan.filter((e) => e.block.length), ...projPlan.filter((p) => p.block.length)];
  blocked.forEach((b) => console.log(`   ⚠ ข้าม ${b.empCode || b.name}: ติด ${b.block.join(", ")}`));
  if (!APPLY) return;

  const okEmpIds = empPlan.filter((e) => !e.block.length).map((e) => e.id);
  const okProj = projPlan.filter((p) => !p.block.length);
  await prisma.$transaction(async (tx) => {
    await tx.assignment.deleteMany({ where: { remark: MARK } });
    await tx.employeeTraining.deleteMany({ where: { source: TRAINING_SOURCE, employeeId: { in: okEmpIds } } });
    await tx.manpowerRequest.deleteMany({ where: { projectId: { in: okProj.map((p) => p.id) } } });
    await tx.project.deleteMany({ where: { id: { in: okProj.map((p) => p.id) } } });
    await tx.masterProjectRecord.deleteMany({
      where: { projectCode: { startsWith: CODE_PREFIX }, sourceFile: MARK, linkedProjects: { none: {} } },
    });
    // พนักงานที่ยังมี training ที่ไม่ใช่ของสมมติ (เพิ่มจากหน้าจอ) จะไม่ถูกลบ
    await tx.employee.deleteMany({ where: { id: { in: okEmpIds }, trainings: { none: {} }, assignments: { none: {} } } });
  });
  const left = await prisma.employee.count({ where: { empCode: { startsWith: EMP_PREFIX } } });
  console.log(`เหลือพนักงานสมมติ ${left} คน (มากกว่า 0 = มีรายการที่ข้าม ดูรายการ ⚠ ข้างบน)`);
}

guard();
(UNDO ? undo() : seed())
  .then(() => console.log(APPLY ? "\n✓ เสร็จ" : "\n(dry run — ใส่ --apply เพื่อบันทึกจริง)"))
  .catch((e) => {
    console.error("✗", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
