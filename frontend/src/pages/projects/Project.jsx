import { useState, useEffect, useContext } from "react";
import axios from "axios";
import { AppContent } from "../../context/AppContext";
import { Link, useNavigate } from "react-router-dom";
import NewRequirementModal from "./NewRequirementModal";
import { StageBadge } from "./calendarShared";

// ══════════════════════════════════════════════════════════
// Projects (ON Number) — Master Project Register
// อยู่ที่เมนู Projects & Positions › Projects (ข้อมูลตั้งต้นจากระบบบัญชี / import)
// การเปิด requirement ใหม่ใช้การ์ดเดียวกับหน้า Manpower Requirements (NewRequirementModal.jsx)
// ══════════════════════════════════════════════════════════

const PAGE_SIZE = 15;

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

const TABLE_HEADERS = [
  ["ON NUMBER", "w-[150px]"],
  ["PROJECT / JOB", ""],
  ["CUSTOMER", ""],
  ["COMPANY", ""],
  ["TEAM", ""],
  ["STATUS", ""],
  ["ACTIONS", "w-[170px]"],
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
  const { backendUrl } = useContext(AppContent);
  const navigate = useNavigate();

  // ── ยกเลิกการเช็ค role ในระดับ component นี้ ──
  // สิทธิ์เข้าถึงหน้า /projects ถูกควบคุมที่ AppRouter.jsx (allowRoles) อยู่แล้ว
  const canManageProjects = true;

  const [years, setYears] = useState([]);
  const [activeYear, setActiveYear] = useState(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ records: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const [clients, setClients] = useState([]);
  const [viewingRecord, setViewingRecord] = useState(null);
  const [linkedProjectsModal, setLinkedProjectsModal] = useState(null);
  // ข้อมูลจากหน้า Manpower Calendar (ขั้นตอน / จำนวนคน / แท็บ) — โหลดตอนเปิดรายการ requirement
  //   ไม่ critical: ถ้าโหลดไม่ได้ ก็ยังแสดงชื่อ / วันที่ / ปุ่มได้ตามเดิม
  const [overviewById, setOverviewById] = useState(null);

  // ── New manpower requirement (การ์ดใช้ร่วมกับหน้า Manpower Requirements) ──
  // null = ปิด / { record } = เปิด (record = ON Number ที่เลือกไว้ให้ ถ้ามี)
  const [newReq, setNewReq] = useState(null);

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

  const fetchClients = async () => {
    try {
      const res = await axios.get(`${backendUrl}/api/clients`, {
        withCredentials: true,
      });
      setClients(res.data);
    } catch (error) {
      console.error(error);
    }
  };

  const fetchRecords = async (year, pageNum, search) => {
    try {
      setLoading(true);
      const res = await axios.get(
        `${backendUrl}/api/projects/master-records/browse`,
        {
          withCredentials: true,
          params: { year, page: pageNum, pageSize: PAGE_SIZE, search },
        },
      );
      setData(res.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchYears();
    fetchClients();
  }, []);

  useEffect(() => {
    if (activeYear !== null) fetchRecords(activeYear, page, searchQuery);
  }, [activeYear, page, searchQuery]);

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

  const switchYear = (y) => {
    setActiveYear(y);
    setPage(1);
  };

  const runSearch = () => {
    setSearchQuery(searchInput.trim());
    setPage(1);
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearchQuery("");
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
        className={`${BTN} ${LIFT_WHITE} min-w-[72px] px-3.5 py-1.5 text-gray-700`}
      >
        👁 View
      </button>
      {/* มี requirement เดียว → เข้าไปจัดการได้เลย / หลายอัน → เปิดรายการให้เลือก */}
      {linkedCount === 1 && (
        <Link
          to={`/projects/${r.linkedProjects[0].id}`}
          title="หน้ารายละเอียด requirement — แก้ตำแหน่ง / จำนวนคน / วันที่ / คุยกับ PE"
          className={`${BTN} ${LIFT_BLUE} min-w-[72px] px-3.5 py-1.5 no-underline`}
        >
          Requirement →
        </Link>
      )}
      {linkedCount > 1 && (
        <button
          onClick={() => setLinkedProjectsModal(r)}
          className={`${BTN} ${LIFT_BLUE} min-w-[72px] px-3.5 py-1.5`}
        >
          📂 รายการ ({linkedCount})
        </button>
      )}
    </>
  );

  const emptyState = (text) => (
    <div className="rounded-[10px] border border-gray-200 bg-white p-10 text-center text-[13px] text-gray-500">
      {text}
    </div>
  );

  return (
    // lg ขึ้นไป: สูงเต็มจอ ตาราง scroll ภายในการ์ด
    // ต่ำกว่า lg: สูงตามเนื้อหา ทั้งหน้า scroll ปกติ
    <div className="flex flex-col lg:h-[calc(100vh-90px)]">
      <div className="mx-auto flex min-h-0 w-full max-w-[1800px] flex-1 flex-col">
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

        {/* ════════ Search & Filter ════════ */}
        <div className="mb-3 shrink-0 border-y border-gray-200 py-3">
          <label className="mb-1 block text-[11px] font-semibold text-gray-500">
            ค้นหา (ON Number / ชื่องาน / ลูกค้า / Engineer)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="เช่น ON/018-01/2026, Hydraulic, K.Pakorn..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
              }}
              className={`${INPUT} min-w-0 max-w-[720px] flex-1`}
            />
            <button
              onClick={runSearch}
              className={`${BTN} shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 sm:px-5`}
            >
              🔍 ค้นหา
            </button>
            {searchQuery && (
              <button
                onClick={clearSearch}
                className={`${BTN} shrink-0 rounded-lg border border-solid border-gray-200 bg-white px-3 py-2 text-gray-500 hover:bg-gray-50 sm:px-4`}
              >
                ✕ ล้าง
              </button>
            )}
          </div>
          {searchQuery && (
            <div className="mt-2 text-xs text-gray-500">
              ผลค้นหา "{searchQuery}" ในปี {activeYear} — พบ{" "}
              <strong className="text-gray-900">{data.total}</strong> รายการ
            </div>
          )}
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
          ) : data.records.length === 0 ? (
            emptyState("No records found")
          ) : (
            <div className="flex flex-col gap-2.5">
              {data.records.map((r) => {
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
        <div className="hidden min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-gray-200 bg-white lg:flex">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[820px] border-collapse text-[13px]">
              <thead>
                <tr>
                  {TABLE_HEADERS.map(([h, w], i) => (
                    <th
                      key={h}
                      className={`sticky top-0 z-[1] whitespace-nowrap bg-white px-4 py-2.5 text-[11px] font-semibold tracking-[0.5px] text-gray-500 shadow-[inset_0_-1px_0_#dee2e6] ${
                        i === 6 ? "text-center" : "text-left"
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
                    <td colSpan="7" className="p-10 text-center text-gray-500">
                      Loading...
                    </td>
                  </tr>
                ) : data.records.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="p-10 text-center text-gray-500">
                      No records found
                    </td>
                  </tr>
                ) : (
                  data.records.map((r, idx) => {
                    const linkedCount = r.linkedProjects?.length ?? 0;
                    return (
                      <tr
                        key={r.id}
                        className={`hover:bg-gray-50 ${
                          idx < data.records.length - 1
                            ? "border-b border-gray-100"
                            : ""
                        }`}
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-semibold">
                          {r.projectCode}
                        </td>
                        <td className="px-4 py-3">{r.jobTitle}</td>
                        <td className="px-4 py-3">{r.customerName || "—"}</td>
                        <td className="px-4 py-3">{r.company || "—"}</td>
                        <td className="px-4 py-3">{r.team || "—"}</td>
                        <td className="px-4 py-3">
                          <StatusBadge linkedCount={linkedCount} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex justify-center gap-1.5">
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
        {data.totalPages > 1 && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2.5 px-1 py-3 text-xs text-gray-500 sm:px-4">
            <span>
              หน้า {data.page} / {data.totalPages} — ทั้งหมด {data.total} รายการ
            </span>
            <div className="flex flex-wrap items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className={PAGE_BTN}
              >
                ←<span className="hidden sm:inline"> ก่อนหน้า</span>
              </button>

              {getPageNumbers(page, data.totalPages).map((p, idx) =>
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
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                disabled={page >= data.totalPages}
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
