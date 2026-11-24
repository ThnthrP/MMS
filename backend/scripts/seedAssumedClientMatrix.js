// ============================================================
// scripts/seedAssumedClientMatrix.js
// Training Matrix สมมติของ Erawan / PTT / Valeura สำหรับพัฒนา / ถ่ายภาพหน้าจอโหมด multi-client
// ระหว่างรอ matrix จริงจาก HR — ใช้บนเครื่อง dev เท่านั้น ห้ามรันบน server
//
// ต้องรันก่อน: seedAssumedClientTrainings.js --apply และ seedAssumedMultiClientData.js --apply
//
// ทำอะไร
//   ตำแหน่ง = ตำแหน่งของพนักงานสมมติ (empCode ขึ้นต้น ASM-)
//   ต่อลูกค้า: ทุก training ที่ผูกกับ contract ของลูกค้านั้น ถ้า Chevron กำหนดตำแหน่ง × training นั้นไว้
//   ใช้ประเภทเดียวกับ Chevron (Mandatory / Assigned) · ถ้าตำแหน่งไหนไม่ตรงกับ Chevron เลย
//   ตั้ง Mandatory ให้ 3 training แรก เพื่อให้มี % Match
//   ทุกแถวมี PositionRequirement.sourceMatrixSheet = "[ASSUMED]" ไว้ลบทีหลัง
//
// วิธีรัน (ใน container dev)
//   docker exec chevron-backend node scripts/seedAssumedClientMatrix.js                # dry run
//   docker exec chevron-backend node scripts/seedAssumedClientMatrix.js --apply
//   docker exec chevron-backend node scripts/seedAssumedClientMatrix.js --undo         # ดูว่าจะลบอะไร
//   docker exec chevron-backend node scripts/seedAssumedClientMatrix.js --undo --apply
//
// ลำดับตอนลบ: ลบ matrix นี้ก่อน seedAssumedClientTrainings.js --undo
// (การผูก training ที่ถูกใช้ใน matrix จะถูกข้าม)
// ============================================================
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const UNDO = process.argv.includes("--undo");
const MARK = "[ASSUMED]";
const EMP_PREFIX = "ASM-";
const FALLBACK_COUNT = 3;
const FALLBACK_TYPE = "mandatory"; // ค่าเดียวกับที่ Matrix Editor บันทึกเมื่อเลือก Mandatory (X)

const CLIENTS = [
  { label: "Erawan", aliases: ["Erawan"] },
  { label: "PTT", aliases: ["PTTEP", "PTT"] },
  { label: "Valeura", aliases: ["Valeura"] },
];

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

async function seed() {
  // เช็คว่ามี field ที่ใช้เป็นเครื่องหมาย (ถ้า schema ไม่มี จะ error ตั้งแต่ dry run)
  const already = await prisma.positionRequirement.count({ where: { sourceMatrixSheet: MARK } });
  if (already) console.log(`มี matrix สมมติอยู่แล้ว ${already} แถว — แถวที่ซ้ำจะถูกข้าม`);

  const workers = await prisma.employee.findMany({
    where: { empCode: { startsWith: EMP_PREFIX } },
    select: { positionId: true },
  });
  const positionIds = [...new Set(workers.map((w) => w.positionId).filter(Boolean))];
  if (!positionIds.length) throw new Error("ไม่พบพนักงานสมมติ (ASM-) — รัน seedAssumedMultiClientData.js --apply ก่อน");
  const positions = await prisma.position.findMany({
    where: { id: { in: positionIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  console.log(`ตำแหน่งของพนักงานสมมติ ${positions.length} ตำแหน่ง: ${positions.map((p) => p.name).join(", ")}`);

  // แบบของ Chevron: positionId|globalTrainingId → requirementType
  const chevron = await findClient(["Chevron"]);
  if (!chevron) throw new Error("ไม่พบ client Chevron");
  const chevronReqs = await prisma.positionRequirement.findMany({
    where: { positionId: { in: positionIds }, clientTraining: { contract: { clientId: chevron.id } } },
    select: { positionId: true, requirementType: true, clientTraining: { select: { globalTrainingId: true } } },
  });
  const pattern = new Map();
  for (const r of chevronReqs) {
    if (!r.requirementType) continue;
    const key = `${r.positionId}|${r.clientTraining.globalTrainingId}`;
    if (!pattern.has(key)) pattern.set(key, r.requirementType);
  }

  for (const c of CLIENTS) {
    const client = await findClient(c.aliases);
    const contract = client?.contracts?.[0];
    if (!client || !contract) {
      console.log(`\n── ${c.label}: ไม่พบ client หรือ active contract — ข้าม`);
      continue;
    }
    const links = await prisma.clientTraining.findMany({
      where: { contractId: contract.id },
      select: { id: true, globalTrainingId: true, globalTraining: { select: { name: true } } },
      orderBy: { globalTraining: { name: "asc" } },
    });
    if (!links.length) {
      console.log(`\n── ${c.label}: ยังไม่มี training ที่ผูกกับลูกค้านี้ — รัน seedAssumedClientTrainings.js --apply ก่อน`);
      continue;
    }
    const existing = new Set(
      (
        await prisma.positionRequirement.findMany({
          where: { positionId: { in: positionIds }, clientTrainingId: { in: links.map((l) => l.id) } },
          select: { positionId: true, clientTrainingId: true },
        })
      ).map((r) => `${r.positionId}|${r.clientTrainingId}`),
    );

    const rows = [];
    console.log(`\n── ${c.label} (${client.name} · ${contract.name}) · training ที่ผูก ${links.length}`);
    for (const p of positions) {
      let picks = links
        .filter((l) => pattern.has(`${p.id}|${l.globalTrainingId}`))
        .map((l) => ({ link: l, type: pattern.get(`${p.id}|${l.globalTrainingId}`) }));
      let note = "ตามแบบ Chevron";
      if (!picks.some((x) => ["required", "mandatory"].includes(x.type))) {
        picks = links.slice(0, FALLBACK_COUNT).map((l) => ({ link: l, type: FALLBACK_TYPE }));
        note = `ไม่ตรงกับ Chevron — ตั้ง Mandatory ${picks.length} รายการแรก`;
      }
      const fresh = picks.filter((x) => !existing.has(`${p.id}|${x.link.id}`));
      const m = fresh.filter((x) => ["required", "mandatory"].includes(x.type)).length;
      console.log(`   ${p.name}: เพิ่ม ${fresh.length} (Mandatory ${m}, อื่น ๆ ${fresh.length - m}) · ${note}`);
      for (const x of fresh) {
        rows.push({
          positionId: p.id,
          contractId: contract.id,
          clientTrainingId: x.link.id,
          requirementType: x.type,
          sourceMatrixSheet: MARK,
        });
      }
    }
    if (APPLY && rows.length) {
      const r = await prisma.positionRequirement.createMany({ data: rows, skipDuplicates: true });
      console.log(`   ✓ บันทึก ${r.count} แถว`);
    }
  }
}

async function undo() {
  const rows = await prisma.positionRequirement.findMany({
    where: { sourceMatrixSheet: MARK },
    select: { id: true },
  });
  console.log(`ลบ matrix สมมติ ${rows.length} แถว`);
  if (!APPLY || !rows.length) return;
  const r = await prisma.positionRequirement.deleteMany({ where: { sourceMatrixSheet: MARK } });
  console.log(`ลบแล้ว ${r.count} แถว · เหลือ ${await prisma.positionRequirement.count({ where: { sourceMatrixSheet: MARK } })}`);
}

guard();
(UNDO ? undo() : seed())
  .then(() => console.log(APPLY ? "\n✓ เสร็จ" : "\n(dry run — ใส่ --apply เพื่อบันทึกจริง)"))
  .catch((e) => {
    console.error("✗", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
