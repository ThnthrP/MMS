import { useState, useEffect, useLayoutEffect, useContext, useCallback, useRef } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { AppContent } from "../../context/AppContext";
import RequestBookingModal from "./RequestBookingModal";
import DecisionModal, { fmtRange, toYMD } from "./BookingDecisionModal";

// ══════════════════════════════════════════════════════════
// Training Bookings  (/requests-history)    → <RequestsHistory type="training" />
// Medical Bookings   (/medical-bookings)    → <RequestsHistory type="medical" />
// 1 แถว = 1 คน (คน × training หรือ คน × การตรวจ) จากทุกคำขอ — แบบโปรแกรมตัวอย่าง
//   HR กด "Confirm / reject" ที่แถวได้เลย (การ์ด HR confirmation) หรือเลือกหลายคนแล้วทำทีเดียว
// คำขอมาจาก:
//   • ปุ่ม "Request training / medical" ในหน้านี้
//   • Training Courses › "แจ้ง HR ให้จัด Training"
//   • Assign Names › ดู Gap (Training) / 📨 แจ้ง HR (Medical)
//   • Compliance › Training Alerts / คอลัมน์ Medical › 📨 แจ้ง HR
// ══════════════════════════════════════════════════════════

const LAST_VIEWED_KEY = "trainingRequestLastViewed";
const PAGE_SIZE = 20;

const readLastViewed = () => {
  try {
    const raw = localStorage.getItem(LAST_VIEWED_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
const writeLastViewed = (id) => {
  try {
    localStorage.setItem(LAST_VIEWED_KEY, JSON.stringify({ id, viewedAt: Date.now() }));
  } catch {
    // localStorage อาจไม่พร้อมใช้งาน — ไม่ critical
  }
};

const fmtDateTime = (d) =>
  new Date(d).toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const daysAgoYMD = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toYMD(d);
};
const uniqSorted = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b));

const getPageNumbers = (current, total) => {
  const range = [];
  const out = [];
  let last;
  for (let i = 1; i <= total; i++)
    if (i === 1 || i === total || (i >= current - 2 && i <= current + 2)) range.push(i);
  range.forEach((i) => {
    if (last) {
      if (i - last === 2) out.push(last + 1);
      else if (i - last > 2) out.push("...");
    }
    out.push(i);
    last = i;
  });
  return out;
};

// ยืนยันแล้วและยังไม่ผ่านวัน (ไม่มีวันที่ = นับว่ายังไม่ถึง)
const isUpcoming = (r) => {
  if (r.status !== "confirmed") return false;
  const d = toYMD(r.confirmedEnd || r.confirmedStart);
  return !d || d >= toYMD(new Date());
};

// ── สถานะ ──
//   open = รอ HR + ยืนยันแล้วที่ยังไม่ถึงวัน (งานที่ HR ยังต้องติดตาม) — ค่าเริ่มต้น
const STATUS_FILTERS = [
  ["open", "รอ HR + ยืนยันแล้ว (ยังไม่ถึงวัน)", (r) => r.status === "pending" || isUpcoming(r)],
  ["pending", "⏳ รอ HR", (r) => r.status === "pending"],
  ["upcoming", "✓ ยืนยันแล้ว — ยังไม่ถึงวัน", isUpcoming],
  ["confirmed", "✓ ยืนยันแล้ว (ทั้งหมด)", (r) => r.status === "confirmed"],
  ["rejected", "✕ ปฏิเสธ", (r) => r.status === "rejected"],
  ["all", "ทั้งหมด", () => true],
];
const statusTest = (key) => (STATUS_FILTERS.find((s) => s[0] === key) || STATUS_FILTERS[0])[2];

// ปุ่มสรุปจำนวน (กดเพื่อกรอง) — แบบโปรแกรมตัวอย่าง
const SUMMARY_CHIPS = [
  ["pending", "⏳ รอ HR", "border-[#ffe69c] bg-[#fff8e1] text-[#664d03]"],
  ["upcoming", "✓ ยืนยันแล้ว (ยังไม่ถึงวัน)", "border-[#badbcc] bg-[#f0faf4] text-[#0f5132]"],
  ["rejected", "✕ ปฏิเสธ", "border-[#f5c2c7] bg-[#fff5f5] text-[#842029]"],
];

const STATUS = {
  pending: ["⏳ รอ HR", "bg-[#fff3cd] text-[#664d03]"],
  confirmed: ["✓ ยืนยันแล้ว", "bg-[#d1e7dd] text-[#0f5132]"],
  rejected: ["✕ ปฏิเสธ", "bg-[#f8d7da] text-[#842029]"],
};
const REASON = {
  overdue: "❌ หมดอายุ",
  no_record: "⚪ ไม่มีข้อมูล",
  due_soon: "⏰ ใกล้หมดอายุ",
  manual: "📝 ขอเอง",
};

const DATE_PRESETS = [
  ["all", "ทั้งหมด", null],
  ["today", "วันนี้", 0],
  ["7d", "7 วัน", 6],
  ["30d", "30 วัน", 29],
  ["90d", "90 วัน", 89],
];

// CSV (ใส่ BOM ให้ Excel อ่านภาษาไทยได้)
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

// หัวตารางตรึงไว้ตอนเลื่อน (ตารางเลื่อนในกรอบ max-h ของตัวเอง)
const TH =
  "sticky top-0 z-[1] whitespace-nowrap bg-gray-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.4px] text-gray-500 shadow-[inset_0_-1px_0_#e5e7eb]";
// คลิกที่แถวเพื่อติ๊ก — ยกเว้นคลิกโดนลิงก์ / ปุ่ม / checkbox เอง
const isInteractive = (e) => !!e.target.closest("a,button,input,select,label");
const TD = "px-3 py-3 align-top text-[13px]";
const FILTER_LABEL = "mb-1 block text-xs font-semibold uppercase tracking-[0.4px] text-gray-500";
const FIELD_BASE =
  "box-border h-9 rounded-lg border border-gray-200 bg-white px-3 text-[13px] text-gray-900 outline-none focus:border-[#2B2F78]";
const FIELD = `${FIELD_BASE} w-full`;
const DATE_FIELD = `${FIELD_BASE} w-[140px]`;
const TOOL_BTN =
  "inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 no-underline hover:bg-gray-50";
const BTN =
  "inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50";
const CHIP = "cursor-pointer whitespace-nowrap rounded-full border px-3 py-1 text-xs";
const PAGE_BTN =
  "min-w-[30px] cursor-pointer rounded-md border px-2.5 py-[5px] text-xs disabled:cursor-not-allowed disabled:opacity-50";

// ══════════════════════════════════════════════════════════
export default function RequestsHistory({ type }) {
  const [searchParams] = useSearchParams();
  // ลิงก์เก่า /requests-history?type=medical → หน้า Medical Bookings
  if (!type && searchParams.get("type") === "medical") return <Navigate to="/medical-bookings" replace />;
  const t = type === "medical" ? "medical" : "training";
  return <BookingsPage key={t} requestType={t} />;
}

function BookingsPage({ requestType }) {
  const { backendUrl } = useContext(AppContent);
  const isTraining = requestType === "training";
  const apiBase = `${backendUrl}/api/${isTraining ? "training-requests" : "medical-requests"}`;
  const detailPath = (batchId) => (isTraining ? `/training-requests/${batchId}` : `/medical-requests/${batchId}`);

  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [datePreset, setDatePreset] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [requesterFilter, setRequesterFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState([]); // itemIds
  const [decision, setDecision] = useState(null); // { rows, decision }
  const [saving, setSaving] = useState(false);
  const [lastViewed, setLastViewed] = useState(() => readLastViewed());

  // ความสูงกรอบตาราง = พื้นที่ที่เหลือของจอ (วัดจริง) → เห็นแถบเลขหน้าโดยไม่ต้องเลื่อนทั้งหน้า
  //   หน้า Training มีแท็บด้านบน / filter ขึ้นบรรทัดใหม่ตามความกว้างจอ — ค่าคงที่ใช้ไม่ได้
  const tableBoxRef = useRef(null);
  const [tableMaxH, setTableMaxH] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError("");
    return axios
      .get(`${apiBase}/items`, { withCredentials: true })
      .then((res) => setRows(Array.isArray(res.data) ? res.data : []))
      .catch((err) => {
        console.error(err);
        setRows([]);
        setLoadError(
          err.response?.status === 404
            ? "backend ยังไม่มี GET /items — อัปเดต routes และ bookingListService ก่อน"
            : err.response?.data?.message || "โหลดรายการไม่สำเร็จ",
        );
      })
      .finally(() => setLoading(false));
  }, [apiBase]);

  useEffect(() => {
    load();
  }, [load]);

  const markViewed = (batchId) => {
    writeLastViewed(batchId);
    setLastViewed({ id: batchId, viewedAt: Date.now() });
  };

  // ── filter ──
  const resetFilters = () => {
    setSearch("");
    setDatePreset("all");
    setDateFrom("");
    setDateTo("");
    setRequesterFilter("");
    setSubjectFilter("");
    setClientFilter("");
    setStatusFilter("open");
    setPage(1);
  };
  const applyPreset = (key, days) => {
    setDatePreset(key);
    setDateFrom(days === null ? "" : daysAgoYMD(days));
    setDateTo(days === null ? "" : toYMD(new Date()));
    setPage(1);
  };
  const setDate = (setter) => (e) => {
    setter(e.target.value);
    setDatePreset("");
    setPage(1);
  };
  const onFilter = (setter) => (e) => {
    setter(e.target.value);
    setPage(1);
  };

  const subjectOf = (r) => (isTraining ? r.trainingName : r.checkType);
  const requesterOptions = uniqSorted(rows.map((r) => r.requestedByName));
  const subjectOptions = uniqSorted(rows.map(subjectOf));
  const clientOptions = uniqSorted(rows.map((r) => r.clientName));

  // กรองทุกอย่าง "ยกเว้นสถานะ" — ใช้นับตัวเลขบนปุ่มสรุป
  const baseFiltered = rows.filter((r) => {
    const ymd = toYMD(r.createdAt);
    if (dateFrom && ymd < dateFrom) return false;
    if (dateTo && ymd > dateTo) return false;
    if (requesterFilter && r.requestedByName !== requesterFilter) return false;
    if (subjectFilter && subjectOf(r) !== subjectFilter) return false;
    if (clientFilter && r.clientName !== clientFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [r.fullName, r.fullNameTH, r.empId, r.empCode, r.position, subjectOf(r), r.requestedByName, r.clientName]
      .some((v) => String(v || "").toLowerCase().includes(q));
  });
  const filtered = baseFiltered.filter(statusTest(statusFilter));
  const countOf = (key) => baseFiltered.filter(statusTest(key)).length;

  const hasFilter =
    search || dateFrom || dateTo || requesterFilter || subjectFilter || clientFilter || statusFilter !== "open";

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useLayoutEffect(() => {
    const measure = () => {
      const el = tableBoxRef.current;
      if (!el || el.offsetParent === null) return; // ซ่อนอยู่ (มือถือ)
      const top = el.getBoundingClientRect().top;
      // เผื่อแถบเลขหน้า (~56px) + ระยะขอบล่างของ layout
      const reserve = totalPages > 1 ? 88 : 32;
      setTableMaxH(Math.max(300, Math.floor(window.innerHeight - top - reserve)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [totalPages, loading, hasFilter, isTraining]);

  // ── เลือกหลายคน (เฉพาะคนที่รอ HR ในผลการกรอง) ──
  const pendingInView = filtered.filter((r) => r.status === "pending");
  const allSelected = pendingInView.length > 0 && pendingInView.every((r) => selected.includes(r.itemId));
  const selectedRows = rows.filter((r) => selected.includes(r.itemId));
  const toggle = (id) => setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const toggleAll = () => setSelected(allSelected ? [] : pendingInView.map((r) => r.itemId));

  // ── บันทึกผล: แยกตามคำขอ (batch) แล้วเรียก PATCH /:batchId/items เดิม ──
  const save = async (targetRows, body) => {
    const byBatch = {};
    for (const r of targetRows) (byBatch[r.batchId] ||= []).push(r);
    try {
      setSaving(true);
      for (const [batchId, list] of Object.entries(byBatch)) {
        await axios.patch(
          `${apiBase}/${batchId}/items`,
          {
            itemIds: list.map((r) => r.itemId),
            ...body,
            // เว้นว่าง = ใช้สถานที่ที่ผู้ขอระบุไว้ในคำขอนั้น
            ...(body.decision === "confirmed" ? { provider: body.provider || list[0].provider || "" } : {}),
          },
          { withCredentials: true },
        );
      }
      setSelected([]);
      setDecision(null);
      await load();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const undo = (r) => {
    if (!window.confirm(`ย้อนสถานะของ ${r.fullName} กลับเป็น "รอ HR"?`)) return;
    save([r], { decision: "pending" });
  };

  const exportCsv = () =>
    downloadCsv(`${isTraining ? "training" : "medical"}-bookings-${toYMD(new Date())}.csv`, [
      [
        "Worker",
        "Employee ID",
        "Position",
        isTraining ? "Course" : "Check Type",
        "Requested dates",
        "Requested provider",
        "Client",
        "Status",
        "Confirmed dates",
        "Confirmed provider",
        "HR note",
        "Decided by",
        "Requested by",
        "Requested at",
      ],
      ...filtered.map((r) => [
        r.fullName,
        r.empId || r.empCode,
        r.position,
        subjectOf(r),
        fmtRange(r.requestedStart, r.requestedEnd),
        r.provider,
        r.clientName,
        (STATUS[r.status] || STATUS.pending)[0].replace(/^\S+\s/, ""),
        fmtRange(r.confirmedStart, r.confirmedEnd),
        r.confirmedProvider,
        r.hrNote,
        r.decidedByName,
        r.requestedByName,
        fmtDateTime(r.createdAt),
      ]),
    ]);

  const emptyText = loading
    ? "Loading..."
    : loadError
      ? loadError
      : hasFilter
        ? "ไม่พบรายการตามเงื่อนไขที่เลือก"
        : isTraining
          ? "ยังไม่มีคำขอ training"
          : "ยังไม่มีคำขอ medical check-up";

  // ── ส่วนของแถว (ใช้ทั้งตารางและรายการบนมือถือ) ──
  const workerCell = (r) => (
    <div className="min-w-0">
      <Link
        to={`/workers/${r.employeeId}`}
        className="font-semibold text-gray-900 no-underline hover:text-[#2B2F78] hover:underline"
      >
        {r.fullNameEN || r.fullName}
      </Link>
      {r.fullNameTH && <div className="text-xs text-gray-600">{r.fullNameTH}</div>}
      <div className="text-[11px] text-gray-500">
        {r.empId || r.empCode}
        {r.position && ` · ${r.position}`}
      </div>
    </div>
  );

  const subjectCell = (r) => (
    <div className="min-w-0">
      <div className="break-words">{subjectOf(r)}</div>
      {!isTraining && r.reason && <div className="text-[11px] text-gray-500">{REASON[r.reason] || r.reason}</div>}
    </div>
  );

  // ยืนยันแล้ว → วันที่ / สถานที่ที่ HR ยืนยัน · ยังไม่ยืนยัน → ที่ผู้ขอต้องการ
  const whenCell = (r) => {
    if (r.status === "confirmed")
      return (
        <div className="leading-snug">
          <div className="whitespace-nowrap font-semibold">{fmtRange(r.confirmedStart, r.confirmedEnd) || "—"}</div>
          {r.confirmedProvider && <div className="text-[11px] text-gray-600">{r.confirmedProvider}</div>}
        </div>
      );
    const when = fmtRange(r.requestedStart, r.requestedEnd);
    if (!when && !r.provider) return <span className="text-gray-400">—</span>;
    return (
      <div className="leading-snug text-gray-600">
        <div className="whitespace-nowrap">{when ? `ขอ ${when}` : "—"}</div>
        {r.provider && <div className="text-[11px] text-gray-500">{r.provider}</div>}
      </div>
    );
  };

  const statusCell = (r) => {
    const [label, cls] = STATUS[r.status] || STATUS.pending;
    return (
      <div className="min-w-0">
        <span className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>
        {r.hrNote && <div className="mt-1 break-words text-[11px] text-gray-600">💬 {r.hrNote}</div>}
        {r.decidedByName && (
          <div className="text-[10px] text-gray-400">
            โดย {r.decidedByName}
            {r.decidedAt && ` · ${fmtDateTime(r.decidedAt)}`}
          </div>
        )}
      </div>
    );
  };

  const requestedByCell = (r) => (
    <div className="min-w-0">
      <div className="font-semibold">{r.requestedByName || "—"}</div>
      <div className="whitespace-nowrap text-[11px] text-gray-500">{fmtDateTime(r.createdAt)}</div>
      {r.remarks && (
        <div className="max-w-[200px] truncate text-[11px] text-gray-500" title={r.remarks}>
          📝 {r.remarks}
        </div>
      )}
    </div>
  );

  const actionsCell = (r) => (
    <div className="flex flex-nowrap items-center justify-end gap-2">
      {r.status === "pending" ? (
        <button
          type="button"
          onClick={() => setDecision({ rows: [r], decision: "confirmed" })}
          className={`${BTN} border-[#198754] bg-[#198754] text-white hover:bg-[#157347]`}
        >
          Confirm / reject
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setDecision({ rows: [r], decision: r.status })}
            className="cursor-pointer border-none bg-transparent p-0 text-xs font-semibold text-[#2B2F78] hover:underline"
          >
            แก้ไข
          </button>
          <button
            type="button"
            onClick={() => undo(r)}
            title="ย้อนกลับเป็นรอ HR"
            className="cursor-pointer border-none bg-transparent p-0 text-xs text-gray-500 hover:text-gray-800"
          >
            ↩
          </button>
        </>
      )}
      <Link
        to={detailPath(r.batchId)}
        onClick={() => markViewed(r.batchId)}
        onAuxClick={() => markViewed(r.batchId)}
        title="เปิดคำขอนี้ (ทุกคนในคำขอเดียวกัน)"
        className="whitespace-nowrap text-xs font-semibold text-blue-600 no-underline hover:underline"
      >
        คำขอ →
      </Link>
    </div>
  );

  const rowBg = (r) =>
    selected.includes(r.itemId)
      ? "bg-[#f0f7ff]"
      : lastViewed?.id === r.batchId
        ? "bg-[#f8fbff]"
        : "hover:bg-gray-50";

  const checkbox = (r) =>
    r.status === "pending" ? (
      <input
        type="checkbox"
        checked={selected.includes(r.itemId)}
        onChange={() => toggle(r.itemId)}
        className="h-[15px] w-[15px] cursor-pointer"
        aria-label={`เลือก ${r.fullName}`}
      />
    ) : (
      <span className="text-gray-300" title="ตัดสินแล้ว — แก้ไขได้ที่ Actions">
        —
      </span>
    );
  // คลิกที่แถว (คนที่รอ HR) = ติ๊ก
  const rowClick = (r) => (e) => r.status === "pending" && !isInteractive(e) && toggle(r.itemId);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1800px]">
      {/* ════════ หัวหน้า ════════ */}
      <div className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="m-0 text-lg font-bold">{isTraining ? "Training Bookings" : "Medical Bookings"}</h1>
          <div className="text-xs text-gray-500">
            {isTraining
              ? "คำขอจัดอบรมถึง HR รายคน — จากปุ่ม Request training, Training Courses, Assign Names และ Compliance"
              : "คำขอนัดตรวจสุขภาพถึง HR รายคน — จากปุ่ม Request medical, Assign Names และ Compliance"}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={exportCsv} className={TOOL_BTN}>
            ⬇ Export CSV
          </button>
          {isTraining && (
            <Link
              to="/certifications/bulk-add"
              className={TOOL_BTN}
              title="อบรมเสร็จแล้ว → บันทึก certification ให้ทั้งกลุ่มทีเดียว"
            >
              ✓ บันทึกผลอบรม (Bulk Add Certification)
            </Link>
          )}
          <button
            type="button"
            onClick={() => setRequestModalOpen(true)}
            className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border-none bg-[#2B2F78] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#22265f]"
          >
            {isTraining ? "🎓 Request training" : "🏥 Request medical"}
          </button>
        </div>
      </div>

      {/* ════════ ตัวกรอง ════════ */}
      <div className="border-y border-gray-200 py-3">
        <div
          className={`grid grid-cols-1 gap-2.5 sm:grid-cols-2 ${
            isTraining ? "lg:grid-cols-[2fr_1.4fr_1fr_1.5fr_1fr]" : "lg:grid-cols-[2fr_1.4fr_1fr_1fr]"
          }`}
        >
          <div className="min-w-0">
            <label className={FILTER_LABEL}>ค้นหา</label>
            <input
              type="text"
              placeholder={
                isTraining ? "ชื่อ / ID พนักงาน / ชื่อ training / ผู้ขอ..." : "ชื่อ / ID พนักงาน / ผู้ขอ / client..."
              }
              value={search}
              onChange={onFilter(setSearch)}
              className={FIELD}
            />
          </div>
          <div className="min-w-0">
            <label className={FILTER_LABEL}>สถานะ</label>
            <select value={statusFilter} onChange={onFilter(setStatusFilter)} className={FIELD}>
              {STATUS_FILTERS.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label className={FILTER_LABEL}>ผู้ขอ</label>
            <select value={requesterFilter} onChange={onFilter(setRequesterFilter)} className={FIELD}>
              <option value="">ทั้งหมด</option>
              {requesterOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          {isTraining && (
            <div className="min-w-0">
              <label className={FILTER_LABEL}>Training</label>
              <select value={subjectFilter} onChange={onFilter(setSubjectFilter)} className={FIELD}>
                <option value="">ทั้งหมด</option>
                {subjectOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="min-w-0">
            <label className={FILTER_LABEL}>Client</label>
            <select value={clientFilter} onChange={onFilter(setClientFilter)} className={FIELD}>
              <option value="">ทั้งหมด</option>
              {clientOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.4px] text-gray-500">วันที่ส่งคำขอ</span>
          {DATE_PRESETS.map(([key, label, days]) => (
            <button
              key={key}
              type="button"
              onClick={() => applyPreset(key, days)}
              className={`${CHIP} ${
                datePreset === key
                  ? "border-[#2B2F78] bg-[#2B2F78] font-bold text-white"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {label}
            </button>
          ))}
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
          {hasFilter && (
            <button
              type="button"
              onClick={resetFilters}
              className="ml-auto cursor-pointer border-none bg-transparent p-0 text-xs font-semibold text-[#dc3545] underline hover:text-[#a71d2a]"
            >
              ✕ ล้าง filter
            </button>
          )}
        </div>
      </div>

      {/* ════════ สรุป + เลือกหลายคน ════════ */}
      <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {SUMMARY_CHIPS.map(([key, label, cls]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setStatusFilter(statusFilter === key ? "open" : key);
                setPage(1);
              }}
              title={statusFilter === key ? "กดอีกครั้งเพื่อกลับไปค่าเริ่มต้น" : "กดเพื่อกรอง"}
              className={`cursor-pointer whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-semibold ${cls} ${
                statusFilter === key ? "ring-2 ring-[#2B2F78]/30" : ""
              }`}
            >
              {label} {countOf(key)}
            </button>
          ))}
          <span className="text-xs text-gray-500">
            · แสดง <strong className="text-gray-900">{filtered.length}</strong> คน
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* มือถือไม่มีหัวตาราง — ใช้ checkbox นี้แทน */}
          <label className="mr-1 flex cursor-pointer items-center gap-2 text-[13px] text-gray-700 lg:hidden">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              disabled={pendingInView.length === 0}
              className="h-[15px] w-[15px]"
            />
            เลือกทุกคนที่รอ HR ({pendingInView.length})
          </label>
          <span className="mr-1 hidden text-xs text-gray-600 lg:inline">
            {selectedRows.length > 0 ? (
              <>
                เลือกไว้ <strong className="text-gray-900">{selectedRows.length}</strong> คน
                <button
                  type="button"
                  onClick={() => setSelected([])}
                  className="ml-1.5 cursor-pointer border-none bg-transparent p-0 text-xs text-gray-500 underline hover:text-gray-800"
                >
                  ล้าง
                </button>
              </>
            ) : pendingInView.length > 0 ? (
              <>
                ติ๊ก ☐ หน้าชื่อ (หรือคลิกที่แถว) เพื่อยืนยัน / ปฏิเสธหลายคน — เฉพาะ <b>⏳ รอ HR</b>
              </>
            ) : null}
          </span>
          <button
            type="button"
            disabled={selectedRows.length === 0}
            onClick={() => setDecision({ rows: selectedRows, decision: "confirmed" })}
            className={`${BTN} border-[#198754] bg-[#198754] text-white hover:bg-[#157347]`}
          >
            ✓ Confirm selected ({selectedRows.length})
          </button>
          <button
            type="button"
            disabled={selectedRows.length === 0}
            onClick={() => setDecision({ rows: selectedRows, decision: "rejected" })}
            className={`${BTN} border-[#f5c6cb] bg-white text-[#dc3545] hover:bg-red-50`}
          >
            ✕ Reject selected
          </button>
        </div>
      </div>

      {/* ════════ รายการรายคน ════════ */}
      <div className="border-y border-gray-200">
        {/* ── ต่ำกว่า lg ── */}
        <div className="lg:hidden">
          {paged.length === 0 ? (
            <div className="p-10 text-center text-[13px] text-gray-500">{emptyText}</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {paged.map((r) => (
                <div
                  key={r.itemId}
                  onClick={rowClick(r)}
                  className={`flex gap-2.5 py-3 text-[13px] ${rowBg(r)} ${r.status === "pending" ? "cursor-pointer" : ""}`}
                >
                  <div className="w-[15px] shrink-0 pt-0.5">{checkbox(r)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      {workerCell(r)}
                      <div className="shrink-0">{statusCell(r)}</div>
                    </div>
                    <div className="mt-1.5 font-medium">{subjectCell(r)}</div>
                    <div className="mt-1 text-xs">
                      {whenCell(r)}
                      {r.clientName && <div className="text-[11px] text-gray-500">Client {r.clientName}</div>}
                    </div>
                    <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
                      <div className="text-[11px] text-gray-500">
                        ขอโดย {r.requestedByName || "—"} · {fmtDateTime(r.createdAt)}
                      </div>
                      {actionsCell(r)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── lg+: ตาราง ── */}
        {/* ตารางเลื่อนในกรอบตัวเอง → หัวคอลัมน์ตรึงไว้ด้านบนตอนเลื่อน */}
        <div
          ref={tableBoxRef}
          style={tableMaxH ? { maxHeight: tableMaxH } : undefined}
          className="hidden max-h-[calc(100vh-330px)] min-h-[300px] overflow-auto lg:block"
        >
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${TH} w-[170px] normal-case tracking-normal`}>
                  <label
                    className={`flex items-center gap-1.5 ${
                      pendingInView.length > 0 ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                    }`}
                    title="เลือกทุกคนที่รอ HR ตาม filter (ทุกหน้า)"
                  >
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      disabled={pendingInView.length === 0}
                      className="h-[15px] w-[15px] cursor-pointer"
                    />
                    เลือกทั้งหมดที่รอ ({pendingInView.length})
                  </label>
                </th>
                <th className={TH}>Worker</th>
                <th className={TH}>{isTraining ? "Course" : "Check Type"}</th>
                <th className={TH}>วันที่ / สถานที่</th>
                <th className={TH}>Client</th>
                <th className={TH}>Status</th>
                <th className={TH}>Requested By</th>
                <th className={`${TH} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-10 text-center text-[13px] text-gray-500">
                    {emptyText}
                  </td>
                </tr>
              ) : (
                paged.map((r) => (
                  <tr
                    key={r.itemId}
                    onClick={rowClick(r)}
                    className={`${rowBg(r)} ${r.status === "pending" ? "cursor-pointer" : ""}`}
                  >
                    <td className={`${TD} text-center`}>{checkbox(r)}</td>
                    <td className={`${TD} min-w-[190px]`}>{workerCell(r)}</td>
                    <td className={`${TD} min-w-[180px] max-w-[300px]`}>{subjectCell(r)}</td>
                    <td className={TD}>{whenCell(r)}</td>
                    <td className={`${TD} text-gray-600`}>{r.clientName || "—"}</td>
                    <td className={`${TD} min-w-[130px] max-w-[220px]`}>{statusCell(r)}</td>
                    <td className={TD}>{requestedByCell(r)}</td>
                    <td className={TD}>{actionsCell(r)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ════════ Pagination ════════ */}
        {totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-gray-200 py-3 text-xs text-gray-500">
            <span>
              หน้า {currentPage} / {totalPages} — ทั้งหมด {filtered.length} คน
            </span>
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => setPage(Math.max(1, currentPage - 1))}
                disabled={currentPage <= 1}
                className={`${PAGE_BTN} border-gray-200 bg-white text-gray-700`}
              >
                ←<span className="hidden sm:inline"> ก่อนหน้า</span>
              </button>
              {getPageNumbers(currentPage, totalPages).map((p, idx) =>
                p === "..." ? (
                  <span key={`dots-${idx}`} className="px-1 text-gray-400">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    className={`${PAGE_BTN} ${
                      p === currentPage
                        ? "border-[#2B2F78] bg-[#2B2F78] font-bold text-white"
                        : "border-gray-200 bg-white font-medium text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                type="button"
                onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage >= totalPages}
                className={`${PAGE_BTN} border-gray-200 bg-white text-gray-700`}
              >
                <span className="hidden sm:inline">ถัดไป </span>→
              </button>
            </div>
          </div>
        )}
      </div>

      {decision && (
        <DecisionModal
          isTraining={isTraining}
          rows={decision.rows}
          initialDecision={decision.decision}
          saving={saving}
          onClose={() => setDecision(null)}
          onSave={(body) => save(decision.rows, body)}
        />
      )}

      {requestModalOpen && (
        <RequestBookingModal
          type={requestType}
          onClose={() => setRequestModalOpen(false)}
          onSent={(n) => {
            setRequestModalOpen(false);
            setStatusFilter("open");
            load();
            alert(`ส่งคำขอถึง HR แล้ว (${n} คน)`);
          }}
        />
      )}
    </div>
  );
}
