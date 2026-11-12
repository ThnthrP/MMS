import { useState, useEffect, useContext, useMemo } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import Select from "react-select";
import { AppContent } from "../../context/AppContext";
import RequestBookingModal from "./RequestBookingModal";
import SelectedPeoplePanel from "../../components/SelectedPeoplePanel";
import { buildWorkerOptions, filterWorkerOption, nameEN, nameTH } from "../../utils/workerSearch";
import {
  MAIN_CHECK,
  CONFINED_SPACE,
  MEDICAL_BUCKETS,
  MEDICAL_RESULT_LABEL,
  daysUntil,
  daysNote,
  findCheck,
  medicalBucket,
  medKey,
  requestReason,
  healthRiskDisplay,
} from "../../utils/medicalStatus";

// ══════════════════════════════════════════════════════════
// Request Medical (/request-medical) — เมนู Bookings & Requests › แท็บ Request Medical
// คู่กับแท็บ Request Training: เลือกประเภทการตรวจ → ดูว่าใครหมด / ใกล้หมด / ยังไม่มีผลตรวจ
//   → ติ๊กหลายคน → "แจ้ง HR ให้นัดตรวจ" (ฟอร์มเดียวกับปุ่ม Request medical — ใส่วันที่ / โรงพยาบาลต่อได้)
// ข้อมูล = ชุดเดียวกับคอลัมน์ MEDICAL หน้า Compliance (GET /api/compliance/dashboard)
// คนที่มีคำขอรอ HR อยู่แล้ว (pending-keys) → ✓ แจ้งแล้ว และเลือกซ้ำไม่ได้
// ══════════════════════════════════════════════════════════

const STAT_ORDER = ["unfit", "overdue", "critical", "due_soon", "upcoming", "valid", "no_record"];
const STAT_HINT = {
  unfit: "ผลตรวจไม่ผ่าน",
  overdue: "หมดอายุแล้ว",
  critical: "< 30 วัน",
  due_soon: "30–90 วัน",
  upcoming: "90–120 วัน",
  valid: "> 120 วัน",
  no_record: "ยังไม่มีผลตรวจ",
};
const TONE = {
  red: "bg-[#f8d7da] text-[#842029]",
  darkRed: "bg-[#f5c2c7] text-[#58151c]",
  yellow: "bg-[#fff3cd] text-[#664d03]",
  indigo: "bg-[#eef2ff] text-[#4f46e5]",
  green: "bg-[#d1e7dd] text-[#0f5132]",
  gray: "bg-gray-100 text-gray-500",
  grayDark: "bg-gray-100 text-gray-700",
};
const STAT_TEXT = {
  red: "text-[#dc3545]",
  yellow: "text-[#cc8400]",
  indigo: "text-[#4f46e5]",
  green: "text-[#198754]",
  gray: "text-gray-500",
};

const FILTER_LABEL = "mb-1 block text-[11px] font-semibold text-gray-500";
const FIELD =
  "box-border h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-[13px] outline-none focus:border-blue-400";
const CHECKBOX = "h-[15px] w-[15px] cursor-pointer disabled:cursor-not-allowed";
const STICKY_TH =
  "sticky top-0 z-[1] whitespace-nowrap bg-gray-50 px-3.5 py-2.5 text-left text-[11px] font-semibold text-gray-500 shadow-[inset_0_-1px_0_#e5e7eb]";
const isInteractive = (e) => !!e.target.closest("a,button,input,select,label");

// ความสูงสูงสุดของ "ตารางรายชื่อ" และ "แผงที่เลือกไว้" ด้านขวา — ค่าเดียวกัน จึงยาวเท่ากันเสมอ
//   (เดิมตารางวัดความสูงตอนโหลดหน้า ซึ่งตารางยังอยู่ต่ำ → ได้แค่ 320px สั้นกว่าแผงมาก)
const LIST_MAX_H = "calc(100vh - 250px)";

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

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : null);
const expiryCls = (days) =>
  days === null
    ? "text-gray-500"
    : days < 30
      ? "font-semibold text-[#dc3545]"
      : days <= 90
        ? "font-semibold text-[#cc8400]"
        : "text-gray-500";
const clientNameOf = (w) => {
  const key = Object.keys(w?.clients || {})[0];
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : null;
};

function Badge({ tone, children }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-md px-2 py-[3px] text-[11px] font-semibold ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export default function RequestMedical() {
  const { backendUrl } = useContext(AppContent);

  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [pendingKeys, setPendingKeys] = useState(() => new Set());

  const [checkType, setCheckType] = useState(MAIN_CHECK);
  const [workerFilter, setWorkerFilter] = useState("");
  const [positionFilter, setPositionFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [hideRequested, setHideRequested] = useState(false);

  const [selectedIds, setSelectedIds] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    axios
      .get(`${backendUrl}/api/compliance/dashboard`, { withCredentials: true })
      .then((res) => {
        setWorkers(Array.isArray(res.data) ? res.data : []);
        setLoadError("");
      })
      .catch((err) => {
        console.error(err);
        setLoadError(err.response?.data?.message || "โหลดข้อมูลไม่สำเร็จ");
      })
      .finally(() => setLoading(false));
    axios
      .get(`${backendUrl}/api/medical-requests/pending-keys`, { withCredentials: true })
      .then((res) => Array.isArray(res.data) && setPendingKeys(new Set(res.data)))
      .catch(() => {}); // ไม่ critical — แค่ไม่แสดง ✓ แจ้งแล้ว
  }, [backendUrl]);

  // ประเภทการตรวจที่มีในระบบ (Medical Check up ขึ้นก่อนเสมอ)
  const checkTypes = useMemo(() => {
    const set = new Set([MAIN_CHECK, CONFINED_SPACE]);
    workers.forEach((w) => (w.medicalChecks || []).forEach((m) => m.checkType && set.add(m.checkType)));
    const rest = [...set].filter((t) => t !== MAIN_CHECK).sort((a, b) => a.localeCompare(b));
    return [MAIN_CHECK, ...rest];
  }, [workers]);

  // 1 แถว = 1 คน ของประเภทการตรวจที่เลือก
  const rows = useMemo(
    () =>
      workers
        .map((w) => {
          const record = findCheck(w.medicalChecks, checkType);
          const bucket = medicalBucket(record);
          return {
            w,
            record,
            bucket,
            days: daysUntil(record?.expiryDate),
            requested: pendingKeys.has(medKey(w.id, checkType)),
          };
        })
        // ด่วนสุดขึ้นก่อน → ใกล้หมดก่อน
        .sort(
          (a, b) =>
            MEDICAL_BUCKETS[b.bucket].rank - MEDICAL_BUCKETS[a.bucket].rank ||
            (a.days ?? 99999) - (b.days ?? 99999),
        ),
    [workers, checkType, pendingKeys],
  );
  const hasHealthRisk = workers.some((w) => "healthRisk" in w || "latestExamNote" in w);

  const counts = useMemo(() => {
    const c = Object.fromEntries(STAT_ORDER.map((k) => [k, 0]));
    rows.forEach((r) => c[r.bucket]++);
    return c;
  }, [rows]);

  const filtered = rows.filter(({ w, bucket, requested }) => {
    if (workerFilter && w.id !== workerFilter) return false;
    if (positionFilter && w.position?.name !== positionFilter) return false;
    if (departmentFilter && (w.department || "") !== departmentFilter) return false;
    if (statusFilter !== "all" && bucket !== statusFilter) return false;
    if (hideRequested && requested) return false;
    return true;
  });

  const hasFilter = workerFilter || positionFilter || departmentFilter || statusFilter !== "all" || hideRequested;
  const clearFilters = () => {
    setWorkerFilter("");
    setPositionFilter("");
    setDepartmentFilter("");
    setStatusFilter("all");
    setHideRequested(false);
  };

  const uniqSorted = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const workerOptions = useMemo(() => buildWorkerOptions(workers), [workers]);
  const positionOptions = uniqSorted(workers.map((w) => w.position?.name)).map((p) => ({ value: p, label: p }));
  const departmentOptions = uniqSorted(workers.map((w) => w.department)).map((d) => ({ value: d, label: d }));

  // ── เลือกคน (คนที่มีคำขอรออยู่แล้วเลือกไม่ได้) ──
  // เปลี่ยนประเภทการตรวจ = ล้างที่เลือก (คำขอผูกกับประเภทการตรวจ)
  const changeCheckType = (t) => {
    setCheckType(t);
    setSelectedIds([]);
  };
  const toggle = (id) => setSelectedIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const selectable = filtered.filter((r) => !r.requested);
  const allSelected = selectable.length > 0 && selectable.every((r) => selectedIds.includes(r.w.id));
  const toggleAll = () => {
    const ids = selectable.map((r) => r.w.id);
    if (allSelected) {
      const s = new Set(ids);
      setSelectedIds((p) => p.filter((x) => !s.has(x)));
    } else setSelectedIds((p) => [...new Set([...p, ...ids])]);
  };

  const rowById = new Map(rows.map((r) => [r.w.id, r]));
  const filteredIds = new Set(filtered.map((r) => r.w.id));
  const selectedItems = selectedIds.map((id) => {
    const r = rowById.get(id);
    return {
      id,
      name: r ? nameEN(r.w) : id,
      sub: r ? [r.w.empId || r.w.empCode, r.w.position?.name].filter(Boolean).join(" · ") : "",
      badge: r ? <Badge tone={MEDICAL_BUCKETS[r.bucket].tone}>{MEDICAL_BUCKETS[r.bucket].label}</Badge> : null,
      hidden: !filteredIds.has(id),
    };
  });

  // เหตุผล + client ต่อคน → แนบไปกับคำขอ (หน้า Medical Bookings แสดงเป็น ❌ หมดอายุ / ⏰ ใกล้หมดอายุ / ⚪ ไม่มีข้อมูล)
  const reasonById = Object.fromEntries(selectedIds.map((id) => [id, requestReason(rowById.get(id)?.bucket)]));
  const clientById = Object.fromEntries(selectedIds.map((id) => [id, clientNameOf(rowById.get(id)?.w)]));

  const rowBg = (r) =>
    r.requested ? "bg-gray-50" : selectedIds.includes(r.w.id) ? "bg-[#fffbe6]" : "bg-white";

  // ── cells (ใช้ทั้งตารางและการ์ดมือถือ) ──
  const workerCell = ({ w }) => (
    <div className="min-w-0">
      <Link to={`/workers/${w.id}`} className="font-semibold text-gray-900 no-underline hover:text-blue-600 hover:underline">
        {nameEN(w)}
      </Link>
      {nameTH(w) && <div className="text-xs text-gray-600">{nameTH(w)}</div>}
      <div className="text-[11px] text-gray-500">{w.empId || w.empCode || "—"}</div>
    </div>
  );

  const statusCell = ({ bucket, record }) => {
    const b = MEDICAL_BUCKETS[bucket];
    const result = bucket !== "unfit" && MEDICAL_RESULT_LABEL[record?.status];
    return (
      <div className="flex flex-col items-start gap-0.5">
        <Badge tone={b.tone}>{b.label}</Badge>
        {result && <span className="text-[11px] font-semibold text-gray-700">{result}</span>}
      </div>
    );
  };

  const lastExamCell = ({ record }) =>
    record?.issuedDate || record?.hospital ? (
      <div className="leading-snug">
        <div className="whitespace-nowrap">{fmtDate(record.issuedDate) || "—"}</div>
        {record.hospital && <div className="text-[11px] text-gray-500">{record.hospital}</div>}
      </div>
    ) : (
      <span className="text-gray-400">—</span>
    );

  const expiryCell = ({ record, days }) =>
    record?.expiryDate ? (
      <div className={`leading-snug ${expiryCls(days)}`}>
        <div className="whitespace-nowrap">{fmtDate(record.expiryDate)}</div>
        {daysNote(days) && <div className="text-[11px]">{daysNote(days)}</div>}
      </div>
    ) : (
      <span className="text-gray-400">—</span>
    );

  const healthCell = ({ w }) => {
    const h = w.healthRisk ? healthRiskDisplay(w.healthRisk) : null;
    const note = w.latestExamNote || w.healthNote;
    if (!h && !note) return <span className="text-gray-400">—</span>;
    return (
      <div className="flex max-w-[140px] flex-col items-start gap-0.5">
        {h && <Badge tone={h.tone}>{h.label}</Badge>}
        {note && (
          <span className="max-w-[140px] truncate text-[10px] text-gray-500" title={note}>
            📄 {note}
          </span>
        )}
      </div>
    );
  };

  const requestCell = (r) =>
    r.requested ? (
      <Link
        to="/medical-bookings"
        title="มีคำขอรอ HR นัดตรวจอยู่แล้ว — ดูที่แท็บ Medical Bookings"
        className="inline-block whitespace-nowrap rounded-md bg-[#d1e7dd] px-2 py-0.5 text-[11px] font-semibold text-[#0f5132] no-underline hover:underline"
      >
        ✓ แจ้งแล้ว
      </Link>
    ) : (
      <span className="text-gray-300">—</span>
    );

  const checkboxFor = (r) =>
    r.requested ? (
      <span className="text-gray-300" title="มีคำขอรอ HR อยู่แล้ว">
        —
      </span>
    ) : (
      <input
        type="checkbox"
        aria-label={`เลือก ${nameEN(r.w)}`}
        checked={selectedIds.includes(r.w.id)}
        onChange={() => toggle(r.w.id)}
        className={CHECKBOX}
      />
    );

  const headers = [
    "WORKER",
    "POSITION",
    "STATUS",
    "ตรวจล่าสุด",
    "หมดอายุ",
    ...(hasHealthRisk ? ["HEALTH RISK"] : []),
    "คำขอ",
  ];
  const requestedCount = rows.filter((r) => r.requested).length;

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1800px]">
      {/* ════════ Header ════════ */}
      <div className="pb-3">
        <h1 className="m-0 text-lg font-bold">Request Medical</h1>
        <div className="text-xs text-gray-500">
          เลือกประเภทการตรวจ เพื่อดูว่าใครหมด / ใกล้หมด / ยังไม่มีผลตรวจ — ติ๊กพนักงานแล้วกด "แจ้ง HR ให้นัดตรวจ" ·
          ติดตามคำขอที่แท็บ Medical Bookings · บันทึกผลตรวจที่หน้าแก้ไขพนักงาน › PE / Medical Exam
        </div>
      </div>

      {/* ════════ ประเภทการตรวจ + ตัวกรอง ════════ */}
      <div className="mb-4 space-y-3 border-y border-gray-200 py-3">
        <div>
          <label className={FILTER_LABEL}>ประเภทการตรวจ</label>
          <div className="flex flex-wrap gap-1.5">
            {checkTypes.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => changeCheckType(t)}
                className={`cursor-pointer whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold ${
                  checkType === t
                    ? "border-[#2B2F78] bg-[#2B2F78] text-white"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <label className={FILTER_LABEL}>
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
              noOptionsMessage={() => "ไม่พบ worker"}
            />
          </div>
          <div className="min-w-0">
            <label className={FILTER_LABEL}>ตำแหน่ง</label>
            <Select
              options={positionOptions}
              value={positionOptions.find((o) => o.value === positionFilter) || null}
              onChange={(o) => setPositionFilter(o ? o.value : "")}
              placeholder="ทุกตำแหน่ง"
              isClearable
              styles={SELECT_STYLES}
              {...MENU_PORTAL}
              noOptionsMessage={() => "ไม่พบตำแหน่ง"}
            />
          </div>
          <div className="min-w-0">
            <label className={FILTER_LABEL}>แผนก</label>
            <Select
              options={departmentOptions}
              value={departmentOptions.find((o) => o.value === departmentFilter) || null}
              onChange={(o) => setDepartmentFilter(o ? o.value : "")}
              placeholder="ทุกแผนก"
              isClearable
              styles={SELECT_STYLES}
              {...MENU_PORTAL}
              noOptionsMessage={() => "ไม่พบแผนก"}
            />
          </div>
          <div className="min-w-0">
            <label className={`${FILTER_LABEL} flex items-center justify-between`}>
              <span>สถานะ</span>
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
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={FIELD}>
              <option value="all">ทุกสถานะ</option>
              {STAT_ORDER.map((k) => (
                <option key={k} value={k}>
                  {MEDICAL_BUCKETS[k].label} ({STAT_HINT[k]})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="border-t border-gray-200 p-10 text-center text-gray-500">Loading...</div>
      ) : loadError ? (
        <div className="border-t border-gray-200 p-10 text-center text-red-600">{loadError}</div>
      ) : (
        <>
          {/* ════════ ตัวเลข — คลิกเพื่อกรอง ════════ */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
            {STAT_ORDER.map((k) => {
              const b = MEDICAL_BUCKETS[k];
              const active = statusFilter === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setStatusFilter(active ? "all" : k)}
                  title={active ? "กดอีกครั้งเพื่อยกเลิกการกรอง" : "กดเพื่อกรอง"}
                  className={`cursor-pointer rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-left transition-shadow hover:shadow-md ${
                    active ? "ring-2 ring-[#2B2F78]/40" : ""
                  }`}
                >
                  <div className={`text-xl font-bold ${STAT_TEXT[b.tone]}`}>{counts[k]}</div>
                  <div className="text-xs text-gray-600">{b.label}</div>
                  <div className="text-[10px] text-gray-400">{STAT_HINT[k]}</div>
                </button>
              );
            })}
          </div>

          {/* ════════ แถบส่งคำขอ ════════ */}
          <div
            className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2.5 ${
              selectedIds.length > 0 ? "border-[#b6d4fe] bg-[#e7f1ff]" : "border-gray-200 bg-gray-50"
            }`}
          >
            {selectedIds.length > 0 ? (
              <span className="text-[13px] text-[#084298]">
                เลือกไว้ <strong>{selectedIds.length}</strong> คน สำหรับ <strong>{checkType}</strong>
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="ml-2 cursor-pointer border-none bg-transparent p-0 text-xs text-[#084298] underline"
                >
                  ล้างที่เลือก
                </button>
              </span>
            ) : (
              <span className="text-[13px] text-gray-600">
                ติ๊ก ☐ หน้าชื่อ (หรือคลิกที่แถว) แล้วกด <strong>แจ้ง HR ให้นัดตรวจ</strong> · คนที่ขึ้น{" "}
                <span className="font-semibold text-[#0f5132]">✓ แจ้งแล้ว</span> มีคำขอรอ HR อยู่ ({requestedCount} คน)
              </span>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={hideRequested}
                  onChange={(e) => setHideRequested(e.target.checked)}
                  className={CHECKBOX}
                />
                ซ่อนคนที่แจ้งแล้ว
              </label>
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                disabled={selectedIds.length === 0}
                className="cursor-pointer rounded-lg border-none bg-[#2B2F78] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#22265f] disabled:cursor-not-allowed disabled:opacity-40"
              >
                📨 แจ้ง HR ให้นัดตรวจ{selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
              </button>
            </div>
          </div>

          <SelectedPeoplePanel
            variant="bar"
            items={selectedItems}
            onRemove={toggle}
            onClear={() => setSelectedIds([])}
          />

          {/* ════════ รายชื่อ (ซ้าย) + ที่เลือกไว้ (ขวา, xl+) ════════ */}
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 border-t border-gray-200">
              {/* ── ต่ำกว่า lg: การ์ด ── */}
              <div className="lg:hidden">
                <div className="flex items-center justify-between gap-2 border-b border-gray-200 py-2.5 text-[13px]">
                  <label className="flex cursor-pointer items-center gap-2 text-gray-700">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      disabled={selectable.length === 0}
                      className={CHECKBOX}
                    />
                    เลือกทั้งหมด ({selectable.length})
                  </label>
                  <span className="text-xs text-gray-500">{filtered.length} คน</span>
                </div>
                {filtered.length === 0 ? (
                  <div className="p-10 text-center text-[13px] text-gray-500">ไม่พบพนักงานตามเงื่อนไขที่เลือก</div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {filtered.map((r) => (
                      <div
                        key={r.w.id}
                        onClick={(e) => !r.requested && !isInteractive(e) && toggle(r.w.id)}
                        className={`flex gap-3 py-3 text-[13px] ${rowBg(r)} ${r.requested ? "" : "cursor-pointer"}`}
                      >
                        <div className="w-[15px] shrink-0 pt-0.5">{checkboxFor(r)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            {workerCell(r)}
                            {statusCell(r)}
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {r.w.position?.name || "—"}
                            {r.w.department && <span className="text-gray-400"> · {r.w.department}</span>}
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-start gap-x-4 gap-y-1 text-xs">
                            <span className="text-gray-500">ตรวจล่าสุด {lastExamCell(r)}</span>
                            <span className="text-gray-500">หมดอายุ {expiryCell(r)}</span>
                            {hasHealthRisk && <span>{healthCell(r)}</span>}
                            {requestCell(r)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── lg+: ตาราง (หัวคอลัมน์ตรึงไว้) ── */}
              <div style={{ maxHeight: LIST_MAX_H }} className="hidden overflow-auto lg:block">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th className={`${STICKY_TH} w-[120px]`}>
                        <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-gray-600">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={toggleAll}
                            disabled={selectable.length === 0}
                            className={CHECKBOX}
                          />
                          เลือกทั้งหมด
                        </label>
                      </th>
                      {headers.map((h) => (
                        <th key={h} className={STICKY_TH}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={headers.length + 1} className="p-10 text-center text-gray-500">
                          ไม่พบพนักงานตามเงื่อนไขที่เลือก
                        </td>
                      </tr>
                    ) : (
                      filtered.map((r) => (
                        <tr
                          key={r.w.id}
                          onClick={(e) => !r.requested && !isInteractive(e) && toggle(r.w.id)}
                          className={`border-b border-gray-100 ${rowBg(r)} ${
                            r.requested ? "" : "cursor-pointer hover:bg-gray-50"
                          }`}
                        >
                          <td className="px-3.5 py-3 text-center">{checkboxFor(r)}</td>
                          <td className="px-3.5 py-3">{workerCell(r)}</td>
                          <td className="px-3.5 py-3 text-gray-500">
                            <div>{r.w.position?.name || "—"}</div>
                            {r.w.department && <div className="mt-0.5 text-[11px] text-gray-400">{r.w.department}</div>}
                          </td>
                          <td className="px-3.5 py-3">{statusCell(r)}</td>
                          <td className="px-3.5 py-3 text-gray-600">{lastExamCell(r)}</td>
                          <td className="px-3.5 py-3">{expiryCell(r)}</td>
                          {hasHealthRisk && <td className="px-3.5 py-3">{healthCell(r)}</td>}
                          <td className="px-3.5 py-3">{requestCell(r)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <SelectedPeoplePanel
              items={selectedItems}
              onRemove={toggle}
              onClear={() => setSelectedIds([])}
              maxHeight={LIST_MAX_H}
            />
          </div>
        </>
      )}

      {modalOpen && (
        <RequestBookingModal
          type="medical"
          initialEmployeeIds={selectedIds}
          initialCheckType={checkType}
          checkTypeOptions={checkTypes}
          initialReasons={reasonById}
          initialClients={clientById}
          pendingKeys={pendingKeys}
          onClose={() => setModalOpen(false)}
          onSent={(n, sentCheckType, sentIds) => {
            setModalOpen(false);
            // ขึ้น ✓ แจ้งแล้ว ทันที ไม่ต้องโหลดใหม่
            setPendingKeys((prev) => {
              const next = new Set(prev);
              (sentIds || selectedIds).forEach((id) => next.add(medKey(id, sentCheckType || checkType)));
              return next;
            });
            setSelectedIds([]);
            alert(`แจ้ง HR ให้นัดตรวจ ${n} คนแล้ว — ดูสถานะที่แท็บ Medical Bookings`);
          }}
        />
      )}
    </div>
  );
}
