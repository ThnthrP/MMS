import {
  useState,
  useEffect,
  useLayoutEffect,
  useContext,
  useMemo,
  useRef,
} from "react";
import { useNavigate, Link } from "react-router-dom";
import axios from "axios";
import { AppContent } from "../../context/AppContext";
import {
  fmtShort,
  projectCode,
  StageBadge,
  StageDots,
} from "./calendarShared";

// ══════════════════════════════════════════════════════════
// Manpower Calendar — รายการ requirement ทั้งหมด (เดิม Projects Overview)
// 1 แถว = 1 requirement · กดแถว → หน้ารายละเอียด (timeline ขั้นตอน + ตารางวันทำงาน)
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

export default function ProjectsOverview() {
  const { backendUrl } = useContext(AppContent);
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("inProgress");
  const [search, setSearch] = useState("");
  const [datePreset, setDatePreset] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");

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
    if (clientFilter && p.client !== clientFilter) return false;
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

  const clientOptions = useMemo(() => {
    if (!data) return [];
    const all = TABS.flatMap((t) => data[t.key] || []);
    return [...new Set(all.map((p) => p.client).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b),
    );
  }, [data]);

  const hasFilter =
    search || dateFrom || dateTo || clientFilter || stageFilter;

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
  }, [loading, hasFilter, activeTab]);

  const resetFilters = () => {
    setSearch("");
    setDatePreset("all");
    setDateFrom("");
    setDateTo("");
    setClientFilter("");
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

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1.2fr]">
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
            <label className={FILTER_LABEL}>Client</label>
            <select
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              className={FIELD}
            >
              <option value="">ทั้งหมด</option>
              {clientOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
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
          <div className="flex flex-wrap gap-2">
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
              : "ไม่มี requirement ในหมวดนี้"}
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
