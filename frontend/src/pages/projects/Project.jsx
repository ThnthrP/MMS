import { useState, useEffect, useLayoutEffect, useContext, useRef, useMemo } from "react";
import axios from "axios";
import { AppContent } from "../../context/AppContext";
import { Link, useNavigate } from "react-router-dom";
import NewRequirementModal from "./NewRequirementModal";
import { StageBadge } from "./calendarShared";
import ClientFilter, { useProjectClientMap } from "../../components/ClientFilter";
import { textMentionsClient } from "../../utils/clientMode";

// ══════════════════════════════════════════════════════════
// Projects (ON Number) — Master Project Register
// อยู่ที่เมนู Projects & Positions › Projects (ข้อมูลตั้งต้นจากระบบบัญชี / import)
// การเปิด requirement ใหม่ใช้การ์ดเดียวกับหน้า Manpower Requirements (NewRequirementModal.jsx)
//
// ตัวกรอง: โหลด ON ของปีที่เลือกทั้งหมด (ปีละไม่กี่ร้อยรายการ) แล้วกรอง / แบ่งหน้าในเบราว์เซอร์
//   ค้นหา (ON / ชื่องาน / Engineer) · Customer · Company · Team · สถานะ · Client (โหมด multi)
//   ถ้าวันหน้า ON ต่อปีเยอะมาก (หลายพัน) ค่อยย้ายการกรองไปทำที่ backend
// ══════════════════════════════════════════════════════════

const PAGE_SIZE = 15;
const FETCH_PAGE_SIZE = 500; // ดึงทีละก้อนจนครบทั้งปี
const NONE = "__none__"; // ตัวเลือก "— ไม่ระบุ —" (ช่องว่าง)

const STATUS_OPTIONS = [
  ["", "ทั้งหมด"],
  ["linked", "✓ เปิดใช้งานแล้ว"],
  ["unlinked", "ยังไม่เปิดใช้งาน"],
];

const FILTER_LABEL =
  "mb-1 block text-xs font-semibold uppercase tracking-[0.4px] text-gray-500";
const FIELD =
  "box-border h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-[13px] text-gray-900 outline-none focus:border-blue-500";

const squash = (v) => String(v ?? "").toLowerCase().replace(/\s+/g, "");
const uniqSorted = (arr) =>
  [...new Set(arr.map((v) => (v ?? "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
const matchOption = (value, filter) =>
  !filter || (filter === NONE ? !(value ?? "").trim() : (value ?? "").trim() === filter);

const DETAIL_FIELDS = [
  ["owner", "เจ้าของงาน"],
  ["year", "Year"],
  ["projectCode", "Project On"],
  ["jobTitle", "Project / Job"],
  ["ccNo", "CC. No."],
  ["engineer", "Project Engineer"],
  ["customerName", "Customer Name"],
  ["wrPoSr", "WR / PO / SR"],
  ["woAfe", "WO / AFE"],
  ["wa", "WA"],
  ["exptEq", "Expt EQ"],
  ["termOfPaymentDays", "Term of Payment"],
  ["company", "Company"],
  ["team", "Team"],
  ["paymentTerms", "Payment Terms"],
  ["totalValue", "Total Value"],
];

// โหมด multi เพิ่มคอลัมน์ CLIENT (Company ในข้อมูลจริงไม่ใช่ชื่อลูกค้าเสมอไป)
const tableHeaders = (multi) => [
  ["ON NUMBER", "w-[150px]"],
  ...(multi ? [["CLIENT", ""]] : []),
  ["PROJECT / JOB", ""],
  ["CUSTOMER", ""],
  ["COMPANY", ""],
  ["TEAM", ""],
  ["STATUS", ""],
  ["ACTIONS", "w-[150px]"],
];

// ── Tailwind class ที่ใช้ซ้ำ (แทน inputStyle / labelStyle / btnBase เดิม) ──
const INPUT =
  "w-full box-border rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-900 outline-none focus:border-blue-400";
const BTN =
  "inline-flex items-center justify-center whitespace-nowrap rounded-md border-none text-xs font-semibold transition-all cursor-pointer disabled:cursor-not-allowed";
const LIFT_WHITE =
  "bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15),0_1px_2px_rgba(0,0,0,0.08)] hover:shadow-[0_3px_6px_rgba(0,0,0,0.18),0_2px_3px_rgba(0,0,0,0.1)] hover:-translate-y-px";
// ปุ่มเดียวกับหน้า Manpower Calendar — Requirement = ProjectDetail · Timeline = ProjectCalendarDetail
const BTN_TIMELINE =
  "inline-block whitespace-nowrap rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 no-underline hover:border-blue-600 hover:bg-blue-50 hover:text-blue-700";
const BTN_REQUIREMENT =
  "inline-block whitespace-nowrap rounded-md border border-[#b6d4fe] bg-[#e7f1ff] px-2.5 py-1 text-xs font-semibold text-blue-700 no-underline hover:bg-blue-600 hover:text-white";
// สถานะตามแท็บของหน้า Manpower Calendar
const PERIOD_TAG = {
  inProgress: ["🟢 กำลังดำเนินการ", "bg-emerald-50 text-emerald-800"],
  upcoming: ["🔵 กำลังจะเริ่ม", "bg-blue-50 text-blue-800"],
  completed: ["⚪ จบแล้ว", "bg-gray-100 text-gray-600"],
};
const PERIOD_ORDER = { inProgress: 0, upcoming: 1, completed: 2 };
const LIFT_BLUE =
  "bg-blue-600 text-white shadow-[0_2px_5px_rgba(13,110,253,0.35)] hover:shadow-[0_4px_8px_rgba(13,110,253,0.45)] hover:-translate-y-px";
const MODAL_HEAD =
  "flex shrink-0 items-center justify-between gap-3 bg-[#1e3a5f] px-4 py-4 text-white sm:px-6";
const MODAL_FOOT =
  "flex shrink-0 flex-wrap justify-end gap-2 border-t border-gray-200 px-4 py-3.5 sm:px-6";
const BTN_CANCEL =
  "cursor-pointer rounded-lg border border-gray-200 bg-white px-5 py-2 text-[13px] hover:bg-gray-50";
const CLOSE_X =
  "shrink-0 cursor-pointer border-none bg-transparent text-xl leading-none text-white";
const PAGE_BTN =
  "cursor-pointer rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white";

const fmtShort = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : null;

// แสดงวัน-เวลาที่สร้าง เพราะหลาย record ถูกสร้างพร้อมกันเป็นชุด วันที่เดียวกันแยกไม่ออก
const fmtCreatedAt = (d) =>
  new Date(d).toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

// ── กรอบ modal ที่ใช้ร่วมกันทุกตัว: overlay + panel ที่ scroll ได้บนจอเตี้ย ──
function ModalShell({ onClose, zClass = "z-[999999]", maxW, children }) {
  return (
    <div
      className={`fixed inset-0 ${zClass} flex items-center justify-center bg-black/50 p-3 sm:p-5`}
      onClick={onClose}
    >
      <div
        className={`flex max-h-[90vh] w-full ${maxW} flex-col overflow-hidden rounded-[10px] bg-white`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function StatusBadge({ linkedCount, large = false }) {
  const size = large ? "text-xs" : "text-[11px]";
  return linkedCount > 0 ? (
    <span
      className={`whitespace-nowrap rounded-md bg-emerald-100 px-2.5 py-0.5 font-semibold text-emerald-800 ${size}`}
    >
      ✓ เปิดใช้งานแล้ว ({linkedCount}
      {large ? " Project" : ""})
    </span>
  ) : (
    <span
      className={`whitespace-nowrap rounded-md bg-amber-100 px-2.5 py-0.5 font-semibold text-amber-800 ${size}`}
    >
      ยังไม่เปิดใช้งาน
    </span>
  );
}

export default function Project() {
  const { backendUrl, isMultiClient, clients, clientMatches, selectedClient } =
    useContext(AppContent);
  const navigate = useNavigate();
  const projectClientMap = useProjectClientMap(); // โหมด multi เท่านั้น

  // ── ยกเลิกการเช็ค role ในระดับ component นี้ ──
  // สิทธิ์เข้าถึงหน้า /projects ถูกควบคุมที่ AppRouter.jsx (allowRoles) อยู่แล้ว
  const canManageProjects = true;

  const [years, setYears] = useState([]);
  const [activeYear, setActiveYear] = useState(null);
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState([]); // ON ทั้งปีที่เลือก
  const [loading, setLoading] = useState(true);
  const fetchReqRef = useRef(0);

  // ── filters ──
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [viewingRecord, setViewingRecord] = useState(null);
  const [linkedProjectsModal, setLinkedProjectsModal] = useState(null);
  // ข้อมูลจากหน้า Manpower Calendar (ขั้นตอน / จำนวนคน / แท็บ) — โหลดตอนเปิดรายการ requirement
  //   ไม่ critical: ถ้าโหลดไม่ได้ ก็ยังแสดงชื่อ / วันที่ / ปุ่มได้ตามเดิม
  const [overviewById, setOverviewById] = useState(null);

  // ── New manpower requirement (การ์ดใช้ร่วมกับหน้า Manpower Requirements) ──
  // null = ปิด / { record } = เปิด (record = ON Number ที่เลือกไว้ให้ ถ้ามี)
  const [newReq, setNewReq] = useState(null);

  // ตารางเลื่อนในกรอบตัวเอง — สูงเท่าพื้นที่ที่เหลือของจอ (วัดจริง) หักแถบเลขหน้า
  //   (เดิม h-[calc(100vh-90px)] ไม่ได้นับแท็บ Projects / Positions ด้านบน แถบเลขหน้าเลยตกขอบล่าง)
  const tableBoxRef = useRef(null);
  const pagerRef = useRef(null);
  const [tableMaxH, setTableMaxH] = useState(null);

  const fetchYears = async () => {
    try {
      const res = await axios.get(
        `${backendUrl}/api/projects/master-records/years`,
        { withCredentials: true },
      );
      setYears(res.data);
      if (res.data.length > 0 && activeYear === null) {
        setActiveYear(res.data[0]);
      }
    } catch (error) {
      console.error(error);
    }
  };

  // ดึงทุกหน้าของปีนั้นจาก endpoint เดิม (browse) — backend จำกัด pageSize ไว้เท่าไหร่ก็ยังได้ครบ
  const fetchYearRecords = async (year) => {
    const reqId = ++fetchReqRef.current; // กันผลของปีเก่ามาทับปีใหม่
    try {
      setLoading(true);
      let all = [];
      let pageNum = 1;
      let totalPages = 1;
      do {
        const res = await axios.get(
          `${backendUrl}/api/projects/master-records/browse`,
          {
            withCredentials: true,
            params: { year, page: pageNum, pageSize: FETCH_PAGE_SIZE },
          },
        );
        all = all.concat(res.data?.records ?? []);
        totalPages = res.data?.totalPages ?? 1;
        pageNum += 1;
      } while (pageNum <= totalPages && pageNum <= 100);
      if (reqId === fetchReqRef.current) setRecords(all);
    } catch (error) {
      console.error(error);
      if (reqId === fetchReqRef.current) setRecords([]);
    } finally {
      if (reqId === fetchReqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchYears();
  }, []);

  useEffect(() => {
    if (activeYear !== null) fetchYearRecords(activeYear);
  }, [activeYear]);

  // ── ลูกค้าของแต่ละ ON (โหมด multi) ──
  //   1) requirement ที่เปิดจาก ON นี้ → Contract → Client (แม่นที่สุด)
  //   2) ยังไม่เคยเปิด requirement → ดูจาก Company / Customer Name ว่าพูดถึงลูกค้าไหน
  //   หาไม่ได้ = ไม่ระบุลูกค้า (ขึ้นเฉพาะตอนเลือก "ทุกลูกค้า")
  const recordClient = (r) => {
    if (!isMultiClient) return null;
    for (const lp of r.linkedProjects ?? []) {
      const name = lp.contract?.client?.name || projectClientMap.get(lp.id);
      if (name) return name;
    }
    const hit = clients.find(
      (c) =>
        textMentionsClient(r.company, c.name) ||
        textMentionsClient(r.customerName, c.name),
    );
    return hit?.name ?? null;
  };

  const rows = useMemo(
    () => records.map((r) => ({ ...r, _client: recordClient(r) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, isMultiClient, projectClientMap, clients],
  );

  // ON ของลูกค้าที่เลือก (ตัวกรอง Client / Navbar) — ตัวเลือก dropdown อื่นๆ คิดจากชุดนี้
  const scopedRows = useMemo(
    () =>
      selectedClient ? rows.filter((r) => clientMatches(r._client)) : rows,
    [rows, selectedClient, clientMatches],
  );

  const customerOptions = useMemo(
    () => uniqSorted(scopedRows.map((r) => r.customerName)),
    [scopedRows],
  );
  const companyOptions = useMemo(
    () => uniqSorted(scopedRows.map((r) => r.company)),
    [scopedRows],
  );
  const teamOptions = useMemo(
    () => uniqSorted(scopedRows.map((r) => r.team)),
    [scopedRows],
  );
  const hasBlank = (key) => scopedRows.some((r) => !(r[key] ?? "").trim());

  const filteredRows = useMemo(() => {
    const q = squash(search);
    return scopedRows.filter((r) => {
      if (!matchOption(r.customerName, customerFilter)) return false;
      if (!matchOption(r.company, companyFilter)) return false;
      if (!matchOption(r.team, teamFilter)) return false;
      const linked = (r.linkedProjects?.length ?? 0) > 0;
      if (statusFilter === "linked" && !linked) return false;
      if (statusFilter === "unlinked" && linked) return false;
      if (!q) return true;
      return [r.projectCode, r.jobTitle, r.engineer, r.owner, r.ccNo, r.customerName].some(
        (v) => squash(v).includes(q),
      );
    });
  }, [scopedRows, search, customerFilter, companyFilter, teamFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pageRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // เปลี่ยนตัวกรอง / ปี / ลูกค้า → กลับหน้า 1
  useEffect(() => {
    setPage(1);
  }, [search, customerFilter, companyFilter, teamFilter, statusFilter, activeYear, selectedClient]);

  // ค่าที่เลือกไว้ไม่มีในปี / ลูกค้านี้แล้ว → ล้างช่องนั้น (ไม่งั้นตารางว่างโดยไม่รู้สาเหตุ)
  useEffect(() => {
    if (loading) return;
    const stale = (f, opts) => f && f !== NONE && !opts.includes(f);
    if (stale(customerFilter, customerOptions)) setCustomerFilter("");
    if (stale(companyFilter, companyOptions)) setCompanyFilter("");
    if (stale(teamFilter, teamOptions)) setTeamFilter("");
  }, [loading, customerOptions, companyOptions, teamOptions, customerFilter, companyFilter, teamFilter]);

  const hasFilter =
    search || customerFilter || companyFilter || teamFilter || statusFilter;

  // ไม่ล้าง Client — เป็นค่าที่ใช้ร่วมทุกหน้า (เปลี่ยนที่ช่อง Client / Navbar)
  const resetFilters = () => {
    setSearch("");
    setCustomerFilter("");
    setCompanyFilter("");
    setTeamFilter("");
    setStatusFilter("");
  };

  useEffect(() => {
    if (!linkedProjectsModal || overviewById) return;
    axios
      .get(`${backendUrl}/api/supervisor/projects-overview`, { withCredentials: true })
      .then((res) => {
        const m = new Map();
        Object.keys(PERIOD_TAG).forEach((tab) =>
          (res.data?.[tab] || []).forEach((p) => m.set(p.id, { ...p, tab })),
        );
        setOverviewById(m);
      })
      .catch((err) => {
        console.error(err);
        setOverviewById(new Map());
      });
  }, [linkedProjectsModal]);

  useLayoutEffect(() => {
    const measure = () => {
      const el = tableBoxRef.current;
      if (!el || el.offsetParent === null) return; // ซ่อนอยู่ (จอเล็กกว่า lg ใช้การ์ด)
      const top = el.getBoundingClientRect().top;
      const reserve = (pagerRef.current?.offsetHeight || 0) + 20;
      setTableMaxH(Math.max(280, Math.floor(window.innerHeight - top - reserve)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [loading, totalPages, filteredRows.length, years.length, isMultiClient]);

  const switchYear = (y) => {
    setActiveYear(y);
    setPage(1);
  };

  const openStartModal = (record = null) => setNewReq({ record });

  const formatDetailValue = (key, value) => {
    if (value === null || value === undefined || value === "") return "—";
    if (key === "termOfPaymentDays") return `${value} วัน`;
    if (key === "totalValue") return Number(value).toLocaleString("th-TH");
    return value;
  };

  const getPageNumbers = (current, total) => {
    const delta = 2;
    const range = [];
    const rangeWithDots = [];
    let last;
    for (let i = 1; i <= total; i++) {
      if (
        i === 1 ||
        i === total ||
        (i >= current - delta && i <= current + delta)
      ) {
        range.push(i);
      }
    }
    range.forEach((i) => {
      if (last) {
        if (i - last === 2) rangeWithDots.push(last + 1);
        else if (i - last > 2) rangeWithDots.push("...");
      }
      rangeWithDots.push(i);
      last = i;
    });
    return rangeWithDots;
  };

  // ── ปุ่ม View / รายการ — ใช้ร่วมกันทั้งตาราง (จอใหญ่) และการ์ด (มือถือ) ──
  const renderRecordActions = (r, linkedCount) => (
    <>
      <button
        title="ดูรายละเอียดทั้งหมด"
        onClick={() => setViewingRecord(r)}
        className={`${BTN} ${LIFT_WHITE} min-w-[72px] px-3 py-1.5 text-gray-700`}
      >
        👁 View
      </button>
      {/* มี requirement เดียว → เข้าไปจัดการได้เลย / หลายอัน → เปิดรายการให้เลือก */}
      {linkedCount === 1 && (
        <Link
          to={`/projects/${r.linkedProjects[0].id}`}
          title="หน้ารายละเอียด requirement — แก้ตำแหน่ง / จำนวนคน / วันที่ / คุยกับ PE"
          className={`${BTN} ${LIFT_BLUE} min-w-[72px] px-3 py-1.5 no-underline`}
        >
          Requirement →
        </Link>
      )}
      {linkedCount > 1 && (
        <button
          onClick={() => setLinkedProjectsModal(r)}
          className={`${BTN} ${LIFT_BLUE} min-w-[72px] px-3 py-1.5`}
        >
          📂 รายการ ({linkedCount})
        </button>
      )}
    </>
  );

  const headers = tableHeaders(isMultiClient);

  const emptyState = (text) => (
    <div className="rounded-[10px] border border-gray-200 bg-white p-10 text-center text-[13px] text-gray-500">
      {text}
    </div>
  );

  return (
    // lg ขึ้นไป: ตาราง scroll ภายในการ์ด สูงตามพื้นที่ที่เหลือของจอ (วัดจริง) — แถบเลขหน้าอยู่ในจอเสมอ
    // ต่ำกว่า lg: สูงตามเนื้อหา ทั้งหน้า scroll ปกติ
    <div className="flex flex-col">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col">
        {/* Header */}
        <div className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h1 className="m-0 text-lg font-bold">Projects (ON Number)</h1>
              <div className="text-xs text-gray-500">
                Master Project Register — ดูรายละเอียด ON Number และเปิด requirement ใหม่จาก ON
                นั้น · รายการตำแหน่งที่ขอทั้งหมดอยู่ที่เมนู Manpower Requirements
              </div>
            </div>

            {canManageProjects && (
              <button
                onClick={() => openStartModal(null)}
                className={`${BTN} w-full rounded-md bg-blue-600 px-[18px] py-2.5 text-[13px] text-white hover:bg-blue-700 sm:w-auto`}
              >
                + New requirement
              </button>
            )}
          </div>
        </div>

        {/* ════════ Search & Filter ════════
            ค้นหาข้อความ + dropdown แยกช่อง (แบบหน้า PE Approvals / Requests) — กรองทันทีไม่ต้องกดปุ่ม */}
        <div className="mb-3 shrink-0 border-y border-gray-200 py-3">
          <div
            className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${
              isMultiClient
                ? "lg:grid-cols-[150px_minmax(220px,2fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)]"
                : "lg:grid-cols-[minmax(240px,2fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)]"
            }`}
          >
            {/* โหมด multi เท่านั้น — ค่าเดียวกับตัวเลือกบน Navbar */}
            <ClientFilter />
            <div className="min-w-0">
              <label className={FILTER_LABEL}>ค้นหา</label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="ON Number / ชื่องาน / Engineer / CC No."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={`${FIELD} pr-8`}
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    title="ล้างคำค้น"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer border-none bg-transparent p-0 text-[13px] text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
            {[
              ["Customer", customerFilter, setCustomerFilter, customerOptions, "customerName"],
              ["Company", companyFilter, setCompanyFilter, companyOptions, "company"],
              ["Team", teamFilter, setTeamFilter, teamOptions, "team"],
            ].map(([label, value, setValue, options, key]) => (
              <div key={label} className="min-w-0">
                <label className={FILTER_LABEL}>{label}</label>
                <select
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className={FIELD}
                >
                  <option value="">ทั้งหมด</option>
                  {options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                  {hasBlank(key) && <option value={NONE}>— ไม่ระบุ —</option>}
                </select>
              </div>
            ))}
            <div className="min-w-0">
              <label className={FILTER_LABEL}>สถานะ</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className={FIELD}
              >
                {STATUS_OPTIONS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
            <span>
              {loading ? (
                "กำลังโหลด..."
              ) : (
                <>
                  ปี {activeYear} — พบ{" "}
                  <strong className="text-gray-900">{filteredRows.length}</strong>
                  {filteredRows.length !== records.length && ` จาก ${records.length}`} รายการ
                  {selectedClient && ` · ลูกค้า ${selectedClient.name}`}
                </>
              )}
            </span>
            {hasFilter && (
              <button
                type="button"
                onClick={resetFilters}
                className="cursor-pointer border-none bg-transparent p-0 text-xs font-semibold text-[#dc3545] underline hover:text-[#a71d2a]"
              >
                ✕ ล้าง filter
              </button>
            )}
          </div>
        </div>

        {/* Year Tabs — มือถือเลื่อนแนวนอนได้ถ้าปีเยอะ */}
        <div className="mb-3 flex shrink-0 gap-2 overflow-x-auto border-b border-gray-200">
          {years.map((y) => (
            <button
              key={y}
              onClick={() => switchYear(y)}
              className={`shrink-0 cursor-pointer border-x-0 border-b-2 border-t-0 border-solid bg-transparent px-[18px] py-2 text-[13px] ${
                activeYear === y
                  ? "border-blue-600 font-bold text-blue-600"
                  : "border-transparent font-medium text-gray-500 hover:text-gray-700"
              }`}
            >
              {y}
            </button>
          ))}
        </div>

        {/* ── มือถือ / แท็บเล็ต (< lg): การ์ดทีละ record ── */}
        <div className="lg:hidden">
          {loading ? (
            emptyState("Loading...")
          ) : pageRows.length === 0 ? (
            emptyState(hasFilter || selectedClient ? "ไม่พบ ON ตามเงื่อนไขที่เลือก" : "No records found")
          ) : (
            <div className="flex flex-col gap-2.5">
              {pageRows.map((r) => {
                const linkedCount = r.linkedProjects?.length ?? 0;
                return (
                  <div
                    key={r.id}
                    className="rounded-[10px] border border-gray-200 bg-white p-3.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="break-all text-[13px] font-bold">
                        {r.projectCode}
                      </div>
                      <StatusBadge linkedCount={linkedCount} />
                    </div>
                    <div className="mt-1 break-words text-[13px] text-gray-800">
                      {r.jobTitle}
                    </div>
                    <div className="mt-2 grid grid-cols-[72px_1fr] gap-y-0.5 text-xs">
                      {isMultiClient && (
                        <>
                          <span className="text-gray-500">Client</span>
                          <span className="break-words font-semibold">{r._client || "—"}</span>
                        </>
                      )}
                      <span className="text-gray-500">Customer</span>
                      <span className="break-words">
                        {r.customerName || "—"}
                      </span>
                      <span className="text-gray-500">Company</span>
                      <span className="break-words">{r.company || "—"}</span>
                      <span className="text-gray-500">Team</span>
                      <span className="break-words">{r.team || "—"}</span>
                    </div>
                    <div className="mt-3 flex gap-2 [&>button]:flex-1">
                      {renderRecordActions(r, linkedCount)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── จอใหญ่ (lg+): ตาราง ── */}
        <div className="hidden flex-col overflow-hidden rounded-[10px] border border-gray-200 bg-white lg:flex">
          <div
            ref={tableBoxRef}
            style={tableMaxH ? { maxHeight: tableMaxH } : undefined}
            className="max-h-[calc(100vh-380px)] overflow-auto"
          >
            <table className="w-full min-w-[820px] border-collapse text-[13px]">
              <thead>
                <tr>
                  {headers.map(([h, w]) => (
                    <th
                      key={h}
                      className={`sticky top-0 z-[1] whitespace-nowrap bg-white px-4 py-2.5 text-[11px] font-semibold tracking-[0.5px] text-gray-500 shadow-[inset_0_-1px_0_#dee2e6] ${
                        h === "ACTIONS" ? "text-center" : "text-left"
                      } ${w}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={headers.length} className="p-10 text-center text-gray-500">
                      Loading...
                    </td>
                  </tr>
                ) : pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={headers.length} className="p-10 text-center text-gray-500">
                      {hasFilter || selectedClient ? "ไม่พบ ON ตามเงื่อนไขที่เลือก" : "No records found"}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((r, idx) => {
                    const linkedCount = r.linkedProjects?.length ?? 0;
                    return (
                      <tr
                        key={r.id}
                        className={`hover:bg-gray-50 ${
                          idx < pageRows.length - 1
                            ? "border-b border-gray-100"
                            : ""
                        }`}
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-semibold">
                          {r.projectCode}
                        </td>
                        {isMultiClient && (
                          <td className="whitespace-nowrap px-4 py-3 font-semibold text-[#2B2F78]">
                            {r._client || <span className="font-normal text-gray-400">—</span>}
                          </td>
                        )}
                        <td className="px-4 py-3">{r.jobTitle}</td>
                        <td className="px-4 py-3">{r.customerName || "—"}</td>
                        <td className="px-4 py-3">{r.company || "—"}</td>
                        <td className="px-4 py-3">{r.team || "—"}</td>
                        <td className="px-4 py-3">
                          <StatusBadge linkedCount={linkedCount} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          {/* ซ้อนแนวตั้ง (แบบหน้า Manpower Requirements) — คอลัมน์แคบ ปุ่มกว้างเท่ากัน */}
                          <div className="mx-auto flex w-[118px] flex-col items-stretch gap-1">
                            {renderRecordActions(r, linkedCount)}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            ref={pagerRef}
            className="flex shrink-0 flex-wrap items-center justify-between gap-2.5 px-1 py-3 text-xs text-gray-500 sm:px-4"
          >
            <span>
              หน้า {page} / {totalPages} — ทั้งหมด {filteredRows.length} รายการ
            </span>
            <div className="flex flex-wrap items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className={PAGE_BTN}
              >
                ←<span className="hidden sm:inline"> ก่อนหน้า</span>
              </button>

              {getPageNumbers(page, totalPages).map((p, idx) =>
                p === "..." ? (
                  <span key={`dots-${idx}`} className="px-1 text-gray-400">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`min-w-[30px] cursor-pointer rounded-md border border-solid px-2.5 py-1.5 text-xs ${
                      p === page
                        ? "border-blue-600 bg-blue-600 font-bold text-white"
                        : "border-gray-200 bg-white font-medium text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {p}
                  </button>
                ),
              )}

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className={PAGE_BTN}
              >
                <span className="hidden sm:inline">ถัดไป </span>→
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ════════ View Details Modal ════════ */}
      {viewingRecord && (
        <ModalShell onClose={() => setViewingRecord(null)} maxW="max-w-[640px]">
          <div className={MODAL_HEAD}>
            <div className="min-w-0">
              <div className="break-all text-base font-bold">
                {viewingRecord.projectCode}
              </div>
              <div className="mt-0.5 break-words text-xs opacity-[0.85]">
                {viewingRecord.jobTitle}
              </div>
            </div>
            <button onClick={() => setViewingRecord(null)} className={CLOSE_X}>
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            <table className="w-full border-collapse text-[13px]">
              <tbody>
                {DETAIL_FIELDS.map(([key, label]) => (
                  <tr key={key} className="border-b border-gray-100">
                    <td className="w-[120px] py-2 pr-3 align-top font-semibold text-gray-500 sm:w-[160px]">
                      {label}
                    </td>
                    <td className="break-words py-2 text-gray-900">
                      {formatDetailValue(key, viewingRecord[key])}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="py-2 pr-3 font-semibold text-gray-500">
                    สถานะ
                  </td>
                  <td className="py-2">
                    <StatusBadge
                      linkedCount={viewingRecord.linkedProjects?.length ?? 0}
                      large
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className={MODAL_FOOT}>
            <button
              onClick={() => setViewingRecord(null)}
              className={BTN_CANCEL}
            >
              ปิด
            </button>
            {(viewingRecord.linkedProjects?.length ?? 0) > 0 && (
              <button
                onClick={() => {
                  setViewingRecord(null);
                  setLinkedProjectsModal(viewingRecord);
                }}
                className="cursor-pointer rounded-lg border border-blue-600 bg-white px-5 py-2 text-[13px] font-semibold text-blue-600 hover:bg-blue-50"
              >
                ดูรายการ requirement →
              </button>
            )}
            {canManageProjects && (
              <button
                onClick={() => {
                  setViewingRecord(null);
                  openStartModal(viewingRecord);
                }}
                className="cursor-pointer rounded-lg border-none bg-blue-600 px-5 py-2 text-[13px] font-semibold text-white hover:bg-blue-700"
              >
                + New requirement จาก ON นี้
              </button>
            )}
          </div>
        </ModalShell>
      )}

      {/* ════════ Linked Projects Modal ════════ */}
      {linkedProjectsModal && (
        <ModalShell
          onClose={() => setLinkedProjectsModal(null)}
          maxW="max-w-[640px]"
        >
          <div className={MODAL_HEAD}>
            <span className="min-w-0 truncate text-base font-semibold">
              📂 Requirements จาก {linkedProjectsModal.projectCode}
            </span>
            <button
              onClick={() => setLinkedProjectsModal(null)}
              className={CLOSE_X}
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            <div className="mb-3 break-words text-xs text-gray-500">
              {linkedProjectsModal.jobTitle}
              <span className="text-gray-400">
                {" "}· แก้ไข / ลบ requirement ที่ปุ่ม Requirement
              </span>
            </div>

            {[...linkedProjectsModal.linkedProjects]
              // เรียงตามแท็บของ Manpower Calendar (กำลังดำเนินการ → กำลังจะเริ่ม → จบแล้ว) แล้วตามวันเริ่ม
              .sort((a, b) => {
                const ta = PERIOD_ORDER[overviewById?.get(a.id)?.tab] ?? 9;
                const tb = PERIOD_ORDER[overviewById?.get(b.id)?.tab] ?? 9;
                return ta - tb || new Date(a.startDate || 0) - new Date(b.startDate || 0);
              })
              .map((p) => {
              const ov = overviewById?.get(p.id);
              const startPart = fmtShort(p.startDate);
              const endPart = fmtShort(p.endDate);
              const need = ov ? ov.requests.reduce((n, r) => n + (r.quantity || 0), 0) : null;
              const [tagText, tagCls] = PERIOD_TAG[ov?.tab] || [];

              return (
                <div
                  key={p.id}
                  className="mb-1.5 flex flex-col gap-2 rounded-md bg-gray-50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    {/* ชื่อ requirement มักซ้ำกันใน ON เดียว — ช่วงวันที่คือตัวแยก ขึ้นก่อนชื่อ */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold">
                      <span>
                        {startPart || "ยังไม่กำหนดวัน"}
                        {endPart ? ` – ${endPart}` : ""}
                      </span>
                      {tagText && (
                        <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${tagCls}`}>
                          {tagText}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 break-words text-[11px] text-gray-700">
                      {p.name}
                      {p.location ? ` · 📍 ${p.location}` : ""}
                    </div>
                    {ov && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-600">
                        <span>{ov.requests.length} ตำแหน่ง</span>
                        <span>
                          ลงงาน{" "}
                          <b className={ov.employees.length >= need && need > 0 ? "text-emerald-700" : "text-gray-800"}>
                            {ov.employees.length}
                          </b>
                          /{need} คน
                        </span>
                        <StageBadge stage={ov.currentStage} />
                      </div>
                    )}
                    <div className="mt-0.5 text-[10px] text-gray-400">
                      สร้างเมื่อ {fmtCreatedAt(p.createdAt)}
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-1.5 self-end sm:self-auto">
                    <Link
                      to={`/projects-overview/${p.id}`}
                      title="ดู timeline ขั้นตอน + ตารางวันทำงานรายคน (Manpower Calendar)"
                      className={BTN_TIMELINE}
                    >
                      Timeline
                    </Link>
                    <Link
                      to={`/projects/${p.id}`}
                      title="หน้ารายละเอียด requirement — แก้ตำแหน่ง / จำนวนคน / วันที่ / คุยกับ PE"
                      className={BTN_REQUIREMENT}
                    >
                      Requirement →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-gray-200 px-4 py-3.5 sm:px-6">
            {canManageProjects && (
              <button
                onClick={() => {
                  const record = linkedProjectsModal;
                  setLinkedProjectsModal(null);
                  openStartModal(record);
                }}
                className="cursor-pointer rounded-lg border border-[#198754] bg-white px-4 py-2 text-[13px] font-semibold text-[#198754] hover:bg-emerald-50"
              >
                + New requirement จาก ON นี้
              </button>
            )}
            <button
              onClick={() => setLinkedProjectsModal(null)}
              className={`${BTN_CANCEL} ml-auto`}
            >
              ปิด
            </button>
          </div>
        </ModalShell>
      )}

      {/* ════════ New manpower requirement ════════ */}
      {newReq && canManageProjects && (
        <NewRequirementModal
          prefillRecord={newReq.record}
          onClose={() => setNewReq(null)}
          onCreated={(projectId) => {
            setNewReq(null);
            navigate(`/projects/${projectId}`);
          }}
        />
      )}

    </div>
  );
}
