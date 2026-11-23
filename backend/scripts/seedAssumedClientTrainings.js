// ============================================================
// scripts/seedAssumedClientTrainings.js
// ข้อมูลสมมติ "training ไหนใช้กับลูกค้าเจ้าไหน" สำหรับพัฒนา/ทดสอบโหมด multi-client
// ระหว่างรอ HR ส่งข้อมูลจริง — ใช้บนเครื่อง dev เท่านั้น ห้ามรันบน server
//
// ทำอะไร
//   1. หา client Erawan / PTTEP / Valeura (ไม่มีก็สร้าง) และ active contract (ไม่มีก็สร้าง ชื่อขึ้นต้น [ASSUMED])
//   2. ผูก training ที่ Chevron ใช้อยู่ และชื่อตรงกับ training ความปลอดภัยพื้นฐาน (ดู RULES)
//      เข้ากับ contract ของลูกค้าแต่ละเจ้า — ClientTraining.nameAlias = "[ASSUMED]" ไว้แยกจากของจริง
//   3. --undo ลบเฉพาะสิ่งที่ script นี้สร้าง (nameAlias = "[ASSUMED]" / contract ชื่อ [ASSUMED]
//      ที่ไม่มี project) — การผูกที่ HR ติ๊กเองในหน้า Trainings ไม่ถูกลบ
//
// วิธีรัน (ใน container dev)
//   docker exec chevron-backend node scripts/seedAssumedClientTrainings.js           # ดูว่าจะสร้างอะไร (dry run)
//   docker exec chevron-backend node scripts/seedAssumedClientTrainings.js --apply   # สร้างจริง
//   docker exec chevron-backend node scripts/seedAssumedClientTrainings.js --undo --apply  # ลบข้อมูลสมมติ
// ============================================================
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const UNDO = process.argv.includes("--undo");
const MARK = "[ASSUMED]";

// ลูกค้าและ keyword ของ training ที่สมมติว่าใช้ร่วมกับ Chevron (เทียบกับชื่อกลาง ไม่สนตัวพิมพ์)
const COMMON = [
  "bosiet", "huet", "h2s", "first aid", "fire", "working at height", "rigging",
  "confined space", "permit to work", "gas test", "scaffold", "safety induction",
];
// aliases = ชื่อที่อาจใช้ใน DB (เทียบทั้งคำ ไม่สนตัวพิมพ์) · PTTEP ใน DB ตอนนี้ชื่อ "PTT"
const RULES = [
  { name: "Erawan", aliases: ["Erawan"], keywords: COMMON },
  { name: "PTTEP", aliases: ["PTTEP", "PTT"], keywords: COMMON },
  { name: "Valeura", aliases: ["Valeura"], keywords: ["bosiet", "huet", "h2s", "first aid", "fire"] },
];

function guard() {
  if (process.env.NODE_ENV === "production") {
    console.error("✗ NODE_ENV=production — script นี้ใช้บนเครื่อง dev เท่านั้น");
    process.exit(1);
  }
}

async function findClient(aliases) {
  return prisma.client.findFirst({
    where: { OR: aliases.map((a) => ({ name: { equals: a, mode: "insensitive" } })) },
    include: { contracts: { where: { isActive: true }, orderBy: { createdAt: "asc" } } },
  });
}

async function seed() {
  const chevron = await findClient(["Chevron"]);
  if (!chevron) throw new Error("ไม่พบ client Chevron");
  const chevronLinks = await prisma.clientTraining.findMany({
    where: { contract: { clientId: chevron.id } },
    select: { globalTrainingId: true, trainingStandardId: true, globalTraining: { select: { name: true } } },
  });
  // training เดียวกันอาจผูกหลาย contract ของ Chevron — เก็บตัวแรก
  const byTraining = new Map();
  for (const l of chevronLinks) if (!byTraining.has(l.globalTrainingId)) byTraining.set(l.globalTrainingId, l);
  console.log(`Chevron ใช้ training อยู่ ${byTraining.size} รายการ`);

  for (const rule of RULES) {
    let client = await findClient(rule.aliases);
    let contract = client?.contracts?.[0];
    const actions = [];
    if (!client) actions.push(`สร้าง client ${rule.name}`);
    if (!contract) actions.push(`สร้าง contract "${MARK} ${rule.name} (สมมติ)"`);

    const picks = [...byTraining.values()].filter((l) =>
      rule.keywords.some((k) => l.globalTraining.name.toLowerCase().includes(k)),
    );
    const existing = contract
      ? new Set(
          (
            await prisma.clientTraining.findMany({
              where: { contractId: contract.id },
              select: { globalTrainingId: true },
            })
          ).map((x) => x.globalTrainingId),
        )
      : new Set();
    const toLink = picks.filter((l) => !existing.has(l.globalTrainingId));

    console.log(`\n── ${rule.name}${client ? ` (ใน DB: ${client.name})` : ""}: ${actions.join(" · ") || "มี client + contract แล้ว"}`);
    console.log(`   ผูก training ใหม่ ${toLink.length} รายการ (ผูกอยู่แล้ว ${picks.length - toLink.length})`);
    toLink.forEach((l) => console.log(`   + ${l.globalTraining.name}`));
    if (!APPLY) continue;

    if (!client) {
      client = await prisma.client.create({
        data: { name: rule.name, type: "offshore" },
        include: { contracts: true },
      });
    }
    if (!contract) {
      contract = await prisma.contract.create({
        data: { clientId: client.id, name: `${MARK} ${rule.name} (สมมติ)`, type: "manpower_supply", isActive: true },
      });
    }
    if (toLink.length) {
      await prisma.clientTraining.createMany({
        data: toLink.map((l) => ({
          globalTrainingId: l.globalTrainingId,
          contractId: contract.id,
          trainingStandardId: l.trainingStandardId,
          nameAlias: MARK,
        })),
        skipDuplicates: true,
      });
    }
  }
}

async function undo() {
  const links = await prisma.clientTraining.findMany({
    where: { nameAlias: MARK },
    select: { id: true, _count: { select: { requirements: true, employeeTrainings: true } } },
  });
  const removable = links.filter((l) => l._count.requirements === 0 && l._count.employeeTrainings === 0);
  const contracts = await prisma.contract.findMany({
    where: { name: { startsWith: MARK } },
    select: { id: true, name: true, _count: { select: { projects: true, clientTrainings: true } } },
  });
  console.log(`ลบการผูกสมมติ ${removable.length} รายการ (ข้าม ${links.length - removable.length} ที่ถูกใช้ใน matrix/ใบ cert แล้ว)`);
  contracts.forEach((c) => console.log(`contract ${c.name}: project ${c._count.projects}`));
  if (!APPLY) return;
  await prisma.clientTraining.deleteMany({ where: { id: { in: removable.map((l) => l.id) } } });
  for (const c of contracts) {
    const left = await prisma.clientTraining.count({ where: { contractId: c.id } });
    if (c._count.projects === 0 && left === 0) {
      await prisma.contract.delete({ where: { id: c.id } });
      console.log(`ลบ contract ${c.name}`);
    }
  }
  console.log("client ที่สร้างไว้ยังอยู่ (ลบเองได้ถ้าไม่ใช้)");
}

guard();
(UNDO ? undo() : seed())
  .then(() => console.log(APPLY ? "\n✓ เสร็จ" : "\n(dry run — ใส่ --apply เพื่อบันทึกจริง)"))
  .catch((e) => {
    console.error("✗", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
