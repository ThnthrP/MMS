import { useState, useEffect, useContext } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { AppContent } from "../../context/AppContext";
import Select from "react-select";
import {
  buildWorkerOptions,
  filterWorkerOption,
  nameEN,
  nameTH,
} from "../../utils/workerSearch";

// ── badge: [tone, label] ต่อค่าสถานะ ──
const TONE = {
  ok: "bg-emerald-100 text-emerald-800",
  danger: "bg-red-100 text-red-800",
  info: "bg-blue-50 text-blue-700",
  warn: "bg-amber-100 text-amber-800",
  muted: "bg-gray-100 text-gray-500",
};
const STATUS_MAP = {
  active: ["ok", "Active"],
  inactive: ["danger", "Inactive"],
};
const AVAILABILITY_MAP = {
  available: ["ok", "Available"],
  unavailable: ["danger", "Unavailable"],
};
const MOBILIZATION_MAP = {
  ready: ["ok", "Ready"],
  on_site: ["info", "On Site"],
  pending: ["warn", "Pending"],
};

function Badge({ map, value, fixedWidth = false }) {
  const [tone, label] = map[(value || "").toLowerCase()] || [
    "muted",
    value || "-",
  ];
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-md px-2.5 py-1 text-center text-xs font-semibold ${TONE[tone]} ${
        fixedWidth ? "min-w-[90px]" : ""
      }`}
    >
      {label}
    </span>
  );
}

// [หัวคอลัมน์, ชิด, ความกว้าง]
// ตาราง auto layout: FIT = กว้างพอดีข้อความที่ยาวที่สุดในคอลัมน์ (w-px + ไม่ตัดบรรทัด)
// POSITION ไม่กำหนด → ได้พื้นที่ที่เหลือทั้งหมด และขึ้นบรรทัดใหม่ถ้าชื่อยาว
const FIT = "w-px whitespace-nowrap";
const TABLE_HEADERS = [
  ["EMP CODE", "left", FIT],
  ["EMPLOYEE ID", "left", FIT],
  ["NAME", "left", FIT],
  ["POSITION", "left", "min-w-[220px]"],
  ["DEPARTMENT", "left", FIT],
  ["STATUS", "center", FIT],
  ["AVAILABILITY", "center", FIT],
  ["MOBILIZATION", "center", FIT],
  ["ACTIONS", "center", FIT],
];

const ICON_BTN =
  "inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-none p-0 text-xs leading-none transition-all disabled:cursor-not-allowed";
const LIFT_WHITE =
  "bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15),0_1px_2px_rgba(0,0,0,0.08)] hover:-translate-y-px hover:shadow-[0_3px_6px_rgba(0,0,0,0.18),0_2px_3px_rgba(0,0,0,0.1)]";
const LIFT_RED =
  "bg-[#fff5f5] text-[#842029] shadow-[0_1px_3px_rgba(220,53,69,0.15),0_1px_2px_rgba(0,0,0,0.06)] hover:-translate-y-px hover:shadow-[0_3px_6px_rgba(220,53,69,0.25),0_2px_3px_rgba(0,0,0,0.08)]";
const BTN_DISABLED = "bg-gray-100 opacity-50 shadow-none";
const FILTER_LABEL =
  "mb-1 block text-xs font-semibold uppercase tracking-[0.4px] text-gray-500";

const customSelectStyles = {
  control: (provided) => ({
    ...provided,
    borderColor: "#dee2e6",
    borderRadius: "8px",
    minHeight: "36px",
    fontSize: "13px",
    boxShadow: "none",
    "&:hover": { borderColor: "#86b7fe" },
  }),
  option: (provided) => ({ ...provided, fontSize: "13px" }),
  placeholder: (provided) => ({
    ...provided,
    fontSize: "13px",
    color: "#6c757d",
  }),
  // dropdown ลอยเหนือทุกอย่าง (หัวตาราง sticky เคยบังอยู่)
  menuPortal: (provided) => ({ ...provided, zIndex: 50 }),
};

// render dropdown ไว้ที่ <body> — ไม่ถูกการ์ด/ตารางด้านล่างบัง
const MENU_PORTAL = {
  menuPortalTarget: typeof document !== "undefined" ? document.body : null,
  menuPosition: "fixed",
};

export default function Workers() {
  const [workerFilter, setWorkerFilter] = useState(""); // worker.id
  const [status, setStatus] = useState("");
  const [department, setDepartment] = useState("");
  const [position, setPosition] = useState("");
  const [availability, setAvailability] = useState("");
  const [mobilization, setMobilization] = useState("");

  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(false);
  const { backendUrl } = useContext(AppContent);

  // สิทธิ์เข้าถึงหน้า /workers ถูกควบคุมที่ AppRouter.jsx (allowRoles) อยู่แล้ว
  const canManageWorkers = true;

  const departments = [
    ...new Set(workers.map((w) => w.division).filter(Boolean)),
  ];
  const positions = [
    ...new Set(workers.map((w) => w.position?.name).filter(Boolean)),
  ];

  // ตัวกรองไม่มีตัวเลือก "All …" — ไม่เลือก = ทั้งหมด (แสดงเป็น placeholder สีจาง)
  // ปุ่ม ✕ จึงขึ้นเฉพาะตอนกรองอยู่จริง
  const workerOptions = buildWorkerOptions(workers);
  const departmentOptions = [
    ...departments.map((dept) => ({ value: dept, label: dept })),
  ];
  const positionOptions = [
    ...positions.map((pos) => ({ value: pos, label: pos })),
  ];
  const statusOptions = [
    { value: "active", label: "Active" },
    { value: "inactive", label: "Inactive" },
  ];
  const availabilityOptions = [
    { value: "available", label: "Available" },
    { value: "unavailable", label: "Unavailable" },
  ];
  const mobilizationOptions = [
    { value: "pending", label: "Pending" },
    { value: "ready", label: "Ready" },
    { value: "on_site", label: "On-Site" },
  ];

  const filteredWorkers = workers
    .filter((worker) => {
      const matchSearch = !workerFilter || worker.id === workerFilter;
      const matchStatus = !status || worker.status === status;
      const matchDepartment = !department || worker.division === department;
      const matchPosition = !position || worker.position?.name === position;
      const matchAvailability =
        !availability || worker.availabilityStatus === availability;
      const matchMobilization =
        !mobilization || worker.mobilizationStatus === mobilization;
      return (
        matchSearch &&
        matchStatus &&
        matchDepartment &&
        matchPosition &&
        matchAvailability &&
        matchMobilization
      );
    })
    .sort((a, b) =>
      (a.empCode || "").localeCompare(b.empCode || "", undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );

  const totalWorkers = workers.length;
  const activeWorkers = workers.filter((w) => w.status === "active").length;
  const inactiveWorkers = workers.filter((w) => w.status !== "active").length;

  const hasFilter =
    workerFilter ||
    department ||
    position ||
    status ||
    availability ||
    mobilization;

  const clearFilters = () => {
    setWorkerFilter("");
    setDepartment("");
    setPosition("");
    setStatus("");
    setAvailability("");
    setMobilization("");
  };

  const fetchWorkers = async ({ showLoading = false } = {}) => {
    try {
      if (showLoading) setLoading(true);
      const res = await axios.get(`${backendUrl}/api/workers`, {
        withCredentials: true,
      });
      setWorkers(res.data);
    } catch (error) {
      console.error(error);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkers({ showLoading: true });
  }, []);

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to deactivate this worker?"))
      return;
    try {
      await axios.delete(`${backendUrl}/api/workers/${id}`, {
        withCredentials: true,
      });
      fetchWorkers();
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.message || "Failed to deactivate worker");
    }
  };

  // ── ปุ่ม View / Edit / Delete — ใช้ทั้งตารางและการ์ด ──
  const renderActions = (worker) => {
    const inactive = isInactive(worker);
    return (
      <div className="flex justify-center gap-1.5">
        <Link
          to={`/workers/${worker.id}`}
          title="ดูรายละเอียด"
          className={`${ICON_BTN} ${LIFT_WHITE} no-underline`}
        >
          👁
        </Link>
        {canManageWorkers && (
          <>
            <Link
              to={`/workers/${worker.id}/edit`}
              title="แก้ไข"
              className={`${ICON_BTN} ${LIFT_WHITE} no-underline`}
            >
              ✏️
            </Link>
            <button
              onClick={() => handleDelete(worker.id)}
              disabled={inactive}
              title={inactive ? "Inactive อยู่แล้ว" : "Deactivate พนักงานคนนี้"}
              className={`${ICON_BTN} ${inactive ? BTN_DISABLED : LIFT_RED}`}
            >
              🗑
            </button>
          </>
        )}
      </div>
    );
  };

  const isInactive = (w) => w.status === "inactive";
  const dash = <span className="text-gray-400">—</span>;

  const emptyText = loading
    ? "Loading workers data..."
    : "No matching records found.";

  return (
    // xl+: สูงเต็มจอ ตาราง scroll ในพื้นที่ที่เหลือ / ต่ำกว่านั้น: สูงตามเนื้อหา
    <div className="flex flex-col xl:h-[calc(100vh-108px)]">
      <div className="mx-auto flex min-h-0 w-full max-w-[1800px] flex-1 flex-col">
        {/* ════════ Header ════════ */}
        <div className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="m-0 text-lg font-bold">Workers</h1>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
              <span>Recruitment &amp; Data Entry</span>
              <span>
                Total <b className="text-gray-900">{totalWorkers}</b> · Active{" "}
                <b className="text-[#198754]">{activeWorkers}</b> · Inactive{" "}
                <b className="text-gray-700">{inactiveWorkers}</b>
              </span>
              {hasFilter && (
                <span>
                  พบ <b className="text-blue-700">{filteredWorkers.length}</b> จาก{" "}
                  {workers.length} คน
                </span>
              )}
            </div>
          </div>
          {canManageWorkers && (
            <Link
              to="/workers/add"
              className="inline-block w-full shrink-0 rounded-md bg-[#2B2F78] px-3.5 py-2 text-center text-xs font-semibold text-white no-underline hover:bg-[#22265f] sm:w-auto"
            >
              + Add Worker
            </Link>
          )}
        </div>

        {/* ════════ Search & Filter — คั่นด้วยเส้น ════════
            มือถือ 1 / sm 2 / lg+ 3 ช่องต่อแถว (2 บรรทัด — ช่องกว้างพอเห็นค่าเต็ม) */}
        <div className="grid grid-cols-1 gap-x-3 gap-y-3 border-y border-gray-200 py-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="min-w-0">
            <label className={FILTER_LABEL}>
              Worker <span className="normal-case tracking-normal text-gray-400">(ID / ชื่อไทย / อังกฤษ)</span>
            </label>
            <Select
              options={workerOptions}
              styles={customSelectStyles}
              {...MENU_PORTAL}
              value={workerOptions.find((o) => o.value === workerFilter) || null}
              onChange={(o) => setWorkerFilter(o ? o.value : "")}
              filterOption={filterWorkerOption}
              placeholder="🔍 ค้นหาด้วย ID หรือชื่อ (ไทย/อังกฤษ)..."
              isClearable
              noOptionsMessage={() => "ไม่พบ worker"}
            />
          </div>
          <div className="min-w-0">
            <label className={FILTER_LABEL}>Department</label>
            <Select
              options={departmentOptions}
              styles={customSelectStyles}
              {...MENU_PORTAL}
              value={departmentOptions.find((o) => o.value === department) || null}
              onChange={(o) => setDepartment(o ? o.value : "")}
              placeholder="All Departments"
              isClearable
              noOptionsMessage={() => "No departments found"}
            />
          </div>
          <div className="min-w-0">
            <label className={FILTER_LABEL}>Position</label>
            <Select
              options={positionOptions}
              styles={customSelectStyles}
              {...MENU_PORTAL}
              value={positionOptions.find((o) => o.value === position) || null}
              onChange={(o) => setPosition(o ? o.value : "")}
              placeholder="All Positions"
              isClearable
              noOptionsMessage={() => "No positions found"}
            />
          </div>
          <div className="min-w-0">
            <label className={FILTER_LABEL}>Status</label>
            <Select
              options={statusOptions}
              styles={customSelectStyles}
              {...MENU_PORTAL}
              value={statusOptions.find((o) => o.value === status) || null}
              onChange={(o) => setStatus(o ? o.value : "")}
              placeholder="All Status"
              isClearable
              isSearchable={false}
            />
          </div>
          <div className="min-w-0">
            <label className={FILTER_LABEL}>Availability</label>
            <Select
              options={availabilityOptions}
              styles={customSelectStyles}
              {...MENU_PORTAL}
              value={availabilityOptions.find((o) => o.value === availability) || null}
              onChange={(o) => setAvailability(o ? o.value : "")}
              placeholder="All Availability"
              isClearable
              isSearchable={false}
            />
          </div>
          <div className="min-w-0">
            <label className={`${FILTER_LABEL} flex items-center justify-between`}>
              <span>Mobilization</span>
              {hasFilter && (
                <button
                  onClick={clearFilters}
                  className="cursor-pointer border-none bg-transparent p-0 text-[11px] font-semibold normal-case tracking-normal text-[#dc3545] underline"
                >
                  ✕ ล้างทั้งหมด
                </button>
              )}
            </label>
            <Select
              options={mobilizationOptions}
              styles={customSelectStyles}
              {...MENU_PORTAL}
              value={mobilizationOptions.find((o) => o.value === mobilization) || null}
              onChange={(o) => setMobilization(o ? o.value : "")}
              placeholder="All Mobilization"
              isClearable
              isSearchable={false}
            />
          </div>
        </div>

        {/* ════════ List ════════ */}
        <div className="flex min-h-0 flex-1 flex-col border-b border-gray-200">
          {/* ── ต่ำกว่า xl: รายการคั่นเส้น ── */}
          <div className="xl:hidden">
            {loading || filteredWorkers.length === 0 ? (
              <div className="p-10 text-center text-[13px] text-gray-500">
                {emptyText}
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {filteredWorkers.map((worker) => (
                  <div key={worker.id} className="py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link
                          to={`/workers/${worker.id}`}
                          className="break-words text-[13px] font-semibold text-blue-600 no-underline hover:underline"
                        >
                          {nameEN(worker)}
                        </Link>
                        {nameTH(worker) && (
                          <div className="text-xs text-gray-600">
                            {nameTH(worker)}
                          </div>
                        )}
                        <div className="text-[11px] text-gray-500">
                          <span className="font-semibold text-gray-700">
                            {worker.empId || "—"}
                          </span>
                          <span className="text-gray-400">
                            {" "}
                            · #{worker.empCode}
                          </span>
                        </div>
                      </div>
                      {renderActions(worker)}
                    </div>

                    <div className="mt-1.5 text-xs text-gray-700">
                      {worker.position?.name || "—"}
                      {worker.division && (
                        <span className="text-gray-500">
                          {" "}
                          · {worker.division}
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge map={STATUS_MAP} value={worker.status} />
                      {!isInactive(worker) && (
                        <>
                          <Badge
                            map={AVAILABILITY_MAP}
                            value={worker.availabilityStatus}
                          />
                          <Badge
                            map={MOBILIZATION_MAP}
                            value={worker.mobilizationStatus}
                          />
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── xl+: ตาราง ── */}
          <div className="hidden min-h-0 flex-1 overflow-auto xl:block">
            <table className="w-full min-w-[1200px] border-collapse text-[13px]">
              <thead>
                <tr>
                  {TABLE_HEADERS.map(([h, align, width]) => (
                    <th
                      key={h}
                      className={`sticky top-0 z-[1] whitespace-nowrap bg-gray-50 px-3 py-2 text-[11px] font-semibold tracking-[0.4px] text-gray-500 shadow-[inset_0_-1px_0_#e5e7eb] ${
                        align === "center" ? "text-center" : "text-left"
                      } ${width}`}
                    >
                      {h === "EMP CODE" ? (
                        <span title="เลขอ้างอิงพนักงานในระบบ เรียงตามลำดับที่สร้าง ไม่มีนัยสำคัญอื่น">
                          {h}
                        </span>
                      ) : (
                        h
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading || filteredWorkers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={TABLE_HEADERS.length}
                      className="p-10 text-center text-gray-500"
                    >
                      {emptyText}
                    </td>
                  </tr>
                ) : (
                  filteredWorkers.map((worker, idx) => (
                    <tr
                      key={worker.id}
                      className={`transition-colors duration-150 hover:bg-gray-50 ${
                        idx < filteredWorkers.length - 1
                          ? "border-b border-gray-100"
                          : ""
                      }`}
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-gray-400">
                        {worker.empCode}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-semibold text-gray-700">
                        {worker.empId || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <Link
                          to={`/workers/${worker.id}`}
                          className="font-semibold text-blue-600 no-underline hover:underline"
                        >
                          {nameEN(worker)}
                        </Link>
                        {nameTH(worker) && (
                          <div className="text-xs text-gray-500">
                            {nameTH(worker)}
                          </div>
                        )}
                      </td>
                      <td className="break-words px-3 py-2">
                        {worker.position?.name || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-500">
                        {worker.division || "—"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Badge
                          map={STATUS_MAP}
                          value={worker.status}
                          fixedWidth
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        {isInactive(worker) ? (
                          dash
                        ) : (
                          <Badge
                            map={AVAILABILITY_MAP}
                            value={worker.availabilityStatus}
                            fixedWidth
                          />
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {isInactive(worker) ? (
                          dash
                        ) : (
                          <Badge
                            map={MOBILIZATION_MAP}
                            value={worker.mobilizationStatus}
                            fixedWidth
                          />
                        )}
                      </td>
                      <td className="px-2 py-2 text-center">
                        {renderActions(worker)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
