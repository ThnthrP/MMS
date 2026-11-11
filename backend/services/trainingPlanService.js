// ══════════════════════════════════════════════════════════
// Training Plan — อบรมที่กำลังดำเนินอยู่ / กำลังจะเริ่ม
//
// ใช้ข้อมูลชุดเดียวกับ Training Bookings: TrainingRequestItem ที่ status = "confirmed"
//   • HR ยืนยันคำขอที่หน้า Bookings → ขึ้นใน Training Calendar เอง
//   • เพิ่มแผนอบรมจากหน้า Training Plan → สร้างคำขอที่ยืนยันแล้วทันที (เห็นในหน้า Bookings ด้วย)
// "รอบอบรม" = รายการที่ training + วันเริ่ม + วันจบ + สถานที่ ตรงกัน
// วันที่: ใช้วันที่ HR ยืนยัน (confirmedStart/End) · ถ้า HR ไม่ได้กรอก → ใช้วันที่ผู้ขอระบุในคำขอ
//   (แสดงป้าย "วันที่ตามคำขอ" ให้รู้ · แก้วันที่ในหน้า Training Calendar แล้วจะเป็นวันยืนยัน)
// ไม่ต้องแก้ schema
// ══════════════════════════════════════════════════════════
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TZ = "Asia/Bangkok";
const PLAN_TAG = "[Training Plan]";

// วันที่แบบ YYYY-MM-DD (วันที่เก็บจาก <input type=date> = เที่ยงคืน UTC)
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const addDaysStr = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const toDate = (s) => (s ? new Date(`${String(s).slice(0, 10)}T00:00:00Z`) : null);
const httpError = (status, message) => Object.assign(new Error(message), { status });

const statusOf = (start, end, today) =>
  start > today ? "upcoming" : (end || start) < today ? "ended" : "inProgress";

// ── GET: รอบอบรมทั้งหมดที่ยังไม่จบ (+ จบไปแล้วไม่เกิน endedDays วัน) ──
export async function listSessions({ endedDays = 0 } = {}) {
  const today = todayStr();
  const since = toDate(addDaysStr(today, -Math.max(0, Number(endedDays) || 0)));

  const items = await prisma.trainingRequestItem.findMany({
    where: {
      status: "confirmed",
      OR: [
        { confirmedEnd: { gte: since } },
        { confirmedEnd: null, confirmedStart: { gte: since } },
        // HR ไม่ได้กรอกวันยืนยัน → ดูวันที่ผู้ขอระบุ
        {
          confirmedStart: null,
          batch: {
            is: {
              OR: [
                { requestedEnd: { gte: since } },
                { requestedEnd: null, requestedStart: { gte: since } },
              ],
            },
          },
        },
      ],
    },
    include: {
      globalTraining: { select: { id: true, name: true, fullName: true } },
      employee: {
        select: {
          id: true,
          empId: true,
          empCode: true,
          fullName: true,
          fullNameEN: true,
          fullNameTH: true,
          division: true,
          position: { select: { name: true } },
        },
      },
      batch: {
        select: {
          remarks: true,
          requestedStart: true,
          requestedEnd: true,
          provider: true,
          requestedBy: { select: { name: true } },
        },
      },
    },
  });

  const sessions = new Map();
  for (const it of items) {
    const fromRequest = !it.confirmedStart; // HR ไม่ได้กรอกวันยืนยัน
    const start = ymd(fromRequest ? it.batch?.requestedStart : it.confirmedStart);
    if (!start) continue;
    const end = ymd(fromRequest ? it.batch?.requestedEnd : it.confirmedEnd) || start;
    const provider = (it.confirmedProvider || it.batch?.provider || "").trim();
    const key = [it.globalTrainingId, start, end, provider.toLowerCase(), fromRequest ? "req" : ""].join("|");
    if (!sessions.has(key)) {
      sessions.set(key, {
        key,
        training: it.globalTraining,
        start,
        end,
        provider: provider || null,
        status: statusOf(start, end, today),
        datesFromRequest: fromRequest,
        attendees: [],
      });
    }
    sessions.get(key).attendees.push({
      itemId: it.id,
      employee: it.employee,
      hrNote: it.hrNote || null,
      fromPlan: (it.batch?.remarks || "").startsWith(PLAN_TAG),
      requestedBy: it.batch?.requestedBy?.name || null,
    });
  }

  const order = { inProgress: 0, upcoming: 1, ended: 2 };
  const list = [...sessions.values()].sort((a, b) => {
    if (a.status !== b.status) return order[a.status] - order[b.status];
    if (a.status === "inProgress") return b.start.localeCompare(a.start); // เพิ่งเริ่มก่อน
    if (a.status === "upcoming") return a.start.localeCompare(b.start); // ใกล้เริ่มก่อน
    return b.end.localeCompare(a.end); // เพิ่งจบก่อน
  });
  for (const s of list)
    s.attendees.sort((x, y) =>
      String(x.employee?.fullName || "").localeCompare(String(y.employee?.fullName || "")),
    );
  return { today, sessions: list };
}

// ── POST: เพิ่มแผนอบรม → คำขอที่ยืนยันแล้ว 1 ชุด (คนละ 1 รายการ) ──
export async function createPlan(data, user) {
  const { globalTrainingId, provider, note } = data;
  const start = toDate(data.start);
  const end = toDate(data.end) || start;
  const employeeIds = [...new Set(data.employeeIds || [])].filter(Boolean);

  if (!globalTrainingId) throw httpError(400, "กรุณาเลือก Training");
  if (!start) throw httpError(400, "กรุณาระบุวันเริ่มอบรม");
  if (end < start) throw httpError(400, "วันจบต้องไม่ก่อนวันเริ่ม");
  if (employeeIds.length === 0) throw httpError(400, "กรุณาเลือกพนักงานอย่างน้อย 1 คน");

  // คนที่มีแผน training นี้ช่วงวันซ้อนกันอยู่แล้ว → ข้าม (กันลงซ้ำ)
  const overlapping = await prisma.trainingRequestItem.findMany({
    where: {
      globalTrainingId,
      employeeId: { in: employeeIds },
      status: "confirmed",
      confirmedStart: { lte: end },
      OR: [{ confirmedEnd: { gte: start } }, { confirmedEnd: null, confirmedStart: { gte: start } }],
    },
    select: { employeeId: true },
  });
  const skip = new Set(overlapping.map((o) => o.employeeId));
  const toCreate = employeeIds.filter((id) => !skip.has(id));

  const providerText = String(provider || "").trim().slice(0, 200) || null;
  const noteText = String(note || "").trim().slice(0, 500) || null;

  if (toCreate.length > 0) {
    await prisma.trainingRequestBatch.create({
      data: {
        requestedById: user?.id || null,
        status: "confirmed",
        requestedStart: start,
        requestedEnd: end,
        provider: providerText,
        remarks: noteText ? `${PLAN_TAG} ${noteText}` : PLAN_TAG,
        items: {
          create: toCreate.map((employeeId) => ({
            employeeId,
            globalTrainingId,
            status: "confirmed",
            confirmedStart: start,
            confirmedEnd: end,
            confirmedProvider: providerText,
            hrNote: noteText,
            decidedAt: new Date(),
            decidedByName: user?.name || null,
          })),
        },
      },
    });
  }
  return { created: toCreate.length, skippedEmployeeIds: [...skip] };
}

// ── PUT: แก้วันที่ / สถานที่ ของทั้งรอบ (ส่ง itemId ของคนในรอบนั้นมา) ──
export async function updateSession({ itemIds, start, end, provider }, user) {
  const s = toDate(start);
  const e = toDate(end) || s;
  if (!Array.isArray(itemIds) || itemIds.length === 0) throw httpError(400, "ไม่มีรายการ");
  if (!s) throw httpError(400, "กรุณาระบุวันเริ่มอบรม");
  if (e < s) throw httpError(400, "วันจบต้องไม่ก่อนวันเริ่ม");
  const { count } = await prisma.trainingRequestItem.updateMany({
    where: { id: { in: itemIds }, status: "confirmed" },
    data: {
      confirmedStart: s,
      confirmedEnd: e,
      confirmedProvider: String(provider || "").trim().slice(0, 200) || null,
      decidedAt: new Date(),
      decidedByName: user?.name || null,
    },
  });
  return { updated: count };
}

// ── PUT: เอาคนออกจากรอบ → ยกเลิกรายการ (ไม่ลบ เก็บประวัติไว้ในหน้า Bookings) ──
export async function cancelAttendee(itemId, user) {
  const item = await prisma.trainingRequestItem.findUnique({
    where: { id: itemId },
    select: { status: true, hrNote: true },
  });
  if (!item) throw httpError(404, "ไม่พบรายการ");
  if (item.status !== "confirmed") throw httpError(400, "รายการนี้ไม่ได้อยู่ในแผนอบรมแล้ว");
  return prisma.trainingRequestItem.update({
    where: { id: itemId },
    data: {
      status: "rejected",
      hrNote: [item.hrNote, "ยกเลิกจาก Training Plan"].filter(Boolean).join(" · "),
      decidedAt: new Date(),
      decidedByName: user?.name || null,
    },
  });
}
