// ══════════════════════════════════════════════════════════
// Import ประวัติลงงาน (Past Deployment History) จากไฟล์แม่แบบ "ประวัติลงงาน.xlsx" ของ HR
//
//   node scripts/importDeploymentHistory.js <file.xlsx>            ← dry-run (ไม่เขียน DB)
//   node scripts/importDeploymentHistory.js <file.xlsx> --apply    ← เขียนจริง
//   ตัวเลือก: --client=Chevron  (ถ้าเดา client จาก Traveling Team No. ไม่ได้ ใช้ค่านี้)
//
// 1 แถว = พนักงาน 1 คน ใน 1 รอบลงงาน · หัวคอลัมน์อ่านจากแถวแรก (ชื่อตามแม่แบบ)
// จับคู่พนักงานด้วย Employee ID — ตัดช่องว่าง/ขีด ทั้งฝั่งไฟล์และฝั่งระบบ ("3856 1667" = "38561667")
// ซ้ำได้ (idempotent): คนเดิม + วันลงงานเดิม + project เดิม → อัปเดตแถวเดิม ไม่สร้างซ้ำ
// ⚠ ไฟล์มีชื่อ/รหัสพนักงานจริง — อย่า commit เข้า git และลบออกจาก server หลัง import
// ══════════════════════════════════════════════════════════
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const APPLY = args.includes("--apply");
const DEFAULT_CLIENT =
  (args.find((a) => a.startsWith("--client=")) || "").split("=")[1] || "";

if (!file) {
  console.error("ใช้: node scripts/importDeploymentHistory.js <file.xlsx> [--apply] [--client=Chevron]");
  process.exit(1);
}

// หัวคอลัมน์ในแม่แบบ → key (เทียบแบบตัดช่องว่าง/วงเล็บ ไม่สนตัวพิมพ์)
const HEADERS = {
  employeeid: "empId",
  "ชื่อ-สกุล": "name",
  ตำแหน่ง: "position",
  travelingteamno: "teamNo",
  project: "project",
  field: "field",
  date: "docDate",
  วันลงงาน: "mobDate",
  วันเดินทางกลับ: "demobDate",
  สถานที่เดินทาง: "platform",
  ขาไป: "travelOut",
  ขากลับ: "travelBack",
  หมายเหตุ: "remark",
};
const headerKey = (v) => {
  const s = String(v ?? "")
    .replace(/\(.*?\)/g, "")
    .replace(/[\s.]/g, "")
    .toLowerCase();
  return HEADERS[s] || null;
};

const cellText = (c) => {
  const v = c?.value;
  if (v == null) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((r) => r.text).join("").trim();
    if (v.text) return String(v.text).trim();
    if (v.result != null) return v.result instanceof Date ? v.result : String(v.result).trim();
  }
  return String(v).trim();
};

const normId = (v) => String(v ?? "").replace(/[\s-]/g, "");
const normName = (v) => String(v ?? "").replace(/\s+/g, "").toLowerCase();

// วันที่: Date ของ Excel / ตัวเลข serial / "dd/mm/yyyy" (พ.ศ. → ค.ศ.)
function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  if (/^\d+(\.\d+)?$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(v) * 86400000);
    return isNaN(d) ? null : d;
  }
  const m = String(v).match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (!m) return null;
  let [, d, mo, y] = m.map(Number);
  if (y < 100) y += 2000;
  if (y > 2400) y -= 543;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 ? dt : null;
}
const ymd = (d) => (d ? d.toISOString().slice(0, 10) : "—");

// ต้องตรงกับ composeProjectLabel ใน AddWorker.jsx / EditWorker.jsx
const composeProjectLabel = (client, field, platform) => {
  if (!client) return "";
  if (field) return `Supply Manpower for ${client} : ${field}`;
  if (platform) return `Supply Manpower for ${client} at ${platform}`;
  return `Supply Manpower for ${client}`;
};
const guessClient = (teamNo) =>
  /ch[ae]vron/i.test(teamNo || "") ? "Chevron" : DEFAULT_CLIENT;

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];

  const cols = {};
  ws.getRow(1).eachCell((c, i) => {
    const k = headerKey(cellText(c));
    if (k && !cols[k]) cols[k] = i;
  });
  for (const need of ["empId", "mobDate"]) {
    if (!cols[need]) throw new Error(`ไม่พบคอลัมน์ ${need} ในแถวหัวตาราง`);
  }

  const employees = await prisma.employee.findMany({
    select: { id: true, empId: true, empCode: true, fullName: true, fullNameTH: true },
  });
  const byId = new Map();
  for (const e of employees) {
    const k = normId(e.empId);
    if (!k) continue;
    byId.set(k, byId.has(k) ? "DUP" : e);
  }
  const positions = await prisma.position.findMany({ select: { id: true, name: true } });
  const posByName = new Map(positions.map((p) => [p.name.trim().toLowerCase(), p.id]));

  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const get = (k) => (cols[k] ? cellText(row.getCell(cols[k])) : "");
    const r = Object.fromEntries(Object.keys(HEADERS).map((h) => [HEADERS[h], get(HEADERS[h])]));
    if (!normId(r.empId) && !r.name) return; // แถวว่าง
    if (/^เพิ่มใหม่|^ตาราง$/.test(String(r.empId)) || String(r.name) === "ตาราง") return; // แถวคำอธิบายของแม่แบบ
    rows.push({ n, ...r });
  });

  // Employee ID เดียวกันแต่ชื่อในไฟล์ต่างกัน → น่าจะ copy ผิด ข้ามทั้งกลุ่ม
  const namesById = new Map();
  rows.forEach((r) => {
    const k = normId(r.empId);
    if (!namesById.has(k)) namesById.set(k, new Set());
    namesById.get(k).add(normName(r.name));
  });

  const report = { create: 0, update: 0, skip: [] };
  const today = new Date();

  for (const r of rows) {
    const k = normId(r.empId);
    const skip = (why) => report.skip.push(`แถว ${r.n} · ${r.empId || "—"} ${r.name || ""} — ${why}`);
    if (!k) { skip("ไม่มี Employee ID"); continue; }
    if (namesById.get(k).size > 1) { skip("Employee ID นี้ในไฟล์มีหลายชื่อ — เช็คว่า copy ถูกคน"); continue; }
    const emp = byId.get(k);
    if (!emp) { skip("ไม่พบ Employee ID นี้ในระบบ — เพิ่มพนักงานก่อน"); continue; }
    if (emp === "DUP") { skip("ในระบบมีพนักงานหลายคนใช้ ID นี้ (หลังตัดช่องว่าง)"); continue; }

    const mobDate = toDate(r.mobDate);
    const demobDate = toDate(r.demobDate);
    if (!mobDate) { skip(`วันลงงานอ่านไม่ได้ (${r.mobDate || "ว่าง"})`); continue; }
    if (demobDate && demobDate < mobDate) { skip("วันเดินทางกลับก่อนวันลงงาน"); continue; }

    const client = guessClient(r.teamNo);
    const field = [r.project, r.field && `Field: ${r.field}`].filter(Boolean).join(" ");
    const platform = r.platform || null;
    const positionId = posByName.get(String(r.position || "").trim().toLowerCase()) || null;
    const remark = [
      r.remark,
      !positionId && r.position ? `ตำแหน่งตามไฟล์: ${r.position}` : "",
      demobDate && demobDate > today ? "วันกลับตามแผน" : "",
    ].filter(Boolean).join(" · ") || null;

    const data = {
      projectLabel: composeProjectLabel(client, field, platform) || null,
      positionId,
      platform,
      mobDate,
      demobDate,
      travelTeamNo: r.teamNo || null,
      travelOut: r.travelOut || null,
      travelBack: r.travelBack || null,
      remark,
    };

    // รอบนี้ลงงานผ่านระบบจริงแล้ว (Worker Schedule) → ไม่สร้างประวัติซ้ำ
    const DAY = 86400000;
    const live = await prisma.assignment.findFirst({
      where: {
        employeeId: emp.id,
        projectId: { not: null },
        mobDate: { gte: new Date(+mobDate - 3 * DAY), lte: new Date(+mobDate + 3 * DAY) },
      },
      select: { id: true },
    });
    if (live) { skip("รอบนี้มีในระบบแล้วจาก Worker Schedule (MOB ใกล้กัน ±3 วัน)"); continue; }

    const existing = await prisma.assignment.findFirst({
      where: { employeeId: emp.id, projectId: null, mobDate, projectLabel: data.projectLabel },
      select: { id: true },
    });
    const tag = `${emp.empCode} ${emp.fullNameTH || emp.fullName} · ${ymd(mobDate)} → ${ymd(demobDate)} · ${data.projectLabel}`;
    if (existing) {
      report.update++;
      console.log(`  ↻ อัปเดต  ${tag}`);
      if (APPLY) await prisma.assignment.update({ where: { id: existing.id }, data });
    } else {
      report.create++;
      console.log(`  + เพิ่ม    ${tag}`);
      if (APPLY)
        await prisma.assignment.create({
          data: { ...data, employeeId: emp.id, bookingId: null, projectId: null, status: "completed" },
        });
    }
  }

  console.log("\n══════════════════════════════");
  console.log(`${APPLY ? "บันทึกแล้ว" : "DRY-RUN (ยังไม่บันทึก)"} · อ่าน ${rows.length} แถว`);
  console.log(`เพิ่มใหม่ ${report.create} · อัปเดตของเดิม ${report.update} · ข้าม ${report.skip.length}`);
  if (report.skip.length) {
    console.log("\nแถวที่ข้าม (ส่งให้ HR แก้ในไฟล์ แล้วรันใหม่ได้เลย):");
    report.skip.forEach((s) => console.log("  ✕ " + s));
  }
  if (!APPLY) console.log("\nตรวจแล้วรันซ้ำพร้อม --apply เพื่อบันทึกจริง");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
