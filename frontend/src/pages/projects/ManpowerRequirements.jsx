import { useState, useEffect, useContext, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import Select from "react-select";
import { AppContent } from "../../context/AppContext";
import NewRequirementModal from "./NewRequirementModal";

// ══════════════════════════════════════════════════════════
// Manpower Requirements (/requirements) — แบบโปรแกรมตัวอย่าง
// 1 แถว = 1 ตำแหน่งที่ขอ (ManpowerRequest) ของ 1 requirement
//   • ข้อมูลชุดเดียวกับหน้า ProjectDetail (/projects/:id) → เพิ่ม/แก้ที่ไหนก็เห็นทั้งสองหน้า
//   • + New requirement = การ์ดเดียวกับหน้า Projects (NewRequirementModal.jsx)
//   • คลิกแถว → หน้ารายละเอียด requirement (แก้จำนวน / เพิ่มตำแหน่ง / คุยกับ PE)
// Requested by = คนที่เพิ่มตำแหน่งนี้ · Filled by = คนที่จัดรายชื่อเข้าตำแหน่งนี้ล่าสุด
// ══════════════════════════════════════════════════════════

const PAGE_SIZE = 25;
const DAY_MS = 86400000;

const SCOPES = [
  ["active", "Active (ยังไม่จบ)"],
  ["ended", "จบแล้ว"],
  ["all", "ทั้งหมด"],
];
const FILLS = [
  ["all", "ทุกสถานะ"],
  ["open", "ยังขาดคน"],
  ["filled", "Filled"],
];

const TH =
  "sticky top-0 z-[1] whitespace-nowrap bg-gray-50 px-3 py-2 text-left text-[11px] font-semibold tracking-[0.4px] text-gray-500 shadow-[inset_0_-1px_0_#e5e7eb]";
const TD = "px-3 py-2.5 align-top text-[13px]";
const FIELD =
  "box-border h-9 rounded-lg border border-gray-200 bg-white px-3 text-[13px] outline-none focus:border-blue-500";
const LABEL =
  "mb-1 block text-xs font-semibold uppercase tracking-[0.4px] text-gray-500";
// react-select — สไตล์เดียวกับหน้า Assign Names (Allocation)
const SELECT_PORTAL = {
  menuPortalTarget: typeof document !== "undefined" ? document.body : null,
  menuPosition: "fixed",
};
const selectStyles = {
  control: (b) => ({
    ...b,
    borderColor: "#e5e7eb",
    borderRadius: "8px",
    minHeight: "36px",
    height: "36px",
    fontSize: "13px",
    boxShadow: "none",
    "&:hover": { borderColor: "#86b7fe" },
  }),
  option: (b) => ({ ...b, fontSize: "13px" }),
  placeholder: (b) => ({ ...b, fontSize: "13px", color: "#6c757d" }),
  menuPortal: (b) => ({ ...b, zIndex: 9999 }),
  valueContainer: (b) => ({ ...b, padding: "0 8px", height: "34px" }),
  input: (b) => ({ ...b, margin: 0, padding: 0 }),
  indicatorsContainer: (b) => ({ ...b, height: "34px" }),
};
const projectSelectStyles = {
  ...selectStyles,
  // ชื่อโปรเจกต์ยาว → แสดงเต็ม ไม่ตัด "..."
  singleValue: (b) => ({ ...b, whiteSpace: "normal", overflow: "visible", lineHeight: "1.3" }),
  // ถ้าจอแคบจนชื่อยาวเกิน → ขยายความสูงเป็น 2 บรรทัดแทนการตัด
  control: (b, st) => ({ ...selectStyles.control(b, st), height: "auto" }),
  valueContainer: (b) => ({ ...b, padding: "1px 8px" }),
  indicatorsContainer: (b) => ({ ...b, alignSelf: "stretch" }),
  dropdownIndicator: (b) => ({ ...b, padding: "6px 8px" }),
  clearIndicator: (b) => ({ ...b, padding: "6px 8px" }),
  menu: (b) => ({ ...b, minWidth: "min(560px, calc(100vw - 40px))" }),
  menuList: (b) => ({ ...b, maxHeight: "360px" }),
};
const PAGE_BTN =
  "min-w-[30px] cursor-pointer rounded-md border px-2.5 py-[5px] text-xs disabled:cursor-not-allowed disabled:opacity-50";

const dayStart = (d) => {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate());
};
const fmtDay = (d) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fmtDayY = (d) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const periodText = (s, e) => {
  if (!s && !e) return "—";
  if (!e) return `${fmtDayY(s)} –`;
  if (!s) return `– ${fmtDayY(e)}`;
  const sameYear = new Date(s).getFullYear() === new Date(e).getFullYear();
  return `${sameYear ? fmtDay(s) : fmtDayY(s)} – ${fmtDayY(e)}`;
};
// นับรวมวันแรกและวันสุดท้าย (21 Sep – 20 Oct = 30 วัน)
const daysOf = (s, e) =>
  s && e ? Math.round((dayStart(e) - dayStart(s)) / DAY_MS) + 1 : null;
const agoText = (d) => {
  if (!d) return "";
  const days = Math.floor((Date.now() - new Date(d).getTime()) / DAY_MS);
  if (days <= 0) return "วันนี้";
  if (days < 30) return `${days} d ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return `${Math.floor(days / 365)} y ago`;
};
const isEnded = (r) => r.endDate && dayStart(r.endDate) < dayStart(new Date());

const fillState = (r) =>
  r.assigned >= r.quantity ? "filled" : r.assigned > 0 ? "partial" : "open";
const FILL_STYLE = {
  filled: ["✓ Filled", "bg-[#d1e7dd] text-[#0f5132]", "bg-[#198754]"],
  partial: ["Partial", "bg-[#fff3cd] text-[#664d03]", "bg-[#f59e0b]"],
  open: ["Open", "bg-[#f8d7da] text-[#842029]", "bg-[#dc3545]"],
};

const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const downloadCsv = (filename, rows) => {
  const blob = new Blob(["﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

export default function ManpowerRequirements() {
  const { backendUrl } = useContext(AppContent);
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("active");
  const [fill, setFill] = useState("all");
  const [client, setClient] = useState("");
  const [projectId, setProjectId] = useState("");
  const [position, setPosition] = useState("");
  const [page, setPage] = useState(1);
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    axios
      .get(`${backendUrl}/api/supervisor/requirements`, { withCredentials: true })
      .then((res) => {
        setRows(res.data || []);
        setError("");
      })
      .catch((err) => {
        console.error(err);
        setError(err.response?.data?.message || "โหลดข้อมูลไม่สำเร็จ");
      })
      .finally(() => setLoading(false));
  }, [backendUrl, reload]);

  const clients = useMemo(
    () => [...new Set(rows.map((r) => r.client).filter(Boolean))].sort(),
    [rows],
  );
  // ตัวเลือกโปรเจกต์ แบบเดียวกับหน้า Assign Names: [ON] ชื่องาน — ลูกค้า · สถานที่
  // (พิมพ์ ON Number / ชื่องาน / ลูกค้า เพื่อค้นได้ในช่องเดียว)
  const projectOptions = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => {
      if (!r.projectId || m.has(r.projectId)) return;
      const start = r.projectStartDate || r.startDate;
      const tail = [r.client, r.location, start && `Start ${fmtDayY(start)}`]
        .filter(Boolean)
        .join(" · ");
      m.set(r.projectId, {
        value: r.projectId,
        label: `${r.projectCode ? `[${r.projectCode}] ` : ""}${r.jobTitle || r.projectName || ""}${tail ? ` — ${tail}` : ""}`,
      });
    });
    // ON เดียวกันมีได้หลาย requirement — ถ้าชื่อยังซ้ำ ต่อท้ายรหัสสั้นให้แยกออก
    const seen = {};
    [...m.values()].forEach((o) => (seen[o.label] = (seen[o.label] || 0) + 1));
    [...m.values()].forEach((o) => {
      if (seen[o.label] > 1) o.label += ` · #${o.value.slice(-6)}`;
    });
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);
  // ตำแหน่ง (นับจำนวนแถว) — จำกัดตามโปรเจกต์ที่เลือกอยู่
  const positionOptions = useMemo(() => {
    const m = new Map();
    rows
      .filter((r) => !projectId || r.projectId === projectId)
      .forEach((r) => r.position && m.set(r.position, (m.get(r.position) || 0) + 1));
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([p, n]) => ({ value: p, label: `${p} (${n})` }));
  }, [rows, projectId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (scope === "active" && isEnded(r)) return false;
        if (scope === "ended" && !isEnded(r)) return false;
        if (fill === "open" && r.assigned >= r.quantity) return false;
        if (fill === "filled" && r.assigned < r.quantity) return false;
        if (client && r.client !== client) return false;
        if (projectId && r.projectId !== projectId) return false;
        if (position && r.position !== position) return false;
        if (!q) return true;
        // ช่องค้นหาอิสระ (แบบโปรแกรมตัวอย่าง): ตำแหน่ง / โปรเจกต์ / สถานที่ / ชื่อพนักงาน / ผู้ขอ
        return [
          r.position,
          r.projectCode,
          r.jobTitle,
          r.projectName,
          r.location,
          r.requestedBy,
          r.filledBy?.name,
          ...(r.workers || []).flatMap((w) => [w.empId, w.name, w.nameTH]),
        ]
          .some((v) => String(v || "").toLowerCase().includes(q));
      })
      .sort(
        (a, b) =>
          new Date(b.startDate || 0) - new Date(a.startDate || 0) ||
          String(a.projectCode).localeCompare(String(b.projectCode)) ||
          String(a.position).localeCompare(String(b.position)),
      );
  }, [rows, search, scope, fill, client, projectId, position]);

  // ตำแหน่งที่ถูกซ่อนเพราะ "Active" (วันจบงานผ่านไปแล้ว) — บอกให้รู้ จะได้ไม่งงว่าหายไปไหน
  const hiddenEnded = useMemo(
    () => (scope === "active" ? rows.filter(isEnded).length : 0),
    [rows, scope],
  );

  const totals = useMemo(() => {
    const required = filtered.reduce((n, r) => n + r.quantity, 0);
    const assigned = filtered.reduce((n, r) => n + Math.min(r.assigned, r.quantity), 0);
    return { required, assigned, missing: required - assigned };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const onFilter = (setter) => (e) => {
    setter(e.target.value);
    setPage(1);
  };
  const searchQ = search.trim().toLowerCase();
  const hasFilter =
    search || fill !== "all" || client || projectId || position || scope !== "active";
  const resetFilters = () => {
    setSearch("");
    setScope("active");
    setFill("all");
    setClient("");
    setProjectId("");
    setPosition("");
    setPage(1);
  };

  const exportCsv = () =>
    downloadCsv(`manpower-requirements-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["Position", "ON Number", "Project / Job", "Client", "Qty", "Working start", "Working end", "Days", "Location", "Assigned", "Approved", "Status", "Requested by", "Requested at", "Filled by", "Filled at"],
      ...filtered.map((r) => [
        r.position,
        r.projectCode || "",
        r.jobTitle || r.projectName || "",
        r.client || "",
        r.quantity,
        r.startDate ? fmtDayY(r.startDate) : "",
        r.endDate ? fmtDayY(r.endDate) : "",
        daysOf(r.startDate, r.endDate) ?? "",
        r.location || "",
        r.assigned,
        r.approved,
        FILL_STYLE[fillState(r)][0].replace("✓ ", ""),
        r.requestedBy || "",
        r.requestedAt ? fmtDayY(r.requestedAt) : "",
        r.filledBy?.name || "",
        r.filledBy?.at ? fmtDayY(r.filledBy.at) : "",
      ]),
    ]);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1800px]">
      {/* ════════ หัว ════════ */}
      <div className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="m-0 text-lg font-bold">Manpower Requirements</h1>
          <div className="text-xs text-gray-500">
            {filtered.length} ตำแหน่ง · ต้องการ <b className="text-gray-800">{totals.required}</b> คน ·
            จัดรายชื่อแล้ว <b className="text-gray-800">{totals.assigned}</b> คน ·{" "}
            <b className={totals.missing > 0 ? "text-[#dc3545]" : "text-[#198754]"}>
              ขาด {totals.missing} คน
            </b>
            {hiddenEnded > 0 && (
              <button
                type="button"
                onClick={() => {
                  setScope("all");
                  setPage(1);
                }}
                className="ml-2 cursor-pointer border-none bg-transparent p-0 text-xs text-blue-600 underline"
              >
                + แสดงอีก {hiddenEnded} ตำแหน่งที่วันจบงานผ่านไปแล้ว
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={exportCsv}
            className="cursor-pointer rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            ⬇ Export CSV
          </button>
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="cursor-pointer rounded-md border-none bg-[#2B2F78] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#22265f]"
          >
            + New requirement
          </button>
        </div>
      </div>

      {/* ════════ ตัวกรอง — 2 แถว ════════
          แถว 1: Project (ยาว เห็นชื่อเต็ม) + ค้นหาอิสระ  · แถว 2: ตัวกรองแบบเลือก */}
      <div className="space-y-3 border-y border-gray-200 py-3">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-end">
        <div className="min-w-0">
          <label className={LABEL}>Project</label>
          <Select
            {...SELECT_PORTAL}
            options={projectOptions}
            styles={projectSelectStyles}
            value={projectOptions.find((o) => o.value === projectId) || null}
            onChange={(o) => {
              setProjectId(o ? o.value : "");
              setPosition("");
              setPage(1);
            }}
            placeholder="ทุกโปรเจกต์ — พิมพ์ ON Number / ชื่องาน..."
            isClearable
            noOptionsMessage={() => "ไม่พบโปรเจกต์"}
          />
        </div>
        <div className="min-w-0">
          <label className={`${LABEL} flex items-center justify-between`}>
            <span>
              Search{" "}
              <span className="normal-case tracking-normal text-gray-400">
                (ชื่อพนักงาน / ID / ตำแหน่ง / โปรเจกต์ / สถานที่ / ผู้ขอ)
              </span>
            </span>
            {hasFilter && (
              <button
                type="button"
                onClick={resetFilters}
                className="cursor-pointer border-none bg-transparent p-0 text-[11px] font-semibold normal-case tracking-normal text-[#dc3545] underline"
              >
                ✕ ล้างทั้งหมด
              </button>
            )}
          </label>
          <input
            type="text"
            value={search}
            onChange={onFilter(setSearch)}
            placeholder="🔍 พิมพ์ชื่อพนักงาน (ไทย/อังกฤษ), Employee ID, ตำแหน่ง, สถานที่..."
            className={`${FIELD} w-full`}
          />
        </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0">
          <label className={LABEL}>Position</label>
          <Select
            {...SELECT_PORTAL}
            options={positionOptions}
            styles={selectStyles}
            value={positionOptions.find((o) => o.value === position) || null}
            onChange={(o) => {
              setPosition(o ? o.value : "");
              setPage(1);
            }}
            placeholder="ทุกตำแหน่ง"
            isClearable
            noOptionsMessage={() => "ไม่พบตำแหน่ง"}
          />
        </div>
        <div className="min-w-0">
          <label className={LABEL}>Client</label>
          <select value={client} onChange={onFilter(setClient)} className={`${FIELD} w-full`}>
            <option value="">ทุกลูกค้า</option>
            {clients.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <label className={LABEL}>Period</label>
          <select value={scope} onChange={onFilter(setScope)} className={`${FIELD} w-full`}>
            {SCOPES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <label className={LABEL}>Status</label>
          <select value={fill} onChange={onFilter(setFill)} className={`${FIELD} w-full`}>
            {FILLS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        </div>
      </div>

      {/* ════════ ตาราง ════════ */}
      <div className="max-h-[calc(100vh-350px)] min-h-[200px] overflow-auto border-b border-gray-200">
        <table className="w-full min-w-[1100px] border-collapse">
          <thead>
            <tr>
              <th className={`${TH} w-[30%]`}>POSITION / PROJECT</th>
              <th className={`${TH} text-center`}>QTY</th>
              <th className={TH}>WORKING PERIOD</th>
              <th className={TH}>LOCATION</th>
              <th className={`${TH} w-[130px]`}>FILLED</th>
              <th className={TH}>STATUS</th>
              <th className={TH}>REQUESTED BY</th>
              <th className={TH}>FILLED BY</th>
              <th className={`${TH} w-[100px] text-center`}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="p-10 text-center text-[13px] text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={9} className="p-10 text-center text-[13px] text-red-600">
                  {error}
                </td>
              </tr>
            ) : paged.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-10 text-center text-[13px] text-gray-500">
                  {hasFilter ? "ไม่พบตำแหน่งตามเงื่อนไขที่เลือก" : "ยังไม่มี requirement — กด + New requirement"}
                </td>
              </tr>
            ) : (
              paged.map((r) => {
                const st = fillState(r);
                const [stLabel, stCls, barCls] = FILL_STYLE[st];
                const pct = r.quantity ? Math.min(100, (r.assigned / r.quantity) * 100) : 0;
                const days = daysOf(r.startDate, r.endDate);
                const ended = isEnded(r);
                return (
                  <tr
                    key={r.id}
                    onClick={() => navigate(`/projects/${r.projectId}`)}
                    className={`group cursor-pointer border-b border-gray-100 hover:bg-gray-50 ${ended ? "opacity-70" : ""}`}
                  >
                    <td className={TD}>
                      <div className="font-semibold text-gray-900 group-hover:text-blue-700 group-hover:underline">
                        {r.position || "—"}
                      </div>
                      <div className="truncate text-[11px] text-gray-600" title={`${r.projectCode || ""} – ${r.jobTitle || ""}`}>
                        {r.projectCode && <span className="font-mono text-blue-700">{r.projectCode}</span>}
                        {r.projectCode && " – "}
                        {r.jobTitle || r.projectName}
                      </div>
                      <div className="text-[11px] text-gray-400">{r.client || "—"}</div>
                    </td>
                    <td className={`${TD} text-center font-semibold`}>{r.quantity}</td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <div>{periodText(r.startDate, r.endDate)}</div>
                      <div className="text-[11px] text-gray-500">
                        {days != null ? `${days} days` : ""}
                        {ended && <span className="ml-1 text-gray-400">· จบแล้ว</span>}
                      </div>
                    </td>
                    <td className={TD}>
                      <div>{r.location || "—"}</div>
                      <div className="text-[11px] text-gray-400">{r.isOffshore ? "Offshore" : "Onshore"}</div>
                    </td>
                    <td
                      className={TD}
                      title={(r.workers || []).map((w) => `${w.empId || ""} ${w.name}${w.nameTH ? ` (${w.nameTH})` : ""}`.trim()).join("\n") || undefined}
                    >
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                        <div className={`h-full ${barCls}`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-1 text-[11px] text-gray-600">
                        <b>{r.assigned}</b>/{r.quantity}
                        {r.approved > 0 && r.approved < r.assigned && (
                          <span className="text-gray-400"> · approve {r.approved}</span>
                        )}
                        {r.booked > 0 && (
                          <span className="text-gray-400" title="จองงานแล้ว (คอลัมน์ ASSIGNED ในหน้ารายละเอียด)">
                            {" "}· booked {r.booked}
                          </span>
                        )}
                        {r.pendingPe > 0 && <span className="text-[#b08900]"> · รอ PE {r.pendingPe}</span>}
                      </div>
                      {/* ค้นหาด้วยชื่อพนักงาน → โชว์ว่าเจอใครในแถวนี้ */}
                      {searchQ &&
                        (r.workers || [])
                          .filter((w) =>
                            [w.empId, w.name, w.nameTH].some((v) => String(v || "").toLowerCase().includes(searchQ)),
                          )
                          .map((w) => (
                            <div key={w.empId || w.name} className="mt-0.5 truncate text-[11px] font-semibold text-blue-700">
                              👤 {w.name}
                              {w.nameTH && <span className="font-normal text-gray-500"> · {w.nameTH}</span>}
                            </div>
                          ))}
                    </td>
                    <td className={TD}>
                      <span className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold ${stCls}`}>
                        {stLabel}
                      </span>
                    </td>
                    <td className={TD}>
                      <div className="text-xs">{r.requestedBy || "—"}</div>
                      <div className="text-[11px] text-gray-400">{agoText(r.requestedAt)}</div>
                    </td>
                    <td className={TD}>
                      {r.filledBy ? (
                        <>
                          <div className="text-xs">{r.filledBy.name || "—"}</div>
                          <div className="text-[11px] text-gray-400">{agoText(r.filledBy.at)}</div>
                        </>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      {/* View = หน้ารายละเอียด requirement (ProjectDetail) · Assign = จัดรายชื่อ */}
                      <div className="flex flex-col items-stretch gap-1">
                        <Link
                          to={`/projects/${r.projectId}`}
                          onClick={(e) => e.stopPropagation()}
                          title="ดูรายละเอียด requirement — แก้จำนวน / เพิ่มตำแหน่ง / คุยกับ PE"
                          className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-center text-xs font-semibold text-gray-700 no-underline hover:border-gray-400 hover:bg-gray-50"
                        >
                          View
                        </Link>
                        <Link
                          to={`/allocation?projectId=${r.projectId}`}
                          onClick={(e) => e.stopPropagation()}
                          title="จัดรายชื่อที่หน้า Assign Names"
                          className="rounded-md border border-[#a3cfbb] bg-[#e8f5ee] px-2.5 py-1 text-center text-xs font-semibold text-[#146c43] no-underline hover:bg-[#198754] hover:text-white"
                        >
                          Assign →
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ════════ หน้า ════════ */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs text-gray-500">
          <span>
            หน้า {currentPage} / {totalPages} — {filtered.length} ตำแหน่ง
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              className={`${PAGE_BTN} border-gray-200 bg-white text-gray-700`}
            >
              ← ก่อนหน้า
            </button>
            <span className="px-2 py-1">{currentPage}</span>
            <button
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
              className={`${PAGE_BTN} border-gray-200 bg-white text-gray-700`}
            >
              ถัดไป →
            </button>
          </div>
        </div>
      )}

      {newOpen && (
        <NewRequirementModal
          onClose={() => setNewOpen(false)}
          onCreated={() => {
            setNewOpen(false);
            setReload((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
