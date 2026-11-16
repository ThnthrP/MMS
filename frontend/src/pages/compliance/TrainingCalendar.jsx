import { useState, useEffect, useContext, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import Select from "react-select";
import { AppContent } from "../../context/AppContext";
import { buildWorkerOptions, filterWorkerOption, nameEN, nameTH } from "../../utils/workerSearch";
import { invalidateTrainingPlanCache } from "../../components/TrainingPlanNotice";

// ══════════════════════════════════════════════════════════
// Training Calendar (เมนู Training Plan › แท็บแรก)
// อบรมที่กำลังดำเนินอยู่ / กำลังจะเริ่ม — แต่ละรอบมีใครบ้าง
// ข้อมูล = คำขออบรมที่ HR ยืนยันแล้ว (หน้า Bookings) + แผนที่เพิ่มจากหน้า "เพิ่มแผนอบรม"
//
// 2 มุมมอง (จำค่าที่เลือกต่อเบราว์เซอร์):
//   📋 รายการ  — เรียง กำลังอบรม → กำลังจะเริ่ม → จบแล้ว (ถ้าเปิดดู) · มีรายชื่อ + ปุ่มจัดการครบ
//   📅 ปฏิทิน — ปฏิทินรายเดือน รอบอบรม = แถบยาวตามวันอบรม · กดแถบ → หน้าต่างรายละเอียดรอบ
//               ดึงข้อมูลตามช่วงของเดือน (from / to) จึงเลื่อนดูเดือนย้อนหลังได้
//               จอเล็กกว่า md → แสดงรายการรอบในเดือนนั้นแทนตาราง
// ══════════════════════════════════════════════════════════

const DAY = 86400000;
const ENDED_DAYS = 30;

const PERIODS = [
  ["inProgress", "🟢 กำลังอบรม", "border-l-[#198754]", "bg-emerald-50 text-emerald-800"],
  ["upcoming", "🔵 กำลังจะเริ่ม", "border-l-blue-600", "bg-blue-50 text-blue-800"],
  ["ended", `⚪ จบแล้ว (${ENDED_DAYS} วัน)`, "border-l-gray-300", "bg-gray-100 text-gray-600"],
];
const PERIOD = Object.fromEntries(PERIODS.map(([k, ...rest]) => [k, rest]));

// สีแถบในปฏิทิน — โทนเดียวกับป้ายสถานะในมุมมองรายการ
const BAR = {
  inProgress: "border-[#198754] bg-emerald-50 text-emerald-900 hover:bg-emerald-100",
  upcoming: "border-blue-600 bg-blue-50 text-blue-900 hover:bg-blue-100",
  ended: "border-gray-400 bg-gray-100 text-gray-600 hover:bg-gray-200",
};
const DOT = { inProgress: "bg-[#198754]", upcoming: "bg-blue-600", ended: "bg-gray-400" };

const VIEW_KEY = "trainingCalendarView"; // "list" | "month"
const readView = () => {
  try {
    return localStorage.getItem(VIEW_KEY) === "month" ? "month" : "list";
  } catch {
    return "list";
  }
};
const writeView = (v) => {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    // localStorage อาจไม่พร้อมใช้งาน — ไม่ critical
  }
};

const LABEL = "mb-1 block text-[11px] font-semibold text-gray-500";
const FIELD =
  "box-border h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-[13px] outline-none focus:border-blue-400";
// react-select — โทนเดียวกับหน้า Workers · dropdown ลอยเหนือทุกอย่าง (render ที่ <body>)
const SELECT_STYLES = {
  control: (p) => ({
    ...p,
    borderColor: "#e5e7eb",
    borderRadius: "8px",
    minHeight: "36px",
    fontSize: "13px",
    boxShadow: "none",
    "&:hover": { borderColor: "#86b7fe" },
  }),
  option: (p) => ({ ...p, fontSize: "13px" }),
  menuPortal: (p) => ({ ...p, zIndex: 50 }),
};
const MENU_PORTAL = {
  menuPortalTarget: typeof document !== "undefined" ? document.body : null,
  menuPosition: "fixed",
};
const NO_PROVIDER = "__none__"; // ตัวเลือก "ยังไม่ระบุสถานที่"

const BTN_SOFT =
  "inline-flex cursor-pointer items-center whitespace-nowrap rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 no-underline hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_NAV =
  "inline-flex h-7 min-w-[28px] cursor-pointer items-center justify-center rounded-md border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700 hover:bg-gray-50";

// ── วันที่: ทำงานกับสตริง YYYY-MM-DD (UTC) ทั้งหมด — ไม่เพี้ยนตาม timezone ──
const daysBetween = (a, b) =>
  Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / DAY);
const addDays = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmt = (s, withYear = true) =>
  new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
const periodText = (s, e) =>
  s === e
    ? fmt(s)
    : `${fmt(s, s.slice(0, 4) !== e.slice(0, 4))} – ${fmt(e)}`;

// ป้ายบอกความคืบหน้าของรอบ
const progressText = (s, today) => {
  const total = daysBetween(s.start, s.end) + 1;
  if (s.status === "upcoming") {
    const d = daysBetween(today, s.start);
    return d === 1 ? "เริ่มพรุ่งนี้" : `เริ่มในอีก ${d} วัน`;
  }
  if (s.status === "inProgress")
    return `วันที่ ${daysBetween(s.start, today) + 1}/${total}`;
  return `จบเมื่อ ${fmt(s.end)}`;
};

const ymdLocal = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

// ── ปฏิทินเดือน (สัปดาห์เริ่มวันจันทร์) ──
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthOf = (ymd) => ymd.slice(0, 7); // "YYYY-MM"
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2000, i, 1)).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" }),
);
const SELECT_SM =
  "h-7 cursor-pointer rounded-md border border-gray-300 bg-white px-2 text-[13px] font-semibold text-gray-900 outline-none hover:bg-gray-50 focus:border-blue-400";
// ช่วงวันที่ของตาราง: จันทร์ก่อน/ตรงวันที่ 1 → อาทิตย์หลัง/ตรงวันสุดท้ายของเดือน
const gridRange = (ym) => {
  const first = `${ym}-01`;
  const last = addDays(`${shiftMonth(ym, 1)}-01`, -1);
  const dowFirst = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7; // จันทร์ = 0
  const dowLast = (new Date(`${last}T00:00:00Z`).getUTCDay() + 6) % 7;
  return [addDays(first, -dowFirst), addDays(last, 6 - dowLast)];
};

// แบ่งรอบอบรมเป็นแถบรายสัปดาห์ + จัดแถว (lane) ไม่ให้แถบทับกัน
const buildWeeks = (gridStart, gridEnd, sessions) => {
  const weeks = [];
  for (let ws = gridStart; ws <= gridEnd; ws = addDays(ws, 7)) {
    const we = addDays(ws, 6);
    const segs = sessions
      .filter((s) => s.start <= we && s.end >= ws)
      .map((s) => ({
        s,
        c0: Math.max(0, daysBetween(ws, s.start)),
        c1: Math.min(6, daysBetween(ws, s.end)),
        head: s.start >= ws, // แถบเริ่มในสัปดาห์นี้ (มุมโค้งด้านซ้าย)
        tail: s.end <= we, // แถบจบในสัปดาห์นี้ (มุมโค้งด้านขวา)
      }))
      .sort((a, b) => a.c0 - b.c0 || b.c1 - b.c0 - (a.c1 - a.c0));
    const laneEnd = [];
    for (const seg of segs) {
      let lane = laneEnd.findIndex((end) => end < seg.c0);
      if (lane === -1) lane = laneEnd.length;
      laneEnd[lane] = seg.c1;
      seg.lane = lane;
    }
    weeks.push({
      start: ws,
      days: Array.from({ length: 7 }, (_, i) => addDays(ws, i)),
      segs,
      lanes: laneEnd.length,
    });
  }
  return weeks;
};

// ── การ์ดรอบอบรม 1 รอบ (ใช้ทั้งมุมมองรายการ และหน้าต่างรายละเอียดจากปฏิทิน) ──
function SessionCard({ s, today, matchPerson, onEdit, onCancel, bordered = true }) {
  const [periodLabel, accent, tagCls] = PERIOD[s.status];
  return (
    <div className={bordered ? `border-l-4 py-3 pl-3 pr-1 sm:pl-4 ${accent}` : ""}>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-words text-[15px] font-bold text-gray-900">
              {s.training?.name || "—"}
            </span>
            <span
              className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${tagCls}`}
            >
              {periodLabel.split(" (")[0]} · {progressText(s, today)}
            </span>
          </div>
          <div className="mt-0.5 text-[13px] text-gray-700">
            📅 {periodText(s.start, s.end)}
            <span className="text-gray-400"> · {daysBetween(s.start, s.end) + 1} วัน</span>
            {s.provider && <span className="text-gray-600"> · 📍 {s.provider}</span>}
            <span className="text-gray-600"> · 👥 {s.attendees.length} คน</span>
          </div>
          {s.datesFromRequest && (
            <div className="mt-1 inline-block rounded bg-[#fff3cd] px-1.5 py-0.5 text-[11px] text-[#664d03]">
              📝 วันที่ตามคำขอ — HR ยังไม่ได้ระบุวันยืนยัน · กด "แก้วันที่ / สถานที่" เพื่อยืนยันวัน
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          {s.status !== "ended" && (
            <Link
              to={`/training-plan/new?${new URLSearchParams({
                trainingId: s.training?.id || "",
                start: s.start,
                end: s.end,
                provider: s.provider || "",
              })}`}
              className={BTN_SOFT}
            >
              + เพิ่มคน
            </Link>
          )}
          <button type="button" onClick={() => onEdit(s)} className={BTN_SOFT}>
            แก้วันที่ / สถานที่
          </button>
          {s.status !== "upcoming" && (
            <Link
              to={`/certifications/bulk-add?${new URLSearchParams({
                trainingId: s.training?.id || "",
                empIds: s.attendees.map((a) => a.employee?.id).filter(Boolean).join(","),
                issued: s.end,
              })}`}
              title="อบรมเสร็จแล้ว → บันทึก certification ให้ทุกคนในรอบนี้"
              className="inline-flex items-center whitespace-nowrap rounded-md border border-[#a3cfbb] bg-[#e8f5ee] px-2.5 py-1 text-xs font-semibold text-[#146c43] no-underline hover:bg-[#198754] hover:text-white"
            >
              ✓ บันทึกผลอบรม →
            </Link>
          )}
        </div>
      </div>

      {/* รายชื่อในรอบนี้ */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {s.attendees.map((a) => {
          const hit = matchPerson(a);
          return (
            <span
              key={a.itemId}
              title={[
                nameTH(a.employee),
                a.employee?.position?.name,
                a.requestedBy && `ขอโดย ${a.requestedBy}`,
                a.hrNote,
              ]
                .filter(Boolean)
                .join(" · ")}
              className={`inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${
                hit
                  ? "border-blue-400 bg-blue-50 font-semibold text-blue-800"
                  : "border-gray-200 bg-white text-gray-700"
              }`}
            >
              <Link
                to={`/workers/${a.employee?.id}`}
                className="truncate text-inherit no-underline hover:underline"
              >
                {nameEN(a.employee)}
              </Link>
              <span className="shrink-0 text-[10px] text-gray-400">
                {a.employee?.empId || a.employee?.empCode}
              </span>
              {s.status !== "ended" && (
                <button
                  type="button"
                  title="เอาออกจากรอบนี้"
                  onClick={() => onCancel(s, a)}
                  className="shrink-0 cursor-pointer border-none bg-transparent p-0 text-[11px] leading-none text-gray-400 hover:text-[#dc3545]"
                >
                  ✕
                </button>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function TrainingCalendar() {
  const { backendUrl } = useContext(AppContent);
  const [data, setData] = useState({ today: ymdLocal(new Date()), sessions: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // มุมมอง + เดือนที่ดูในปฏิทิน (ข้อมูลปฏิทินโหลดแยก ตามช่วงของเดือน)
  const [view, setViewState] = useState(readView);
  const setView = (v) => {
    setViewState(v);
    writeView(v);
  };
  const [month, setMonth] = useState(() => monthOf(ymdLocal(new Date())));
  const [monthData, setMonthData] = useState({ key: "", sessions: [] });
  const [monthLoading, setMonthLoading] = useState(false);
  const [detail, setDetail] = useState(null); // รอบที่กดจากปฏิทิน

  // ตัวกรองแยก 3 ช่อง — ทุกช่องพิมพ์ค้นหาใน dropdown ได้ · ใช้ได้ทั้ง 2 มุมมอง
  const [trainingFilter, setTrainingFilter] = useState(""); // training.id
  const [providerFilter, setProviderFilter] = useState(""); // ชื่อสถานที่ / NO_PROVIDER
  const [workerFilter, setWorkerFilter] = useState(""); // employee.id
  const [shown, setShown] = useState({ inProgress: true, upcoming: true, ended: false });

  const [editing, setEditing] = useState(null); // { session, start, end, provider }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${backendUrl}/api/training-plan`, {
        params: { endedDays: ENDED_DAYS },
        withCredentials: true,
      });
      setData(res.data);
      setError("");
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [backendUrl]);

  const [gridStart, gridEnd] = useMemo(() => gridRange(month), [month]);
  // ปีให้เลือก: ย้อนหลัง 3 ปี ถึงล่วงหน้า 2 ปี (รวมปีที่กำลังดูเสมอ ถ้ากด ◀ ▶ ออกนอกช่วง)
  const yearOptions = useMemo(() => {
    const thisYear = Number(data.today.slice(0, 4));
    const ys = new Set(Array.from({ length: 6 }, (_, i) => thisYear - 3 + i));
    ys.add(Number(month.slice(0, 4)));
    return [...ys].sort((a, b) => a - b);
  }, [data.today, month]);
  const loadMonth = useCallback(async () => {
    try {
      setMonthLoading(true);
      const res = await axios.get(`${backendUrl}/api/training-plan`, {
        params: { from: gridStart, to: gridEnd },
        withCredentials: true,
      });
      setMonthData({ key: `${gridStart}|${gridEnd}`, sessions: res.data.sessions || [] });
      setError("");
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setMonthLoading(false);
    }
  }, [backendUrl, gridStart, gridEnd]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (view === "month") loadMonth();
  }, [view, loadMonth]);

  // หลังแก้ไข — โหลดใหม่ทั้ง 2 ชุด (มุมมองรายการ + เดือนที่เปิดอยู่)
  const refresh = () => {
    invalidateTrainingPlanCache();
    load();
    if (view === "month") loadMonth();
  };

  const isMonth = view === "month";
  // ตัวเลือกใน dropdown มาจากข้อมูลของมุมมองที่เปิดอยู่
  const pool = isMonth ? monthData.sessions : data.sessions;

  const counts = useMemo(() => {
    const c = { inProgress: 0, upcoming: 0, ended: 0 };
    data.sessions.forEach((s) => c[s.status]++);
    return c;
  }, [data.sessions]);

  // วงเล็บ = จำนวนรอบ
  const trainingOptions = useMemo(() => {
    const m = new Map();
    pool.forEach((s) => {
      if (!s.training) return;
      const cur = m.get(s.training.id) || { name: s.training.name, n: 0 };
      cur.n++;
      m.set(s.training.id, cur);
    });
    return [...m.entries()]
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([id, { name, n }]) => ({ value: id, label: `${name} (${n} รอบ)` }));
  }, [pool]);

  const providerOptions = useMemo(() => {
    const m = new Map();
    let blank = 0;
    pool.forEach((s) => {
      const p = (s.provider || "").trim();
      if (!p) blank++;
      else m.set(p, (m.get(p) || 0) + 1);
    });
    const opts = [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([p, n]) => ({ value: p, label: `${p} (${n} รอบ)` }));
    if (blank) opts.push({ value: NO_PROVIDER, label: `— ยังไม่ระบุสถานที่ (${blank} รอบ)` });
    return opts;
  }, [pool]);

  // พนักงานทุกคนที่อยู่ในรอบอบรม (ไม่ซ้ำ) — ค้นหาแบบเดียวกับหน้า Workers (ID / ชื่อไทย / อังกฤษ)
  const workerOptions = useMemo(() => {
    const m = new Map();
    pool.forEach((s) => s.attendees.forEach((a) => a.employee?.id && m.set(a.employee.id, a.employee)));
    return buildWorkerOptions([...m.values()]);
  }, [pool]);

  const matchPerson = (a) => !!workerFilter && a.employee?.id === workerFilter;

  const matchFilters = (s) => {
    if (trainingFilter && s.training?.id !== trainingFilter) return false;
    if (providerFilter) {
      const p = (s.provider || "").trim();
      if (providerFilter === NO_PROVIDER ? p : p !== providerFilter) return false;
    }
    if (workerFilter && !s.attendees.some(matchPerson)) return false;
    return true;
  };

  // มุมมองรายการ: ใช้ปุ่มสถานะด้วย · มุมมองปฏิทิน: แสดงทุกสถานะ (สีแถบบอกสถานะแทน)
  const visible = data.sessions.filter((s) => shown[s.status] && matchFilters(s));
  const monthVisible = monthData.sessions.filter(matchFilters);
  const current = isMonth ? monthVisible : visible;
  const peopleShown = new Set(current.flatMap((s) => s.attendees.map((a) => a.employee?.id))).size;

  const weeks = useMemo(
    () => buildWeeks(gridStart, gridEnd, monthVisible),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gridStart, gridEnd, monthData, trainingFilter, providerFilter, workerFilter],
  );
  // จอเล็ก: รายการรอบที่อยู่ในเดือนนี้ เรียงวันเริ่ม
  const monthStart = `${month}-01`;
  const monthEnd = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const agenda = monthVisible
    .filter((s) => s.start <= monthEnd && s.end >= monthStart)
    .sort((a, b) => a.start.localeCompare(b.start));

  const hasFilter =
    trainingFilter ||
    providerFilter ||
    workerFilter ||
    (!isMonth && (!shown.inProgress || !shown.upcoming || shown.ended));
  const clearFilters = () => {
    setTrainingFilter("");
    setProviderFilter("");
    setWorkerFilter("");
    setShown({ inProgress: true, upcoming: true, ended: false });
  };

  // ── actions ──
  const cancelAttendee = async (session, a) => {
    if (
      !window.confirm(
        `เอา ${nameEN(a.employee)} ออกจากรอบ "${session.training?.name}" (${periodText(session.start, session.end)})?\nรายการจะถูกยกเลิก (ยังดูประวัติได้ที่หน้า Training Bookings)`,
      )
    )
      return;
    try {
      await axios.put(
        `${backendUrl}/api/training-plan/items/${a.itemId}/cancel`,
        {},
        { withCredentials: true },
      );
      setDetail(null);
      refresh();
    } catch (err) {
      alert(err.response?.data?.message || "ยกเลิกไม่สำเร็จ");
    }
  };

  const openEdit = (s) =>
    setEditing({ session: s, start: s.start, end: s.end, provider: s.provider || "" });

  const saveEdit = async () => {
    if (!editing.start) return alert("กรุณาระบุวันเริ่ม");
    if (editing.end && editing.end < editing.start) return alert("วันจบต้องไม่ก่อนวันเริ่ม");
    try {
      setBusy(true);
      await axios.put(
        `${backendUrl}/api/training-plan/session`,
        {
          itemIds: editing.session.attendees.map((a) => a.itemId),
          start: editing.start,
          end: editing.end || editing.start,
          provider: editing.provider,
        },
        { withCredentials: true },
      );
      setEditing(null);
      setDetail(null);
      refresh();
    } catch (err) {
      alert(err.response?.data?.message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const cardProps = { today: data.today, matchPerson, onEdit: openEdit, onCancel: cancelAttendee };
  const emptyAll = (
    <>
      ยังไม่มีอบรมที่กำลังดำเนินอยู่หรือกำลังจะเริ่ม —{" "}
      <Link to="/training-plan/new" className="text-blue-600">
        + เพิ่มแผนอบรม
      </Link>{" "}
      หรือยืนยันคำขอที่หน้า{" "}
      <Link to="/requests-history" className="text-blue-600">
        Training Bookings
      </Link>
    </>
  );

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1800px]">
      {/* ════════ Header ════════ */}
      <div className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="m-0 text-lg font-bold">Training Calendar</h1>
          <div className="text-xs text-gray-500">
            อบรมที่กำลังดำเนินอยู่และกำลังจะเริ่ม — แต่ละรอบมีใครบ้าง · มาจากคำขอที่ HR
            ยืนยันแล้ว (ถ้ายังไม่ระบุวัน ใช้วันที่ผู้ขอระบุ) และแผนที่เพิ่มเอง
          </div>
        </div>
        <Link
          to="/training-plan/new"
          className="inline-block shrink-0 rounded-md bg-[#2B2F78] px-3.5 py-2 text-center text-xs font-semibold text-white no-underline hover:bg-[#22265f]"
        >
          + เพิ่มแผนอบรม
        </Link>
      </div>

      {/* ════════ Filters ════════ */}
      <div className="space-y-3 border-y border-gray-200 py-3">
        {/* Training — เต็มแถว (ชื่อหลักสูตรยาว) */}
        <div className="min-w-0">
          <label className={`${LABEL} flex items-center justify-between`}>
            <span>Training</span>
            {hasFilter && (
              <button
                type="button"
                onClick={clearFilters}
                className="cursor-pointer border-none bg-transparent p-0 text-[11px] font-semibold text-[#dc3545] underline"
              >
                ✕ ล้างทั้งหมด
              </button>
            )}
          </label>
          <Select
            options={trainingOptions}
            value={trainingOptions.find((o) => o.value === trainingFilter) || null}
            onChange={(o) => setTrainingFilter(o ? o.value : "")}
            placeholder="ทุก training — พิมพ์เพื่อค้นหา..."
            isClearable
            styles={SELECT_STYLES}
            {...MENU_PORTAL}
            noOptionsMessage={() => "ไม่พบ training"}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="min-w-0">
            <label className={LABEL}>ศูนย์อบรม / สถานที่</label>
            <Select
              options={providerOptions}
              value={providerOptions.find((o) => o.value === providerFilter) || null}
              onChange={(o) => setProviderFilter(o ? o.value : "")}
              placeholder="ทุกสถานที่ — พิมพ์เพื่อค้นหา..."
              isClearable
              styles={SELECT_STYLES}
              {...MENU_PORTAL}
              noOptionsMessage={() => "ไม่พบสถานที่"}
            />
          </div>
          <div className="min-w-0">
            <label className={LABEL}>
              Worker <span className="font-normal text-gray-400">(ID / ชื่อไทย / อังกฤษ)</span>
            </label>
            <Select
              options={workerOptions}
              value={workerOptions.find((o) => o.value === workerFilter) || null}
              onChange={(o) => setWorkerFilter(o ? o.value : "")}
              filterOption={filterWorkerOption}
              placeholder="🔍 ค้นหาด้วย ID หรือชื่อ (ไทย/อังกฤษ)..."
              isClearable
              styles={SELECT_STYLES}
              {...MENU_PORTAL}
              noOptionsMessage={() => "ไม่พบพนักงานในรอบอบรม"}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* สลับมุมมอง — segmented control แบบเดียวกับหน้า Bookings (อยู่ซ้ายสุด ไม่ขยับเมื่อสลับ) */}
          <div className="mr-1 inline-flex shrink-0 gap-0.5 rounded-lg bg-gray-100 p-0.5" role="group" aria-label="มุมมอง">
            {[
              ["list", "📋 รายการ"],
              ["month", "📅 ปฏิทิน"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                aria-pressed={view === key}
                className={`cursor-pointer whitespace-nowrap rounded-md border-none px-2.5 py-1 text-xs font-semibold transition ${
                  view === key
                    ? "bg-white text-[#2B2F78] shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
                    : "bg-transparent text-gray-500 hover:text-gray-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {isMonth ? (
            <>
              <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} className={BTN_NAV} aria-label="เดือนก่อน">
                ◀
              </button>
              {/* เลือกเดือน / ปี ตรงๆ — ไม่ต้องกด ◀ ▶ ทีละเดือน */}
              <select
                value={month.slice(5, 7)}
                onChange={(e) => setMonth(`${month.slice(0, 4)}-${e.target.value}`)}
                aria-label="เดือน"
                className={SELECT_SM}
              >
                {MONTHS.map((name, i) => (
                  <option key={name} value={String(i + 1).padStart(2, "0")}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                value={month.slice(0, 4)}
                onChange={(e) => setMonth(`${e.target.value}-${month.slice(5, 7)}`)}
                aria-label="ปี"
                className={SELECT_SM}
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => setMonth((m) => shiftMonth(m, 1))} className={BTN_NAV} aria-label="เดือนถัดไป">
                ▶
              </button>
              {month !== monthOf(data.today) && (
                <button type="button" onClick={() => setMonth(monthOf(data.today))} className={BTN_NAV}>
                  เดือนนี้
                </button>
              )}
              {/* คำอธิบายสีแถบ */}
              <span className="ml-1 hidden items-center gap-3 text-[11px] text-gray-500 lg:inline-flex">
                {PERIODS.map(([key, label]) => (
                  <span key={key} className="inline-flex items-center gap-1">
                    <span className={`inline-block h-2 w-2 rounded-full ${DOT[key]}`} />
                    {label.split(" (")[0].replace(/^\S+\s/, "")}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2.5 w-3.5 rounded-sm border border-dashed border-gray-500" />
                  วันที่ตามคำขอ
                </span>
              </span>
            </>
          ) : (
            PERIODS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setShown((p) => ({ ...p, [key]: !p[key] }))}
                className={`cursor-pointer rounded-full border px-3 py-1 font-semibold ${
                  shown[key]
                    ? "border-[#2B2F78] bg-[#2B2F78] text-white"
                    : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {label} {counts[key]}
              </button>
            ))
          )}
          <span className="ml-auto text-gray-500">
            {isMonth ? "ในปฏิทิน" : "แสดง"} {current.length} รอบ · {peopleShown} คน
          </span>
        </div>
      </div>

      {/* ════════ Sessions ════════ */}
      {error ? (
        <div className="p-10 text-center text-[13px] text-red-600">{error}</div>
      ) : isMonth ? (
        /* ──────── มุมมองปฏิทิน ──────── */
        <div className={`pt-3 transition-opacity ${monthLoading ? "opacity-50" : ""}`}>
          {/* md+: ตารางเดือน */}
          <div className="hidden overflow-hidden rounded-lg border border-gray-200 md:block">
            <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
              {WEEKDAYS.map((d, i) => (
                <div
                  key={d}
                  className={`px-2 py-1.5 text-[11px] font-semibold tracking-[0.4px] ${i >= 5 ? "text-gray-400" : "text-gray-500"}`}
                >
                  {d}
                </div>
              ))}
            </div>
            {weeks.map((w) => (
              <div
                key={w.start}
                className="relative grid grid-cols-7 border-b border-gray-100 last:border-b-0"
                style={{ gridTemplateRows: `26px repeat(${Math.max(w.lanes, 2)}, 24px) 8px` }}
              >
                {/* พื้นหลังแต่ละวัน */}
                {w.days.map((d, i) => {
                  const inMonth = monthOf(d) === month;
                  const isToday = d === data.today;
                  return (
                    <div
                      key={d}
                      style={{ gridColumn: i + 1, gridRow: "1 / -1" }}
                      className={`px-1.5 pt-1 ${i < 6 ? "border-r border-gray-100" : ""} ${
                        isToday ? "bg-amber-50" : inMonth ? (i >= 5 ? "bg-gray-50/60" : "bg-white") : "bg-gray-50"
                      }`}
                    >
                      <span
                        className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[11px] ${
                          isToday
                            ? "bg-[#E8590C] font-bold text-white"
                            : inMonth
                              ? "font-semibold text-gray-700"
                              : "text-gray-300"
                        }`}
                      >
                        {Number(d.slice(8))}
                      </span>
                    </div>
                  );
                })}
                {/* แถบรอบอบรม */}
                {w.segs.map((seg) => (
                  <button
                    key={`${seg.s.key}|${w.start}`}
                    type="button"
                    onClick={() => setDetail(seg.s)}
                    title={`${seg.s.training?.name || "—"} · ${periodText(seg.s.start, seg.s.end)}${
                      seg.s.provider ? ` · ${seg.s.provider}` : ""
                    } · ${seg.s.attendees.length} คน`}
                    style={{ gridColumn: `${seg.c0 + 1} / ${seg.c1 + 2}`, gridRow: seg.lane + 2 }}
                    className={`relative z-[1] mx-0.5 my-px flex min-w-0 cursor-pointer items-center gap-1 overflow-hidden border px-1.5 text-left text-[11px] font-semibold ${
                      BAR[seg.s.status]
                    } ${seg.s.datesFromRequest ? "border-dashed" : ""} ${
                      seg.head ? "rounded-l-md border-l-4" : "rounded-l-none border-l-0"
                    } ${seg.tail ? "rounded-r-md" : "rounded-r-none border-r-0"} ${
                      workerFilter ? "ring-1 ring-blue-400" : ""
                    }`}
                  >
                    <span className="truncate">
                      {!seg.head && "↳ "}
                      {seg.s.training?.name || "—"}
                    </span>
                    <span className="shrink-0 font-normal opacity-70">· {seg.s.attendees.length} คน</span>
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* จอเล็ก: รายการรอบในเดือนนี้ */}
          <div className="divide-y divide-gray-100 md:hidden">
            {agenda.length === 0 ? (
              <div className="p-8 text-center text-[13px] text-gray-500">ไม่มีรอบอบรมในเดือนนี้</div>
            ) : (
              agenda.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setDetail(s)}
                  className="flex w-full cursor-pointer items-start gap-2 border-none bg-transparent px-1 py-2.5 text-left hover:bg-gray-50"
                >
                  <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${DOT[s.status]}`} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-gray-900">{s.training?.name || "—"}</span>
                    <span className="block text-xs text-gray-500">
                      {periodText(s.start, s.end)}
                      {s.provider ? ` · ${s.provider}` : ""} · {s.attendees.length} คน
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>

          {!monthLoading && monthData.sessions.length > 0 && monthVisible.length === 0 && (
            <div className="p-4 text-center text-[13px] text-gray-500">ไม่พบรอบอบรมตามเงื่อนไขที่เลือกในเดือนนี้</div>
          )}
          <div className="pt-2 text-[11px] text-gray-400">กดที่แถบเพื่อดูรายชื่อและจัดการรอบอบรม</div>
        </div>
      ) : loading ? (
        <div className="p-10 text-center text-[13px] text-gray-500">Loading...</div>
      ) : visible.length === 0 ? (
        <div className="p-10 text-center text-[13px] text-gray-500">
          {data.sessions.length === 0 ? emptyAll : "ไม่พบรอบอบรมตามเงื่อนไขที่เลือก"}
        </div>
      ) : (
        /* ──────── มุมมองรายการ ──────── */
        <div className="divide-y divide-gray-100">
          {visible.map((s) => (
            <SessionCard key={s.key} s={s} {...cardProps} />
          ))}
        </div>
      )}

      {/* ════════ รายละเอียดรอบ (กดจากปฏิทิน) ════════ */}
      {detail && (
        <div
          className="fixed inset-0 z-[900] flex items-center justify-center bg-black/40 p-3"
          onClick={() => setDetail(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-[720px] overflow-y-auto rounded-[10px] bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
              <div className="text-[13px] font-semibold text-gray-500">รอบอบรม</div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                aria-label="ปิด"
                className="cursor-pointer border-none bg-transparent p-0 text-lg leading-none text-gray-400 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <div className="px-5 py-4">
              <SessionCard s={detail} {...cardProps} bordered={false} />
            </div>
          </div>
        </div>
      )}

      {/* ════════ แก้วันที่ / สถานที่ ของทั้งรอบ ════════ */}
      {editing && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-3"
          onClick={() => !busy && setEditing(null)}
        >
          <div
            className="w-full max-w-[460px] overflow-hidden rounded-[10px] bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-[#1e3a5f] px-5 py-3.5 text-white">
              <div className="font-semibold">แก้วันที่ / สถานที่</div>
              <div className="mt-0.5 text-xs opacity-80">
                {editing.session.training?.name} · {editing.session.attendees.length} คน
              </div>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>วันเริ่ม *</label>
                  <input
                    type="date"
                    value={editing.start}
                    onChange={(e) => setEditing((p) => ({ ...p, start: e.target.value }))}
                    className={FIELD}
                  />
                </div>
                <div>
                  <label className={LABEL}>วันจบ</label>
                  <input
                    type="date"
                    value={editing.end}
                    min={editing.start || undefined}
                    onChange={(e) => setEditing((p) => ({ ...p, end: e.target.value }))}
                    className={FIELD}
                  />
                </div>
              </div>
              <div>
                <label className={LABEL}>ศูนย์อบรม / สถานที่</label>
                <input
                  type="text"
                  value={editing.provider}
                  onChange={(e) => setEditing((p) => ({ ...p, provider: e.target.value }))}
                  placeholder="e.g. TPTI Songkhla"
                  className={FIELD}
                />
              </div>
              <div className="text-[11px] text-gray-500">
                ใช้กับทุกคนในรอบนี้ ({editing.session.attendees.length} คน)
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={busy}
                className="cursor-pointer rounded-lg border border-gray-200 bg-white px-4 py-2 text-[13px] hover:bg-gray-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={busy}
                className="cursor-pointer rounded-lg border-none bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? "กำลังบันทึก..." : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
