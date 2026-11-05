import { useState, useEffect, useContext, useCallback, useRef } from "react";
import axios from "axios";
import Select from "react-select";
import { AppContent } from "../../context/AppContext";
import { useSearchParams, useNavigate } from "react-router-dom";
import RequestBookingModal from "./RequestBookingModal";
import SelectedPeoplePanel from "../../components/SelectedPeoplePanel";
import { nameEN, nameTH } from "../../utils/workerSearch";

// ══════════════════════════════════════════════════════════
// constants
// ══════════════════════════════════════════════════════════
// ไม่ห่อเป็น card แล้ว — ใช้เส้นแบ่ง (พื้นเนื้อหาสีขาว)
const STAT_TILE = "rounded-lg border border-gray-200 bg-white";
const FILTER_LABEL = "mb-1 block text-[11px] font-semibold text-gray-500";
const FILTER_FIELD =
  "box-border h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-[13px] outline-none focus:border-blue-400";
const CHECKBOX = "h-[15px] w-[15px] cursor-pointer";
// หัวตารางตรึงไว้ตอนเลื่อน (ต้องอยู่ในกรอบที่มี overflow-auto + max-h)
const STICKY_TH =
  "sticky top-0 z-[1] bg-gray-50 px-3.5 py-2.5 shadow-[inset_0_-1px_0_#e5e7eb]";
// คลิกที่แถวเพื่อติ๊ก — ยกเว้นคลิกโดนลิงก์ / ปุ่ม / checkbox เอง
const isInteractive = (e) => !!e.target.closest("a,button,input,select,label");

const BUCKET_BADGE = {
  expired: ["bg-[#f8d7da] text-[#842029]", "🔴 Expired"],
  critical: ["bg-[#f8d7da] text-[#842029]", "🔥 Critical"],
  warning: ["bg-[#fff3cd] text-[#664d03]", "🟡 Warning"],
  upcoming: ["bg-[#eef2ff] text-[#4f46e5]", "🔵 Upcoming"],
  valid: ["bg-[#d1e7dd] text-[#0f5132]", "✅ Valid"],
  missing: ["bg-gray-200 text-gray-700", "— Missing"],
};

const STAT_CARDS = [
  {
    key: "expired",
    icon: "🔴",
    label: "Expired",
    text: "text-[#dc3545]",
    ring: "ring-[#dc3545]",
  },
  {
    key: "critical",
    icon: "🔥",
    label: "Critical (<30 days)",
    text: "text-[#cc8400]",
    ring: "ring-[#cc8400]",
  },
  {
    key: "warning",
    icon: "🟡",
    label: "Warning (30-90 days)",
    text: "text-[#0aa2c0]",
    ring: "ring-[#0aa2c0]",
  },
  {
    key: "upcoming",
    icon: "🔵",
    label: "Upcoming (90-120 days)",
    text: "text-[#4f46e5]",
    ring: "ring-[#4f46e5]",
  },
  {
    key: "valid",
    icon: "✅",
    label: "Valid",
    text: "text-[#198754]",
    ring: "ring-[#198754]",
  },
  {
    key: "missing",
    icon: "⚪",
    label: "Missing (ยังไม่มี cert)",
    text: "text-gray-500",
    ring: "ring-gray-500",
  },
];

const TABLE_HEADERS = [
  "WORKER",
  "POSITION",
  "STATUS",
  "ISSUED DATE",
  "EXPIRY DATE",
];

// react-select ใช้ styles API ของไลบรารี
const customSelectStyles = {
  control: (base) => ({
    ...base,
    minHeight: "36px",
    fontSize: "13px",
    borderColor: "#dee2e6",
    boxShadow: "none",
    "&:hover": { borderColor: "#86b7fe" },
  }),
  option: (base) => ({ ...base, fontSize: "13px" }),
  singleValue: (base) => ({ ...base, fontSize: "13px" }),
  placeholder: (base) => ({ ...base, fontSize: "13px", color: "#6c757d" }),
};

// ══════════════════════════════════════════════════════════
// small components
// ══════════════════════════════════════════════════════════
function BucketBadge({ bucket }) {
  const entry = BUCKET_BADGE[bucket];
  if (!entry) return <span>—</span>;
  const [cls, label] = entry;
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-md px-2 py-[3px] text-[11px] font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}

function CertDate({ hasRecord, value, emptyLabel }) {
  if (!hasRecord) return <span className="text-gray-400">N/A</span>;
  if (value) return new Date(value).toLocaleDateString();
  return emptyLabel;
}

// ══════════════════════════════════════════════════════════
// main
// ══════════════════════════════════════════════════════════
export default function Certifications() {
  const { backendUrl } = useContext(AppContent);
  const [searchParams] = useSearchParams();

  const navigate = useNavigate();

  // ไปหน้าบันทึกผลอบรม โดยเลือกหลักสูตร + พนักงานที่ติ๊กไว้ให้แล้ว
  const goBulkAdd = () => {
    const qs = new URLSearchParams({
      trainingId: selectedTraining.value,
      empIds: selectedEmployeeIds.join(","),
    });
    navigate(`/certifications/bulk-add?${qs}`);
  };

  // สิทธิ์ถูกคุมที่ AppRouter แล้ว
  const canRequestTraining = true;

  const [trainingOptions, setTrainingOptions] = useState([]);
  const [selectedTraining, setSelectedTraining] = useState(null);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState(""); // ชื่อไทย / อังกฤษ / รหัส
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [positionFilter, setPositionFilter] = useState("");

  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState([]);
  const [requestOpen, setRequestOpen] = useState(false); // การ์ด Request training

  // คนที่ถูกระบุมาจากลิงก์คำขอ Training (?empIds=...)
  const [highlightedIds, setHighlightedIds] = useState([]);
  const hasScrolledRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${backendUrl}/api/global-trainings`, {
          withCredentials: true,
        });
        setTrainingOptions(
          (res.data || []).map((t) => ({
            value: t.id,
            label: `${t.name} (${t._count?.employeeTrainings ?? 0})`,
          })),
        );
      } catch (err) {
        console.error(err);
      }
    })();
  }, [backendUrl]);

  const loadCertification = useCallback(
    async (trainingId) => {
      if (!trainingId) return;
      try {
        setLoading(true);
        const res = await axios.get(
          `${backendUrl}/api/compliance/certification/${trainingId}`,
          { withCredentials: true },
        );
        setData(res.data);
      } catch (err) {
        console.error(err);
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [backendUrl],
  );

  // เปลี่ยน training → โหลดใหม่ + reset selection/filter
  useEffect(() => {
    if (selectedTraining) loadCertification(selectedTraining.value);
    else setData(null);
    setSelectedEmployeeIds([]);
    setSearch("");
    setDepartmentFilter("");
    setPositionFilter("");
  }, [selectedTraining, loadCertification]);

  // อ่าน ?trainingId=...&empIds=... จาก URL
  useEffect(() => {
    const trainingId = searchParams.get("trainingId");
    const empIds = searchParams.get("empIds");
    if (trainingId && trainingOptions.length > 0 && !selectedTraining) {
      const match = trainingOptions.find((o) => o.value === trainingId);
      if (match) setSelectedTraining(match);
    }
    if (empIds) setHighlightedIds(empIds.split(","));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainingOptions, searchParams]);

  const q = search.trim().toLowerCase();
  const filteredWorkers = (data?.workers || []).filter((w) => {
    // String() — รหัสบางคนเป็นตัวเลข
    const matchSearch =
      !q ||
      [nameEN(w), nameTH(w), w.fullName, w.empId, w.empCode].some((v) =>
        String(v || "")
          .toLowerCase()
          .includes(q),
      );
    const matchDept = !departmentFilter || w.department === departmentFilter;
    const matchPosition = !positionFilter || w.position === positionFilter;
    const matchStatus = statusFilter === "all" || w.bucket === statusFilter;
    return matchSearch && matchDept && matchPosition && matchStatus;
  });

  // เลื่อนไปแถวที่ highlight — ครั้งเดียวหลังโหลดข้อมูลเสร็จ
  // (เดิมเลื่อนทุกครั้งที่ render เช่นติ๊ก checkbox แล้วหน้าเด้งกลับไปแถวแรก)
  useEffect(() => {
    if (hasScrolledRef.current || highlightedIds.length === 0 || !data) return;
    // การ์ด (มือถือ) และตาราง (lg+) render คู่กัน แต่ซ่อนอันหนึ่งด้วย CSS
    // จึงเลือกเฉพาะตัวที่มองเห็นอยู่ (offsetParent !== null)
    const el = [
      ...document.querySelectorAll(`[data-worker-row="${highlightedIds[0]}"]`),
    ].find((node) => node.offsetParent !== null);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      hasScrolledRef.current = true;
    }
  }, [highlightedIds, data]);

  const toggleEmployee = (employeeId) =>
    setSelectedEmployeeIds((prev) =>
      prev.includes(employeeId)
        ? prev.filter((id) => id !== employeeId)
        : [...prev, employeeId],
    );

  const allFilteredSelected =
    filteredWorkers.length > 0 &&
    filteredWorkers.every((w) => selectedEmployeeIds.includes(w.employeeId));

  const toggleAllFiltered = () => {
    const ids = filteredWorkers.map((w) => w.employeeId);
    if (allFilteredSelected) {
      const idSet = new Set(ids);
      setSelectedEmployeeIds((prev) => prev.filter((id) => !idSet.has(id)));
    } else {
      setSelectedEmployeeIds((prev) => [...new Set([...prev, ...ids])]);
    }
  };

  const clearFilters = () => {
    setSearch("");
    setDepartmentFilter("");
    setPositionFilter("");
    setStatusFilter("all");
  };
  const hasFilter =
    search || departmentFilter || positionFilter || statusFilter !== "all";

  const uniqSorted = (arr) =>
    [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const departments = uniqSorted((data?.workers || []).map((w) => w.department));
  const positions = uniqSorted((data?.workers || []).map((w) => w.position));

  // รายชื่อที่เลือกไว้ (แผงด้านขวา) — ไม่หายตอนค้นหา/กรอง
  const filteredIdSet = new Set(filteredWorkers.map((w) => w.employeeId));
  const workerById = new Map(
    (data?.workers || []).map((w) => [w.employeeId, w]),
  );
  const selectedItems = selectedEmployeeIds.map((id) => {
    const w = workerById.get(id);
    return {
      id,
      name: w ? nameEN(w) : id,
      sub: w ? [w.empId || w.empCode, w.position].filter(Boolean).join(" · ") : "",
      badge: w ? <BucketBadge bucket={w.bucket} /> : null,
      hidden: !filteredIdSet.has(id),
    };
  });

  const rowBg = (w) =>
    highlightedIds.includes(w.employeeId)
      ? "bg-[#fff3cd]"
      : selectedEmployeeIds.includes(w.employeeId)
        ? "bg-[#fffbe6]"
        : "bg-white";

  const noExpiry = (
    <span className="font-medium text-[#198754]">ไม่มีวันหมดอายุ</span>
  );
  const dash = <span className="text-gray-400">—</span>;

  const placeholderBox = (text) => (
    <div className="border-t border-gray-200 p-10 text-center text-gray-500 sm:p-[60px]">
      {text}
    </div>
  );

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1800px]">
      {/* ════════ Header ════════ */}
      <div className="pb-3">
        <h1 className="m-0 text-lg font-bold">Training Courses</h1>
        <div className="text-xs text-gray-500">
          เลือกหลักสูตร เพื่อดูว่าใครมี / หมดอายุ / ยังไม่มี — ติ๊กพนักงานแล้วกด
          "แจ้ง HR ให้จัด Training" (บันทึกผลอบรมทีละกลุ่มอยู่ที่หน้า Bookings)
        </div>
      </div>

      {/* ════════ Filters ════════ */}
      <div className="mb-4 border-y border-gray-200 py-3">
        <div className="flex flex-wrap gap-3 sm:gap-4">
          {/* ชื่อ training บางตัวยาวมาก → ให้ช่องนี้กว้างที่สุดในแถว */}
          <div className="w-full min-w-0">
            <label className={FILTER_LABEL}>Training / Certification</label>
            <Select
              options={trainingOptions}
              value={selectedTraining}
              onChange={setSelectedTraining}
              placeholder="เลือก training / certification..."
              isClearable
              styles={customSelectStyles}
            />
          </div>

          {selectedTraining && (
            <div className="grid w-full grid-cols-2 gap-3 md:grid-cols-[minmax(220px,1fr)_180px_220px_200px_auto]">
              <div className="col-span-2 md:col-span-1">
                <label className={FILTER_LABEL}>ค้นหาพนักงาน</label>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="🔍 ชื่อไทย / อังกฤษ หรือรหัสพนักงาน"
                  className={FILTER_FIELD}
                />
              </div>
              <div>
                <label className={FILTER_LABEL}>แผนก</label>
                <select
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className={FILTER_FIELD}
                >
                  <option value="">ทุกแผนก</option>
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={FILTER_LABEL}>ตำแหน่ง</label>
                <select
                  value={positionFilter}
                  onChange={(e) => setPositionFilter(e.target.value)}
                  className={FILTER_FIELD}
                >
                  <option value="">ทุกตำแหน่ง</option>
                  {positions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={FILTER_LABEL}>สถานะ cert</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className={FILTER_FIELD}
                >
                  <option value="all">ทุกสถานะ</option>
                  <option value="expired">🔴 Expired</option>
                  <option value="critical">🔥 Critical (&lt;30 days)</option>
                  <option value="warning">🟡 Warning (30-90 days)</option>
                  <option value="upcoming">🔵 Upcoming (90-120 days)</option>
                  <option value="valid">✅ Valid</option>
                  <option value="missing">⚪ Missing</option>
                </select>
              </div>
              <div className="flex items-end">
                {hasFilter && (
                  <button
                    onClick={clearFilters}
                    className="h-9 cursor-pointer whitespace-nowrap rounded-lg border border-[#dc3545] bg-white px-3.5 text-[13px] text-[#dc3545] hover:bg-red-50"
                  >
                    ✕ Clear
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {!selectedTraining ? (
        placeholderBox("เลือก training ด้านบนเพื่อดูรายการ")
      ) : loading ? (
        placeholderBox("Loading...")
      ) : data ? (
        <>
          {/* ════════ Stats — คลิกเพื่อกรอง ════════ */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6">
            {STAT_CARDS.map((c) => {
              const active = statusFilter === c.key;
              return (
                <div
                  key={c.key}
                  onClick={() => setStatusFilter(active ? "all" : c.key)}
                  className={`${STAT_TILE} cursor-pointer px-3.5 py-2.5 transition-shadow hover:shadow-md ${
                    active ? `ring-2 ${c.ring}` : ""
                  }`}
                >
                  <div className={`text-xl font-bold ${c.text}`}>
                    {data.stats[c.key] ?? 0}
                  </div>
                  <div className="text-xs text-gray-500">
                    {c.icon} {c.label}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ════════ Request Training bar ════════ */}
          {/* แสดงตลอด — ยังไม่เลือก = บอกวิธีเลือก / เลือกแล้ว = จำนวน + ปุ่มแจ้ง HR */}
          {canRequestTraining && (
            <div
              className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2.5 ${
                selectedEmployeeIds.length > 0
                  ? "border-[#ffe69c] bg-[#fff3cd]"
                  : "border-gray-200 bg-gray-50"
              }`}
            >
              {selectedEmployeeIds.length > 0 ? (
                <span className="text-[13px] text-[#664d03]">
                  เลือกไว้ <strong>{selectedEmployeeIds.length}</strong> คน
                  สำหรับ training นี้
                  <button
                    type="button"
                    onClick={() => setSelectedEmployeeIds([])}
                    className="ml-2 cursor-pointer border-none bg-transparent p-0 text-xs text-[#664d03] underline"
                  >
                    ล้างที่เลือก
                  </button>
                </span>
              ) : (
                <span className="text-[13px] text-gray-600">
                  ติ๊ก ☐ หน้าชื่อพนักงาน (หรือคลิกที่แถว) แล้วเลือก{" "}
                  <strong>เพิ่ม training ใน CV</strong> (อบรมผ่านแล้ว) หรือ{" "}
                  <strong>แจ้ง HR ให้จัด Training</strong> (ยังไม่ได้อบรม) — ☐{" "}
                  <strong>เลือกทั้งหมด</strong> ที่หัวตาราง =
                  ทุกคนที่แสดงอยู่ตาม filter
                </span>
              )}
              {/* เปิดการ์ด Request training ที่กรอกหลักสูตร + คนไว้ให้แล้ว — ใส่วันที่ / สถานที่ต่อได้ */}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={goBulkAdd}
                  disabled={selectedEmployeeIds.length === 0}
                  title="อบรมผ่านแล้ว → ไปหน้าบันทึกผลอบรม (คนที่เลือกไว้ติดไปด้วย) แล้วกรอกวันที่ออก / วันหมดอายุ / ไฟล์ cert ที่นั่น"
                  className="cursor-pointer rounded-lg border border-[#198754] bg-white px-4 py-2 text-[13px] font-semibold text-[#198754] hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ✓ เพิ่ม training ใน CV ของพนักงาน →
                </button>
                <button
                  type="button"
                  onClick={() => setRequestOpen(true)}
                  disabled={selectedEmployeeIds.length === 0}
                  className="cursor-pointer rounded-lg border-none bg-[#664d03] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#523e02] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  📢 แจ้ง HR ให้จัด Training
                </button>
              </div>
            </div>
          )}

          {highlightedIds.length > 0 && (
            <div className="mb-4 rounded-[10px] border border-[#b6e0f5] bg-sky-50 px-4 py-2.5 text-[13px] text-[#0a5a8a]">
              📌 มาจากคำขอ Training ล่าสุด —
              เน้นแถวสีเหลืองด้านล่างคือคนที่ถูกระบุใน request นี้ (
              {highlightedIds.length} คน)
            </div>
          )}

          <SelectedPeoplePanel
            variant="bar"
            items={selectedItems}
            onRemove={toggleEmployee}
            onClear={() => setSelectedEmployeeIds([])}
          />

          {/* ════════ Worker list (ซ้าย) + ที่เลือกไว้ (ขวา, xl+) ════════ */}
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 border-t border-gray-200">
            {/* ── ต่ำกว่า lg: การ์ด ── */}
            <div className="lg:hidden">
              <div className="flex items-center justify-between gap-2 border-b border-gray-200 py-2.5 text-[13px]">
                {canRequestTraining ? (
                  <label className="flex cursor-pointer items-center gap-2 text-gray-700">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleAllFiltered}
                      className={CHECKBOX}
                    />
                    เลือกทั้งหมด ({filteredWorkers.length})
                  </label>
                ) : (
                  <span />
                )}
                <span className="text-xs text-gray-500">
                  {filteredWorkers.length} คน
                </span>
              </div>

              {filteredWorkers.length === 0 ? (
                <div className="p-10 text-center text-[13px] text-gray-500">
                  ไม่พบ worker ตามเงื่อนไขที่เลือก
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2.5 py-3 md:grid-cols-2">
                  {filteredWorkers.map((w) => (
                    <label
                      key={w.employeeId}
                      data-worker-row={w.employeeId}
                      className={`flex cursor-pointer gap-3 rounded-lg border border-gray-200 p-3 text-[13px] ${rowBg(w)}`}
                    >
                      {canRequestTraining && (
                        <input
                          type="checkbox"
                          checked={selectedEmployeeIds.includes(w.employeeId)}
                          onChange={() => toggleEmployee(w.employeeId)}
                          className={`${CHECKBOX} mt-0.5 shrink-0`}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold">{nameEN(w)}</div>
                            {nameTH(w) && (
                              <div className="text-xs text-gray-600">
                                {nameTH(w)}
                              </div>
                            )}
                            <div className="text-[11px] text-gray-500">
                              {w.empId}
                            </div>
                          </div>
                          <BucketBadge bucket={w.bucket} />
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          {w.position || "—"}
                          {w.department && (
                            <span className="text-gray-400">
                              {" "}
                              · {w.department}
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
                          <span>
                            Issued:{" "}
                            <CertDate
                              hasRecord={w.hasRecord}
                              value={w.completedDate}
                              emptyLabel={dash}
                            />
                          </span>
                          <span>
                            Expiry:{" "}
                            <CertDate
                              hasRecord={w.hasRecord}
                              value={w.expiryDate}
                              emptyLabel={noExpiry}
                            />
                          </span>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* ── lg+: ตาราง ── */}
            {/* ตารางเลื่อนในกรอบตัวเอง → หัวคอลัมน์ตรึงไว้ด้านบนตอนเลื่อน */}
            <div className="hidden max-h-[calc(100vh-240px)] overflow-auto lg:block">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    {canRequestTraining && (
                      <th className={`${STICKY_TH} w-[120px]`}>
                        <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-gray-600">
                          <input
                            type="checkbox"
                            checked={allFilteredSelected}
                            onChange={toggleAllFiltered}
                            className={CHECKBOX}
                          />
                          เลือกทั้งหมด
                        </label>
                      </th>
                    )}
                    {TABLE_HEADERS.map((h) => (
                      <th
                        key={h}
                        className={`${STICKY_TH} whitespace-nowrap text-left text-[11px] font-semibold text-gray-500`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredWorkers.length === 0 ? (
                    <tr>
                      <td
                        colSpan={
                          TABLE_HEADERS.length + (canRequestTraining ? 1 : 0)
                        }
                        className="p-10 text-center text-gray-500"
                      >
                        ไม่พบ worker ตามเงื่อนไขที่เลือก
                      </td>
                    </tr>
                  ) : (
                    filteredWorkers.map((w) => (
                      <tr
                        key={w.employeeId}
                        data-worker-row={w.employeeId}
                        onClick={(e) =>
                          canRequestTraining &&
                          !isInteractive(e) &&
                          toggleEmployee(w.employeeId)
                        }
                        className={`border-b border-gray-100 ${rowBg(w)} ${
                          canRequestTraining
                            ? "cursor-pointer hover:bg-gray-50"
                            : ""
                        }`}
                      >
                        {canRequestTraining && (
                          <td className="px-3.5 py-3 text-center">
                            <input
                              type="checkbox"
                              aria-label={`เลือก ${nameEN(w)}`}
                              checked={selectedEmployeeIds.includes(
                                w.employeeId,
                              )}
                              onChange={() => toggleEmployee(w.employeeId)}
                              className={CHECKBOX}
                            />
                          </td>
                        )}
                        <td className="px-3.5 py-3">
                          <div className="font-semibold">{nameEN(w)}</div>
                          {nameTH(w) && (
                            <div className="text-xs text-gray-600">
                              {nameTH(w)}
                            </div>
                          )}
                          <div className="text-[11px] text-gray-500">
                            {w.empId}
                          </div>
                        </td>
                        <td className="px-3.5 py-3 text-gray-500">
                          <div>{w.position || "—"}</div>
                          {w.department && (
                            <div className="mt-0.5 text-[11px] text-gray-400">
                              {w.department}
                            </div>
                          )}
                        </td>
                        <td className="px-3.5 py-3">
                          <BucketBadge bucket={w.bucket} />
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-3 text-gray-500">
                          <CertDate
                            hasRecord={w.hasRecord}
                            value={w.completedDate}
                            emptyLabel={dash}
                          />
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-3 text-gray-500">
                          <CertDate
                            hasRecord={w.hasRecord}
                            value={w.expiryDate}
                            emptyLabel={noExpiry}
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

            <SelectedPeoplePanel
              items={selectedItems}
              onRemove={toggleEmployee}
              onClear={() => setSelectedEmployeeIds([])}
              listMaxHeight="max-h-[calc(100vh-300px)]"
            />
          </div>
        </>
      ) : (
        placeholderBox("โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
      )}

      {requestOpen && selectedTraining && (
        <RequestBookingModal
          type="training"
          initialCourseId={selectedTraining.value}
          initialEmployeeIds={selectedEmployeeIds}
          onClose={() => setRequestOpen(false)}
          onSent={(n) => {
            setRequestOpen(false);
            setSelectedEmployeeIds([]);
            alert(
              `แจ้ง HR ให้จัด training ให้ ${n} คนแล้ว — ดูสถานะที่ Training Bookings`,
            );
          }}
        />
      )}
    </div>
  );
}
