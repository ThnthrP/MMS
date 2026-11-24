// ============================================================
// services/trainingImportService.js
// นำเข้า Training / Medical / Passport จากไฟล์ Excel ของ HR
// ("Employee Training Offshore-Chevron dd-mm-yyyy.xlsx" — sheet "Record")
//
// ใช้ได้กับไฟล์ต้นฉบับของ HR โดยตรง ไม่ต้องทำไฟล์ CLEAN:
//   - หาแถวหัวตารางเองจากคำว่า "ID Employee" หรือ "Name - Last name"
//     (ไฟล์ Assistant Floor Operators ไม่มีคอลัมน์ ID Employee → จับคู่ด้วยชื่อ)
//   - row หัวตาราง-2 = ชื่อกลุ่ม/ชื่อ training (merge cell → เติมให้คอลัมน์ถัดไป)
//   - row หัวตาราง   = ชื่อ field เช่น "Completed date310", "Expire Date311"
//   - หาคอลัมน์จากชื่อหัว ไม่ fix เลขคอลัมน์ → HR แทรก/ซ่อนคอลัมน์ก็ยังอ่านได้
//
// dryRun = true  → ไม่เขียน DB คืนรายงานว่าจะเกิดอะไรขึ้น
// dryRun = false → เขียนจริง (ทีละพนักงานใน transaction)
//
// กติกา:
//   - จับคู่พนักงานด้วย Employee ID (empId) ก่อน → ไม่เจอค่อยใช้ชื่อ (TH/EN)
//   - ค่าในช่อง ID Employee ที่เป็นรหัสภายใน (EXPT-xxx) → ไม่ใช้จับคู่ และไม่เติมลง empId
//     (EMP CODE แต่ละเครื่อง/แต่ละ server ไม่ตรงกัน — ใช้ชื่อแทน)
//   - วันที่ไม่เปลี่ยน → ข้าม (ไม่สร้าง version ใหม่ซ้ำ)
//   - ในระบบมีวันที่ใหม่กว่าไฟล์ → ข้าม (ไม่ทับด้วยข้อมูลเก่า) แสดงในรายงาน
//   - training map ด้วย alias / ชื่อกลาง / "ชื่อที่ HR ใช้ในไฟล์" (ใส่หลายชื่อคั่นด้วย |)
//     ของ training ใน contract ก่อน → ไม่เจอค่อยหาจาก Global Training ทั้งหมด
//   - หลายคอลัมน์ map ไป training เดียวกัน → ใช้วันที่ล่าสุด
//   - ช่องว่าง / N/A / Pending → ไม่ลบข้อมูลเดิม
//   - backfill empId / ชื่อไทย / ชื่ออังกฤษ เฉพาะเมื่อในระบบยังว่าง
// ============================================================
import xlsx from "xlsx";
import prisma from "../config/prisma.js";

const DEFAULT_CLIENT = "Chevron";
const PREFERRED_SHEET = "Record";
const MEDICAL_CHECK_TYPE = "Medical Check up";
const MEDICAL_CHECK_TYPE_2 = "Medical Check up 2";
const REMIND_DAYS = 30;
const NO_EXPIRY_YEAR = 2099;
const MAX_CHANGE_ROWS = 500; // จำนวนรายการเปลี่ยนแปลงที่ส่งกลับไปแสดง (กัน response ใหญ่เกิน)

// ── text helpers ──
const cleanText = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\r?\n|\r/g, " ").replace(/\s+/g, " ").trim();
  return s || null;
};
const BLANK_RE = /^(-|n\/?a|#value!|#n\/a|pending|if required|none|no)$/i;
const isBlankLike = (s) => !s || BLANK_RE.test(String(s).trim());

// key แบบหลวม — ไม่สนตัวพิมพ์/ช่องว่าง/เครื่องหมาย ใช้จับคู่ชื่อ
const looseKey = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[\s\-_/().,:;'"&]+/g, "");

// ตัดวงเล็บบอกอายุ cert ท้ายชื่อ เช่น "(3 Year)", "(2 , 3 Year)", "(No expire)"
const PERIOD_SUFFIX_RE =
  /\s*\(\s*(?:\d+\s*,?\s*)*(?:\d+\s*years?|no\s*expire)\s*\)\s*$/i;
const trainingNameOf = (s) =>
  cleanText(String(s || "").replace(PERIOD_SUFFIX_RE, ""));

// "Completed date310" → "completed date"
const fieldKey = (s) =>
  (cleanText(s) || "")
    .toLowerCase()
    .replace(/\d+$/, "")
    .trim();

const digitsKey = (s) => String(s ?? "").replace(/\s+/g, "").trim();

// รหัสภายใน EXPERTEAM (EMP CODE) — ไม่ใช่ Employee ID ของ client
const EMP_CODE_RE = /^EXPT-?\d+$/i;

// ชื่อทั้งหมดที่ใช้จับคู่ training ได้ — "ชื่อที่ HR ใช้ในไฟล์" ใส่ได้หลายชื่อ คั่นด้วย |
const trainingAliases = (gt, alias) => [
  alias,
  gt?.name,
  ...String(gt?.fullName || "").split("|"),
];
const time = (d) => (d ? new Date(d).getTime() : null);

// ── date helpers (เก็บเป็นเที่ยงคืน UTC เสมอ — เทียบวันได้ตรง) ──
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const inRange = (d) => {
  if (!d || isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  return y < 1990 || y > 2100 ? null : d;
};
function parseDate(val) {
  if (val === null || val === undefined || val === "") return null;
  if (val instanceof Date) {
    return inRange(
      new Date(Date.UTC(val.getFullYear(), val.getMonth(), val.getDate())),
    );
  }
  if (typeof val === "number") {
    return inRange(new Date(EXCEL_EPOCH + Math.round(val) * 86400000));
  }
  const s = String(val).trim();
  if (isBlankLike(s) || s.startsWith("=")) return null;
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    return inRange(new Date(EXCEL_EPOCH + Math.round(Number(s)) * 86400000));
  }
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // d/m/yyyy
  if (m) return inRange(new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])));
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // yyyy-mm-dd
  if (m) return inRange(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
  return null; // รูปแบบอื่น (เช่น "02-มี.ค.-2026") ไม่เดา
}
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const sameDay = (a, b) => ymd(a) === ymd(b);
const remindOf = (exp) =>
  exp ? new Date(exp.getTime() - REMIND_DAYS * 86400000) : null;

function trainingStatus(completed, expiry) {
  if (!completed && !expiry) return null;
  if (!expiry || expiry.getUTCFullYear() >= NO_EXPIRY_YEAR) return "completed";
  const now = Date.now();
  if (expiry.getTime() < now) return "overdue";
  if (expiry.getTime() < now + 90 * 86400000) return "due_soon";
  return "completed";
}
const medicalStatus = (exp) =>
  !exp ? "pending" : exp.getTime() < Date.now() ? "overdue" : "passed";

// ============================================================
// 1) อ่านไฟล์ → โครงสร้างข้อมูล (ไม่แตะ DB)
// ============================================================
export function parseTrainingWorkbook(buffer) {
  const wb = xlsx.read(buffer, { type: "buffer", cellDates: false });

  const findHeaderRow = (rows) =>
    rows
      .slice(0, 30)
      .findIndex((r) =>
        (r || []).some((c) => {
          const t = cleanText(c) || "";
          return /^id\s*employ/i.test(t) || /^name\s*-?\s*last\s*name/i.test(t);
        }),
      );

  // เลือก sheet: "Record" ก่อน ไม่มีก็หา sheet แรกที่มีหัว "ID Employee" / "Name - Last name"
  const names = [
    ...wb.SheetNames.filter((n) => n.trim().toLowerCase() === PREFERRED_SHEET.toLowerCase()),
    ...wb.SheetNames,
  ];
  let sheetName = null;
  let rows = null;
  let headerIdx = -1;
  for (const n of names) {
    const r = xlsx.utils.sheet_to_json(wb.Sheets[n], {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });
    const h = findHeaderRow(r);
    if (h >= 0) {
      sheetName = n;
      rows = r;
      headerIdx = h;
      break;
    }
  }
  if (!rows) {
    throw new Error('ไม่พบหัวตาราง "ID Employee" หรือ "Name - Last name" ในไฟล์นี้ — ไฟล์ไม่ตรงรูปแบบ Training Record');
  }

  const header = rows[headerIdx] || [];
  const groupRow = rows[headerIdx - 2] || [];
  const width = Math.max(header.length, groupRow.length);

  // เติมชื่อกลุ่มให้คอลัมน์ที่ merge (ค่าอยู่แค่คอลัมน์แรกของกลุ่ม)
  const group = [];
  let last = null;
  for (let c = 0; c < width; c++) {
    const g = cleanText(groupRow[c]);
    if (g) last = g;
    group[c] = last;
  }
  const field = Array.from({ length: width }, (_, c) => fieldKey(header[c]));
  const grp = (c) => (group[c] || "").toLowerCase();

  const findCol = (pred, from = 0, to = width) => {
    for (let c = from; c < to; c++) if (pred(field[c], c)) return c;
    return -1;
  };

  const col = {
    id: findCol((f) => f.startsWith("id employ")),
    nameEN: findCol((f) => f.startsWith("name")),
    nameTH: findCol((f) => f.includes("ชื่อ")),
    position: findCol((f) => f.startsWith("position")),
    covid: findCol((f) => f.includes("vaccin") || f.includes("covid")),
  };
  // ID Employee ไม่บังคับ (ไม่มี = จับคู่ด้วยชื่อ) — แต่ต้องมีคอลัมน์ชื่อ
  if (col.nameEN < 0) {
    throw new Error('ไม่พบคอลัมน์ "Name" ในแถวหัวตาราง');
  }

  // Passport / PDPA — หาจากชื่อกลุ่ม
  const passportCols = [];
  for (let c = 0; c < width; c++) if (grp(c).includes("passport")) passportCols.push(c);
  const passportStart = passportCols.length ? passportCols[0] : width;
  const passport = passportCols.length
    ? {
        no: passportCols.find((c) => field[c].startsWith("passport")) ?? -1,
        issue: passportCols.find((c) => field[c].startsWith("completed") || field[c].startsWith("issue")) ?? -1,
        expiry: passportCols.find((c) => field[c].startsWith("expire")) ?? -1,
      }
    : null;
  const pdpaCol = (() => {
    for (let c = 0; c < width; c++) if (grp(c) === "pdpa") return c;
    return -1;
  })();

  // Medical — ทุก "Hospital" ก่อนส่วน Passport = 1 ชุด (ชุดที่ 2 = Medical Check up 2)
  const medical = [];
  for (let c = 0; c < passportStart; c++) {
    if (!field[c].startsWith("hospital")) continue;
    let next = passportStart;
    for (let k = c + 1; k < passportStart; k++) {
      if (field[k].startsWith("hospital")) {
        next = k;
        break;
      }
    }
    medical.push({
      hospital: c,
      issued: findCol((f) => f.startsWith("issued"), c + 1, next),
      expired: findCol((f) => f.startsWith("expire"), c + 1, next),
    });
  }

  // Training — คอลัมน์หลัง PDPA / Passport ที่เป็น Completed / Expire
  const trainingStart = Math.max(pdpaCol, ...passportCols, col.covid, 0) + 1;
  const trainingMap = new Map();
  for (let c = trainingStart; c < width; c++) {
    const f = field[c];
    const isCompleted = f.startsWith("completed");
    const isExpiry = f.startsWith("expire");
    if (!isCompleted && !isExpiry) continue;
    const name = trainingNameOf(group[c]);
    if (!name) continue;
    if (!trainingMap.has(name)) {
      trainingMap.set(name, { name, completedCol: -1, expiryCol: -1 });
    }
    const t = trainingMap.get(name);
    if (isCompleted && t.completedCol < 0) t.completedCol = c;
    if (isExpiry && t.expiryCol < 0) t.expiryCol = c;
  }
  const trainings = [...trainingMap.values()];

  // ── แถวข้อมูล ──
  const records = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const rawId = col.id >= 0 ? cleanText(row[col.id]) : null;
    const nameEN = cleanText(row[col.nameEN]);
    if (!nameEN || isBlankLike(nameEN) || nameEN.startsWith("=")) continue;
    // ไม่มี ID / เป็น EMP CODE (EXPT-xxx) → empId = null แล้วจับคู่ด้วยชื่อ
    const idIsEmpCode = !!rawId && EMP_CODE_RE.test(rawId);
    const empId = !rawId || isBlankLike(rawId) || idIsEmpCode ? null : rawId;

    const get = (c) => (c >= 0 ? row[c] : null);
    records.push({
      rowNo: r + 1,
      empId,
      idIsEmpCode,
      nameEN,
      nameTH: cleanText(get(col.nameTH)),
      position: cleanText(get(col.position)),
      covid: (() => {
        const v = cleanText(get(col.covid));
        return isBlankLike(v) ? null : v;
      })(),
      pdpa: (() => {
        const v = cleanText(get(pdpaCol));
        return v && /^(yes|y|true|✓|ยินยอม)$/i.test(v) ? true : null;
      })(),
      medical: medical.map((m) => ({
        hospital: (() => {
          const v = cleanText(get(m.hospital));
          return isBlankLike(v) ? null : v;
        })(),
        issued: parseDate(get(m.issued)),
        expiry: parseDate(get(m.expired)),
      })),
      passport: passport
        ? {
            no: (() => {
              const v = cleanText(get(passport.no));
              return isBlankLike(v) ? null : v;
            })(),
            issue: parseDate(get(passport.issue)),
            expiry: parseDate(get(passport.expiry)),
          }
        : null,
      trainings: trainings.map((t) => ({
        name: t.name,
        completed: parseDate(get(t.completedCol)),
        expiry: parseDate(get(t.expiryCol)),
      })),
    });
  }

  return {
    sheetName,
    headerRow: headerIdx + 1,
    columns: { ...col, pdpa: pdpaCol, passport, medical, trainingStart },
    hasIdColumn: col.id >= 0,
    trainings,
    records,
  };
}

// ============================================================
// 2) เทียบกับ DB + เขียน (ถ้าไม่ใช่ dryRun)
// ============================================================
export async function runTrainingImport({
  buffer,
  fileName = "upload.xlsx",
  dryRun = true,
  createMissing = false, // true = คนที่ไม่พบในระบบ → สร้างพนักงานใหม่
  clientName = DEFAULT_CLIENT,
}) {
  const parsed = parseTrainingWorkbook(buffer);

  const client = await prisma.client.findFirst({ where: { name: clientName } });
  if (!client) throw new Error(`ไม่พบ client "${clientName}"`);
  const contract = await prisma.contract.findFirst({
    where: { clientId: client.id, isActive: true },
    orderBy: { createdAt: "desc" },
  });
  if (!contract) throw new Error(`ไม่พบ contract ที่ active ของ ${clientName}`);
  // ผลตรวจสุขภาพเป็นของพนักงาน ไม่ขึ้นกับลูกค้า — ลูกค้าที่ยังไม่มี requirement ของตัวเอง
  // (เช่นลูกค้าใหม่ในโหมด multi) ใช้ "Medical Check" ที่มีอยู่แล้วในระบบ ไม่ข้ามผลตรวจทั้งไฟล์
  const medicalRequirement =
    (await prisma.medicalRequirement.findFirst({
      where: { clientId: client.id, name: { contains: "Medical Check" } },
    })) ||
    (await prisma.medicalRequirement.findFirst({
      where: { name: { contains: "Medical Check" } },
    }));

  // ── mapping ชื่อ training ในไฟล์ → ClientTraining (ใน contract) → GlobalTraining (ทั้งหมด) ──
  // จับได้ทั้ง nameAlias, ชื่อกลาง และ "ชื่อที่ HR ใช้ในไฟล์" (GlobalTraining.fullName — หลายชื่อคั่นด้วย |)
  const clientTrainings = await prisma.clientTraining.findMany({
    where: { contractId: contract.id },
    include: { globalTraining: true },
  });
  // ชื่อกลาง / "ชื่อที่ HR ใช้ในไฟล์" ก่อน → nameAlias ของ contract (ไม่เห็นในหน้า Trainings) ทีหลัง
  // กัน alias เก่าจากการนำเข้า matrix ดึงคอลัมน์ไปผิดหลักสูตร ทั้งที่มีหลักสูตรชื่อตรงอยู่แล้ว
  const ctByKey = new Map();
  for (const pass of ["name", "alias"]) {
    for (const ct of clientTrainings) {
      const names = pass === "name" ? trainingAliases(ct.globalTraining) : [ct.nameAlias];
      for (const n of names) {
        const k = looseKey(trainingNameOf(n));
        if (k && !ctByKey.has(k)) ctByKey.set(k, ct);
      }
    }
  }
  // training ที่ยังไม่ผูกกับ contract นี้ (เช่น หลักสูตรเฉพาะ Assistant Floor Operator) ก็นำเข้าได้
  const globalTrainings = await prisma.globalTraining.findMany({
    select: { id: true, name: true, fullName: true },
  });
  const gtByKey = new Map();
  for (const gt of globalTrainings) {
    for (const n of trainingAliases(gt)) {
      const k = looseKey(trainingNameOf(n));
      if (k && !gtByKey.has(k)) gtByKey.set(k, gt);
    }
  }
  const unmapped = [];
  const ctByGt = new Map(clientTrainings.map((ct) => [ct.globalTrainingId, ct]));
  const mappedTrainings = parsed.trainings.map((t) => {
    const key = looseKey(t.name);
    // หลักสูตรที่ชื่อตรงกับหัวคอลัมน์ (ใน contract หรือไม่ก็ตาม) ชนะ alias ของ contract
    const ctHit = ctByKey.get(key) || null;
    const gtHit = gtByKey.get(key) || null;
    const aliasOnly = ctHit && !trainingAliases(ctHit.globalTraining).some((n) => looseKey(trainingNameOf(n)) === key);
    const gt = gtHit && aliasOnly && gtHit.id !== ctHit.globalTrainingId ? gtHit : ctHit?.globalTraining || gtHit;
    const ct = gt ? (ctHit?.globalTrainingId === gt.id ? ctHit : ctByGt.get(gt.id) || null) : null;
    if (!gt) {
      const filled = parsed.records.filter((r) =>
        r.trainings.some((x) => x.name === t.name && (x.completed || x.expiry)),
      ).length;
      unmapped.push({ name: t.name, filledRows: filled });
    }
    return { ...t, ct, gt };
  });
  // หลายคอลัมน์ในไฟล์ → training เดียวกัน (เช่น Fire and Gas สองคอลัมน์) — ใช้วันที่ล่าสุด
  const sharedTrainings = (() => {
    const byGt = new Map();
    for (const t of mappedTrainings) {
      if (!t.gt) continue;
      (byGt.get(t.gt.id) || byGt.set(t.gt.id, []).get(t.gt.id)).push(t.name);
    }
    return [...byGt.values()].filter((names) => names.length > 1);
  })();

  // ── พนักงาน ──
  const employees = await prisma.employee.findMany({
    select: {
      id: true,
      empCode: true,
      empId: true,
      fullName: true,
      fullNameTH: true,
      fullNameEN: true,
      covidVac: true,
      pdpaConsent: true,
      positionId: true,
    },
  });
  const byEmpId = new Map();
  const byName = new Map();
  for (const e of employees) {
    if (e.empId) byEmpId.set(digitsKey(e.empId), e);
    for (const n of [e.fullNameTH, e.fullNameEN, e.fullName]) {
      const k = looseKey(n);
      if (k && !byName.has(k)) byName.set(k, e);
    }
  }

  // ── สำหรับสร้างพนักงานใหม่: ตำแหน่ง + รหัส EXPT ถัดไป (รูปแบบเดียวกับหน้า Add Worker) ──
  const positions = await prisma.position.findMany({ select: { id: true, name: true, nameTH: true } });
  const posByKey = new Map();
  for (const p of positions) {
    for (const n of [p.name, p.nameTH]) {
      const k = looseKey(n);
      if (k && !posByKey.has(k)) posByKey.set(k, p);
    }
  }
  let nextExpt = 0;
  for (const e of employees) {
    const m = /^EXPT-(\d+)$/.exec(e.empCode || "");
    if (m) nextExpt = Math.max(nextExpt, Number(m[1]));
  }
  const newEmpCode = () => `EXPT-${String(++nextExpt).padStart(3, "0")}`;

  // ── ข้อมูลเดิม (โหลดครั้งเดียว) ──
  // ใบเดิม — ทุก contract (ใบที่ HR เพิ่มเองในหน้า Edit Worker ไม่มี contractId)
  // ถ้ามีใบ isLatest ซ้ำ ใช้ใบที่วันที่ล่าสุดเทียบ
  const existingTrainings = await prisma.employeeTraining.findMany({
    where: { isLatest: true, globalTrainingId: { not: null } },
    select: { id: true, employeeId: true, globalTrainingId: true, completedDate: true, expiryDate: true, version: true },
  });
  const etKey = (empId, gtId) => `${empId}|${gtId}`;
  const etMap = new Map();
  for (const t of existingTrainings) {
    const k = etKey(t.employeeId, t.globalTrainingId);
    const cur = etMap.get(k);
    if (!cur || (time(t.completedDate) ?? 0) > (time(cur.completedDate) ?? 0)) etMap.set(k, t);
  }

  const medTypes = [MEDICAL_CHECK_TYPE, MEDICAL_CHECK_TYPE_2];
  // ผลตรวจเดิม — ใช้ของ requirement นี้ก่อน ไม่มีค่อยใช้ที่ไม่ได้ผูก requirement (เพิ่มเองในหน้า Edit Worker)
  const existingMed = medicalRequirement
    ? await prisma.medicalCheck.findMany({ where: { checkType: { in: medTypes } } })
    : [];
  const medMap = new Map();
  for (const m of existingMed) {
    const k = `${m.employeeId}|${m.checkType}`;
    const cur = medMap.get(k);
    const own = m.medicalRequirementId === medicalRequirement.id;
    if (!cur || (own && cur.medicalRequirementId !== medicalRequirement.id)) medMap.set(k, m);
  }

  const passports = await prisma.passport.findMany();
  const ppMap = new Map(passports.map((p) => [p.employeeId, p]));

  // ── report ──
  const report = {
    dryRun,
    fileName,
    sheetName: parsed.sheetName,
    headerRow: parsed.headerRow,
    client: clientName,
    contract: contract.name,
    rowsInFile: parsed.records.length,
    trainingColumns: parsed.trainings.length,
    mappedTrainings: mappedTrainings.filter((t) => t.gt).length,
    mappedOutsideContract: mappedTrainings.filter((t) => t.gt && !t.ct).map((t) => t.name),
    hasIdColumn: parsed.hasIdColumn,
    idIgnored: parsed.records.filter((r) => r.idIsEmpCode).length,
    olderInFile: [], // ในระบบใหม่กว่าไฟล์ → ข้าม
    unmappedTrainings: unmapped,
    employeesMatched: 0,
    matchedByName: 0,
    notFound: [],
    createMissing,
    created: [], // พนักงานใหม่ที่สร้าง (หรือจะสร้าง ถ้าเป็น preview)
    duplicatesInFile: [],
    backfills: [],
    counts: {
      trainingCreate: 0,
      trainingUpdate: 0,
      trainingUnchanged: 0,
      medicalCreate: 0,
      medicalUpdate: 0,
      medicalUnchanged: 0,
      passportUpsert: 0,
      employeeInfoUpdate: 0,
      employeeCreate: 0,
      olderSkipped: 0,
      errors: 0,
    },
    changes: [],
    changesTruncated: false,
    errors: [],
    warnings: [
      ...(medicalRequirement ? [] : ['ไม่พบ MedicalRequirement "Medical Check" ในระบบ — ข้ามผลตรวจสุขภาพ']),
      ...(parsed.hasIdColumn ? [] : ["ไฟล์นี้ไม่มีคอลัมน์ ID Employee — จับคู่พนักงานด้วยชื่อทั้งหมด ตรวจรายชื่อให้ดีก่อนนำเข้า"]),
      ...sharedTrainings.map((names) => `หลายคอลัมน์เป็น training เดียวกัน (ใช้วันที่ล่าสุด): ${names.join(" · ")}`),
    ],
  };
  if (report.idIgnored)
    report.warnings.push(
      `ช่อง ID Employee เป็นรหัสภายใน (EXPT-xxx) ${report.idIgnored} แถว — ไม่ใช้จับคู่ และไม่เติมลง Employee ID (จับคู่ด้วยชื่อแทน)`,
    );
  const pushOlder = (o) => {
    report.counts.olderSkipped++;
    if (report.olderInFile.length < MAX_CHANGE_ROWS) report.olderInFile.push(o);
  };
  const pushChange = (c) => {
    if (report.changes.length < MAX_CHANGE_ROWS) report.changes.push(c);
    else report.changesTruncated = true;
  };

  const seen = new Map(); // employee.id → rowNo (กันพนักงานซ้ำในไฟล์)

  for (const rec of parsed.records) {
    let emp = rec.empId ? byEmpId.get(digitsKey(rec.empId)) : null;
    let matchedBy = "empId";
    if (!emp) {
      emp = byName.get(looseKey(rec.nameTH)) || byName.get(looseKey(rec.nameEN));
      matchedBy = "name";
    }
    if (!emp) {
      report.notFound.push({ row: rec.rowNo, empId: rec.empId, nameEN: rec.nameEN, nameTH: rec.nameTH });
      if (!createMissing) continue;
      // พนักงานใหม่ — id จะได้ตอนสร้างจริงใน transaction (op แรก)
      emp = { id: null, isNew: true, tmpKey: `new:${rec.rowNo}`, empCode: newEmpCode() };
      // แถวซ้ำในไฟล์จะถูกจับเป็น duplicate
      if (rec.empId) byEmpId.set(digitsKey(rec.empId), emp);
      for (const n of [rec.nameTH, rec.nameEN]) if (looseKey(n)) byName.set(looseKey(n), emp);
      matchedBy = "new";
    }
    const seenKey = emp.id || emp.tmpKey;
    if (seen.has(seenKey)) {
      report.duplicatesInFile.push({ row: rec.rowNo, firstRow: seen.get(seenKey), empId: rec.empId, nameEN: rec.nameEN });
      continue;
    }
    seen.set(seenKey, rec.rowNo);
    if (matchedBy !== "new") report.employeesMatched++;
    if (matchedBy === "name") report.matchedByName++;

    const who = `${rec.empId || emp.empCode || "-"} ${rec.nameEN}`;
    const ops = []; // ฟังก์ชัน (tx) => Promise — รันใน transaction ตอนเขียนจริง

    if (emp.isNew) {
      const pos = posByKey.get(looseKey(rec.position)) || null;
      const createData = {
        empCode: emp.empCode,
        fullName: rec.nameEN, // ระบบเดิมเก็บชื่ออังกฤษไว้ที่ fullName
        fullNameEN: rec.nameEN,
        fullNameTH: rec.nameTH || null,
        empId: rec.empId,
        positionId: pos?.id || null,
        isOffshore: true,
        covidVac: rec.covid || null,
        pdpaConsent: rec.pdpa || null,
      };
      report.counts.employeeCreate++;
      report.created.push({
        row: rec.rowNo,
        empCode: emp.empCode,
        empId: rec.empId,
        nameEN: rec.nameEN,
        nameTH: rec.nameTH,
        position: rec.position,
        positionMatched: pos?.name || null,
      });
      ops.push(async (tx) => {
        const created = await tx.employee.create({ data: createData, select: { id: true } });
        emp.id = created.id;
      });
    }

    // ── backfill รหัส/ชื่อ (เฉพาะช่องที่ยังว่างในระบบ) ──
    const empData = {};
    if (emp.isNew) {
      // ข้อมูลครบแล้วตอนสร้าง — ข้ามส่วน backfill
    } else if (rec.empId && !emp.empId && !byEmpId.has(digitsKey(rec.empId))) {
      empData.empId = rec.empId;
      byEmpId.set(digitsKey(rec.empId), emp); // กันอีกแถวในไฟล์ backfill รหัสเดียวกันซ้ำ
    }
    if (!emp.isNew && !emp.fullNameTH && rec.nameTH) empData.fullNameTH = rec.nameTH;
    if (!emp.isNew && !emp.fullNameEN && rec.nameEN) empData.fullNameEN = rec.nameEN;
    if (Object.keys(empData).length) {
      report.backfills.push({ employee: who, empCode: emp.empCode, fields: { ...empData } });
    }
    // covid / pdpa — อัปเดตเมื่อไฟล์มีค่า (ช่องว่างไม่ลบของเดิม)
    if (!emp.isNew && rec.covid && rec.covid !== emp.covidVac) empData.covidVac = rec.covid;
    if (!emp.isNew && rec.pdpa && emp.pdpaConsent !== true) empData.pdpaConsent = true;
    if (Object.keys(empData).length) {
      report.counts.employeeInfoUpdate++;
      ops.push((tx) => tx.employee.update({ where: { id: emp.id }, data: empData }));
    }

    // ── Medical Check up (ชุด 1, 2) ──
    if (medicalRequirement) {
      rec.medical.slice(0, 2).forEach((m, i) => {
        if (!m.issued && !m.expiry) return;
        const checkType = i === 0 ? MEDICAL_CHECK_TYPE : MEDICAL_CHECK_TYPE_2;
        const old = medMap.get(`${emp.id}|${checkType}`);
        // ในระบบตรวจรอบใหม่กว่าไฟล์แล้ว → ไม่ทับ
        if (old && time(old.issuedDate) && time(m.issued) && time(m.issued) < time(old.issuedDate)) {
          pushOlder({
            employee: who,
            item: checkType,
            inSystem: `${ymd(old.issuedDate)} → ${ymd(old.expiryDate) || "-"}`,
            inFile: `${ymd(m.issued)} → ${ymd(m.expiry) || "-"}`,
          });
          return;
        }
        if (
          old &&
          sameDay(old.issuedDate, m.issued) &&
          sameDay(old.expiryDate, m.expiry) &&
          (old.hospital || null) === (m.hospital || old.hospital || null)
        ) {
          report.counts.medicalUnchanged++;
          return;
        }
        const data = {
          hospital: m.hospital ?? old?.hospital ?? null,
          issuedDate: m.issued,
          expiryDate: m.expiry,
          remindDate: remindOf(m.expiry),
          remindDays: REMIND_DAYS,
          status: medicalStatus(m.expiry),
        };
        report.counts[old ? "medicalUpdate" : "medicalCreate"]++;
        pushChange({
          employee: who,
          item: checkType,
          kind: old ? "update" : "create",
          from: old ? `${ymd(old.issuedDate) || "-"} → ${ymd(old.expiryDate) || "-"}` : null,
          to: `${ymd(m.issued) || "-"} → ${ymd(m.expiry) || "-"}`,
        });
        ops.push((tx) =>
          old
            ? tx.medicalCheck.update({
                where: { id: old.id },
                data: { ...data, medicalRequirementId: medicalRequirement.id },
              })
            : tx.medicalCheck.create({
                data: { ...data, employeeId: emp.id, checkType, medicalRequirementId: medicalRequirement.id },
              }),
        );
      });
    }

    // ── Passport ──
    const pp = rec.passport;
    if (pp && (pp.no || pp.issue || pp.expiry)) {
      const old = ppMap.get(emp.id);
      const changed =
        !old ||
        (pp.no && pp.no !== old.passportNo) ||
        (pp.issue && !sameDay(pp.issue, old.issueDate)) ||
        (pp.expiry && !sameDay(pp.expiry, old.expiryDate));
      if (changed) {
        report.counts.passportUpsert++;
        const data = {
          ...(pp.no ? { passportNo: pp.no } : {}),
          ...(pp.issue ? { issueDate: pp.issue } : {}),
          ...(pp.expiry ? { expiryDate: pp.expiry } : {}),
        };
        pushChange({
          employee: who,
          item: "Passport",
          kind: old ? "update" : "create",
          from: old ? `${old.passportNo || "-"} exp ${ymd(old.expiryDate) || "-"}` : null,
          to: `${pp.no || old?.passportNo || "-"} exp ${ymd(pp.expiry) || ymd(old?.expiryDate) || "-"}`,
        });
        ops.push((tx) =>
          tx.passport.upsert({
            where: { employeeId: emp.id },
            update: data,
            create: { employeeId: emp.id, ...data },
          }),
        );
      }
    }

    // ── Trainings ── (หลายคอลัมน์ → training เดียวกัน: ใช้วันที่ล่าสุด)
    const pick = new Map(); // globalTrainingId → { t, v }
    mappedTrainings.forEach((t, i) => {
      if (!t.gt) return;
      const v = rec.trainings[i];
      if (!v.completed && !v.expiry) return; // ช่องว่าง/N/A/Pending → ไม่แตะของเดิม
      const cur = pick.get(t.gt.id);
      if (!cur || (time(v.completed) ?? 0) > (time(cur.v.completed) ?? 0)) pick.set(t.gt.id, { t, v });
    });
    for (const [gtId, { t, v }] of pick) {
      const itemName = t.gt.name || t.name;
      const old = etMap.get(etKey(emp.id, gtId));
      if (old && sameDay(old.completedDate, v.completed) && sameDay(old.expiryDate, v.expiry)) {
        report.counts.trainingUnchanged++;
        continue;
      }
      // ในระบบมีใบที่อบรมหลังวันที่ในไฟล์ → ไม่ทับ
      if (old && time(old.completedDate) && time(v.completed) && time(v.completed) < time(old.completedDate)) {
        pushOlder({
          employee: who,
          item: itemName,
          inSystem: `${ymd(old.completedDate)} → ${ymd(old.expiryDate) || "-"}`,
          inFile: `${ymd(v.completed)} → ${ymd(v.expiry) || "-"}`,
        });
        continue;
      }
      const status = trainingStatus(v.completed, v.expiry);
      report.counts[old ? "trainingUpdate" : "trainingCreate"]++;
      pushChange({
        employee: who,
        item: itemName,
        kind: old ? "update" : "create",
        from: old ? `${ymd(old.completedDate) || "-"} → ${ymd(old.expiryDate) || "-"}` : null,
        to: `${ymd(v.completed) || "-"} → ${ymd(v.expiry) || "-"}`,
      });
      ops.push(async (tx) => {
        // ใบเดิมทุกใบที่ยังเป็น isLatest (รวมใบซ้ำ) → เก็บเป็นประวัติ
        await tx.employeeTraining.updateMany({
          where: { employeeId: emp.id, globalTrainingId: gtId, isLatest: true },
          data: { isLatest: false },
        });
        await tx.employeeTraining.create({
          data: {
            employeeId: emp.id,
            rawTrainingName: t.name,
            globalTrainingId: gtId,
            clientTrainingId: t.ct?.id ?? null,
            contractId: contract.id,
            completedDate: v.completed,
            expiryDate: v.expiry,
            remindDate: remindOf(v.expiry),
            remindDays: REMIND_DAYS,
            status,
            source: "excel_import",
            sourceFile: fileName,
            isLatest: true,
            version: old ? (old.version || 1) + 1 : 1,
          },
        });
      });
    }

    // ── เขียนจริง: ทีละพนักงาน ล้มคนเดียวไม่ลากคนอื่น ──
    if (!dryRun && ops.length) {
      try {
        await prisma.$transaction(
          async (tx) => {
            for (const op of ops) await op(tx);
          },
          { timeout: 30000 },
        );
      } catch (err) {
        report.counts.errors++;
        report.errors.push({ row: rec.rowNo, employee: who, message: err.message });
      }
    }
  }

  return report;
}
