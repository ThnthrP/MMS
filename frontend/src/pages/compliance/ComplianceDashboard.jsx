import { useState, useEffect, useLayoutEffect, useContext, useRef } from "react";
import axios from "axios";
import { AppContent } from "../../context/AppContext";
import Select from "react-select";
import { Link } from "react-router-dom";
import {
  MEDICAL_BUCKETS,
  MEDICAL_REQUEST_WITHIN_DAYS,
  expiryBucket,
} from "../../utils/medicalStatus";
import {
  buildWorkerOptions,
  filterWorkerOption,
  nameEN,
  nameTH,
} from "../../utils/workerSearch";
import TrainingPlanNotice, { useEmployeeTrainingPlan, findPlan, PlanTag } from "../../components/TrainingPlanNotice";

// ══════════════════════════════════════════════════════════
// constants
// ══════════════════════════════════════════════════════════
const FILTER_LABEL =
  "mb-1 block text-xs font-semibold uppercase tracking-[0.4px] text-gray-500";
const LINK =
  "cursor-pointer text-[11px] font-semibold text-blue-600 hover:underline";

const TONE = {
  red: "bg-[#f8d7da] text-[#842029]",
  yellow: "bg-[#fff3cd] text-[#664d03]",
  indigo: "bg-[#eef2ff] text-[#4f46e5]",
  green: "bg-[#d1e7dd] text-[#0f5132]",
  gray: "bg-gray-100 text-gray-500",
};

const STAT_CARDS = [
  {
    key: "expired",
    color: "#dc3545",
    tint: "#fff5f5",
    icon: "🔴",
    label: "Expired",
    bg: "bg-[#fff5f5]",
    bar: "bg-[#dc3545]",
    text: "text-[#dc3545]",
    ring: "ring-[#dc3545]",
  },
  {
    key: "critical",
    color: "#cc8400",
    tint: "#fff8e1",
    icon: "🔥",
    label: "Critical (<30d)",
    bg: "bg-[#fff8e1]",
    bar: "bg-[#ffc107]",
    text: "text-[#cc8400]",
    ring: "ring-[#ffc107]",
  },
  {
    key: "warning",
    color: "#0aa2c0",
    tint: "#e8f8fc",
    icon: "🟡",
    label: "Warning (30-90d)",
    bg: "bg-[#e8f4fd]",
    bar: "bg-[#0dcaf0]",
    text: "text-[#0aa2c0]",
    ring: "ring-[#0dcaf0]",
  },
  {
    key: "upcoming",
    color: "#4f46e5",
    tint: "#eef2ff",
    icon: "🔵",
    label: "Upcoming (90-120d)",
    bg: "bg-[#eef2ff]",
    bar: "bg-[#6366f1]",
    text: "text-[#4f46e5]",
    ring: "ring-[#6366f1]",
  },
  {
    key: "valid",
    color: "#198754",
    tint: "#f0faf4",
    icon: "✅",
    label: "Valid (>120d)",
    bg: "bg-[#f0fff4]",
    bar: "bg-[#198754]",
    text: "text-[#198754]",
    ring: "ring-[#198754]",
  },
];

const ALERT_GROUPS = [
  { key: "expired", label: "🔴 Expired", text: "text-[#dc3545]" },
  { key: "critical", label: "🔥 Critical (<30 days)", text: "text-[#cc8400]" },
  { key: "warning", label: "🟡 Warning (30-90 days)", text: "text-[#0aa2c0]" },
  {
    key: "upcoming",
    label: "🔵 Upcoming (90-120 days)",
    text: "text-[#4f46e5]",
  },
];

// ผลตรวจจริง (แยกจาก badge หลักที่สื่อ "ใบด่วนแค่ไหน")
const MEDICAL_STATUS_LABEL = {
  passed: "Fit",
  pending: "Pending",
  failed: "Unfit",
  not_required: "Fit w/ Restriction",
};

const TABLE_HEADERS = [
  ["WORKER", "text-left", "w-[15%]"],
  ["POSITION", "text-left", "w-[20%]"],
  ["DEPARTMENT", "text-left", "w-[12%]"],
  ["TRAINING ALERTS", "text-center", "w-[19%]"],
  ["MEDICAL", "text-center", "w-[17%]"],
  ["CHEVRON MATCH", "text-center", "w-[17%]"],
];

// key ของ HR request ที่ส่งไปแล้วในรอบนี้ (กันกดซ้ำ)
const reqKey = (employeeId, trainingId) => `${employeeId}:${trainingId}`;
// key ของคำขอตรวจสุขภาพ — ตรงกับ GET /api/medical-requests/pending-keys
const MAIN_CHECK = "Medical Check up";
const medKey = (employeeId, checkType) => `${employeeId}:${checkType || MAIN_CHECK}`;
// แจ้ง HR เรื่อง medical ได้เมื่อหมดอายุแล้ว หรือเหลือไม่เกิน 120 วัน — MEDICAL_REQUEST_WITHIN_DAYS (utils/medicalStatus.js)

// ชื่อ client ของ worker สำหรับแนบในคำขอ (dashboard เก็บ key เป็นตัวเล็ก เช่น "chevron")
const clientNameOf = (w) => {
  const key = Object.keys(w?.clients || {})[0];
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : null;
};

const BUCKET_RANK = {
  valid: 0,
  upcoming: 1,
  warning: 2,
  critical: 3,
  expired: 4,
};

const EMPTY_GROUP = { required: [], completed: [], missing: [] };

// react-select ใช้ styles API ของไลบรารี
const customSelectStyles = {
  control: (p) => ({
    ...p,
    borderColor: "#dee2e6",
    borderRadius: "8px",
    minHeight: "36px",
    fontSize: "13px",
    boxShadow: "none",
    "&:hover": { borderColor: "#86b7fe" },
  }),
  option: (p) => ({ ...p, fontSize: "13px" }),
  placeholder: (p) => ({ ...p, fontSize: "13px", color: "#6c757d" }),
  // dropdown ลอยเหนือหัวตารางที่ตรึงไว้
  menuPortal: (p) => ({ ...p, zIndex: 50 }),
};
const MENU_PORTAL = {
  menuPortalTarget: typeof document !== "undefined" ? document.body : null,
  menuPosition: "fixed",
};
// หัวตารางตรึงไว้ตอนเลื่อน (ตารางเลื่อนในกรอบของตัวเอง — แบบหน้า Manpower Calendar)
const STICKY_TH =
  "sticky top-0 z-[1] whitespace-nowrap bg-gray-50 px-3.5 py-2 text-[11px] font-semibold tracking-[0.5px] text-gray-500 shadow-[inset_0_-1px_0_#e5e7eb]";

// ══════════════════════════════════════════════════════════
// helpers
// ══════════════════════════════════════════════════════════
const alertCounts = (w) => ({
  expired: w.alerts?.expired ?? 0,
  critical: w.alerts?.critical ?? 0,
  warning: w.alerts?.warning ?? 0,
  upcoming: w.alerts?.upcoming ?? 0,
});

// ความรุนแรงของ training อย่างเดียว — ใช้กับคอลัมน์ Training Alerts
const trainingSeverity = (w) => {
  const a = alertCounts(w);
  if (a.expired > 0) return 4;
  if (a.critical > 0) return 3;
  if (a.warning > 0) return 2;
  if (a.upcoming > 0) return 1;
  return 0;
};

// ความรุนแรงรวม training + medical — ใช้เรียงแถวและกรอง Status
// (คนที่ medical หมดอายุยังขึ้นบนสุด และกรอง "Expired" แล้วยังเจอ)
const severity = (w) =>
  Math.max(trainingSeverity(w), BUCKET_RANK[w.medicalWorst] ?? 0);

// สถานะ "แย่สุด" ของ worker — ใช้กรองตาม status
const worstStatus = (w) =>
  ["valid", "upcoming", "warning", "critical", "expired"][severity(w)];

const getMedical = (w) =>
  (w.medicalChecks || []).find((m) => m.checkType === "Medical Check up") ||
  null;

// ผลตรวจประเภทอื่น (เช่น Confined Space Entry) — แสดงเป็นบรรทัดรองในคอลัมน์ Medical
const getOtherMedicals = (w) =>
  (w.medicalChecks || []).filter((m) => m.checkType !== "Medical Check up");

const daysUntil = (date) => {
  if (!date) return null;
  const d = new Date(date);
  return isNaN(d.getTime())
    ? null
    : Math.ceil((d.getTime() - Date.now()) / 86400000);
};

// สีวันหมดอายุ: <30 วัน (รวมหมดแล้ว) แดง · 30–90 วัน ส้ม · มากกว่านั้น เทา
const expiryTextCls = (daysLeft) =>
  daysLeft === null
    ? "text-gray-500"
    : daysLeft < 30
      ? "font-semibold text-[#dc3545]"
      : daysLeft <= 90
        ? "font-semibold text-[#cc8400]"
        : "text-gray-500";

const daysNote = (daysLeft) =>
  daysLeft === null
    ? null
    : daysLeft < 0
      ? `หมดมาแล้ว ${Math.abs(daysLeft)} วัน`
      : daysLeft <= 90
        ? `เหลือ ${daysLeft} วัน`
        : null;

const fmtDate = (date) => new Date(date).toLocaleDateString("en-GB");

// badge หลักของ Medical สื่อ "ใบด่วนแค่ไหน" มิติเดียว
//   เกณฑ์กลางใช้ร่วมกับ Assign Names / Request Medical (utils/medicalStatus.js)
const medicalExpiryInfo = (daysLeft, hasValidExp) => {
  const b = MEDICAL_BUCKETS[hasValidExp ? expiryBucket(daysLeft) : "no_record"];
  return [b.tone, b.label];
};

// ══════════════════════════════════════════════════════════
// small components (อยู่นอก component หลัก)
// ══════════════════════════════════════════════════════════
function Badge({ tone, children }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-md px-2 py-[3px] text-[11px] font-semibold ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

function ClientCell({
  completed = null,
  required = 0,
  missing = 0,
  score = 0,
}) {
  if (completed === null) return <span className="text-gray-500">—</span>;
  const scoreColor =
    score >= 80
      ? "text-[#198754]"
      : score >= 60
        ? "text-[#cc8400]"
        : "text-[#dc3545]";
  return (
    <div>
      <div
        className={`text-[13px] font-semibold ${
          missing === 0 ? "text-[#198754]" : "text-[#dc3545]"
        }`}
      >
        {missing === 0 ? "Complete" : `${missing} Missing`}
      </div>
      <div className="text-[11px] text-gray-500">
        {completed} / {required} completed
      </div>
      <div className={`text-[11px] font-semibold ${scoreColor}`}>
        {score}% Match
      </div>
    </div>
  );
}

// หัวกลุ่มแบบบรรทัดเดียว: ● ชื่อกลุ่ม  [14/17]  ขาด 3  + แถบความคืบหน้า
// (เดิมเป็นกล่องตัวเลขใหญ่ 3 กล่อง Required / Completed / Missing — กินพื้นที่ ~90px ต่อกลุ่ม)
function GapGroupHeader({ dot, title, required, completed, missing }) {
  const done = missing === 0;
  const pct = required > 0 ? Math.round((completed / required) * 100) : 0;
  return (
    <div className="mb-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
        <span className="text-[13px] font-bold text-gray-900">{title}</span>
        <span
          className={`rounded-full px-2 py-px text-[11px] font-bold ${
            done ? "bg-[#d1e7dd] text-[#0f5132]" : "bg-[#f8d7da] text-[#842029]"
          }`}
          title={`มีแล้ว ${completed} จาก ${required}`}
        >
          {completed}/{required}
        </span>
        <span
          className={`text-xs font-semibold ${
            done ? "text-[#198754]" : "text-[#dc3545]"
          }`}
        >
          {done ? "✓ ครบ" : `ขาด ${missing}`}
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded bg-gray-200">
        <div
          className={`h-1 rounded ${done ? "bg-[#198754]" : "bg-[#dc3545]"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// extra(t) = ของต่อท้ายแต่ละป้าย (เช่น ป้ายแผนอบรม 🗓)
function TagList({ items, cls, prefix, extra }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t) => (
        <span
          key={t}
          className={`rounded-md border px-2 py-0.5 text-xs ${cls}`}
        >
          {prefix} {t}
          {extra?.(t)}
        </span>
      ))}
    </div>
  );
}

// plans = แผนอบรมของพนักงานคนนี้ → training ที่ขาดแต่มีรอบอบรมแล้ว ขึ้นป้าย 🗓
function GapTrainingTags({ missing, completed, plans }) {
  return (
    <>
      {missing.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold text-[#dc3545]">
            ✕ Missing ({missing.length}):
          </div>
          <TagList
            items={missing}
            prefix="✕"
            cls="border-[#f5c6cb] bg-[#fff5f5] text-[#dc3545]"
            extra={(name) => <PlanTag plan={findPlan(plans, { name })} />}
          />
        </div>
      )}
      {completed.length > 0 && (
        <div className={missing.length > 0 ? "mt-2" : ""}>
          <div className="mb-1 text-xs font-semibold text-[#198754]">
            ✓ Completed ({completed.length}):
          </div>
          <TagList
            items={completed}
            prefix="✓"
            cls="border-[#b2dfdb] bg-[#f0fff4] text-[#198754]"
          />
        </div>
      )}
    </>
  );
}

// กรอบ modal ที่ใช้ร่วมกันทั้ง 3 ตัว
// หัว + ปุ่ม Close อยู่กับที่ เลื่อนเฉพาะเนื้อหาข้างใน (เดิมเลื่อนทั้ง modal — หัวหลุดจอ)
function Modal({ maxW, title, subtitle, headerRight, onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/50 p-3 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-[10px] bg-white supports-[height:100dvh]:max-h-[92dvh] ${maxW}`}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <div className="break-words text-[15px] font-bold leading-snug">
              {title}
            </div>
            {subtitle}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {headerRight}
            <button
              onClick={onClose}
              aria-label="ปิด"
              className="cursor-pointer border-none bg-transparent text-xl leading-none text-gray-500 hover:text-gray-800"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:px-5">
          {children}
        </div>
        <div className="shrink-0 border-t border-gray-200 px-4 py-2.5 text-right sm:px-5">
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg border border-gray-200 bg-gray-500 px-6 py-1.5 text-[13px] text-white hover:bg-gray-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// main
// ══════════════════════════════════════════════════════════
export default function ComplianceDashboard() {
  const { backendUrl } = useContext(AppContent);

  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    expired: 0,
    critical: 0,
    warning: 0,
    upcoming: 0,
    valid: 0,
  });

  const [workerFilter, setWorkerFilter] = useState(""); // worker.id
  const [positionFilter, setPositionFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [selectedGap, setSelectedGap] = useState(null);
  const [selectedAlert, setSelectedAlert] = useState(null); // + workerId, clientName
  const [requestedKeys, setRequestedKeys] = useState(() => new Set()); // แจ้ง HR แล้ว (รอบนี้)
  const [sendingKey, setSendingKey] = useState(null); // key ที่กำลังส่ง / "all"
  const [noteModal, setNoteModal] = useState(null); // { name, note }
  // คำขอตรวจสุขภาพที่รอ HR อยู่ (จาก backend) + ที่เพิ่งกดส่งในรอบนี้
  const [medicalRequested, setMedicalRequested] = useState(() => new Set());
  const [sendingMedKey, setSendingMedKey] = useState(null);

  const anyModalOpen = !!(selectedGap || selectedAlert || noteModal);
  // แผนอบรมของคนที่เปิด Gap Analysis / Training Alerts อยู่ (Training Plan: กำลังอบรม / กำลังจะเริ่ม)
  const empPlan = useEmployeeTrainingPlan(selectedAlert?.workerId || selectedGap?.workerId);

  // กรอบตาราง = พื้นที่ที่เหลือของจอ (วัดจริง) → หัวคอลัมน์ค้างอยู่ด้านบนตอนเลื่อน
  const tableBoxRef = useRef(null);
  const [tableMaxH, setTableMaxH] = useState(null);

  // ล็อก scroll ของหน้าเมื่อเปิด modal ใดก็ได้ (เดิมล็อกเฉพาะ Gap modal)
  useEffect(() => {
    document.body.style.overflow = anyModalOpen ? "hidden" : "auto";
    return () => {
      document.body.style.overflow = "auto";
    };
  }, [anyModalOpen]);

  const fetchDashboard = async () => {
    try {
      setLoading(true);
      const [dashboardRes, statsRes] = await Promise.all([
        axios.get(`${backendUrl}/api/compliance/dashboard`, {
          withCredentials: true,
        }),
        axios.get(`${backendUrl}/api/compliance/stats`, {
          withCredentials: true,
        }),
      ]);
      setWorkers(
        [...dashboardRes.data].sort((a, b) => severity(b) - severity(a)),
      );
      setStats(statsRes.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
    // ใครแจ้ง HR เรื่อง medical ไปแล้ว — โหลดไม่ได้ (เช่นไม่มีสิทธิ์) ก็แค่ไม่แสดง "✓ แจ้งแล้ว"
    axios
      .get(`${backendUrl}/api/medical-requests/pending-keys`, { withCredentials: true })
      .then((res) => Array.isArray(res.data) && setMedicalRequested(new Set(res.data)))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Export PE Tracking (.xlsx) — ผลตรวจสุขภาพรายคน ตาม layout Excel เดิมของ HR
  // (ย้ายมาจากหน้า Analytics & Reports — endpoint เดิม)
  const [exportingPE, setExportingPE] = useState(false);
  const exportPETracking = async () => {
    setExportingPE(true);
    try {
      const res = await axios.get(
        `${backendUrl}/api/analytics/export-pe-tracking`,
        { withCredentials: true, responseType: "blob" },
      );
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `PE-tracking-export-${new Date().toLocaleDateString("en-CA")}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert(
        err.response?.status === 403
          ? "ไม่มีสิทธิ์ Export ผลตรวจสุขภาพ"
          : "Export PE Tracking ไม่สำเร็จ ลองใหม่อีกครั้ง",
      );
    } finally {
      setExportingPE(false);
    }
  };

  const handleViewGap = async (workerId) => {
    try {
      const res = await axios.get(
        `${backendUrl}/api/compliance/worker/${workerId}/gaps`,
        { withCredentials: true },
      );
      setSelectedGap({ ...res.data, workerId });
    } catch (error) {
      console.error(error);
    }
  };

  const handleViewAlerts = async (w) => {
    try {
      const res = await axios.get(
        `${backendUrl}/api/compliance/worker/${w.id}/alerts`,
        { withCredentials: true },
      );
      setSelectedAlert({
        ...res.data,
        workerId: w.id,
        clientName: clientNameOf(w),
      });
    } catch (error) {
      console.error(error);
    }
  };

  // ── แจ้ง HR ให้จัด training → ไปอยู่หน้า Training Bookings (endpoint เดียวกับหน้า Allocation) ──
  // items: alert item ที่มี globalTrainingId (training ที่ map กับระบบแล้ว)
  const sendTrainingRequest = async (items, busyKey) => {
    if (!selectedAlert || items.length === 0 || sendingKey) return;
    // กดทีละตัว = ส่งทันที / แจ้งทั้งหมด = ยืนยันก่อน
    if (items.length > 1) {
      const names = items.map((it) => `• ${it.name}`).join("\n");
      if (
        !window.confirm(
          `แจ้ง HR ให้จัด training ${items.length} รายการให้ ${selectedAlert.fullName}?\n\n${names}\n\nคำขอจะไปอยู่ที่เมนู Training Bookings`,
        )
      )
        return;
    }
    try {
      setSendingKey(busyKey);
      await axios.post(
        `${backendUrl}/api/training-requests`,
        {
          items: items.map((it) => ({
            employeeId: selectedAlert.workerId,
            globalTrainingId: it.globalTrainingId,
            clientName: selectedAlert.clientName,
          })),
        },
        { withCredentials: true },
      );
      setRequestedKeys((prev) => {
        const next = new Set(prev);
        items.forEach((it) =>
          next.add(reqKey(selectedAlert.workerId, it.globalTrainingId)),
        );
        return next;
      });
    } catch (err) {
      console.error(err);
      alert(
        err.response?.status === 403
          ? "ไม่มีสิทธิ์ส่งคำขอ training"
          : err.response?.data?.message || "แจ้ง HR ไม่สำเร็จ ลองใหม่อีกครั้ง",
      );
    } finally {
      setSendingKey(null);
    }
  };

  // ── แจ้ง HR ให้นัดตรวจสุขภาพ → ไปอยู่หน้า Medical Bookings (endpoint เดียวกับหน้า Assign Names) ──
  const sendMedicalRequest = async (w, checkType, daysLeft) => {
    const k = medKey(w.id, checkType);
    if (sendingMedKey || medicalRequested.has(k)) return;
    try {
      setSendingMedKey(k);
      await axios.post(
        `${backendUrl}/api/medical-requests`,
        {
          items: [
            {
              employeeId: w.id,
              checkType: checkType || MAIN_CHECK,
              clientName: clientNameOf(w),
              reason: daysLeft < 0 ? "overdue" : "due_soon",
            },
          ],
        },
        { withCredentials: true },
      );
      setMedicalRequested((prev) => new Set(prev).add(k));
    } catch (err) {
      console.error(err);
      alert(
        err.response?.status === 403
          ? "ไม่มีสิทธิ์ส่งคำขอตรวจสุขภาพ"
          : err.response?.data?.message || "แจ้ง HR ไม่สำเร็จ ลองใหม่อีกครั้ง",
      );
    } finally {
      setSendingMedKey(null);
    }
  };

  // ปุ่ม "แจ้ง HR" ใต้ผลตรวจในคอลัมน์ Medical
  const renderMedicalRequestButton = (w, checkType, daysLeft, small = false) => {
    if (daysLeft === null || daysLeft > MEDICAL_REQUEST_WITHIN_DAYS) return null;
    const k = medKey(w.id, checkType);
    const size = small ? "px-1.5 py-px text-[10px]" : "px-2 py-1 text-[11px]";
    if (medicalRequested.has(k)) {
      return (
        <Link
          to="/medical-bookings"
          title="มีคำขอรอ HR นัดตรวจอยู่แล้ว — ดูที่เมนู Medical Bookings"
          className={`mt-0.5 inline-block whitespace-nowrap rounded-md bg-[#d1e7dd] font-semibold text-[#0f5132] no-underline hover:underline ${size}`}
        >
          ✓ แจ้งแล้ว
        </Link>
      );
    }
    return (
      <button
        type="button"
        onClick={() => sendMedicalRequest(w, checkType, daysLeft)}
        disabled={!!sendingMedKey}
        title={`แจ้ง HR ให้นัด ${checkType || MAIN_CHECK} — คำขอไปที่เมนู Medical Bookings`}
        className={`mt-0.5 cursor-pointer whitespace-nowrap rounded-md border border-blue-600 bg-white font-semibold text-blue-600 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60 ${size}`}
      >
        {sendingMedKey === k ? "..." : "📨 แจ้ง HR"}
      </button>
    );
  };

  const filteredWorkers = workers.filter((w) => {
    const matchWorker = !workerFilter || w.id === workerFilter;
    const matchPosition =
      !positionFilter || w.position?.name === positionFilter;
    const matchDepartment =
      !departmentFilter || (w.department || "") === departmentFilter;
    const matchStatus =
      statusFilter === "all" || worstStatus(w) === statusFilter;
    return matchWorker && matchPosition && matchDepartment && matchStatus;
  });

  const hasFilter =
    workerFilter || positionFilter || departmentFilter || statusFilter !== "all";

  // ไม่มีตัวเลือก "All …" — ไม่เลือก = ทั้งหมด (แสดงเป็น placeholder สีจาง แบบหน้า Workers)
  const workerOptions = buildWorkerOptions(workers);

  const positionOptions = [
    ...[...new Set(workers.map((w) => w.position?.name).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
      .map((p) => ({ value: p, label: p })),
  ];

  const departmentOptions = [
    ...[...new Set(workers.map((w) => w.department).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
      .map((d) => ({ value: d, label: d })),
  ];

  // ── cell renderers — ใช้ทั้งตาราง (lg+) และการ์ด (มือถือ) ──
  const renderWorker = (w) => (
    <>
      {/* ชื่อ → หน้า WorkerDetail (คลิกขวาเปิดแท็บใหม่ได้) */}
      <Link
        to={`/workers/${w.id}`}
        className="font-semibold text-gray-900 no-underline hover:text-blue-600 hover:underline"
      >
        {nameEN(w)}
      </Link>
      {nameTH(w) && (
        <div className="text-xs text-gray-600">{nameTH(w)}</div>
      )}
      {w.empId ? (
        <div className="font-mono text-[11px] text-gray-500">{w.empId}</div>
      ) : (
        <div className="mt-[3px] flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-[#ffe69c] bg-[#fff3cd] px-2 py-px text-[10px] font-semibold text-[#664d03]">
            ⚠ No ID
          </span>
          <Link
            to={`/workers/${w.id}/edit`}
            className="whitespace-nowrap text-[10px] font-semibold text-blue-600 underline"
          >
            กรอก →
          </Link>
        </div>
      )}
    </>
  );

  const renderAlerts = (w) => {
    const a = alertCounts(w);
    const hasAlerts = trainingSeverity(w) > 0;
    return (
      <div className="flex flex-col items-center gap-1">
        {!hasAlerts ? (
          <Badge tone="green">✅ No Alerts</Badge>
        ) : (
          <div className="flex flex-wrap justify-center gap-1">
            {a.expired > 0 && <Badge tone="red">🔴 {a.expired} Expired</Badge>}
            {a.critical > 0 && (
              <Badge tone="red">🔥 {a.critical} Critical</Badge>
            )}
            {a.warning > 0 && (
              <Badge tone="yellow">🟡 {a.warning} Warning</Badge>
            )}
            {a.upcoming > 0 && (
              <Badge tone="indigo">🔵 {a.upcoming} Upcoming</Badge>
            )}
          </div>
        )}
        {hasAlerts && (
          <span onClick={() => handleViewAlerts(w)} className={LINK}>
            🔍 ดู Alerts →
          </span>
        )}
      </div>
    );
  };

  const renderChevron = (w) => (
    <div className="flex flex-col items-center gap-1">
      <ClientCell {...(w.clients?.chevron ?? { completed: null })} />
      {w.clients?.chevron && w.clients.chevron.completed !== null && (
        <span onClick={() => handleViewGap(w.id)} className={LINK}>
          🔍 ดู Gap →
        </span>
      )}
    </div>
  );

  const renderMedical = (w) => {
    const med = getMedical(w);
    const others = getOtherMedicals(w);
    if (!med && others.length === 0)
      return <span className="text-gray-500">—</span>;

    const daysLeft = daysUntil(med?.expiryDate);
    const hasValidExp = daysLeft !== null;

    // "failed" (Unfit) ขึ้นเสมอ — ตรวจแล้วไม่ผ่านจริง คนละเรื่องกับวันหมดอายุ
    const isUnfit = med?.status === "failed";
    const [tone, label] = isUnfit
      ? ["red", "Unfit"]
      : medicalExpiryInfo(daysLeft, hasValidExp);
    const statusText = isUnfit ? null : MEDICAL_STATUS_LABEL[med?.status];
    const note = daysNote(daysLeft);

    return (
      <div className="flex flex-col items-center gap-[3px]">
        {med ? (
          <>
            <Badge tone={tone}>{label}</Badge>
            {statusText && (
              <div className="text-[11px] font-semibold text-gray-700">
                {statusText}
              </div>
            )}
            <div className={`text-[11px] ${expiryTextCls(daysLeft)}`}>
              {hasValidExp ? `Exp: ${fmtDate(med.expiryDate)}` : "No expiry"}
              {note && <div>{note}</div>}
            </div>
            {renderMedicalRequestButton(w, med.checkType, daysLeft)}
            {med.notes && (
              <span
                title={med.notes}
                onClick={() =>
                  setNoteModal({ name: w.fullName, note: med.notes })
                }
                className="max-w-[120px] cursor-pointer truncate text-[10px] text-gray-500 underline decoration-dotted"
              >
                📄 {med.notes}
              </span>
            )}
          </>
        ) : (
          <Badge tone="gray">No Check-up</Badge>
        )}

        {/* ผลตรวจประเภทอื่น เช่น Confined Space */}
        {others.map((o) => {
          const d = daysUntil(o.expiryDate);
          return (
            <div
              key={o.id}
              className="mt-1 w-full border-t border-dashed border-gray-200 pt-1 text-[10px] leading-snug"
              title={o.checkType}
            >
              <div className="truncate font-semibold text-gray-600">
                {o.checkType}
              </div>
              <div className={expiryTextCls(d)}>
                {d === null ? "No expiry" : `Exp: ${fmtDate(o.expiryDate)}`}
                {daysNote(d) && ` · ${daysNote(d)}`}
              </div>
              {renderMedicalRequestButton(w, o.checkType, d, true)}
            </div>
          );
        })}
      </div>
    );
  };

  useLayoutEffect(() => {
    const measure = () => {
      const el = tableBoxRef.current;
      if (!el || el.offsetParent === null) return; // ซ่อนอยู่ (จอเล็กใช้การ์ด)
      const top = el.getBoundingClientRect().top;
      setTableMaxH(Math.max(360, Math.floor(window.innerHeight - top - 24)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [loading, hasFilter, filteredWorkers.length]);

  const emptyText = loading
    ? "Loading compliance data..."
    : "No workers match the current filters.";

  // ── Alert modal: รวมทุกกลุ่ม (กัน upcoming เป็น undefined) ──
  const alertTotal = selectedAlert
    ? ALERT_GROUPS.reduce((n, g) => n + (selectedAlert[g.key]?.length || 0), 0)
    : 0;

  // แจ้งแล้ว = มีคำขอค้างอยู่ที่หน้า Requests (จาก backend) หรือเพิ่งกดส่งในรอบนี้
  const isRequested = (item) =>
    !!selectedAlert &&
    (item.requestPending ||
      requestedKeys.has(reqKey(selectedAlert.workerId, item.globalTrainingId)));

  // training ที่แจ้ง HR ได้และยังไม่ได้แจ้ง (ไม่ซ้ำ)
  const pendingRequestable = selectedAlert
    ? [
        ...new Map(
          ALERT_GROUPS.flatMap((g) => selectedAlert[g.key] || [])
            .filter(
              (it) =>
                it.type === "Training" &&
                it.globalTrainingId &&
                !isRequested(it),
            )
            .map((it) => [it.globalTrainingId, it]),
        ).values(),
      ]
    : [];

  // ปุ่ม "แจ้ง HR" หลัง training แต่ละตัว
  const renderRequestButton = (item) => {
    if (item.type !== "Training") return null;
    if (!item.globalTrainingId) {
      return (
        <span
          title="training นี้ยังไม่ได้ map กับรายการ training ในระบบ — แจ้ง HR อัตโนมัติไม่ได้"
          className="whitespace-nowrap rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-400"
        >
          แจ้งไม่ได้
        </span>
      );
    }
    if (isRequested(item)) {
      return (
        <Link
          to="/requests-history"
          className="whitespace-nowrap rounded-md bg-[#d1e7dd] px-2 py-1 text-[11px] font-semibold text-[#0f5132] no-underline hover:underline"
          title="มีคำขอรอ HR ดำเนินการอยู่แล้ว — ดูที่เมนู Training Bookings"
        >
          ✓ แจ้งแล้ว
        </Link>
      );
    }
    const k = reqKey(selectedAlert.workerId, item.globalTrainingId);
    return (
      <button
        onClick={() => sendTrainingRequest([item], k)}
        disabled={!!sendingKey}
        title="แจ้ง HR ให้จัด training นี้ — คำขอไปที่เมนู Training Bookings"
        className="cursor-pointer whitespace-nowrap rounded-md border border-blue-600 bg-white px-2 py-1 text-[11px] font-semibold text-blue-600 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60"
      >
        {sendingKey === k ? "..." : "📨 แจ้ง HR"}
      </button>
    );
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1800px]">
      {/* ════════ Header ════════ */}
      <div className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="m-0 text-lg font-bold">Compliance Center</h1>
          <div className="text-xs text-gray-500">
            Certification Monitoring, Gap Analysis &amp; Position Matching ·
            ตัวเลขด้านล่างและคอลัมน์ Training Alerts นับเฉพาะใบรับรอง training ·
            ผลตรวจสุขภาพดูที่คอลัมน์ Medical (แจ้ง HR นัดตรวจได้เมื่อเหลือไม่เกิน 120 วัน)
          </div>
        </div>
        <button
          onClick={exportPETracking}
          disabled={exportingPE}
          title="ผลตรวจสุขภาพรายคน (Physical Examination) ตาม layout PE tracking ของ HR"
          className="w-full shrink-0 cursor-pointer whitespace-nowrap rounded-md border-none bg-[#2B2F78] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#22265f] disabled:cursor-default disabled:bg-gray-400 sm:w-auto"
        >
          {exportingPE ? "Exporting…" : "⬇ Export PE Tracking (.xlsx)"}
        </button>
      </div>

      {/* ════════ ตัวเลขสถานะ — คลิกเพื่อกรอง (แบบเดียวกับ Dashboard) ════════ */}
      <div className="grid grid-cols-2 gap-px border-b border-gray-200 bg-gray-200 sm:grid-cols-3 lg:grid-cols-5 [&>*]:bg-white">
        {STAT_CARDS.map((card) => {
          const active = statusFilter === card.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => setStatusFilter(active ? "all" : card.key)}
              title={active ? "กดอีกครั้งเพื่อยกเลิกการกรอง" : "กดเพื่อกรองรายชื่อตามสถานะนี้"}
              className="cursor-pointer border-x-0 border-b-0 border-t-[3px] border-solid px-4 py-3 text-left transition-colors hover:bg-[var(--tint)]"
              style={{
                borderTopColor: card.color,
                "--tint": card.tint,
                ...(active ? { background: card.tint } : {}),
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-gray-500">
                  {card.icon} {card.label}
                </span>
                {active && (
                  <span className="text-[10px] font-bold" style={{ color: card.color }}>
                    กำลังกรอง ✕
                  </span>
                )}
              </div>
              <div
                className="mt-1 text-[26px] font-extrabold leading-tight"
                style={{ color: card.color }}
              >
                {stats[card.key]}
              </div>
            </button>
          );
        })}
      </div>

      {/* ════════ Filters — คั่นด้วยเส้น ════════ */}
      <div className="grid grid-cols-1 gap-3 border-b border-gray-200 py-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1.6fr)_minmax(0,1.1fr)_minmax(0,1fr)] lg:items-end">
        <div className="min-w-0">
          <label className={FILTER_LABEL}>
            Worker{" "}
            <span className="normal-case tracking-normal text-gray-400">
              (ID / ชื่อไทย / อังกฤษ)
            </span>
          </label>
          <Select
            options={workerOptions}
            value={workerOptions.find((o) => o.value === workerFilter) || null}
            onChange={(o) => setWorkerFilter(o ? o.value : "")}
            filterOption={filterWorkerOption}
            placeholder="🔍 ค้นหาด้วย ID หรือชื่อ (ไทย/อังกฤษ)..."
            isClearable
            styles={customSelectStyles}
            {...MENU_PORTAL}
            noOptionsMessage={() => "ไม่พบ worker"}
          />
        </div>
        <div className="min-w-0">
          <label className={FILTER_LABEL}>Position</label>
          <Select
            options={positionOptions}
            value={positionOptions.find((o) => o.value === positionFilter) || null}
            onChange={(o) => setPositionFilter(o ? o.value : "")}
            placeholder="All Positions"
            isClearable
            styles={customSelectStyles}
            {...MENU_PORTAL}
            noOptionsMessage={() => "ไม่พบตำแหน่ง"}
          />
        </div>
        <div className="min-w-0">
          <label className={FILTER_LABEL}>Department</label>
          <Select
            options={departmentOptions}
            value={departmentOptions.find((o) => o.value === departmentFilter) || null}
            onChange={(o) => setDepartmentFilter(o ? o.value : "")}
            placeholder="All Departments"
            isClearable
            styles={customSelectStyles}
            {...MENU_PORTAL}
            noOptionsMessage={() => "ไม่พบแผนก"}
          />
        </div>
        <div className="min-w-0">
          <label className={`${FILTER_LABEL} flex items-center justify-between`}>
            <span>Status</span>
            {hasFilter && (
              <button
                onClick={() => {
                  setWorkerFilter("");
                  setPositionFilter("");
                  setDepartmentFilter("");
                  setStatusFilter("all");
                }}
                className="cursor-pointer border-none bg-transparent p-0 text-[11px] font-semibold normal-case tracking-normal text-[#dc3545] underline"
              >
                ✕ ล้างทั้งหมด
              </button>
            )}
          </label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="box-border h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-[13px] outline-none focus:border-blue-400"
          >
            <option value="all">All Status</option>
            <option value="expired">🔴 Expired</option>
            <option value="critical">🔥 Critical (&lt;30 days)</option>
            <option value="warning">🟡 Warning (30-90 days)</option>
            <option value="upcoming">🔵 Upcoming (90-120 days)</option>
            <option value="valid">✅ No Alerts (training + medical)</option>
          </select>
        </div>
      </div>

      {/* ════════ Worker Compliance ════════ */}
      <div className="border-b border-gray-200">
        <div className="flex flex-wrap items-center justify-between gap-2 py-3">
          <span className="border-l-[3px] border-[#2B2F78] pl-2.5 text-[15px] font-bold leading-tight">
            Worker Compliance Overview
          </span>
          <span className="text-xs text-gray-500">
            {filteredWorkers.length} of {workers.length}
          </span>
        </div>

        {/* ── ต่ำกว่า lg: การ์ด ── */}
        <div className="lg:hidden">
          {loading || filteredWorkers.length === 0 ? (
            <div className="p-10 text-center text-[13px] text-gray-500">
              {emptyText}
            </div>
          ) : (
            <div className="divide-y divide-gray-100 border-t border-gray-200">
              {filteredWorkers.map((w) => (
                <div key={w.id} className="py-3 text-[13px]">
                  <div className="mb-2">
                    {renderWorker(w)}
                    <div className="mt-1 text-xs text-gray-500">
                      {w.position?.name || "—"}
                      {w.department && (
                        <span className="text-gray-400"> · {w.department}</span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 border-t border-gray-100 pt-2.5">
                    {[
                      ["Training", renderAlerts(w)],
                      ["Medical", renderMedical(w)],
                      ["Chevron", renderChevron(w)],
                    ].map(([label, content]) => (
                      <div key={label} className="min-w-0 text-center">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.5px] text-gray-400">
                          {label}
                        </div>
                        {content}
                      </div>
                    ))}
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
          className="hidden max-h-[calc(100vh-300px)] min-h-[360px] overflow-auto border-t border-gray-200 lg:block"
        >
          <table className="w-full table-fixed border-collapse text-[13px]">
            <thead>
              <tr>
                {TABLE_HEADERS.map(([h, align, width]) => (
                  <th
                    key={h}
                    className={`${STICKY_TH} ${align} ${width}`}
                  >
                    {h}
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
                filteredWorkers.map((w, idx) => (
                  <tr
                    key={w.id}
                    className={`transition-colors duration-150 hover:bg-gray-50 ${
                      idx < filteredWorkers.length - 1
                        ? "border-b border-gray-100"
                        : ""
                    }`}
                  >
                    <td className="px-3.5 py-3">{renderWorker(w)}</td>
                    <td className="px-3.5 py-3 text-gray-500">
                      <div className="truncate" title={w.position?.name || ""}>
                        {w.position?.name || "—"}
                      </div>
                    </td>
                    <td className="px-3.5 py-3 text-gray-500">
                      <div className="truncate" title={w.department || ""}>
                        {w.department || "—"}
                      </div>
                    </td>
                    <td className="px-3.5 py-3 text-center">
                      {renderAlerts(w)}
                    </td>
                    <td className="px-3.5 py-3 text-center">
                      {renderMedical(w)}
                    </td>
                    <td className="px-3.5 py-3 text-center">
                      {renderChevron(w)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ════════ Gap Modal — Mandatory / Assigned / Others ════════ */}
      {selectedGap && (() => {
        const clientEntries = Object.entries(selectedGap.clients || {});
        const single = clientEntries.length === 1;

        // % Match อิงจาก Mandatory เท่านั้น (ตรงกับคอลัมน์ CHEVRON MATCH)
        const scoreOf = (client) => {
          const m = client.mandatory ?? EMPTY_GROUP;
          const score =
            m.required.length > 0
              ? Math.round((m.completed.length / m.required.length) * 100)
              : 0;
          const tone =
            m.missing.length === 0 ? TONE.green : score >= 80 ? TONE.yellow : TONE.red;
          return [score, tone];
        };
        const scorePill = (client) => {
          const [score, tone] = scoreOf(client);
          return (
            <span className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold ${tone}`}>
              {score}% Match
            </span>
          );
        };

        return (
          <Modal
            maxW="max-w-[900px]"
            title={`Gap Analysis — ${selectedGap.fullName}`}
            subtitle={
              <div className="text-xs text-gray-500">
                {selectedGap.position}
                {/* client เดียว → ชื่อ client อยู่บรรทัดเดียวกับตำแหน่ง ไม่ต้องมีกรอบแยก */}
                {single && (
                  <span className="font-semibold uppercase text-gray-700">
                    {" "}· {clientEntries[0][0]}
                  </span>
                )}
              </div>
            }
            headerRight={single ? scorePill(clientEntries[0][1]) : null}
            onClose={() => setSelectedGap(null)}
          >
            <TrainingPlanNotice plans={empPlan.plans} loading={empPlan.loading} className="mb-3" />
            {clientEntries.map(([clientName, client]) => {
              const mandatory = client.mandatory ?? EMPTY_GROUP;
              const assigned = client.assigned ?? EMPTY_GROUP;
              const others = client.others ?? { completed: [] };

              return (
                <div
                  key={clientName}
                  className={
                    single
                      ? "space-y-4"
                      : "mb-3 space-y-4 rounded-[10px] border border-gray-200 p-3 sm:p-4"
                  }
                >
                  {!single && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-bold uppercase">{clientName}</span>
                      {scorePill(client)}
                    </div>
                  )}

                  {/* Mandatory */}
                  <div>
                    <GapGroupHeader
                      dot="bg-red-500"
                      title="Mandatory"
                      required={mandatory.required.length}
                      completed={mandatory.completed.length}
                      missing={mandatory.missing.length}
                    />
                    <GapTrainingTags
                      missing={mandatory.missing}
                      completed={mandatory.completed}
                      plans={empPlan.plans}
                    />
                  </div>

                  {/* Assigned */}
                  <div className="border-t border-gray-100 pt-3">
                    {assigned.required.length === 0 ? (
                      <div className="flex items-center gap-2 text-[13px]">
                        <span className="h-2.5 w-2.5 rounded-full bg-orange-400" />
                        <span className="font-bold">Assigned</span>
                        <span className="text-xs text-gray-500">
                          — ไม่มี Assigned training สำหรับตำแหน่งนี้
                        </span>
                      </div>
                    ) : (
                      <>
                        <GapGroupHeader
                          dot="bg-orange-400"
                          title="Assigned"
                          required={assigned.required.length}
                          completed={assigned.completed.length}
                          missing={assigned.missing.length}
                        />
                        <GapTrainingTags
                          missing={assigned.missing}
                          completed={assigned.completed}
                          plans={empPlan.plans}
                        />
                      </>
                    )}
                  </div>

                  {/* Others */}
                  <div className="border-t border-gray-100 pt-3">
                    <div className="mb-1.5 flex flex-wrap items-center gap-x-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
                      <span className="text-[13px] font-bold">
                        Others ({others.completed.length})
                      </span>
                      <span className="text-[11px] text-gray-500">
                        training ที่มีนอกเหนือจาก matrix ตำแหน่งนี้
                      </span>
                    </div>
                    {others.completed.length === 0 ? (
                      <div className="text-xs text-gray-500">— ไม่มี</div>
                    ) : (
                      <TagList
                        items={others.completed}
                        prefix="✓"
                        cls="border-gray-200 bg-gray-100 text-gray-700"
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </Modal>
        );
      })()}

      {/* ════════ Alert Modal ════════ */}
      {selectedAlert && (
        <Modal
          maxW="max-w-[700px]"
          title={`Training Alerts — ${selectedAlert.fullName}`}
          subtitle={
            <div className="mt-2 flex flex-wrap gap-1.5">
              {selectedAlert.expired?.length > 0 && (
                <Badge tone="red">
                  🔴 {selectedAlert.expired.length} Expired
                </Badge>
              )}
              {selectedAlert.critical?.length > 0 && (
                <Badge tone="red">
                  🔥 {selectedAlert.critical.length} Critical
                </Badge>
              )}
              {selectedAlert.warning?.length > 0 && (
                <Badge tone="yellow">
                  🟡 {selectedAlert.warning.length} Warning
                </Badge>
              )}
              {selectedAlert.upcoming?.length > 0 && (
                <Badge tone="indigo">
                  🔵 {selectedAlert.upcoming.length} Upcoming
                </Badge>
              )}
            </div>
          }
          onClose={() => setSelectedAlert(null)}
        >
          <TrainingPlanNotice plans={empPlan.plans} loading={empPlan.loading} className="mb-4" />
          {/* แจ้ง HR ทั้งหมดในครั้งเดียว — เฉพาะ training ที่ยังไม่ได้แจ้ง */}
          {pendingRequestable.length > 1 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5">
              <span className="text-xs text-gray-700">
                แจ้ง HR ให้จัด training ที่หมด/ใกล้หมดทั้งหมด → ไปที่เมนู
                Training Bookings
              </span>
              <button
                onClick={() => sendTrainingRequest(pendingRequestable, "all")}
                disabled={!!sendingKey}
                className="cursor-pointer whitespace-nowrap rounded-md border-none bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
              >
                {sendingKey === "all"
                  ? "กำลังส่ง..."
                  : `📨 แจ้ง HR ทั้งหมด (${pendingRequestable.length})`}
              </button>
            </div>
          )}
          {ALERT_GROUPS.map(({ key, label, text }) => {
            const items = selectedAlert[key] || [];
            if (items.length === 0) return null;
            return (
              <div key={key} className="mb-6">
                <div className={`mb-2 text-sm font-bold ${text}`}>{label}</div>
                {items.map((item, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-gray-100 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700">
                        {item.type}
                      </span>
                      <span className="break-words text-[13px]">
                        {item.name}
                        {item.type === "Training" && (
                          <PlanTag
                            plan={findPlan(empPlan.plans, {
                              trainingId: item.globalTrainingId,
                              name: item.name,
                            })}
                          />
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <div className={`text-xs font-semibold ${text}`}>
                        {new Date(item.expiryDate).toLocaleDateString()} (
                        {Math.abs(item.daysLeft)} days{" "}
                        {item.daysLeft < 0 ? "ago" : "left"})
                      </div>
                      {renderRequestButton(item)}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
          {alertTotal === 0 && (
            <div className="p-8 text-center font-semibold text-[#198754]">
              ✅ All training certificates valid
            </div>
          )}
        </Modal>
      )}

      {/* ════════ Medical Notes Modal ════════ */}
      {noteModal && (
        <Modal
          maxW="max-w-[480px]"
          title={`📄 Medical Notes — ${noteModal.name}`}
          onClose={() => setNoteModal(null)}
        >
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-900">
            {noteModal.note}
          </div>
        </Modal>
      )}
    </div>
  );
}
