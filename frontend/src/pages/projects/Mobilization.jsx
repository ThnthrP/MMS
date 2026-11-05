import { useState, useEffect, useContext, useMemo, useRef } from "react";
import axios from "axios";
import Select from "react-select";
import { AppContent } from "../../context/AppContext";
import useStickyState from "../../hooks/useStickyState";
import { Link, useSearchParams } from "react-router-dom";

const DEMOB_DAYS = 28;

// ══════════════════════════════════════════════════════════
// ข้อมูลคงที่
// ══════════════════════════════════════════════════════════
const PPE_ITEMS = [
  "Workwear",
  "Hardhat Helmets",
  "Welding Helmets",
  "Safety glasses",
  "Goggles",
  "Face shields",
  "Welding face shield",
  "Foot Protection",
  "Hearing Protection",
  "Welding Gloves",
  "G-tech Gloves",
  "Impact Gloves",
  "Half mask",
  "Specialized Protection",
  "Other",
];
const PPE_REQUIRED = PPE_ITEMS.filter((i) => i !== "Other");

const TRAINING_TOPICS = [
  "Safety Oriented",
  "Currently alert case from offshore work",
  "Human performance issue",
  "Knowledge sharing",
  "28 Days plan",
  "Other",
];

const CHECKLIST_DEFS = [
  { type: "alcohol_test", label: "ตรวจแอลกอฮอล์", valueLabel: "ระดับ (mg%)" },
  {
    type: "drug_test",
    label: "ตรวจสารเสพติด",
    note: "ตรวจ 9 สาร: Amphetamines, Methamphetamine, Ecstasy, Benzodiazepines, Cannabinoids, Cocaine Metabolites, Opiates, Phencyclidine, Mitragynine",
  },
  {
    type: "ppe_inspection",
    label: "ตรวจ PPE (Pre-Mob)",
    items: PPE_ITEMS,
    notesLabel: "ระบุอุปกรณ์ Other...",
  },
  {
    type: "pre_field_training",
    label: "อบรมก่อนปฏิบัติงานนอกพื้นที่",
    freeTextItems: TRAINING_TOPICS,
  },
  {
    type: "baggage_inspection",
    label: "ตรวจกระเป๋า Mob/D-Mob",
    baggageFields: true,
  },
  {
    type: "blood_pressure_check",
    label: "ตรวจความดันโลหิต",
    vitalsFields: true,
  },
];

const RESULT_OPTIONS = [
  { value: "pass", label: "Pass", tone: "ok" },
  { value: "fail", label: "Fail", tone: "danger" },
  { value: "not_applicable", label: "N/A", tone: "muted" },
];
const BAGGAGE_OPTIONS = [
  { value: "pass", label: "Pass", tone: "ok" },
  { value: "fail", label: "Reject", tone: "danger" },
];
const DRESS_OPTIONS = [
  { value: "good", label: "Good", tone: "ok" },
  { value: "reject", label: "Reject", tone: "danger" },
];
const RESULT_TONE = { pass: "ok", fail: "danger", not_applicable: "muted" };
const RESULT_LABEL = { pass: "Pass", fail: "Fail", not_applicable: "N/A" };

const BAN_DURATION_OPTIONS = [
  { value: 3, label: "3 เดือน" },
  { value: 5, label: "5 เดือน" },
  { value: 6, label: "6 เดือน" },
  { value: 12, label: "1 ปี" },
  { value: "custom", label: "กำหนดเอง" },
];

const MEDICAL_STATUS_LABEL = {
  passed: "Fit",
  pending: "Pending",
  failed: "Unfit",
  not_required: "Fit w/ Restriction",
};

const WORKER_CONFIRM_TONE = {
  pending: "warn",
  confirmed: "ok",
  rejected: "danger",
};
const WORKER_CONFIRM_LABEL = {
  pending: "⏳ รอ Worker ยืนยัน",
  confirmed: "✓ Worker ยืนยันแล้ว",
  rejected: "✕ Worker ปฏิเสธ",
};

const STATUS_TONE = { pending: "warn", ready: "info", deployed: "ok" };
const STATUS_LABEL = {
  pending: "Pending",
  ready: "Ready",
  deployed: "Deployed",
};

// ══════════════════════════════════════════════════════════
// Tailwind class ที่ใช้ซ้ำ
// ══════════════════════════════════════════════════════════
const TONE_CLASSES = {
  ok: "bg-emerald-100 text-emerald-800",
  warn: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
  muted: "bg-gray-100 text-gray-500",
  info: "bg-blue-100 text-blue-800",
};
// ปุ่มแบบกลุ่ม (Pass/Fail/N/A) ตอนถูกเลือก
const ACTIVE_TONE = {
  ok: "border-emerald-700 bg-emerald-100 text-emerald-800",
  danger: "border-red-700 bg-red-100 text-red-800",
  muted: "border-gray-400 bg-gray-100 text-gray-600",
};
const HEALTH_TONE = {
  low: ["Low", "bg-[#d1e7dd] text-[#0f5132]"],
  moderate: ["Moderate", "bg-[#fff3cd] text-[#664d03]"],
  high: ["High", "bg-[#f8d7da] text-[#842029]"],
  significant: ["Significant", "bg-[#f5c2c7] text-[#58151c]"],
  pending: ["Pending", "bg-gray-100 text-gray-500"],
};

// section คั่นด้วยเส้น (ไม่มีกรอบ card)
const CARD = "border-b border-gray-200";
// หัวคอลัมน์ขึ้นบรรทัดใหม่ได้ (เดิม nowrap → "Pre-Mob Checklist" ถูกตัด)
const TH =
  "sticky top-0 z-[1] bg-white px-2.5 py-2.5 align-bottom text-[11px] font-bold uppercase leading-tight tracking-[0.3px] text-gray-500 shadow-[inset_0_-1px_0_#e9ecef]";
const TD =
  "border-b border-gray-100 px-2.5 py-2.5 align-middle text-[13px] [overflow-wrap:anywhere]";

// 12px บนจอใหญ่ · จอสัมผัสได้ 16px จาก index.css (กัน iOS ซูม)
// min-h + text-left: กันช่องวันที่ว่างยุบ/จัดกึ่งกลางใน iOS Safari
const INPUT =
  "box-border w-full min-w-0 min-h-[34px] appearance-none rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 [&::-webkit-date-and-time-value]:text-left";
const LABEL_SM =
  "mb-1 block text-[11px] font-semibold uppercase tracking-[0.4px] text-gray-500";
const FILTER_LABEL =
  "mb-1 block text-xs font-semibold uppercase tracking-[0.4px] text-gray-500";
const SEG_BTN =
  "flex-1 cursor-pointer rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const LIFT_RED =
  "cursor-pointer rounded-md border-none bg-[#fff5f5] text-[#842029] shadow-[0_1px_3px_rgba(220,53,69,0.15),0_1px_2px_rgba(0,0,0,0.06)] transition-all hover:-translate-y-px hover:shadow-[0_3px_6px_rgba(220,53,69,0.25),0_2px_3px_rgba(0,0,0,0.08)]";
const LIFT_DANGER =
  "bg-[#f8d7da] text-[#842029] shadow-[0_1px_3px_rgba(220,53,69,0.25),0_1px_2px_rgba(0,0,0,0.06)] hover:-translate-y-px hover:shadow-[0_3px_6px_rgba(220,53,69,0.35),0_2px_3px_rgba(0,0,0,0.08)]";
const LIFT_BLUE_SOFT =
  "bg-blue-50 text-blue-700 shadow-[0_1px_3px_rgba(13,110,253,0.2),0_1px_2px_rgba(0,0,0,0.06)] hover:-translate-y-px hover:shadow-[0_3px_6px_rgba(13,110,253,0.3),0_2px_3px_rgba(0,0,0,0.08)]";
const BTN_OUTLINE =
  "cursor-pointer rounded-lg border border-gray-200 bg-white px-5 py-2 text-[13px] hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60";
const DASH = <span className="text-gray-400">—</span>;

// ── react-select (ใช้ styles API ของไลบรารี) ──
const projectSelectStyles = {
  control: (b) => ({
    ...b,
    borderColor: "#ced4da",
    borderRadius: "8px",
    minHeight: "40px",
    fontSize: "14px",
    boxShadow: "none",
    "&:hover": { borderColor: "#86b7fe" },
  }),
  option: (b) => ({ ...b, fontSize: "13px" }),
  placeholder: (b) => ({ ...b, fontSize: "14px", color: "#6c757d" }),
  menuPortal: (b) => ({ ...b, zIndex: 9999 }),
  menu: (b) => ({ ...b, minWidth: "min(560px, calc(100vw - 40px))" }),
  menuList: (b) => ({ ...b, maxHeight: "360px" }),
  singleValue: (b) => ({
    ...b,
    whiteSpace: "normal",
    wordBreak: "break-word",
    overflow: "visible",
    lineHeight: "1.3",
  }),
  valueContainer: (b) => ({ ...b, padding: "6px 8px" }),
};
// ══════════════════════════════════════════════════════════
// helpers
// ══════════════════════════════════════════════════════════
// วันที่จาก DB (เก็บเป็นเที่ยงคืน UTC) → "YYYY-MM-DD"
function ymd(d) {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

// วัน-เวลาจริง (เช่น createdAt) → "YYYY-MM-DD" ตามเวลาเครื่อง
// (เดิมใช้ toISOString → deploy ช่วง 00:00–07:00 น. วันที่จะเลื่อนไปวันก่อนหน้า)
function ymdLocal(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${m}-${day}`;
}

function addDays(dateStr, days) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function calcAge(birthDate) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (isNaN(b.getTime())) return null;
  return Math.floor((Date.now() - b.getTime()) / (365.25 * 86400000));
}

const fmtShort = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : null;

function medicalFit(expiry, status) {
  // "failed" (Unfit) ต้องบล็อกเสมอ ไม่ว่าวันหมดอายุจะยังไม่ถึงก็ตาม
  if (status === "failed") {
    return {
      fit: false,
      label: "Unfit",
      statusText: null,
      tone: "danger",
      expiry: expiry ? new Date(expiry) : null,
    };
  }
  // ผลตรวจจริง แสดงแยกจาก badge หลัก (badge สื่อ "ใบด่วนแค่ไหน")
  const statusText = MEDICAL_STATUS_LABEL[status] || null;
  const d = expiry ? new Date(expiry) : null;
  if (!d || isNaN(d.getTime()))
    return {
      fit: false,
      label: "No record",
      statusText,
      tone: "muted",
      expiry: null,
    };
  const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
  if (days < 0)
    return {
      fit: false,
      label: "Overdue",
      statusText,
      tone: "danger",
      expiry: d,
    };
  if (days <= 30)
    return {
      fit: true,
      label: "Due soon",
      statusText,
      tone: "warn",
      expiry: d,
    };
  return { fit: true, label: "Valid", statusText, tone: "ok", expiry: d };
}

const healthRiskDisplay = (raw) => {
  const n = (raw || "").toLowerCase();
  const key = ["significant", "moderate", "high", "low", "pending"].find((k) =>
    n.includes(k),
  );
  return key
    ? { label: HEALTH_TONE[key][0], cls: HEALTH_TONE[key][1] }
    : { label: raw, cls: "bg-gray-100 text-gray-700" };
};

function checklistSummary(checklist = []) {
  const passed = checklist.filter(
    (t) => t.resultStatus === "pass" || t.resultStatus === "not_applicable",
  ).length;
  return { passed, total: checklist.length || CHECKLIST_DEFS.length };
}

function checklistComplete(checklist = []) {
  if (!checklist.length) return false;
  return checklist.every(
    (t) => t.resultStatus === "pass" || t.resultStatus === "not_applicable",
  );
}

// เหตุผลที่ยัง Deploy ไม่ได้ (ข้อแรกที่เจอ) — null = พร้อม Deploy
function deployBlockReason(r) {
  if (r.deployed) return "Deploy แล้ว";
  if (r.activeBan) return "พนักงานถูกแบนอยู่";
  if (r.workerConfirmStatus === "pending")
    return "รอพนักงานยืนยันงานใน Worker App";
  if (r.workerConfirmStatus === "rejected") return "พนักงานปฏิเสธงานนี้";
  if (!checklistComplete(r.checklist)) return "Pre-Mob checklist ยังไม่ครบ";
  if (!medicalFit(r.medicalExpiry, r.medicalStatus).fit)
    return "Medical ไม่ผ่าน / หมดอายุ";
  if (!r.mobDate) return "ยังไม่ได้กรอกวัน MOB";
  if (!r.platform) return "ยังไม่ได้กรอก Platform";
  return null;
}
const isReady = (r) => deployBlockReason(r) === null;
const rowStatus = (r) =>
  r.deployed ? "deployed" : isReady(r) ? "ready" : "pending";

const errMsg = (err, fallback) => err.response?.data?.message || fallback;

// ══════════════════════════════════════════════════════════
// small components
// ══════════════════════════════════════════════════════════
function Badge({ tone = "muted", title, children }) {
  return (
    <span
      title={title}
      className={`${TONE_CLASSES[tone] ?? TONE_CLASSES.muted} whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold`}
    >
      {children}
    </span>
  );
}

function Modal({ onClose, z = "z-[999999]", maxW, children }) {
  return (
    <div
      className={`fixed inset-0 ${z} flex items-center justify-center bg-black/50 p-3 sm:p-5`}
      onClick={onClose}
    >
      <div
        className={`flex max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] w-full ${maxW} flex-col overflow-hidden rounded-[10px] bg-white`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function ModalHead({ title, sub, bg = "bg-[#1e3a5f]", right, onClose }) {
  return (
    <div
      className={`flex shrink-0 items-start justify-between gap-3 px-4 py-3.5 text-white sm:px-6 ${bg}`}
    >
      <div className="min-w-0">
        <div className="text-[15px] font-bold">{title}</div>
        {sub && (
          <div className="mt-0.5 break-words text-xs opacity-90">{sub}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {right}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="ปิด (Esc)"
            className="cursor-pointer border-none bg-transparent text-xl leading-none text-white"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function Segmented({ options, value, onPick, disabled }) {
  return (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onPick(o.value)}
          className={`${SEG_BTN} ${
            value === o.value
              ? ACTIVE_TONE[o.tone]
              : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children, className = "mb-2.5" }) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-semibold text-gray-700">
        {label}
      </label>
      {children}
    </div>
  );
}

// รายการที่เพิ่มแล้ว (หัวข้ออบรม / PPE Other)
function EntryList({ entries, onRemove, disabled, canEdit, white }) {
  if (!entries.length) return null;
  return (
    <div className="mb-2 flex flex-col gap-1">
      {entries.map((item, idx) => (
        <div
          key={idx}
          className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs ${
            white ? "border border-gray-200 bg-white" : "bg-gray-50"
          }`}
        >
          <span className="w-4 shrink-0 text-gray-500">{idx + 1}.</span>
          <span className="min-w-0 flex-1 break-words">{item}</span>
          {canEdit && (
            <button
              type="button"
              onClick={() => onRemove(idx)}
              disabled={disabled}
              title="ลบรายการนี้"
              className="cursor-pointer border-none bg-transparent p-0 text-[13px] leading-none text-red-600 disabled:opacity-50"
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function AddEntry({ value, onChange, onAdd, placeholder, disabled }) {
  return (
    <div className="flex gap-1.5">
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onAdd();
          }
        }}
        className={`${INPUT} flex-1`}
      />
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled || !value.trim()}
        className="shrink-0 cursor-pointer rounded-md border border-blue-600 bg-white px-3 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400 disabled:hover:bg-white"
      >
        + เพิ่ม
      </button>
    </div>
  );
}

// แถบความคืบหน้า n / q
// สถานะต่อตำแหน่ง: done = Deploy ครบ · ready = Approve ครบ รอ Deploy · short = Approve ยังไม่ครบ
function positionState(p) {
  if (p.deployedCount >= p.quantity) return "done";
  if (p.approvedCount >= p.quantity) return "ready";
  return "short";
}
const POSITION_STATE = {
  short: { dot: "bg-amber-500", label: "Approve ยังไม่ครบ", order: 0 },
  ready: { dot: "bg-blue-500", label: "รอ Deploy", order: 1 },
  done: { dot: "bg-emerald-500", label: "Deploy ครบแล้ว", order: 2 },
};

// ชิปสรุปต่อตำแหน่ง (บรรทัดเดียว) — แทนการ์ดเดิมที่สูงจนดันตารางพนักงานลงไป
function PositionChip({ p, active, onClick }) {
  const st = POSITION_STATE[positionState(p)];
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${p.positionName ?? "Unknown"} — ${st.label}\nApproved ${p.approvedCount}/${p.quantity} · Deployed ${p.deployedCount}/${p.quantity}\n${
        active ? "กดอีกครั้งเพื่อแสดงทุกตำแหน่ง" : "กดเพื่อกรองเฉพาะตำแหน่งนี้"
      }`}
      aria-pressed={active}
      className={`inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active
          ? "border-blue-500 bg-blue-50 ring-2 ring-blue-500/20"
          : "border-gray-200 bg-white hover:border-blue-300"
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`} />
      <span className="min-w-0 max-w-[220px] truncate font-semibold text-gray-800">
        {p.positionName ?? "Unknown"}
      </span>
      <span className="shrink-0 tabular-nums text-gray-500">
        A {p.approvedCount}/{p.quantity} · D{" "}
        <span
          className={
            p.deployedCount >= p.quantity ? "font-semibold text-emerald-700" : ""
          }
        >
          {p.deployedCount}/{p.quantity}
        </span>
      </span>
    </button>
  );
}

function IconBtn({ title, onClick, big, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`${LIFT_RED} flex shrink-0 items-center justify-center p-0 text-[13px] ${
        big ? "h-9 w-9" : "h-7 w-7"
      }`}
    >
      {children}
    </button>
  );
}

// ══════════════════════════════════════════════════════════
// main
// ══════════════════════════════════════════════════════════
export default function Mobilization() {
  const { backendUrl, userData } = useContext(AppContent);
  const [searchParams] = useSearchParams();

  // ทุกคนที่ login เข้ามาจัดการหน้านี้ได้เต็มสิทธิ์ (สิทธิ์เข้าหน้าคุมที่ AppRouter)
  const canManageMobilization = true;
  const canManageChecklist = true;
  // Dev tool เท่านั้น — จำกัดเฉพาะ admin
  const isAdmin = userData?.role?.name === "admin";

  // ── Project ──
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useStickyState(
    "mob_projectId",
    "",
  );
  const [project, setProject] = useState(null);
  // deploy ค้าง: มีข้อมูลลงงานในโปรเจกต์นี้ แต่ไม่ได้ Approve แล้ว (ไม่ขึ้นในตารางด้านล่าง)
  const [orphans, setOrphans] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const fetchReqRef = useRef(0);

  const [positionSummary, setPositionSummary] = useState([]);
  const [positionFilter, setPositionFilter] = useStickyState(
    "mob_positionFilter",
    "all",
  );

  // ── หัวข้ออบรม (ทั้งหมด) ──
  const [bulkEntries, setBulkEntries] = useState({});
  const [bulkDraft, setBulkDraft] = useState({});
  const [applyingBulk, setApplyingBulk] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  // ── Checklist modal ──
  const [checklistModal, setChecklistModal] = useState(null); // row object
  const [savingTaskId, setSavingTaskId] = useState(null);
  const [uploadingTaskId, setUploadingTaskId] = useState(null);
  const [previewPhoto, setPreviewPhoto] = useState(null);
  const [otherDraft, setOtherDraft] = useState({}); // { [key]: ข้อความที่กำลังพิมพ์ }
  const [manualOverride, setManualOverride] = useState({}); // เปิด/ปิดหัวข้อที่ผู้ใช้กดเอง

  // ── Ban / Lift ban ──
  const [banModal, setBanModal] = useState(null); // { taskId?, employeeId, fullName, reason? }
  const [banDuration, setBanDuration] = useState(3);
  const [banCustomDate, setBanCustomDate] = useState("");
  const [banNote, setBanNote] = useState("");
  const [banning, setBanning] = useState(false);
  const [liftBanModal, setLiftBanModal] = useState(null); // { banId, fullName }
  const [liftReason, setLiftReason] = useState("");
  const [lifting, setLifting] = useState(false);

  // ===========================================================
  // Fetch
  // ===========================================================
  useEffect(() => {
    axios
      .get(`${backendUrl}/api/allocation/projects`, { withCredentials: true })
      .then((res) => setProjects(res.data))
      .catch((err) => console.error(err));
  }, [backendUrl]);

  // sync selectedProjectId จาก URL (?projectId=...) เช่นลิงก์จากหน้า Allocation
  useEffect(() => {
    const pid = searchParams.get("projectId");
    if (pid) setSelectedProjectId(pid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const buildRows = (data) => {
    const defaultMob = ymd(data.project.startDate);
    return data.workers.map((w) => {
      const asg = w.assignment;
      const mobDate = asg?.mobDate ? ymd(asg.mobDate) : defaultMob;
      return {
        ...w,
        mobDate,
        demobDate: asg?.demobDate
          ? ymd(asg.demobDate)
          : addDays(mobDate, DEMOB_DAYS),
        fromLocation: asg?.fromLocation ?? w.previousPlatform ?? "",
        platform: asg?.platform ?? "",
        deployed: !!asg,
        deployedAt: asg?.createdAt ?? null,
        checklist: w.checklist ?? [],
      };
    });
  };

  const fetchList = async (projectId) => {
    const reqId = ++fetchReqRef.current; // กันผล project เก่ามาทับ project ใหม่
    try {
      setLoading(true);
      const res = await axios.get(
        `${backendUrl}/api/mobilization/${projectId}`,
        { withCredentials: true },
      );
      if (reqId !== fetchReqRef.current) return;
      const data = res.data;
      setProject(data.project);
      // ไม่บังคับ — โหลดไม่ได้ก็แค่ไม่แสดงแถบเตือน
      axios
        .get(`${backendUrl}/api/supervisor/projects-overview/${projectId}`, {
          withCredentials: true,
        })
        .then(
          (r) =>
            reqId === fetchReqRef.current &&
            setOrphans(r.data?.orphanAssignments ?? []),
        )
        .catch(() => setOrphans([]));
      setPositionSummary(data.positionSummary ?? []);

      const freshRows = buildRows(data);

      // หัวข้ออบรม (ทั้งหมด) — ดึงจาก task ของคนแรกที่มีข้อมูล
      const seed = Object.fromEntries(TRAINING_TOPICS.map((t) => [t, []]));
      const sampleTask = freshRows
        .flatMap((r) => r.checklist)
        .find((t) => t.taskType === "pre_field_training" && t.itemsChecked);
      if (sampleTask) {
        TRAINING_TOPICS.forEach((topic) => {
          const entries = sampleTask.itemsChecked?.[topic]?.entries;
          if (Array.isArray(entries)) seed[topic] = entries;
        });
      }
      setBulkEntries(seed);

      // รักษาค่าที่พิมพ์ไว้ในเครื่องของคนที่ "ยังไม่ deploy"
      // ไม่ให้ถูกรีเซ็ตตอน fetchList ถูกเรียกใหม่จากการ deploy คนอื่น
      setRows((prevRows) =>
        freshRows.map((fresh) => {
          if (fresh.deployed) return fresh;
          const prev = prevRows.find((r) => r.employeeId === fresh.employeeId);
          if (!prev || prev.deployed) return fresh;
          return {
            ...fresh,
            mobDate: prev.mobDate,
            demobDate: prev.demobDate,
            fromLocation: prev.fromLocation,
            platform: prev.platform,
          };
        }),
      );
    } catch (err) {
      console.error(err);
      if (reqId !== fetchReqRef.current) return;
      setProject(null);
      setRows([]);
      setPositionSummary([]);
    } finally {
      if (reqId === fetchReqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedProjectId) {
      fetchReqRef.current++;
      setProject(null);
      setRows([]);
      setPositionSummary([]);
      return;
    }
    setRows([]); // เปลี่ยน project → ล้างค่าที่พิมพ์ค้างของ project ก่อน
    fetchList(selectedProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  // ตัวกรองตำแหน่งที่จำไว้ ไม่มีอยู่ใน project นี้ → กลับเป็น All
  // (เดิมตารางว่างเปล่าโดยไม่รู้สาเหตุ)
  useEffect(() => {
    if (
      positionFilter !== "all" &&
      positionSummary.length > 0 &&
      !positionSummary.some((p) => p.requestId === positionFilter)
    ) {
      setPositionFilter("all");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionSummary]);

  useEffect(() => {
    setManualOverride({});
  }, [checklistModal?.employeeId]);

  // Esc ปิด modal บนสุดทีละตัว
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (previewPhoto) setPreviewPhoto(null);
      else if (liftBanModal && !lifting) setLiftBanModal(null);
      else if (banModal && !banning) setBanModal(null);
      else if (checklistModal) setChecklistModal(null);
      else if (bulkOpen && !applyingBulk) setBulkOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    previewPhoto,
    liftBanModal,
    lifting,
    banModal,
    banning,
    checklistModal,
    bulkOpen,
    applyingBulk,
  ]);

  // ===========================================================
  // Checklist task
  // ===========================================================
  // แทน task ตัวนั้นทั้งใน rows และใน modal ที่เปิดอยู่
  const replaceTask = (taskId, updated) => {
    const swap = (list) => list.map((t) => (t.id === taskId ? updated : t));
    setRows((prev) =>
      prev.map((r) =>
        r.checklist?.some((t) => t.id === taskId)
          ? { ...r, checklist: swap(r.checklist) }
          : r,
      ),
    );
    setChecklistModal((prev) =>
      prev ? { ...prev, checklist: swap(prev.checklist) } : prev,
    );
  };

  const updateChecklistTask = async (taskId, patch) => {
    try {
      setSavingTaskId(taskId);
      const res = await axios.patch(
        `${backendUrl}/api/mobilization/task/${taskId}`,
        patch,
        { withCredentials: true },
      );
      replaceTask(taskId, res.data);
    } catch (err) {
      console.error(err);
      alert(errMsg(err, "บันทึกไม่สำเร็จ"));
    } finally {
      setSavingTaskId(null);
    }
  };

  const uploadTaskPhoto = async (taskId, file) => {
    try {
      setUploadingTaskId(taskId);
      const formData = new FormData();
      formData.append("photo", file);
      const res = await axios.post(
        `${backendUrl}/api/mobilization/task/${taskId}/photo`,
        formData,
        {
          withCredentials: true,
          headers: { "Content-Type": "multipart/form-data" },
        },
      );
      replaceTask(taskId, res.data);
    } catch (err) {
      console.error(err);
      alert(errMsg(err, "อัปโหลดรูปไม่สำเร็จ"));
    } finally {
      setUploadingTaskId(null);
    }
  };

  const removeTaskPhoto = async (taskId, photoPath) => {
    if (!window.confirm("ลบรูปนี้?")) return;
    try {
      setUploadingTaskId(taskId);
      const res = await axios.delete(
        `${backendUrl}/api/mobilization/task/${taskId}/photo`,
        { withCredentials: true, data: { photoPath } },
      );
      replaceTask(taskId, res.data);
    } catch (err) {
      console.error(err);
      alert(errMsg(err, "ลบรูปไม่สำเร็จ"));
    } finally {
      setUploadingTaskId(null);
    }
  };

  // ===========================================================
  // Ban
  // ===========================================================
  // เปิด modal แบน — รีเซ็ตค่าทุกครั้ง (เดิมค่าของคนก่อนค้างมาคนถัดไป)
  const openBan = (data) => {
    setBanDuration(3);
    setBanCustomDate("");
    setBanNote("");
    setBanModal(data);
  };

  const submitBan = async () => {
    if (!banModal || banning) return;
    const target = banModal;
    try {
      setBanning(true);
      const endpoint =
        target.reason === "no_show"
          ? `${backendUrl}/api/mobilization/no-show`
          : `${backendUrl}/api/mobilization/task/${target.taskId}/ban`;

      await axios.post(
        endpoint,
        {
          employeeId: target.employeeId,
          durationMonths: banDuration === "custom" ? null : banDuration,
          customUntil: banDuration === "custom" ? banCustomDate : null,
          reasonNote: banNote,
        },
        { withCredentials: true },
      );

      // ตรวจสารเสพติดไม่ผ่าน → mark task เป็น fail ด้วย (no-show ไม่มี task)
      if (target.reason !== "no_show") {
        await updateChecklistTask(target.taskId, { resultStatus: "fail" });
      }

      setBanModal(null);
      alert(`แบน ${target.fullName} เรียบร้อยแล้ว`);
      if (project) fetchList(project.id);
    } catch (err) {
      console.error(err);
      alert(errMsg(err, "แบนไม่สำเร็จ"));
    } finally {
      setBanning(false);
    }
  };

  const submitLiftBan = async () => {
    if (!liftBanModal || lifting) return;
    const target = liftBanModal;
    try {
      setLifting(true);
      await axios.patch(
        `${backendUrl}/api/employees/ban/${target.banId}/lift`,
        { liftReason },
        { withCredentials: true },
      );
      setLiftBanModal(null);
      setLiftReason("");
      alert(`ยกเลิกแบน ${target.fullName} เรียบร้อยแล้ว`);
      if (project) fetchList(project.id);
    } catch (err) {
      console.error(err);
      alert(errMsg(err, "ยกเลิกแบนไม่สำเร็จ"));
    } finally {
      setLifting(false);
    }
  };

  // ===========================================================
  // Rows / Deploy
  // ===========================================================
  // แก้ค่าในเครื่องเท่านั้น จนกว่าจะกด Deploy
  const updateRow = (employeeId, patch) =>
    setRows((prev) =>
      prev.map((r) => (r.employeeId === employeeId ? { ...r, ...patch } : r)),
    );

  // ── กรอกให้ทุกคน (From / Platform / MOB / D-MOB) ──
  // ใช้กับคนที่ยังไม่ Deploy ในรายการที่แสดงอยู่ (ตามตำแหน่งที่กรอง) · ช่องที่เว้นว่าง = ไม่เปลี่ยน
  const EMPTY_BULK = { fromLocation: "", platform: "", mobDate: "", demobDate: "" };
  const [bulkFields, setBulkFields] = useState(EMPTY_BULK);
  const setBulkField = (field, value) =>
    setBulkFields((f) => {
      const next = { ...f, [field]: value };
      // เลือก MOB แล้วเติม D-MOB = MOB + 28 วันให้ (แก้เองได้)
      if (field === "mobDate") next.demobDate = value ? addDays(value, DEMOB_DAYS) : "";
      return next;
    });
  const bulkHasValue = Object.values(bulkFields).some((v) => v.trim() !== "");

  const deploy = async (targets) => {
    if (!project || !targets.length || deploying) return;
    try {
      setDeploying(true);
      const res = await axios.post(
        `${backendUrl}/api/mobilization/deploy`,
        {
          projectId: project.id,
          deployments: targets.map((r) => ({
            employeeId: r.employeeId,
            mobDate: r.mobDate,
            demobDate: r.demobDate,
            fromLocation: r.fromLocation,
            platform: r.platform,
          })),
        },
        { withCredentials: true },
      );
      await fetchList(project.id);
      if (res.data?.deployed) {
        alert(`Deployed ${res.data.deployed} worker(s) to site ✓`);
      }
    } catch (err) {
      console.error(err);
      alert(errMsg(err, "Deploy ไม่สำเร็จ"));
    } finally {
      setDeploying(false);
    }
  };

  const deployRow = (employeeId) => {
    const r = rows.find((x) => x.employeeId === employeeId);
    if (r && isReady(r)) deploy([r]);
  };
  const deployAllReady = () => deploy(rows.filter(isReady));

  const undeployRow = async (employeeId) => {
    if (!project || !window.confirm("ยกเลิกการ deploy คนนี้?")) return;
    try {
      await axios.post(
        `${backendUrl}/api/mobilization/undeploy`,
        { projectId: project.id, employeeId },
        { withCredentials: true },
      );
      await fetchList(project.id);
    } catch (err) {
      console.error(err);
      alert(errMsg(err, "Undeploy ไม่สำเร็จ"));
    }
  };

  // เอาออกจาก shortlist → กลับเป็น proposed ใน Allocation
  const removeFromShortlist = async (row) => {
    if (
      !window.confirm(
        `เอา ${row.fullName} ออกจาก shortlist? (กลับไปสถานะ proposed ใน Allocation)`,
      )
    )
      return;
    try {
      await axios.put(
        `${backendUrl}/api/allocation/unapprove`,
        { candidateIds: [row.candidateId], requestId: row.requestId },
        { withCredentials: true },
      );
      await fetchList(project.id);
    } catch (err) {
      console.error(err);
      alert(errMsg(err, "เอาออกไม่สำเร็จ"));
    }
  };

  const clearProjectDeployments = async () => {
    if (!selectedProjectId) return;
    if (
      !window.confirm(
        "⚠ DEV TOOL: ลบ deployment record ทั้งหมดของ project นี้ทิ้ง?\n" +
          "(ใช้ตอนแก้ position request แล้วมี worker ค้าง deploy อยู่)",
      )
    )
      return;
    try {
      setClearing(true);
      const res = await axios.post(
        `${backendUrl}/api/mobilization/clear-project`,
        { projectId: selectedProjectId },
        { withCredentials: true },
      );
      alert(`ลบ deployment record ${res.data.count} รายการแล้ว`);
      await fetchList(selectedProjectId);
    } catch (err) {
      console.error(err);
      alert(errMsg(err, "Clear ไม่สำเร็จ"));
    } finally {
      setClearing(false);
    }
  };

  // ===========================================================
  // หัวข้ออบรม (ทั้งหมด)
  // ===========================================================
  const addBulkEntry = (topic) => {
    const v = (bulkDraft[topic] || "").trim();
    if (!v) return;
    setBulkEntries((prev) => ({
      ...prev,
      [topic]: [...(prev[topic] || []), v],
    }));
    setBulkDraft((prev) => ({ ...prev, [topic]: "" }));
  };

  const removeBulkEntry = (topic, idx) =>
    setBulkEntries((prev) => ({
      ...prev,
      [topic]: prev[topic].filter((_, i) => i !== idx),
    }));

  const applyBulkTrainingToAll = async () => {
    if (!project || bulkTargets.length === 0 || applyingBulk) return;

    // รวมข้อความที่พิมพ์ค้างไว้ (ยังไม่ได้กด + เพิ่ม) เข้าไปด้วย
    const merged = Object.fromEntries(
      TRAINING_TOPICS.map((t) => {
        const draft = (bulkDraft[t] || "").trim();
        const list = bulkEntries[t] || [];
        return [t, draft ? [...list, draft] : list];
      }),
    );

    if (
      !window.confirm(
        `บันทึกหัวข้ออบรมนี้ให้พนักงานที่ยังไม่ Deploy ${bulkTargets.length} คน?\n` +
          `(จะเขียนทับหัวข้ออบรมเดิม และตั้งสถานะเป็น Pass ให้ทุกคน)`,
      )
    )
      return;

    const itemsChecked = Object.fromEntries(
      TRAINING_TOPICS.map((t) => [t, { entries: merged[t] }]),
    );

    try {
      setApplyingBulk(true);
      setBulkEntries(merged);
      setBulkDraft({});
      await Promise.all(
        bulkTargets.map((r) => {
          const task = r.checklist?.find(
            (t) => t.taskType === "pre_field_training",
          );
          if (!task) return null;
          return axios.patch(
            `${backendUrl}/api/mobilization/task/${task.id}`,
            { itemsChecked, resultStatus: "pass" },
            { withCredentials: true },
          );
        }),
      );
      await fetchList(project.id);
      setBulkOpen(false);
      alert("บันทึกหัวข้ออบรม + ตั้งสถานะ Pass เรียบร้อยแล้ว ✓");
    } catch (err) {
      console.error(err);
      alert(errMsg(err, "บันทึกไม่สำเร็จ"));
    } finally {
      setApplyingBulk(false);
    }
  };
  // ===========================================================
  // Derived
  // ===========================================================
  const projectOptions = projects.map((p) => {
    const codePart = p.masterProjectRecord?.projectCode
      ? `[${p.masterProjectRecord.projectCode}] `
      : "";
    const parts = [];
    if (p.location) parts.push(p.location);
    if (p.startDate) parts.push(`Start ${fmtShort(p.startDate)}`);
    const disambiguator = parts.length
      ? parts.join(" · ")
      : `#${p.id.slice(-6)}`;
    return { value: p.id, label: `${codePart}${p.name} · ${disambiguator}` };
  });

  const readyCount = useMemo(() => rows.filter(isReady).length, [rows]);
  const deployedCount = useMemo(
    () => rows.filter((r) => r.deployed).length,
    [rows],
  );
  const allDeployed = rows.length > 0 && rows.every((r) => r.deployed);

  // ชิปตำแหน่ง: ยังไม่ครบขึ้นก่อน
  const sortedPositions = useMemo(
    () =>
      [...positionSummary].sort(
        (a, b) =>
          POSITION_STATE[positionState(a)].order -
          POSITION_STATE[positionState(b)].order,
      ),
    [positionSummary],
  );
  const positionCounts = useMemo(() => {
    const c = { short: 0, ready: 0, done: 0 };
    positionSummary.forEach((p) => (c[positionState(p)] += 1));
    return c;
  }, [positionSummary]);

  const filteredRows = useMemo(
    () =>
      positionFilter === "all"
        ? rows
        : rows.filter((r) => r.requestId === positionFilter),
    [rows, positionFilter],
  );

  // กรอกให้ทุกคน + หัวข้ออบรม (ทั้งหมด): เฉพาะคนที่ยังไม่ Deploy ในรายการที่แสดงอยู่
  // (คนที่ส่งไปแล้ว checklist / ข้อมูลเดินทางถูกล็อก) · กรองตำแหน่งไว้ = ใช้กับตำแหน่งนั้นเท่านั้น
  const bulkFieldTargets = useMemo(
    () => filteredRows.filter((r) => !r.deployed),
    [filteredRows],
  );
  const bulkTargets = bulkFieldTargets;
  const applyBulkFields = () => {
    if (!bulkHasValue || bulkFieldTargets.length === 0) return;
    const patch = Object.fromEntries(
      Object.entries(bulkFields)
        .map(([k, v]) => [k, v.trim()])
        .filter(([, v]) => v !== ""),
    );
    const overwrite = bulkFieldTargets.some((r) =>
      Object.keys(patch).some((k) => r[k] && r[k] !== patch[k]),
    );
    if (
      overwrite &&
      !window.confirm(
        `ใช้ค่านี้กับพนักงานที่ยังไม่ Deploy ${bulkFieldTargets.length} คน?\n(ช่องที่กรอกไว้แล้วจะถูกเขียนทับ · ยังไม่บันทึกจนกว่าจะกด Deploy)`,
      )
    )
      return;
    const ids = new Set(bulkFieldTargets.map((r) => r.employeeId));
    setRows((prev) => prev.map((r) => (ids.has(r.employeeId) ? { ...r, ...patch } : r)));
    setBulkFields(EMPTY_BULK);
  };

  const showPositionFilter = positionSummary.length > 1;
  const hasRows = project && rows.length > 0;

  // ===========================================================
  // Render helpers — ใช้ร่วมกันทั้งตาราง (จอใหญ่) และการ์ด (มือถือ)
  // ===========================================================
  const renderWorkerBadges = (r) => (
    <>
      {r.workerConfirmStatus && r.workerConfirmStatus !== "confirmed" && (
        <div className="mt-1">
          <Badge tone={WORKER_CONFIRM_TONE[r.workerConfirmStatus]}>
            {WORKER_CONFIRM_LABEL[r.workerConfirmStatus]}
          </Badge>
        </div>
      )}
      {r.activeBan && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge tone="danger" title={r.activeBan.reason || undefined}>
            🚫 Banned until{" "}
            {new Date(r.activeBan.bannedUntil).toLocaleDateString("en-GB")}
          </Badge>
          {canManageChecklist && (
            <button
              type="button"
              onClick={() => {
                setLiftReason("");
                setLiftBanModal({
                  banId: r.activeBan.id,
                  fullName: r.fullName,
                });
              }}
              className="cursor-pointer border-none bg-transparent p-0 text-[11px] font-semibold text-blue-600 underline"
            >
              ยกเลิกแบน
            </button>
          )}
        </div>
      )}
    </>
  );

  // ชื่อ / Emp ID · อายุ / ตำแหน่ง (บรรทัดแยก เพราะชื่อตำแหน่งอาจยาว)
  const renderWorkerInfo = (r) => {
    const age = calcAge(r.birthDate);
    return (
      <>
        <div className="break-words font-bold">{r.fullName}</div>
        <div className="text-[11px] text-gray-500">
          Emp ID: {r.empId || "—"}
          {age ? ` · Age ${age}` : ""}
        </div>
        {r.employeePosition && (
          <div className="text-[11px] leading-snug text-gray-500">
            {r.employeePosition}
          </div>
        )}
        {renderWorkerBadges(r)}
      </>
    );
  };

  const renderHealth = (r) => {
    if (!r.healthRisk) return DASH;
    const h = healthRiskDisplay(r.healthRisk);
    return (
      <span
        className={`inline-block rounded-md px-2 py-0.5 text-center text-[11px] font-semibold leading-tight ${h.cls}`}
      >
        {h.label}
      </span>
    );
  };

  const renderMedical = (r) => {
    const med = medicalFit(r.medicalExpiry, r.medicalStatus);
    return (
      <div className="flex flex-col items-start gap-0.5">
        <Badge tone={med.tone}>{med.label}</Badge>
        {med.statusText && (
          <span className="text-[10px] font-semibold text-gray-700">
            {med.statusText}
          </span>
        )}
        {med.expiry && (
          <span className="text-[10px] text-gray-500">
            Exp {fmtShort(med.expiry)}
          </span>
        )}
      </div>
    );
  };

  const renderChecklistBtn = (r) => {
    const { passed, total } = checklistSummary(r.checklist);
    const complete = checklistComplete(r.checklist);
    return (
      <button
        type="button"
        onClick={() => setChecklistModal(r)}
        disabled={r.deployed}
        title={r.deployed ? "Deploy แล้ว" : "เปิด Pre-Mob Checklist"}
        className={`whitespace-nowrap rounded-md border-none px-3 py-1.5 text-xs font-semibold transition-all ${
          r.deployed
            ? "cursor-default bg-gray-50 text-gray-400"
            : complete
              ? "cursor-pointer bg-[#d1e7dd] text-[#0f5132] shadow-[0_1px_3px_rgba(15,81,50,0.25)] hover:-translate-y-px hover:shadow-[0_3px_6px_rgba(15,81,50,0.35)]"
              : "cursor-pointer bg-white text-gray-700 shadow-[0_1px_3px_rgba(0,0,0,0.15),0_1px_2px_rgba(0,0,0,0.08)] hover:-translate-y-px hover:shadow-[0_3px_6px_rgba(0,0,0,0.18),0_2px_3px_rgba(0,0,0,0.1)]"
        }`}
      >
        {passed}/{total} ✓
      </button>
    );
  };

  const renderInput = (r, field, type, placeholder) => (
    <input
      type={type}
      placeholder={placeholder}
      value={r[field] || ""}
      disabled={r.deployed || !canManageMobilization}
      onChange={(e) => updateRow(r.employeeId, { [field]: e.target.value })}
      className={INPUT}
    />
  );

  // center = ในตาราง (badge + ข้อความใต้ badge อยู่กลางคอลัมน์) · การ์ดมือถือชิดซ้ายตามเดิม
  const renderStatus = (r, center = false) => {
    const st = rowStatus(r);
    const reason = st === "pending" ? deployBlockReason(r) : null;
    return (
      <div
        className={`flex flex-col gap-0.5 ${center ? "items-center text-center" : "items-start"}`}
      >
        <Badge tone={STATUS_TONE[st]} title={reason || undefined}>
          {STATUS_LABEL[st]}
        </Badge>
        {r.deployed && r.deployedAt && (
          <span className="text-[10px] text-gray-400">
            Deployed {ymdLocal(r.deployedAt)}
          </span>
        )}
        {reason && (
          <span className="text-[10px] leading-tight text-gray-400">
            {reason}
          </span>
        )}
      </div>
    );
  };

  const renderActions = (r, big) => {
    if (!canManageMobilization) return DASH;
    if (r.deployed) {
      return (
        <button
          type="button"
          onClick={() => undeployRow(r.employeeId)}
          className={`${LIFT_RED} w-full whitespace-nowrap bg-white px-3 text-xs font-semibold ${big ? "py-2" : "py-1.5"}`}
        >
          Undeploy
        </button>
      );
    }
    const ready = isReady(r);
    // ตาราง: Deploy เต็มความกว้างด้านบน, 🚫 / 🗑 บรรทัดล่าง
    // การ์ดมือถือ: 3 ปุ่มอยู่แถวเดียว (พื้นที่พอ)
    return (
      <div
        className={
          big
            ? "flex items-center gap-1.5"
            : "flex flex-col items-stretch gap-1.5"
        }
      >
        <button
          type="button"
          onClick={() => deployRow(r.employeeId)}
          disabled={!ready || deploying}
          title={deployBlockReason(r) || "Deploy พนักงานคนนี้"}
          className={`min-w-0 whitespace-nowrap rounded-md border-none px-2 text-xs font-semibold transition-all ${
            big ? "flex-1 py-2" : "w-full py-1.5"
          } ${
            ready
              ? "cursor-pointer bg-[#d1e7dd] text-[#0f5132] shadow-[0_1px_3px_rgba(15,81,50,0.2)] hover:-translate-y-px hover:shadow-[0_3px_6px_rgba(15,81,50,0.3)] disabled:cursor-wait disabled:opacity-60"
              : "cursor-not-allowed bg-gray-50 text-gray-400"
          }`}
        >
          Deploy
        </button>
        <div className={big ? "contents" : "flex justify-center gap-1.5"}>
          {/* No-show: แสดงตลอด ให้เจ้าหน้าที่หน้างานกด (ยกเว้นคนที่ถูกแบนอยู่แล้ว) */}
          {!r.activeBan && (
            <IconBtn
              big={big}
              title="พนักงานไม่มารายงานตัว (No-show) — แบน"
              onClick={() =>
                openBan({
                  employeeId: r.employeeId,
                  fullName: r.fullName,
                  reason: "no_show",
                })
              }
            >
              🚫
            </IconBtn>
          )}
          <IconBtn
            big={big}
            title="เอาออกจาก shortlist (กลับเป็น proposed ใน Allocation)"
            onClick={() => removeFromShortlist(r)}
          >
            🗑
          </IconBtn>
        </div>
      </div>
    );
  };

  // ── เนื้อหาแต่ละหัวข้อใน Checklist modal ──
  const renderPhotos = (task) => {
    const photos = Array.isArray(task.itemsChecked?.photos)
      ? task.itemsChecked.photos
      : [];
    const isUploading = uploadingTaskId === task.id;
    return (
      <div className="mt-2.5 border-t border-dashed border-gray-200 pt-2.5">
        <label className="mb-1.5 block text-xs font-semibold text-gray-700">
          รูปแนบ
        </label>
        {photos.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {photos.map((photoPath, pi) => (
              <div key={pi} className="relative h-16 w-16">
                <img
                  src={`${backendUrl}${photoPath}`}
                  alt={`baggage-${pi}`}
                  onClick={() => setPreviewPhoto(`${backendUrl}${photoPath}`)}
                  title="ดูรูปเต็ม"
                  className="block h-16 w-16 cursor-pointer rounded-md border border-gray-200 object-cover"
                />
                {canManageChecklist && (
                  <button
                    type="button"
                    onClick={() => removeTaskPhoto(task.id, photoPath)}
                    disabled={isUploading}
                    title="ลบรูปนี้"
                    className="absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-full border-2 border-white bg-red-600 p-0 text-[10px] leading-none text-white disabled:cursor-not-allowed"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {canManageChecklist && (
          <label
            className={`inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold ${
              isUploading
                ? "cursor-not-allowed text-gray-400"
                : "cursor-pointer text-gray-700 hover:bg-gray-50"
            }`}
          >
            {isUploading ? "กำลังอัปโหลด..." : "📷 แนบรูป"}
            <input
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              disabled={isUploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadTaskPhoto(task.id, file);
                e.target.value = ""; // อัปโหลดไฟล์ชื่อซ้ำติดกันได้
              }}
              className="hidden"
            />
          </label>
        )}
      </div>
    );
  };

  // ช่องกรอกที่บันทึกตอนออกจากช่อง (onBlur)
  const blurInput = (task, value, placeholder, onSave, inputMode) => (
    <input
      key={`${task.id}-${placeholder}`}
      type="text"
      inputMode={inputMode}
      placeholder={placeholder}
      defaultValue={value ?? ""}
      disabled={savingTaskId === task.id || !canManageChecklist}
      onBlur={(e) => {
        if (e.target.value !== (value ?? "")) onSave(e.target.value);
      }}
      className={INPUT}
    />
  );

  const renderTaskBody = (def, task) => {
    const saving = savingTaskId === task.id;
    const locked = saving || !canManageChecklist;
    const pickResult = (val) =>
      updateChecklistTask(task.id, {
        resultStatus: val,
        measuredValue: task.measuredValue,
      });

    // ── ตรวจกระเป๋า ──
    if (def.baggageFields) {
      return (
        <>
          <Field label="จำนวนกระเป๋า (ชิ้น)">
            {blurInput(
              task,
              task.measuredValue,
              "เช่น 2",
              (v) =>
                updateChecklistTask(task.id, {
                  resultStatus: task.resultStatus ?? "pass",
                  measuredValue: v,
                }),
              "numeric",
            )}
          </Field>
          <Field label="Baggage">
            <Segmented
              options={BAGGAGE_OPTIONS}
              value={task.resultStatus}
              disabled={locked}
              onPick={pickResult}
            />
          </Field>
          <Field label="Dress Code" className="">
            <Segmented
              options={DRESS_OPTIONS}
              value={task.itemsChecked?.dressCode}
              disabled={locked}
              onPick={(v) =>
                updateChecklistTask(task.id, {
                  resultStatus: task.resultStatus ?? "pass",
                  itemsChecked: { ...(task.itemsChecked ?? {}), dressCode: v },
                })
              }
            />
          </Field>
          {renderPhotos(task)}
        </>
      );
    }

    // ── ความดัน + ชีพจร ──
    if (def.vitalsFields) {
      return (
        <>
          <div className="mb-2.5">
            <Segmented
              options={RESULT_OPTIONS}
              value={task.resultStatus}
              disabled={locked}
              onPick={pickResult}
            />
          </div>
          <Field label="ค่าความดันโลหิต (mm.Hg)">
            {blurInput(task, task.measuredValue, "เช่น 120/80", (v) =>
              updateChecklistTask(task.id, { measuredValue: v }),
            )}
          </Field>
          <Field label="ชีพจร (ครั้ง/นาที)" className="">
            {blurInput(
              task,
              task.itemsChecked?.pulseRate,
              "เช่น 72",
              (v) =>
                updateChecklistTask(task.id, {
                  itemsChecked: { ...(task.itemsChecked ?? {}), pulseRate: v },
                }),
              "numeric",
            )}
          </Field>
        </>
      );
    }

    // ── อบรม: แต่ละหัวข้อพิมพ์รายการเองได้ ──
    if (def.freeTextItems) {
      return (
        <>
          <div className="mb-2.5">
            <Segmented
              options={RESULT_OPTIONS}
              value={task.resultStatus}
              disabled={locked}
              onPick={(val) =>
                updateChecklistTask(task.id, { resultStatus: val })
              }
            />
          </div>
          {def.freeTextItems.map((topic) => {
            const entries = Array.isArray(task.itemsChecked?.[topic]?.entries)
              ? task.itemsChecked[topic].entries
              : [];
            const draftKey = `${task.id}:${topic}`;
            const draft = otherDraft[draftKey] ?? "";
            const commit = (next) =>
              updateChecklistTask(task.id, {
                itemsChecked: {
                  ...(task.itemsChecked ?? {}),
                  [topic]: { entries: next },
                },
              });
            return (
              <div
                key={topic}
                className="mb-3 border-b border-dashed border-gray-200 pb-3 last:mb-0 last:border-b-0 last:pb-0"
              >
                <div className="mb-2 text-xs font-semibold text-gray-700">
                  {topic}
                </div>
                <EntryList
                  entries={entries}
                  canEdit={canManageChecklist}
                  disabled={saving}
                  onRemove={(idx) =>
                    commit(entries.filter((_, i) => i !== idx))
                  }
                />
                {canManageChecklist && (
                  <AddEntry
                    value={draft}
                    disabled={saving}
                    placeholder={`ระบุหัวข้อย่อยของ ${topic}...`}
                    onChange={(v) =>
                      setOtherDraft((prev) => ({ ...prev, [draftKey]: v }))
                    }
                    onAdd={() => {
                      const v = draft.trim();
                      if (!v) return;
                      commit([...entries, v]);
                      setOtherDraft((prev) => ({ ...prev, [draftKey]: "" }));
                    }}
                  />
                )}
              </div>
            );
          })}
        </>
      );
    }

    // ── ทั่วไป: Pass/Fail/N/A (+ ค่าที่วัดได้ / รายการ PPE) ──
    const checked = Array.isArray(task.itemsChecked) ? task.itemsChecked : [];
    const setItems = (next) => {
      const patch = { itemsChecked: next };
      if (PPE_REQUIRED.every((i) => next.includes(i)))
        patch.resultStatus = "pass";
      updateChecklistTask(task.id, patch);
    };
    const allSelected = PPE_REQUIRED.every((i) => checked.includes(i));
    const otherChecked = checked.includes("Other");
    const otherItems = (task.notes || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const otherDraftValue = otherDraft[task.id] ?? "";
    const commitOther = (next) =>
      updateChecklistTask(task.id, {
        resultStatus: task.resultStatus ?? "pass",
        notes: next.join("\n"),
      });

    return (
      <>
        <Segmented
          options={RESULT_OPTIONS}
          value={task.resultStatus}
          disabled={locked}
          onPick={(val) => {
            // ตรวจสารเสพติดไม่ผ่าน → ต้องระบุระยะเวลาแบนก่อน
            if (def.type === "drug_test" && val === "fail") {
              openBan({
                taskId: task.id,
                employeeId: checklistModal.employeeId,
                fullName: checklistModal.fullName,
              });
              return;
            }
            pickResult(val);
          }}
        />

        {def.valueLabel && (
          <Field label={def.valueLabel} className="mt-2.5">
            {blurInput(
              task,
              task.measuredValue,
              def.valueLabel,
              (v) => updateChecklistTask(task.id, { measuredValue: v }),
              "decimal",
            )}
          </Field>
        )}

        {def.items && (
          <>
            <div className="mb-1.5 mt-2 flex justify-end">
              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  setItems(
                    allSelected
                      ? checked.filter((i) => !PPE_REQUIRED.includes(i))
                      : Array.from(new Set([...checked, ...PPE_REQUIRED])),
                  )
                }
                className="cursor-pointer border-none bg-transparent p-0 text-[11px] font-semibold text-blue-600 underline disabled:cursor-not-allowed disabled:text-gray-400"
              >
                {allSelected ? "ยกเลิกทั้งหมด" : "เลือกทั้งหมด"}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {PPE_REQUIRED.map((item) => (
                <label
                  key={item}
                  className="flex cursor-pointer items-center gap-2 py-0.5 text-xs text-gray-700"
                >
                  <input
                    type="checkbox"
                    checked={checked.includes(item)}
                    disabled={locked}
                    onChange={(e) =>
                      setItems(
                        e.target.checked
                          ? [...checked, item]
                          : checked.filter((i) => i !== item),
                      )
                    }
                    className="h-4 w-4 shrink-0 cursor-pointer"
                  />
                  {item}
                </label>
              ))}
            </div>

            {/* Other — พิมพ์เพิ่มได้หลายรายการ (เก็บใน notes) */}
            <div className="mt-2 border-t border-dashed border-gray-200 pt-2">
              <label
                className={`flex cursor-pointer items-center gap-2 text-xs text-gray-700 ${
                  otherChecked ? "mb-2" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={otherChecked}
                  disabled={locked}
                  onChange={(e) =>
                    setItems(
                      e.target.checked
                        ? [...checked, "Other"]
                        : checked.filter((i) => i !== "Other"),
                    )
                  }
                  className="h-4 w-4 shrink-0 cursor-pointer"
                />
                Other
              </label>
              {otherChecked && (
                <>
                  <EntryList
                    entries={otherItems}
                    canEdit={canManageChecklist}
                    disabled={saving}
                    onRemove={(idx) =>
                      commitOther(otherItems.filter((_, i) => i !== idx))
                    }
                  />
                  {canManageChecklist && (
                    <AddEntry
                      value={otherDraftValue}
                      disabled={saving}
                      placeholder={def.notesLabel || "พิมพ์รายการ..."}
                      onChange={(v) =>
                        setOtherDraft((prev) => ({ ...prev, [task.id]: v }))
                      }
                      onAdd={() => {
                        const v = otherDraftValue.trim();
                        if (!v) return;
                        commitOther([...otherItems, v]);
                        setOtherDraft((prev) => ({ ...prev, [task.id]: "" }));
                      }}
                    />
                  )}
                </>
              )}
            </div>
          </>
        )}
      </>
    );
  };

  // ===========================================================
  // Render
  // ===========================================================
  return (
    <div className="mx-auto w-full min-w-0 max-w-[1800px]">
      {/* ════════ Header ════════ */}
      {/* ชื่อหน้าอยู่ที่แท็บแล้ว — เหลือคำอธิบายบรรทัดเดียว */}
      <div className="pb-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span className="rounded-md bg-gray-200 px-2 py-0.5 font-bold">
            Phase 4
          </span>
          <span>Steps 10–11: Checklist → Deploy to Site</span>
        </div>
      </div>

      {/* ════════ เลือก Project · ตำแหน่ง · Deploy (แถวเดียว) ════════ */}
      <div className="border-y border-gray-200 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:min-w-[280px] sm:max-w-[700px] sm:flex-1">
            <label className={FILTER_LABEL}>Select Project</label>
            <Select
              options={projectOptions}
              styles={projectSelectStyles}
              menuPortalTarget={
                typeof document !== "undefined" ? document.body : null
              }
              menuPosition="fixed"
              value={
                projectOptions.find((o) => o.value === selectedProjectId) ||
                null
              }
              onChange={(o) => {
                setSelectedProjectId(o ? o.value : "");
                setPositionFilter("all");
              }}
              placeholder="-- Select Project --"
              isClearable
              noOptionsMessage={() => "No projects found"}
            />
          </div>

          {hasRows && (
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:pb-1.5">
              <Badge tone="ok">{deployedCount} deployed</Badge>
              <Badge tone="info">{readyCount} ready</Badge>
              {canManageMobilization && (
                <button
                  type="button"
                  onClick={deployAllReady}
                  disabled={readyCount === 0 || deploying}
                  className={`rounded-lg border-none px-3.5 py-1.5 text-xs font-bold transition-all ${
                    readyCount > 0
                      ? "cursor-pointer bg-emerald-600 text-white shadow-[0_2px_5px_rgba(25,135,84,0.35)] hover:-translate-y-px hover:shadow-[0_4px_8px_rgba(25,135,84,0.45)] disabled:cursor-wait disabled:opacity-70"
                      : "cursor-not-allowed bg-gray-200 text-gray-400"
                  }`}
                >
                  {deploying ? "กำลัง Deploy..." : "🚀 Deploy All Ready"}
                </button>
              )}
              {allDeployed && (
                <Link
                  to={`/projects/${project.id}`}
                  className="inline-block rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white no-underline shadow-[0_2px_5px_rgba(13,110,253,0.35)] transition-all hover:-translate-y-px hover:shadow-[0_4px_8px_rgba(13,110,253,0.45)]"
                >
                  ✅ Deploy ครบแล้ว — ดูสรุป Project →
                </Link>
              )}
            </div>
          )}

          {selectedProjectId && isAdmin && (
            <button
              type="button"
              onClick={clearProjectDeployments}
              disabled={clearing}
              title="Dev tool — ลบ deployment record ทั้งหมดของ project นี้"
              className={`w-full cursor-pointer whitespace-nowrap rounded-lg border-none px-3.5 py-2.5 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto ${LIFT_DANGER}`}
            >
              {clearing ? "Clearing..." : "🧹 Clear Deployments (Dev)"}
            </button>
          )}
        </div>

        {project && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-gray-500">
            <span>
              Start (default MOB):{" "}
              <strong>{ymd(project.startDate) || "—"}</strong> · D-MOB = MOB +{" "}
              {DEMOB_DAYS} วัน
            </span>
            {hasRows &&
              positionSummary.length > 0 &&
              positionSummary.every((p) => p.deployedCount >= p.quantity) && (
                <span className="font-semibold text-emerald-800">
                  ✅ Deploy ครบทุกตำแหน่งแล้ว
                </span>
              )}
          </div>
        )}
      </div>

      {/* ════════ deploy ค้าง (ไม่ได้ Approve แล้ว) ════════ */}
      {project && orphans.length > 0 && (
        <div className="mt-3 border-l-[3px] border-[#dc3545] bg-[#fff5f5] px-3 py-2.5 text-[13px]">
          <div className="font-semibold text-[#842029]">
            ⚠ Deploy ค้าง {orphans.length} คน — ไม่ได้ Approve แล้ว
            จึงไม่อยู่ในตารางด้านล่าง
          </div>
          <div className="mb-1.5 text-xs text-gray-600">
            ยังมีข้อมูลลงงานในโปรเจกต์นี้ (ขึ้นใน Manpower Calendar) — กด
            Undeploy เพื่อลบ
          </div>
          {orphans.map((o) => (
            <div
              key={o.employeeId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#f5c2c7] py-1.5"
            >
              <span className="font-semibold">{o.fullName}</span>
              <span className="text-xs text-gray-500">
                {o.empId || o.empCode} · MOB {o.mobDate ? ymd(o.mobDate) : "—"}{" "}
                · D-MOB {o.demobDate ? ymd(o.demobDate) : "—"}
              </span>
              {canManageMobilization && (
                <button
                  type="button"
                  onClick={() => undeployRow(o.employeeId)}
                  className="ml-auto cursor-pointer rounded-md border border-[#dc3545] bg-white px-3 py-1 text-xs font-semibold text-[#dc3545] hover:bg-red-50"
                >
                  Undeploy
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ════════ Step 10–11 ════════ */}
      <div className={CARD}>
        {/* ── สรุปตามตำแหน่ง: ชิปบรรทัดเดียว กดเพื่อกรอง ── */}
        {hasRows && positionSummary.length > 0 && (
          <div className="border-b border-gray-100 py-3">
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
              <span className="font-semibold uppercase tracking-[0.4px]">
                ตำแหน่ง ({positionSummary.length})
              </span>
              {["short", "ready", "done"].map((k) =>
                positionCounts[k] ? (
                  <span key={k} className="inline-flex items-center gap-1">
                    <span className={`h-2 w-2 rounded-full ${POSITION_STATE[k].dot}`} />
                    {POSITION_STATE[k].label} {positionCounts[k]}
                  </span>
                ) : null,
              )}
              <span>· A = Approved · D = Deployed</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {showPositionFilter && (
                <button
                  type="button"
                  onClick={() => setPositionFilter("all")}
                  aria-pressed={positionFilter === "all"}
                  className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                    positionFilter === "all"
                      ? "border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-500/20"
                      : "border-gray-200 bg-white text-gray-700 hover:border-blue-300"
                  }`}
                >
                  ทั้งหมด ({rows.length} คน)
                </button>
              )}
              {sortedPositions.map((p) => (
                <PositionChip
                  key={p.requestId}
                  p={p}
                  active={positionFilter === p.requestId}
                  onClick={() =>
                    setPositionFilter(
                      positionFilter === p.requestId ? "all" : p.requestId,
                    )
                  }
                />
              ))}
            </div>
          </div>
        )}

        {/* ── กรอกให้ทุกคน: From / Platform / MOB / D-MOB ── */}
        {hasRows && canManageMobilization && bulkFieldTargets.length > 0 && (
          <div className="border-b border-gray-100 bg-gray-50/60 px-2.5 py-2.5">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.4px] text-gray-500">
                กรอกให้ทุกคน · พนักงานที่ยังไม่ Deploy {bulkFieldTargets.length} คน
                {positionFilter !== "all" ? " (ตำแหน่งที่เลือก)" : ""}
                <span className="ml-1 font-normal normal-case tracking-normal text-gray-400">
                  — ช่องที่เว้นว่างจะไม่ถูกเปลี่ยน
                </span>
              </div>
              <button
                type="button"
                onClick={() => setBulkOpen(true)}
                aria-haspopup="dialog"
                className={`cursor-pointer whitespace-nowrap rounded-lg border-none px-3 py-1.5 text-xs font-bold transition-all ${LIFT_BLUE_SOFT}`}
              >
                🦺 หัวข้ออบรม ({bulkFieldTargets.length} คน)
              </button>
            </div>
            <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:max-w-[900px]">
              {[
                ["fromLocation", "From", "text", "e.g. STH"],
                ["platform", "Platform", "text", "e.g. BELQ"],
                ["mobDate", "MOB", "date"],
                ["demobDate", "D-MOB", "date"],
              ].map(([field, label, type, ph]) => (
                <div key={field}>
                  <label className={LABEL_SM}>{label}</label>
                  <input
                    type={type}
                    placeholder={ph}
                    value={bulkFields[field]}
                    onChange={(e) => setBulkField(field, e.target.value)}
                    className={INPUT}
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={applyBulkFields}
                disabled={!bulkHasValue}
                className="col-span-2 min-h-[34px] cursor-pointer whitespace-nowrap rounded-md border-none bg-[#2B2F78] px-3.5 text-xs font-bold text-white hover:bg-[#22265f] disabled:cursor-not-allowed disabled:opacity-40 sm:col-span-1"
              >
                ใช้กับทุกคน ({bulkFieldTargets.length})
              </button>
            </div>
          </div>
        )}

        {/* ── รายชื่อพนักงาน ── */}
        {loading && rows.length === 0 ? (
          <div className="p-7 text-center text-sm text-gray-500">Loading…</div>
        ) : !project ? (
          <div className="p-7 text-center text-sm text-gray-500">
            Select a project above.
          </div>
        ) : rows.length === 0 ? (
          <div className="p-7 text-center text-sm text-gray-500">
            No workers shortlisted. Go to Allocation first.
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-7 text-center text-sm text-gray-500">
            ไม่มีพนักงานในตำแหน่งที่เลือก
          </div>
        ) : (
          <>
            {/* มือถือ / แท็บเล็ต (< lg): การ์ดทีละคน */}
            <div className="flex flex-col divide-y divide-gray-100 lg:hidden">
              {filteredRows.map((r) => {
                return (
                  <div key={r.employeeId} className="bg-white py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 text-sm">
                        {renderWorkerInfo(r)}
                      </div>
                      <div className="shrink-0">{renderStatus(r)}</div>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-3 border-t border-gray-100 pt-3">
                      <div>
                        <div className={LABEL_SM}>Health</div>
                        {renderHealth(r)}
                      </div>
                      <div>
                        <div className={LABEL_SM}>Medical</div>
                        {renderMedical(r)}
                      </div>
                      <div>
                        <div className={LABEL_SM}>Checklist</div>
                        {renderChecklistBtn(r)}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
                      <div>
                        <label className={LABEL_SM}>From</label>
                        {renderInput(r, "fromLocation", "text", "e.g. STH")}
                      </div>
                      <div>
                        <label className={LABEL_SM}>Platform</label>
                        {renderInput(r, "platform", "text", "e.g. BELQ")}
                      </div>
                      <div>
                        <label className={LABEL_SM}>MOB</label>
                        {renderInput(r, "mobDate", "date")}
                      </div>
                      <div>
                        <label className={LABEL_SM}>D-MOB</label>
                        {renderInput(r, "demobDate", "date")}
                      </div>
                    </div>

                    <div className="mt-3">{renderActions(r, true)}</div>
                  </div>
                );
              })}
            </div>

            {/* จอใหญ่ (lg+): ตาราง */}
            <div className="hidden max-h-[560px] overflow-auto lg:block">
              <table className="w-full min-w-[980px] table-fixed border-collapse">
                <colgroup>
                  {/* Worker 15 · Health 10 (พอสำหรับ "Temporary unfit") · Medical 9 · Checklist 8
                      · From 8 · MOB 11 · D-MOB 11 · Platform 8 · Status 10 · Actions 10 */}
                  <col className="w-[15%]" />
                  <col className="w-[10%]" />
                  <col className="w-[9%]" />
                  <col className="w-[8%]" />
                  <col className="w-[8%]" />
                  <col className="w-[11%]" />
                  <col className="w-[11%]" />
                  <col className="w-[8%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                </colgroup>
                <thead>
                  <tr>
                    <th className={`${TH} text-left`}>Worker</th>
                    {[
                      "Health Risk",
                      "Medical",
                      "Pre-Mob Checklist",
                      "From",
                      "MOB",
                      "D-MOB",
                      "Platform",
                      "Status",
                      "Actions",
                    ].map((h) => (
                      <th key={h} className={`${TH} text-center`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => {
                    return (
                      <tr key={r.employeeId} className="hover:bg-gray-50/60">
                        <td className={TD}>{renderWorkerInfo(r)}</td>
                        <td className={`${TD} text-center`}>{renderHealth(r)}</td>
                        <td className={TD}>
                          <div className="flex justify-center">{renderMedical(r)}</div>
                        </td>
                        <td className={`${TD} text-center`}>
                          {renderChecklistBtn(r)}
                        </td>
                        <td className={TD}>
                          {renderInput(r, "fromLocation", "text", "e.g. STH")}
                        </td>
                        <td className={TD}>
                          {renderInput(r, "mobDate", "date")}
                        </td>
                        <td className={TD}>
                          {renderInput(r, "demobDate", "date")}
                        </td>
                        <td className={TD}>
                          {renderInput(r, "platform", "text", "e.g. BELQ")}
                        </td>
                        <td className={TD}>{renderStatus(r, true)}</td>
                        <td className={TD}>{renderActions(r, false)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ════════ หัวข้ออบรม (ทั้งหมด) ════════ */}
      {bulkOpen && hasRows && (
        <Modal
          onClose={() => !applyingBulk && setBulkOpen(false)}
          maxW="max-w-[860px]"
        >
          <ModalHead
            title="🦺 หัวข้ออบรมก่อนปฏิบัติงาน (ทั้งหมด)"
            sub={`กรอกครั้งเดียว แล้ว Apply ให้พนักงานที่ยังไม่ Deploy (${bulkTargets.length} คน)`}
            onClose={applyingBulk ? undefined : () => setBulkOpen(false)}
          />

          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
              {TRAINING_TOPICS.map((topic) => (
                <div key={topic} className="min-w-0">
                  <div className="mb-1.5 text-xs font-semibold text-gray-700">
                    {topic}
                  </div>
                  <EntryList
                    white
                    entries={bulkEntries[topic] || []}
                    canEdit={!applyingBulk}
                    onRemove={(idx) => removeBulkEntry(topic, idx)}
                  />
                  <AddEntry
                    value={bulkDraft[topic] ?? ""}
                    disabled={applyingBulk}
                    placeholder="ระบุหัวข้อย่อย..."
                    onChange={(v) =>
                      setBulkDraft((prev) => ({ ...prev, [topic]: v }))
                    }
                    onAdd={() => addBulkEntry(topic)}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-gray-200 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <span className="text-[11px] text-gray-500">
              ⚠ จะเขียนทับหัวข้ออบรมเดิม และตั้งสถานะ Pass ให้ทุกคน
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setBulkOpen(false)}
                disabled={applyingBulk}
                className={`${BTN_OUTLINE} flex-1 sm:flex-none`}
              >
                ปิด
              </button>
              <button
                type="button"
                onClick={applyBulkTrainingToAll}
                disabled={applyingBulk || bulkTargets.length === 0}
                className="flex-1 cursor-pointer rounded-lg border-none bg-blue-600 px-[18px] py-2 text-[13px] font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
              >
                {applyingBulk
                  ? "กำลังบันทึก..."
                  : `บันทึก + Apply (${bulkTargets.length} คน)`}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ════════ Pre-Mob Checklist ════════ */}
      {checklistModal && (
        <Modal onClose={() => setChecklistModal(null)} maxW="max-w-[560px]">
          <ModalHead
            title="📋 Pre-Mob Checklist"
            sub={`${checklistModal.fullName} · ${checklistModal.empId}`}
            right={
              <span className="whitespace-nowrap text-xs opacity-90">
                {(() => {
                  const { passed, total } = checklistSummary(
                    checklistModal.checklist,
                  );
                  return `${passed}/${total} เสร็จแล้ว`;
                })()}
              </span>
            }
            onClose={() => setChecklistModal(null)}
          />

          <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6">
            {CHECKLIST_DEFS.map((def) => {
              const task = checklistModal.checklist.find(
                (t) => t.taskType === def.type,
              );
              if (!task) return null;

              const isComplete =
                task.resultStatus === "pass" ||
                task.resultStatus === "not_applicable";
              // ผู้ใช้กดเปิด/ปิดเองแล้ว → เชื่อค่านั้น, ไม่งั้นยังไม่เสร็จ = เปิด
              const isExpanded =
                def.type in manualOverride
                  ? manualOverride[def.type]
                  : !isComplete;

              return (
                <div
                  key={def.type}
                  className="mb-2.5 rounded-lg border border-gray-200 px-3.5 py-3"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setManualOverride((prev) => ({
                        ...prev,
                        [def.type]: !isExpanded,
                      }))
                    }
                    aria-expanded={isExpanded}
                    className={`flex w-full cursor-pointer items-center justify-between gap-2 border-none bg-transparent p-0 text-left ${
                      isExpanded ? "mb-2" : ""
                    }`}
                  >
                    <span className="text-[13px] font-semibold text-gray-900">
                      {def.label}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {task.resultStatus && (
                        <Badge tone={RESULT_TONE[task.resultStatus]}>
                          {def.baggageFields && task.resultStatus === "fail"
                            ? "Reject"
                            : RESULT_LABEL[task.resultStatus]}
                        </Badge>
                      )}
                      <span className="text-[11px] text-gray-400">
                        {isExpanded ? "▲" : "▼"}
                      </span>
                    </span>
                  </button>

                  {def.note && isExpanded && (
                    <div className="mb-2 text-[11px] leading-relaxed text-gray-500">
                      {def.note}
                    </div>
                  )}

                  {isExpanded && renderTaskBody(def, task)}

                  {task.checkedAt && (
                    <div className="mt-1.5 text-[10px] text-gray-400">
                      Checked {new Date(task.checkedAt).toLocaleString("th-TH")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex shrink-0 justify-end border-t border-gray-200 px-4 py-3.5 sm:px-6">
            <button
              type="button"
              onClick={() => setChecklistModal(null)}
              className={BTN_OUTLINE}
            >
              Close
            </button>
          </div>
        </Modal>
      )}

      {/* ════════ แบน ════════ */}
      {banModal && (
        <Modal
          onClose={() => !banning && setBanModal(null)}
          z="z-[1000002]"
          maxW="max-w-[440px]"
        >
          <ModalHead
            bg="bg-[#842029]"
            title={
              banModal.reason === "no_show"
                ? "🚫 ไม่มารายงานตัว (No-show) — ระบุระยะเวลาแบน"
                : "🚫 ตรวจสารเสพติดไม่ผ่าน — ระบุระยะเวลาแบน"
            }
            sub={banModal.fullName}
          />
          <div className="overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
            <label className="mb-2 block text-xs font-semibold text-gray-700">
              ระยะเวลาแบน
            </label>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {BAN_DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setBanDuration(opt.value)}
                  className={`cursor-pointer rounded-md border px-3 py-1.5 text-xs font-semibold ${
                    banDuration === opt.value
                      ? "border-[#842029] bg-[#f8d7da] text-[#842029]"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {banDuration === "custom" && (
              <Field label="แบนถึงวันที่" className="mb-3">
                <input
                  type="date"
                  value={banCustomDate}
                  min={ymdLocal(new Date())}
                  onChange={(e) => setBanCustomDate(e.target.value)}
                  className={INPUT}
                />
              </Field>
            )}

            <Field label="หมายเหตุ (ถ้ามี)" className="">
              <textarea
                rows={2}
                value={banNote}
                onChange={(e) => setBanNote(e.target.value)}
                placeholder="รายละเอียดเพิ่มเติม..."
                className={`${INPUT} resize-y`}
              />
            </Field>
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 px-4 py-3.5 sm:px-6">
            <button
              type="button"
              onClick={() => setBanModal(null)}
              disabled={banning}
              className={BTN_OUTLINE}
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={submitBan}
              disabled={banning || (banDuration === "custom" && !banCustomDate)}
              className="cursor-pointer rounded-lg border-none bg-[#842029] px-5 py-2 text-[13px] font-semibold text-white hover:bg-[#6a1a21] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {banning ? "กำลังบันทึก..." : "ยืนยันแบน"}
            </button>
          </div>
        </Modal>
      )}

      {/* ════════ ยกเลิกแบน ════════ */}
      {liftBanModal && (
        <Modal
          onClose={() => !lifting && setLiftBanModal(null)}
          z="z-[1000003]"
          maxW="max-w-[420px]"
        >
          <ModalHead
            bg="bg-blue-600"
            title="✅ ยกเลิกการแบน"
            sub={liftBanModal.fullName}
          />
          <div className="px-4 py-5 sm:px-6">
            <Field label="เหตุผลที่ยกเลิกแบน (ถ้ามี)" className="">
              <textarea
                rows={2}
                value={liftReason}
                onChange={(e) => setLiftReason(e.target.value)}
                placeholder="เช่น แบนผิดคน / ตรวจซ้ำแล้วผ่าน..."
                className={`${INPUT} resize-y`}
              />
            </Field>
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 px-4 py-3.5 sm:px-6">
            <button
              type="button"
              onClick={() => setLiftBanModal(null)}
              disabled={lifting}
              className={BTN_OUTLINE}
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={submitLiftBan}
              disabled={lifting}
              className="cursor-pointer rounded-lg border-none bg-blue-600 px-5 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {lifting ? "กำลังบันทึก..." : "ยืนยันยกเลิกแบน"}
            </button>
          </div>
        </Modal>
      )}

      {/* ════════ ดูรูปเต็ม ════════ */}
      {previewPhoto && (
        <div
          className="fixed inset-0 z-[1000004] flex cursor-zoom-out items-center justify-center bg-black/85 p-5"
          onClick={() => setPreviewPhoto(null)}
        >
          <button
            type="button"
            onClick={() => setPreviewPhoto(null)}
            title="ปิด (Esc)"
            className="absolute right-5 top-5 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-none bg-white/15 text-[22px] text-white"
          >
            ✕
          </button>
          <img
            src={previewPhoto}
            alt="preview"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] max-w-[92vw] cursor-default rounded-lg object-contain"
          />
        </div>
      )}
    </div>
  );
}
