import {
  useState,
  useEffect,
  useLayoutEffect,
  useContext,
  useRef,
} from "react";
import { useNavigate, Link } from "react-router-dom";
import axios from "axios";
import { AppContent } from "../../context/AppContext";
import ClientFilter from "../../components/ClientFilter";
import {
  fmtShort,
  projectCode,
  StageBadge,
  StageDots,
} from "./calendarShared";

// ══════════════════════════════════════════════════════════
// Manpower Calendar — รายการ requirement ทั้งหมด (เดิม Projects Overview)
// 1 แถว = 1 requirement · กดแถว → หน้ารายละเอียด (timeline ขั้นตอน + ตารางวันทำงาน)
//
// 2 มุมมอง (จำค่าที่เลือกต่อเบราว์เซอร์):
//   ☰ ตาราง     — แบบเดิม
//   ▤ Timeline — แกนเวลาแนวนอน (Gantt) 1 แถว = 1 requirement · แถบ = ช่วงทำงาน
//                ไส้แถบ = คนที่ลงงานแล้ว / ต้องการ · แถบส้ม = ใกล้เริ่ม (≤ 14 วัน) แต่คนยังไม่ครบ
//                ช่วงแกนเวลา = ช่วงวันที่ที่เลือกใน filter (ถ้าไม่ได้เลือก = ครอบทุก requirement)
//                requirement ที่ยังไม่มีวันที่ → รวมไว้ท้ายสุด
// ══════════════════════════════════════════════════════════

const TABS = [
  { key: "inProgress", label: "🟢 กำลังดำเนินการ" },
  { key: "upcoming", label: "🔵 กำลังจะเริ่ม" },
  { key: "completed", label: "⚪ จบแล้ว" },
];

const FILTER_LABEL =
  "mb-1 block text-xs font-semibold uppercase tracking-[0.4px] text-gray-500";
const FIELD_BASE =
  "box-border h-9 rounded-lg border border-gray-200 bg-white px-3 text-[13px] text-gray-900 outline-none focus:border-blue-500";
const FIELD = `${FIELD_BASE} w-full`;
const DATE_FIELD = `${FIELD_BASE} w-[150px]`;
const CHIP =
  "cursor-pointer whitespace-nowrap rounded-full border px-3 py-1 text-xs";
const TH =
  "sticky top-0 z-[1] whitespace-nowrap bg-gray-50 px-3.5 py-2 text-left text-[11px] font-semibold tracking-[0.4px] text-gray-500 shadow-[inset_0_-1px_0_#e5e7eb]";
const TD = "px-3.5 py-3 align-middle";
// ปุ่มไอคอน (แบบเดียวกับหน้า Trainings) — คอลัมน์ ACTIONS แคบ คอลัมน์ข้อมูลได้พื้นที่มากขึ้น
//   ชื่อปุ่มอยู่ใน title (hover) + aria-label
const ICON_BTN =
  "inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-none text-[13px] no-underline transition-all hover:-translate-y-px disabled:cursor-wait disabled:hover:translate-y-0";
// ปุ่มข้อความ 2 ปุ่ม — บอกชัดว่าไปหน้าไหน (คำเดียวกับปุ่มบนหัวหน้า Timeline / หน้า Projects)
//   Timeline    = หน้านี้ฉบับละเอียด (ProjectCalendarDetail) — ขั้นตอน + ตารางวันทำงานรายคน
//   Requirement = หน้า ProjectDetail — แก้ตำแหน่ง / จำนวนคน / วันที่ / คุยกับ PE / ลบ
const BTN_TIMELINE =
  "inline-block whitespace-nowrap text-center rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 no-underline hover:border-blue-600 hover:bg-blue-50 hover:text-blue-700";
const BTN_REQUIREMENT =
  "inline-block whitespace-nowrap text-center rounded-md border border-[#b6d4fe] bg-[#e7f1ff] px-2.5 py-1 text-xs font-semibold text-blue-700 no-underline hover:bg-blue-600 hover:text-white";
const ICON_DELETE = `${ICON_BTN} bg-[#fff5f5] text-[#842029] shadow-[0_1px_3px_rgba(220,53,69,0.2),0_1px_2px_rgba(0,0,0,0.06)] hover:shadow-[0_3px_6px_rgba(220,53,69,0.3),0_2px_3px_rgba(0,0,0,0.08)]`;

const toYMD = (d) => {
  if (!d) return ""; // new Date(null) = 1 ม.ค. 1970 — ไม่ใช่ "ไม่มีวันที่"
  const x = new Date(d);
  if (isNaN(x.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
const monthRange = (offset, span = 1) => {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + offset + span, 0);
  return [toYMD(from), toYMD(to)];
};
const DATE_PRESETS = [
  ["all", "ทั้งหมด", null],
  ["thisMonth", "เดือนนี้", () => monthRange(0)],
  ["nextMonth", "เดือนหน้า", () => monthRange(1)],
  ["next3", "3 เดือนข้างหน้า", () => monthRange(0, 3)],
];

const sum = (arr, f) => arr.reduce((n, x) => n + (f(x) || 0), 0);

// ── มุมมอง ──
const VIEW_KEY = "manpowerCalendarView"; // "table" | "timeline"
const readView = () => {
  try {
    return localStorage.getItem(VIEW_KEY) === "timeline" ? "timeline" : "table";
  } catch {
    return "table";
  }
};
const writeView = (v) => {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    // localStorage อาจไม่พร้อมใช้งาน — ไม่ critical
  }
};

// ── Timeline: คำนวณด้วยสตริง YYYY-MM-DD (UTC) — ไม่เพี้ยนตาม timezone ──
const DAY = 86400000;
const dayDiff = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / DAY);
const addDaysYMD = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const monthStartOf = (s) => `${s.slice(0, 7)}-01`;
const monthEndOf = (s) => {
  const [y, m] = s.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const fmtMonth = (s, withYear) =>
  new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
const SOON_DAYS = 14; // ใกล้เริ่มภายในกี่วัน ถึงเตือนเรื่องคนไม่ครบ
const TL_LEFT = "w-[150px] sm:w-[260px]"; // คอลัมน์ชื่อ (ตรึงซ้าย)
const TL_ROW_H = 44;

// ความกว้างต่อวัน — ช่วงยาว = แคบลง (เลื่อนแนวนอนได้เมื่อเกินจอ)
const dayWidthFor = (days) => (days > 240 ? 4 : days > 120 ? 7 : days > 60 ? 12 : days > 31 ? 20 : 28);

// Client = ค่าเดียวกับ Navbar (โหมด multi) — กรองทั้งตาราง / Timeline / ตัวเลขบนแท็บ · โหมด single ไม่มีช่องนี้
export default function ProjectsOverview() {
  const { backendUrl, isMultiClient, selectedClient, clientMatches } =
    useContext(AppContent);
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("inProgress");
  const [search, setSearch] = useState("");
  const [datePreset, setDatePreset] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [view, setViewState] = useState(readView);
  const setView = (v) => {
    setViewState(v);
    writeView(v);
  };

  // ตารางเลื่อนในกรอบตัวเอง (หัวคอลัมน์ตรึงไว้) — สูงเท่าพื้นที่ที่เหลือของจอ (วัดจริง)
  //   filter ขึ้นบรรทัดใหม่ตามความกว้างจอ — ใช้ค่าคงที่ไม่ได้
  const tableBoxRef = useRef(null);
  const [tableMaxH, setTableMaxH] = useState(null);

  // project ที่ผู้ใช้คนนี้ลบได้ (admin = ทุก project) — backend ตัดสิน และเช็คซ้ำตอนลบ
  const [deletableIds, setDeletableIds] = useState(() => new Set());
  const [deletingId, setDeletingId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    axios
      .get(`${backendUrl}/api/supervisor/projects-overview`, {
        withCredentials: true,
      })
      .then((res) => setData(res.data))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
    axios
      .get(`${backendUrl}/api/projects/deletable`, { withCredentials: true })
      .then((res) => setDeletableIds(new Set(res.data?.ids || [])))
      .catch(() => setDeletableIds(new Set())); // ไม่ critical — แค่ไม่แสดงปุ่มลบ
  }, [backendUrl, reloadKey]);

  // ลบทั้ง project (ทุกตำแหน่ง รายชื่อ คำขอ PE booking การลงงาน ข้อความ)
  //   ให้พิมพ์ ON Number ยืนยัน กันกดพลาด
  const deleteProject = async (p) => {
    const code = projectCode(p) || p.name;
    const need = sum(p.requests, (r) => r.quantity);
    const typed = window.prompt(
      `ลบ project "${code} ${p.name}" ทั้งหมด?\n\n` +
        `• ${p.requests.length} ตำแหน่ง (ต้องการ ${need} คน)\n` +
        `• ลงงานแล้ว ${p.employees.length} คน\n` +
        "• รายชื่อ / คำขอ PE / checklist / การลงงาน / ข้อความ ของ project นี้จะถูกลบด้วย\n\n" +
        `ลบแล้วกู้คืนไม่ได้ — พิมพ์ ${code} เพื่อยืนยัน`,
    );
    if (typed === null) return;
    if (typed.trim() !== code) {
      alert("พิมพ์ไม่ตรง — ยกเลิกการลบ");
      return;
    }
    try {
      setDeletingId(p.id);
      await axios.delete(`${backendUrl}/api/projects/${p.id}`, {
        withCredentials: true,
      });
      setReloadKey((k) => k + 1);
    } catch (err) {
      alert(err.response?.data?.message || "ลบไม่สำเร็จ");
    } finally {
      setDeletingId(null);
    }
  };

  const timelineBtn = (p) => (
    <Link
      to={`/projects-overview/${p.id}`}
      onClick={(e) => e.stopPropagation()}
      title="ดู timeline ขั้นตอน + ตารางวันทำงานรายคน"
      className={BTN_TIMELINE}
    >
      Timeline
    </Link>
  );

  const requirementBtn = (p) => (
    <Link
      to={`/projects/${p.id}`}
      onClick={(e) => e.stopPropagation()}
      title="หน้ารายละเอียด requirement — แก้ตำแหน่ง / จำนวนคน / วันที่ / คุยกับ PE"
      className={BTN_REQUIREMENT}
    >
      Requirement
    </Link>
  );

  const deleteBtn = (p) =>
    deletableIds.has(p.id) && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          deleteProject(p);
        }}
        disabled={deletingId === p.id}
        title="ลบ project นี้ (เฉพาะ admin)"
        aria-label="ลบ"
        className={ICON_DELETE}
      >
        {deletingId === p.id ? "…" : "🗑"}
      </button>
    );

  const stageKeyOf = (p) => p.currentStage?.key || "complete";

  const matchesFilters = (p) => {
    if (selectedClient && !clientMatches(p.client)) return false;
    if (stageFilter && stageKeyOf(p) !== stageFilter) return false;
    if (dateFrom || dateTo) {
      const start = toYMD(p.startDate);
      if (!start) return false;
      const end = toYMD(p.endDate) || start;
      if (dateTo && start > dateTo) return false;
      if (dateFrom && end < dateFrom) return false;
    }
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [p.name, p.client, p.location, projectCode(p)].some((v) =>
      String(v || "")
        .toLowerCase()
        .includes(q),
    );
  };

  const hasFilter = search || dateFrom || dateTo || stageFilter;

  useLayoutEffect(() => {
    const measure = () => {
      const el = tableBoxRef.current;
      if (!el || el.offsetParent === null) return; // ซ่อนอยู่ (จอเล็กกว่า xl ใช้การ์ด)
      const top = el.getBoundingClientRect().top;
      setTableMaxH(Math.max(320, Math.floor(window.innerHeight - top - 24)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [loading, hasFilter, activeTab, view, selectedClient]);

  const resetFilters = () => {
    setSearch("");
    setDatePreset("all");
    setDateFrom("");
    setDateTo("");
    setStageFilter("");
  };

  const applyPreset = (key, fn) => {
    setDatePreset(key);
    const [from, to] = fn ? fn() : ["", ""];
    setDateFrom(from);
    setDateTo(to);
  };

  const setDate = (setter) => (e) => {
    setter(e.target.value);
    setDatePreset("");
  };

  if (loading) return <div className="p-4 text-gray-500">Loading...</div>;
  if (!data)
    return <div className="p-4 text-gray-500">ไม่สามารถโหลดข้อมูลได้</div>;

  const projects = (data[activeTab] || []).filter(matchesFilters);
  const tabCount = (key) => (data[key] || []).filter(matchesFilters).length;
  const stages = data.stages || [];

  const openDetail = (p) => navigate(`/projects-overview/${p.id}`);
  const hasDeletable = projects.some((p) => deletableIds.has(p.id));

  // ── Timeline ──
  const today = toYMD(new Date());
  const dated = [];
  const undated = [];
  projects.forEach((p) => {
    const start = toYMD(p.startDate);
    if (!start) return undated.push(p);
    const end = toYMD(p.endDate) || start;
    dated.push({ p, start, end: end < start ? start : end });
  });
  dated.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  // ช่วงแกนเวลา: ตาม filter วันที่ · ไม่ได้เลือก = ครอบทุกแถว (ปัดเป็นต้นเดือน / สิ้นเดือน)
  let tlFrom = dateFrom || (dated.length ? dated.reduce((m, r) => (r.start < m ? r.start : m), dated[0].start) : today);
  let tlTo = dateTo || (dated.length ? dated.reduce((m, r) => (r.end > m ? r.end : m), dated[0].end) : today);
  if (!dateFrom) tlFrom = monthStartOf(tlFrom);
  if (!dateTo) tlTo = monthEndOf(tlTo);
  if (tlTo < tlFrom) tlTo = tlFrom;
  const tlDays = dayDiff(tlFrom, tlTo) + 1;
  const dayW = dayWidthFor(tlDays);
  const tlWidth = tlDays * dayW;
  const months = [];
  for (let m = monthStartOf(tlFrom); m <= tlTo; m = addDaysYMD(monthEndOf(m), 1)) {
    const s = m < tlFrom ? tlFrom : m;
    const e = monthEndOf(m) > tlTo ? tlTo : monthEndOf(m);
    months.push({ key: m, left: dayDiff(tlFrom, s) * dayW, width: (dayDiff(s, e) + 1) * dayW });
  }
  // เส้นแบ่งสัปดาห์ (วันจันทร์) — แสดงเมื่อช่องกว้างพอ
  const weekTicks = [];
  if (dayW >= 7) {
    const first = addDaysYMD(tlFrom, (8 - new Date(`${tlFrom}T00:00:00Z`).getUTCDay()) % 7);
    for (let d = first; d <= tlTo; d = addDaysYMD(d, 7)) weekTicks.push({ d, left: dayDiff(tlFrom, d) * dayW });
  }
  const todayLeft = today >= tlFrom && today <= tlTo ? dayDiff(tlFrom, today) * dayW + dayW / 2 : null;

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1800px]">
      {/* Header */}
      <div className="pb-3">
        <h1 className="m-0 text-lg font-bold">Manpower Calendar</h1>
        <div className="text-xs text-gray-500">
          ติดตามทุก requirement ว่าอยู่ขั้นตอนไหน · <b>Timeline</b> (หรือกดที่แถว) =
          ขั้นตอนและตารางวันทำงานรายคน · <b>Requirement</b> = แก้ตำแหน่ง / จำนวนคน / วันที่
        </div>
      </div>

      {/* ════════ Search & Filter ════════ */}
      <div className="border-y border-gray-200 py-3">
        <div>
          <label className={FILTER_LABEL}>
            ช่วงวันที่ทำงาน (Start → End ของ requirement)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {DATE_PRESETS.map(([key, label, fn]) => (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key, fn)}
                className={`${CHIP} ${
                  datePreset === key
                    ? "border-blue-600 bg-blue-600 font-bold text-white"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {label}
              </button>
            ))}
            <span className="hidden text-gray-300 sm:inline">|</span>
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={setDate(setDateFrom)}
              className={DATE_FIELD}
              title="ตั้งแต่วันที่"
            />
            <span className="text-xs text-gray-400">ถึง</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={setDate(setDateTo)}
              className={DATE_FIELD}
              title="ถึงวันที่"
            />
          </div>
        </div>

        <div
          className={`mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 ${
            isMultiClient ? "lg:grid-cols-[160px_2fr_1.2fr]" : "lg:grid-cols-[2fr_1.2fr]"
          }`}
        >
          {/* โหมด multi เท่านั้น — ค่าเดียวกับตัวเลือกบน Navbar (ปุ่ม ล้าง filter ไม่ล้างค่านี้) */}
          <ClientFilter />
          <div className="min-w-0">
            <label className={FILTER_LABEL}>ค้นหา</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ON Number / ชื่อ requirement / client / location..."
              className={FIELD}
            />
          </div>
          <div className="min-w-0">
            <label className={FILTER_LABEL}>ขั้นตอนปัจจุบัน</label>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className={FIELD}
            >
              <option value="">ทั้งหมด</option>
              {stages.map((s, i) => (
                <option key={s.key} value={s.key}>
                  {i + 1}. {s.label}
                </option>
              ))}
              <option value="complete">✓ Complete</option>
            </select>
          </div>
        </div>

        {hasFilter && (
          <div className="mt-2.5 text-right">
            <button
              type="button"
              onClick={resetFilters}
              className="cursor-pointer border-none bg-transparent p-0 text-xs font-semibold text-[#dc3545] underline hover:text-[#a71d2a]"
            >
              ✕ ล้าง filter
            </button>
          </div>
        )}
      </div>

      {/* ════════ รายการ ════════ */}
      <div className="border-b border-gray-200">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* สลับมุมมอง — segmented control แบบเดียวกับหน้า Bookings / Training Calendar */}
            <div className="mr-1 inline-flex shrink-0 gap-0.5 rounded-lg bg-gray-100 p-0.5" role="group" aria-label="มุมมอง">
              {[
                ["table", "☰ ตาราง"],
                ["timeline", "▤ Timeline"],
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
            {TABS.map((tab) => {
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`cursor-pointer whitespace-nowrap rounded-md border px-3.5 py-1.5 text-xs ${
                    active
                      ? "border-blue-600 bg-blue-600 font-bold text-white"
                      : "border-gray-200 bg-white font-medium text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {tab.label} ({tabCount(tab.key)})
                </button>
              );
            })}
          </div>
          <span className="text-xs text-gray-500">
            พบ <strong className="text-gray-900">{projects.length}</strong>{" "}
            requirement
          </span>
        </div>

        {projects.length === 0 ? (
          <div className="p-12 text-center text-[13px] text-gray-500">
            {hasFilter
              ? "ไม่พบ requirement ตามเงื่อนไขที่เลือก"
              : selectedClient
                ? `ไม่มี requirement ของ ${selectedClient.name} ในหมวดนี้`
                : "ไม่มี requirement ในหมวดนี้"}
          </div>
        ) : view === "timeline" ? (
          <div className="py-3">
            {/* คำอธิบายสี */}
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
              <span className="inline-flex items-center gap-1">
                <span className="relative inline-block h-2.5 w-5 overflow-hidden rounded-sm border border-blue-300 bg-blue-100">
                  <span className="absolute inset-y-0 left-0 w-2 bg-blue-500" />
                </span>
                ไส้แถบ = ลงงานแล้ว / ต้องการ
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-5 rounded-sm border border-emerald-300 bg-emerald-500" />
                คนครบแล้ว
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-5 rounded-sm border border-orange-300 bg-orange-100" />
                เริ่มภายใน {SOON_DAYS} วัน คนยังไม่ครบ
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-0.5 bg-[#E8590C]" />
                วันนี้
              </span>
            </div>

            {dated.length === 0 ? (
              <div className="p-8 text-center text-[13px] text-gray-500">ไม่มี requirement ที่ระบุวันที่ในหมวดนี้</div>
            ) : (
              <div
                ref={tableBoxRef}
                style={tableMaxH ? { maxHeight: tableMaxH } : undefined}
                className="max-h-[calc(100vh-360px)] overflow-auto rounded-lg border border-gray-200"
              >
                <div className="relative" style={{ width: "max-content", minWidth: "100%" }}>
                  {/* หัวแกนเวลา (ตรึงบน) */}
                  <div className="sticky top-0 z-[3] flex border-b border-gray-200 bg-gray-50">
                    <div
                      className={`${TL_LEFT} sticky left-0 z-[4] shrink-0 border-r border-gray-200 bg-gray-50 px-3 py-2 text-[11px] font-semibold tracking-[0.4px] text-gray-500`}
                    >
                      REQUIREMENT
                    </div>
                    <div className="relative h-[46px] shrink-0" style={{ width: tlWidth }}>
                      {months.map((m, i) => (
                        <div
                          key={m.key}
                          style={{ left: m.left, width: m.width }}
                          className="absolute top-0 h-[24px] overflow-hidden border-l border-gray-200 px-1.5 pt-1 text-[11px] font-semibold text-gray-700"
                        >
                          {fmtMonth(m.key, i === 0 || m.key.slice(5, 7) === "01")}
                        </div>
                      ))}
                      {weekTicks.map((w) => (
                        <div
                          key={w.d}
                          style={{ left: w.left }}
                          className="absolute top-[26px] border-l border-gray-200 pl-1 text-[10px] text-gray-400"
                        >
                          {Number(w.d.slice(8))}
                        </div>
                      ))}
                      {todayLeft !== null && (
                        <div
                          style={{ left: todayLeft }}
                          className="absolute bottom-0 -translate-x-1/2 rounded-sm bg-[#E8590C] px-1 text-[9px] font-bold leading-[14px] text-white"
                        >
                          วันนี้
                        </div>
                      )}
                    </div>
                  </div>

                  {/* แถว */}
                  {dated.map(({ p, start, end }, idx) => {
                    const need = sum(p.requests, (r) => r.quantity);
                    const have = p.employees.length;
                    const full = need > 0 && have >= need;
                    const soon = !full && dayDiff(today, start) >= 0 && dayDiff(today, start) <= SOON_DAYS;
                    const s = start < tlFrom ? tlFrom : start;
                    const e = end > tlTo ? tlTo : end;
                    const left = dayDiff(tlFrom, s) * dayW;
                    const width = Math.max(dayW, (dayDiff(s, e) + 1) * dayW);
                    const pct = need > 0 ? Math.min(100, Math.round((have / need) * 100)) : 0;
                    const tone = full
                      ? { bar: "border-emerald-400 bg-emerald-100", fill: "bg-emerald-500", text: "text-emerald-900" }
                      : soon
                        ? { bar: "border-orange-400 bg-orange-100", fill: "bg-orange-500", text: "text-orange-900" }
                        : { bar: "border-blue-300 bg-blue-100", fill: "bg-blue-500", text: "text-blue-900" };
                    return (
                      <div
                        key={p.id}
                        onClick={() => openDetail(p)}
                        className={`group flex cursor-pointer ${idx < dated.length - 1 ? "border-b border-gray-100" : ""}`}
                        style={{ height: TL_ROW_H }}
                      >
                        <div
                          className={`${TL_LEFT} sticky left-0 z-[2] flex shrink-0 flex-col justify-center border-r border-gray-200 bg-white px-3 group-hover:bg-gray-50`}
                        >
                          <div className="flex min-w-0 items-baseline gap-1.5">
                            <span className="shrink-0 font-mono text-[11px] font-bold text-blue-600">
                              {projectCode(p) || "—"}
                            </span>
                            <span className="truncate text-xs font-semibold text-gray-900">{p.name}</span>
                          </div>
                          <div className="truncate text-[11px] text-gray-500">
                            ● {p.currentStage?.label || "Complete"}
                            {isMultiClient && !selectedClient && p.client ? ` · ${p.client}` : ""}
                            {p.location ? ` · ${p.location}` : ""}
                          </div>
                        </div>
                        <div className="relative shrink-0 group-hover:bg-gray-50/60" style={{ width: tlWidth }}>
                          {weekTicks.map((w) => (
                            <div key={w.d} style={{ left: w.left }} className="absolute inset-y-0 border-l border-gray-100" />
                          ))}
                          {todayLeft !== null && (
                            <div style={{ left: todayLeft }} className="absolute inset-y-0 z-[1] w-0.5 -translate-x-1/2 bg-[#E8590C]/70" />
                          )}
                          <div
                            title={`${projectCode(p) || ""} ${p.name}\n${fmtShort(p.startDate)} – ${fmtShort(p.endDate)} · ลงงาน ${have}/${need} คน · ${p.currentStage?.label || "Complete"}`}
                            style={{ left, width }}
                            className={`absolute top-[10px] h-[24px] overflow-hidden border ${tone.bar} ${
                              start < tlFrom ? "rounded-l-none border-l-0" : "rounded-l-md"
                            } ${end > tlTo ? "rounded-r-none border-r-0" : "rounded-r-md"}`}
                          >
                            <div className={`h-full ${tone.fill} opacity-80`} style={{ width: `${pct}%` }} />
                          </div>
                          {/* ป้ายข้างแถบ — อยู่นอก overflow ของแถบ จึงอ่านได้แม้แถบสั้น */}
                          <div
                            style={{ left: left + 6 }}
                            className={`pointer-events-none absolute top-[10px] z-[1] flex h-[24px] items-center whitespace-nowrap text-[11px] font-semibold ${tone.text}`}
                          >
                            <span className="rounded bg-white/75 px-1">
                              {have}/{need} คน · {fmtShort(p.startDate)} – {fmtShort(p.endDate)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ยังไม่มีวันที่ — วางบนแกนเวลาไม่ได้ */}
            {undated.length > 0 && (
              <div className="mt-3 rounded-lg border border-dashed border-gray-300 px-3 py-2.5">
                <div className="mb-1.5 text-[11px] font-semibold text-gray-500">
                  ยังไม่ระบุวันที่ ({undated.length}) — ใส่วันที่ที่หน้า Requirement แล้วจะขึ้นใน Timeline
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {undated.map((p) => (
                    <Link
                      key={p.id}
                      to={`/projects/${p.id}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-700 no-underline hover:border-blue-400 hover:text-blue-700"
                    >
                      <span className="font-mono text-[11px] font-bold text-blue-600">{projectCode(p) || "—"}</span>
                      {p.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* ── มือถือ / แท็บเล็ต: การ์ด ── */}
            <div className="divide-y divide-gray-100 xl:hidden">
              {projects.map((p) => {
                const need = sum(p.requests, (r) => r.quantity);
                return (
                  <div
                    key={p.id}
                    onClick={() => openDetail(p)}
                    className="cursor-pointer py-3 text-[13px] hover:bg-gray-50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {projectCode(p) && (
                          <div className="font-mono text-[11px] font-bold text-blue-600">
                            {projectCode(p)}
                          </div>
                        )}
                        <div className="break-words font-semibold">{p.name}</div>
                      </div>
                      <StageBadge stage={p.currentStage} />
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {p.client || "—"}
                      {p.location ? ` · ${p.location}` : ""} ·{" "}
                      {fmtShort(p.startDate)} – {fmtShort(p.endDate)} · {need} คน
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <StageDots stages={p.stages} />
                      <span className="flex shrink-0 items-center gap-1.5">
                        {timelineBtn(p)}
                        {requirementBtn(p)}
                        {deleteBtn(p)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── xl+: ตาราง ── */}
            <div
              ref={tableBoxRef}
              style={tableMaxH ? { maxHeight: tableMaxH } : undefined}
              className="hidden max-h-[calc(100vh-360px)] overflow-auto xl:block"
            >
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className={TH}>ON NUMBER</th>
                    <th className={TH}>REQUIREMENT</th>
                    <th className={TH}>CLIENT · LOCATION</th>
                    <th className={TH}>ช่วงทำงาน</th>
                    <th className={`${TH} text-center`}>ตำแหน่ง</th>
                    <th className={`${TH} text-center`}>คน (ลงงาน/ต้องการ)</th>
                    <th className={TH}>ขั้นตอนปัจจุบัน</th>
                    <th className={TH}>ความคืบหน้า</th>
                    {/* ปุ่ม Timeline / Requirement ซ้อนแนวตั้ง (แบบหน้า Manpower Requirements) — คอลัมน์แคบ
                        คอลัมน์ข้อมูลได้พื้นที่คืน · +🗑 ด้านขวา ถ้ามี project ที่ลบได้อย่างน้อย 1 แถว */}
                    <th className={`${TH} text-left ${hasDeletable ? "w-[152px]" : "w-[124px]"}`}>
                      ACTIONS
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p, idx) => {
                    const need = sum(p.requests, (r) => r.quantity);
                    return (
                      <tr
                        key={p.id}
                        onClick={() => openDetail(p)}
                        className={`cursor-pointer hover:bg-gray-50 ${
                          idx < projects.length - 1 ? "border-b border-gray-100" : ""
                        }`}
                      >
                        <td className={`${TD} whitespace-nowrap font-mono text-xs font-bold text-blue-600`}>
                          {projectCode(p) || "—"}
                        </td>
                        <td className={TD}>
                          {/* ลิงก์จริง — คลิกขวาเปิดแท็บใหม่ได้ */}
                          <Link
                            to={`/projects-overview/${p.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-semibold text-gray-900 no-underline hover:text-blue-600 hover:underline"
                          >
                            {p.name}
                          </Link>
                        </td>
                        <td className={`${TD} text-gray-600`}>
                          {p.client || "—"}
                          {p.location ? (
                            <div className="text-[11px] text-gray-400">{p.location}</div>
                          ) : null}
                        </td>
                        <td className={`${TD} whitespace-nowrap text-gray-600`}>
                          {fmtShort(p.startDate)} – {fmtShort(p.endDate)}
                        </td>
                        <td className={`${TD} text-center`}>{p.requests.length}</td>
                        <td className={`${TD} whitespace-nowrap text-center`}>
                          <span className={p.employees.length >= need && need > 0 ? "font-semibold text-emerald-700" : ""}>
                            {p.employees.length}
                          </span>
                          <span className="text-gray-400"> / {need}</span>
                        </td>
                        <td className={TD}>
                          <StageBadge stage={p.currentStage} />
                        </td>
                        <td className={TD}>
                          <StageDots stages={p.stages} />
                        </td>
                        {/* ชิดซ้าย — Timeline / Requirement ตรงกันทุกแถว ไม่ว่าแถวนั้นจะมีปุ่มลบหรือไม่ */}
                        <td className={`${TD} whitespace-nowrap text-left`}>
                          <div className="inline-flex items-center gap-1.5">
                            <div className="flex w-[96px] flex-col items-stretch gap-1">
                              {timelineBtn(p)}
                              {requirementBtn(p)}
                            </div>
                            {/* 🗑 ลบทั้ง project = เฉพาะ admin */}
                            {deleteBtn(p)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
