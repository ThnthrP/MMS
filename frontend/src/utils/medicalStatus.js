// ══════════════════════════════════════════════════════════
// สถานะใบตรวจสุขภาพ — ใช้ร่วมกันทุกหน้า (Compliance · Assign Names · Request Medical)
//   เดิมแต่ละหน้าคิดเกณฑ์เอง (Assign Names: Due soon ≤30 วัน / Compliance: ≤90 วัน) → สีไม่ตรงกัน
//   เกณฑ์เดียวกับการ์ดตัวเลขของ Compliance:
//     Overdue (หมดแล้ว) · Critical (<30 วัน) · Due soon (30–90) · Upcoming (90–120) · Valid (>120)
//   Unfit (ผลตรวจไม่ผ่าน) ขึ้นก่อนเสมอ ไม่ว่าใบจะยังไม่หมดอายุก็ตาม
// ══════════════════════════════════════════════════════════

export const MAIN_CHECK = "Medical Check up";
export const CONFINED_SPACE = "Confined Space Entry";

// แจ้ง HR ให้นัดตรวจได้เมื่อหมดอายุแล้ว หรือเหลือไม่เกินกี่วัน
export const MEDICAL_REQUEST_WITHIN_DAYS = 120;

// ผลตรวจจริง (คนละเรื่องกับวันหมดอายุ)
export const MEDICAL_RESULT_LABEL = {
  passed: "Fit",
  pending: "Pending",
  failed: "Unfit",
  not_required: "Fit w/ Restriction",
};

// tone = ชื่อสีกลาง — แต่ละหน้า map เป็น class ของตัวเอง
export const MEDICAL_BUCKETS = {
  unfit: { label: "Unfit", tone: "red", rank: 7 },
  overdue: { label: "Overdue", tone: "red", rank: 6 },
  critical: { label: "Critical", tone: "red", rank: 5 },
  due_soon: { label: "Due soon", tone: "yellow", rank: 4 },
  upcoming: { label: "Upcoming", tone: "indigo", rank: 3 },
  no_record: { label: "No record", tone: "gray", rank: 2 },
  valid: { label: "Valid", tone: "green", rank: 1 },
};

export const daysUntil = (date) => {
  if (!date) return null;
  const d = new Date(date);
  return isNaN(d.getTime()) ? null : Math.ceil((d.getTime() - Date.now()) / 86400000);
};

// จำนวนวันที่เหลือ → bucket (null = ไม่มีวันหมดอายุ)
export const expiryBucket = (daysLeft) => {
  if (daysLeft === null || daysLeft === undefined) return "no_record";
  if (daysLeft < 0) return "overdue";
  if (daysLeft < 30) return "critical";
  if (daysLeft <= 90) return "due_soon";
  if (daysLeft <= MEDICAL_REQUEST_WITHIN_DAYS) return "upcoming";
  return "valid";
};

// record ใบตรวจ { expiryDate, status } → bucket
export const medicalBucket = (record) => {
  if (!record) return "no_record";
  if (record.status === "failed") return "unfit";
  return expiryBucket(daysUntil(record.expiryDate));
};

// เหตุผลที่ส่งไปกับคำขอ (ตรงกับ REASON ในหน้า Medical Bookings)
export const requestReason = (bucket) =>
  bucket === "overdue"
    ? "overdue"
    : bucket === "no_record"
      ? "no_record"
      : ["critical", "due_soon", "upcoming"].includes(bucket)
        ? "due_soon"
        : "manual";

// ข้อความใต้วันหมดอายุ
export const daysNote = (daysLeft) =>
  daysLeft === null
    ? null
    : daysLeft < 0
      ? `หมดมาแล้ว ${Math.abs(daysLeft)} วัน`
      : daysLeft <= 90
        ? `เหลือ ${daysLeft} วัน`
        : null;

// หา record ตามประเภทการตรวจ — tolerant กันสะกด / เว้นวรรคต่าง
const norm = (s) => (s || "").replace(/\s+/g, "").toLowerCase();
export const findCheck = (checks, checkType) =>
  (checks || []).find((m) => norm(m.checkType) === norm(checkType)) || null;

// key ของคำขอที่รอ HR — ตรงกับ GET /api/medical-requests/pending-keys
export const medKey = (employeeId, checkType) => `${employeeId}:${checkType || MAIN_CHECK}`;

// Health Risk จาก PE record ล่าสุด (เดียวกับคอลัมน์ HEALTH RISK หน้า Assign Names)
export const healthRiskDisplay = (raw) => {
  const n = (raw || "").toLowerCase();
  if (n.includes("significant")) return { label: "Significant", tone: "darkRed" };
  if (n.includes("moderate")) return { label: "Moderate", tone: "yellow" };
  if (n.includes("high")) return { label: "High", tone: "red" };
  if (n.includes("low")) return { label: "Low", tone: "green" };
  if (n.includes("pending")) return { label: "Pending", tone: "gray" };
  return { label: raw, tone: "grayDark" };
};
