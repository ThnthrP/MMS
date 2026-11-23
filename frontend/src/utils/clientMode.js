// ══════════════════════════════════════════════════════════
// โหมดลูกค้า (single / multi) — ค่าเดียวใช้ทั้งระบบ
//   frontend/.env:  VITE_CLIENT_MODE=multi  → ระบบหลายลูกค้า (MMS-Multi)
//                   ไม่มีบรรทัดนี้          → ระบบ Chevron อย่างเดียว (ค่าเดิม)
//   Vite อ่านค่าตอน start — แก้ .env แล้วต้อง restart frontend
// ══════════════════════════════════════════════════════════

export const MULTI_CLIENT = import.meta.env.VITE_CLIENT_MODE === "multi";

// ลำดับลูกค้าที่แสดง — ชื่อในวงเล็บเดียวกัน = ลูกค้าเดียวกัน (ใน DB อาจชื่อ PTT หรือ PTTEP)
export const CLIENT_ORDER = [
  ["CHEVRON"],
  ["ERAWAN"],
  ["PTTEP", "PTT"],
  ["VALEURA"],
];

const norm = (s) => String(s || "").trim().toUpperCase();

const clientGroup = (name) =>
  CLIENT_ORDER.findIndex((g) => g.includes(norm(name)));

export const clientRank = (name) => {
  const i = clientGroup(name);
  return i < 0 ? 99 : i;
};

export const sortClients = (list) =>
  [...list].sort(
    (a, b) =>
      clientRank(a.name) - clientRank(b.name) ||
      String(a.name).localeCompare(String(b.name)),
  );

// ชื่อลูกค้าสองชื่อเป็นเจ้าเดียวกันไหม (รวมชื่อเรียกอื่น เช่น PTT = PTTEP)
export const sameClient = (a, b) => {
  if (!a || !b) return false;
  if (norm(a) === norm(b)) return true;
  const g = clientGroup(a);
  return g >= 0 && g === clientGroup(b);
};

const aliasesOf = (name) => {
  const g = clientGroup(name);
  return g >= 0 ? CLIENT_ORDER[g] : [norm(name)];
};

// ข้อความ (Company / Customer Name) พูดถึงลูกค้านี้ไหม — เทียบทั้งคำ
//   "Chevron Thailand E&P" → Chevron · คำว่า "PTT" ไม่ไปตรงกับชื่ออื่นที่แค่ขึ้นต้นด้วย PTT
export const textMentionsClient = (text, clientName) => {
  const words = norm(text).split(/[^A-Z0-9]+/).filter(Boolean);
  if (!words.length) return false;
  return aliasesOf(clientName).some((a) => words.includes(a));
};

// ชื่อลูกค้าของ contract — ใช้ clientName / client.name ที่ backend ส่งมา ถ้าไม่มีดูจากชื่อ contract
//   เช่น "Erawan Offshore 2025" → Erawan (clients = รายการลูกค้าจาก AppContext)
export const contractClientName = (contract, clients = []) =>
  contract?.clientName ||
  contract?.client?.name ||
  clients.find((cl) => textMentionsClient(contract?.name, cl.name))?.name ||
  null;
