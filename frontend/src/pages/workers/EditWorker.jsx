import { useState, useEffect, useContext } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import Select from "react-select";
import CreatableSelect from "react-select/creatable";
import { AppContent } from "../../context/AppContext";

// ══════════════════════════════════════════════════════════
// helpers
// ══════════════════════════════════════════════════════════
// แปลง ISO datetime / date -> "YYYY-MM-DD" สำหรับ <input type="date">
const toDateInput = (val) => {
  if (!val) return "";
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(val);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};

// แปลง "YYYY-MM-DD" -> "DD/MM/YYYY" สำหรับแสดงผลในตาราง
const formatDateDisplay = (val) => {
  if (!val) return "—";
  const parts = val.split("-");
  if (parts.length !== 3) return val;
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
};

const formatFileSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const isPdfFile = (nameOrUrl) => /\.pdf(\?|$)/i.test(nameOrUrl || "");

// Past Deployment — ช่องข้อความตามไฟล์ประวัติลงงานของ HR (ภาษาไทย (อังกฤษ))
//   client = Project (เช่น Chevron) · ข้อความใน CV = composeProjectLabel(Project, Field, Platform)
const DEPLOYMENT_TEXT_FIELDS = [
  ["travelTeamNo", "Traveling Team No. (ON Number)", "เช่น ON/000-01/2026"],
  ["client", "Project", "เช่น Chevron"],
  ["field", "Field", "เช่น BENCHAMAS"],
  ["platform", "สถานที่เดินทาง (Platform)", "เช่น BELQ"],
  ["travelOut", "ขาไป (เดินทางโดย/จาก)", "เช่น boat STH"],
  ["travelBack", "ขากลับ (เดินทางโดย/จาก)", "เช่น boat STH"],
];

const composeProjectLabel = (client, field, platform) => {
  if (!client) return "";
  if (field) return `Supply Manpower for ${client} : ${field}`;
  if (platform) return `Supply Manpower for ${client} at ${platform}`;
  return `Supply Manpower for ${client}`;
};

const parseProjectLabel = (label, platform) => {
  if (!label) return { client: "", field: "" };
  let rest = label.replace(/^Supply Manpower for /, "");
  if (platform && rest.endsWith(` at ${platform}`)) {
    return {
      client: rest.slice(0, -` at ${platform}`.length).trim(),
      field: "",
    };
  }
  const idx = rest.indexOf(" : ");
  if (idx !== -1) {
    return {
      client: rest.slice(0, idx).trim(),
      field: rest.slice(idx + 3).trim(),
    };
  }
  return { client: rest.trim(), field: "" };
};

const toNumOrNull = (v) => (v === "" || v === null ? null : Number(v));

// หา PE record ล่าสุด (ใช้ sync Medical Check-up + แสดง Note ล่าสุด)
const findLatestExam = (exams) =>
  exams.find((e) => e.isLatest) ||
  [...exams]
    .filter((e) => e.examDate)
    .sort((a, b) => new Date(b.examDate) - new Date(a.examDate))[0];

// ══════════════════════════════════════════════════════════
// PE / Medical Exam — field config (แทนการเขียน input ซ้ำ 26 ช่อง)
// ══════════════════════════════════════════════════════════
const EXAM_NUMERIC_FIELDS = [
  "height",
  "weight",
  "bmi",
  "bpSystolic",
  "bpDiastolic",
  "hematocritPct",
  "bloodSugar",
  "ldl",
  "triglyceride",
  "sgot",
  "sgpt",
  "uricAcid",
];
const EXAM_TEXT_FIELDS = [
  "chronicDisease",
  "urineResult",
  "urineAbnormalNote",
  "ekgResult",
  "ekgAbnormalNote",
  "chestXrayResult",
  "chestXrayAbnormalNote",
  "dentalResult",
  "dentalAbnormalNote",
  "estResult",
  "estAbnormalNote",
  "note",
  "healthRisk",
  "recommendation",
  // การติดตามผล (PE tracking col AN..AR)
  "followUpTopic",
  "followUpNotice",
  "followUpRemindBefore",
  "followUpRemindOverdue",
  "followUpSchedule",
];

// ช่องวันที่ของ PE record (นอกจาก examDate / commentDate)
const EXAM_DATE_FIELDS = ["nextExamDate"];

// [key, label, type, placeholder?, step?]
// label = "ชื่อไทย / English" ตามหัวคอลัมน์ในไฟล์ PE tracking ของ HR
const EXAM_SECTIONS = [
  {
    title: "📅 ข้อมูลการตรวจ / EXAM INFO",
    grid: "grid grid-cols-1 gap-4 sm:grid-cols-2",
    fields: [
      ["examDate", "วันที่ตรวจร่างกาย / Exam Date", "date"],
      ["chronicDisease", "โรคประจำตัว / Underlying Disease", "text", "เช่น ไม่มี (No)"],
    ],
  },
  {
    title: "💓 สัญญาณชีพ / VITALS",
    grid: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3",
    fields: [
      ["height", "ส่วนสูง / Height (cm)", "number", "", "0.1"],
      ["weight", "น้ำหนัก / Weight (kg)", "number", "", "0.1"],
      ["bmi", "ดัชนีมวลกาย / BMI", "number", "", "0.01"],
      ["bpSystolic", "ความดันตัวบน / Systolic BP (SBP)", "number"],
      ["bpDiastolic", "ความดันตัวล่าง / Diastolic BP (DBP)", "number"],
      ["hematocritPct", "ความเข้มข้นของเลือด / Hematocrit (Hct) (%)", "number", "", "0.1"],
    ],
  },
  {
    title: "🧪 ปัสสาวะ / URINE",
    grid: "grid grid-cols-1 gap-4 sm:grid-cols-2",
    fields: [
      ["urineResult", "ผลตรวจปัสสาวะ / Urine Analysis (UA)", "text", "ปกติ (Normal) / ผิดปกติ (Abnormal)"],
      ["urineAbnormalNote", "รายละเอียดความผิดปกติ / Urine Abnormal Note", "text"],
    ],
  },
  {
    title: "🩸 เคมีในเลือด / BLOOD CHEMISTRY",
    grid: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3",
    fields: [
      ["bloodSugar", "น้ำตาลในเลือด / Fasting Blood Sugar (FBS)", "number"],
      ["ldl", "ไขมันไม่ดี / LDL-Cholesterol", "number"],
      ["triglyceride", "ไขมันไตรกลีเซอไรด์ / Triglyceride", "number"],
      ["sgot", "เอนไซม์ตับ / SGOT (AST)", "number"],
      ["sgpt", "เอนไซม์ตับ / SGPT (ALT)", "number"],
      ["uricAcid", "กรดยูริค / Uric Acid", "number", "", "0.1"],
    ],
  },
  {
    title: "📋 คลื่นหัวใจ / เอ็กซเรย์ / ฟัน / EST",
    grid: "grid grid-cols-1 gap-4 sm:grid-cols-2",
    fields: [
      ["ekgResult", "คลื่นไฟฟ้าหัวใจ / Electrocardiogram (EKG)", "text"],
      ["ekgAbnormalNote", "รายละเอียดความผิดปกติ / EKG Note", "text"],
      ["chestXrayResult", "เอ็กซเรย์ปอด / Chest X-ray", "text"],
      ["chestXrayAbnormalNote", "รายละเอียดความผิดปกติ / Chest X-ray Note", "text"],
      ["dentalResult", "ผลตรวจฟัน / Dental Examination", "text"],
      ["dentalAbnormalNote", "รายละเอียดความผิดปกติ / Dental Note", "text"],
      ["estResult", "EST (อายุ 55 ปี) / Exercise Stress Test", "text"],
      ["estAbnormalNote", "รายละเอียดความผิดปกติ / EST Note", "text"],
    ],
  },
];

// การติดตามผล — แสดงต่อจาก "สรุปผล" (PE tracking col AN..AR, AU)
const EXAM_FOLLOWUP_SECTION = {
  title: "🔔 การติดตามผล / FOLLOW-UP",
  grid: "grid grid-cols-1 gap-4 sm:grid-cols-2",
  fields: [
    ["followUpTopic", "เรื่องที่ต้องติดตาม / Follow-up Topic", "text", "เช่น ตรวจระดับไตรกลีเซอไรด์อีกครั้งภายใน 3 เดือน"],
    ["followUpNotice", "แจ้งเมื่อมีให้ติดตาม / Notified", "text", "เช่น แจ้งแล้ว"],
    ["followUpRemindBefore", "แจ้งซ้ำก่อนกำหนด 1 เดือน / Reminder Before Due", "text"],
    ["followUpRemindOverdue", "แจ้งซ้ำเมื่อเลยกำหนด / Reminder When Overdue", "text"],
    ["followUpSchedule", "กำหนดการติดตาม / Follow-up Schedule", "text"],
    ["nextExamDate", "กำหนดการตรวจครั้งถัดไป / Next Exam Date", "date"],
  ],
};

// กลุ่มช่องกรอกของ PE record 1 กลุ่ม (ใช้ทั้ง EXAM_SECTIONS และ Follow-up)
function ExamFieldGroup({ sec, exam, onChange }) {
  return (
    <div className="mb-3">
      <div className={SUBSECTION}>{sec.title}</div>
      <div className={sec.grid}>
        {sec.fields.map(([key, label, type, placeholder, step]) => (
          <div key={key}>
            <label className={LABEL}>{label}</label>
            <input
              type={type}
              step={step}
              placeholder={placeholder || undefined}
              value={exam[key] ?? ""}
              onChange={(e) => onChange(exam.id, key, e.target.value)}
              className={INPUT}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

const emptyExam = (id) => ({
  id,
  dbId: null,
  examDate: "",
  commentDate: "",
  nextExamDate: "",
  ...Object.fromEntries(
    [...EXAM_NUMERIC_FIELDS, ...EXAM_TEXT_FIELDS].map((k) => [k, ""]),
  ),
});

const TABS = [
  ["profile", "👤 Profile & Status"],
  ["documents", "📄 Documents & Compliance"],
  ["cv", "📋 CV / Resume Info"],
  ["medical-exam", "🏥 PE / Medical Exam"],
];

const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];

// ══════════════════════════════════════════════════════════
// Tailwind class ที่ใช้ซ้ำ
// ══════════════════════════════════════════════════════════
// section คั่นด้วยเส้น (ไม่มีกรอบ card) — เพิ่มพื้นที่แสดงผล
const CARD = "border-b border-gray-200";
const BODY = "pb-5 pt-1";
const GRID2 = "grid grid-cols-1 gap-4 sm:grid-cols-2";
const GRID3 = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3";
const GRID4 = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4";
const LABEL =
  "mb-1.5 block text-xs font-semibold uppercase tracking-[0.4px] text-gray-500";
const INPUT =
  "box-border w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] outline-none focus:border-blue-400 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500";
const READONLY_BOX =
  "box-border flex min-h-[38px] w-full cursor-help flex-wrap items-center gap-x-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px]";
const TH =
  "whitespace-nowrap border-b-2 border-gray-200 px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-[0.4px] text-gray-500";
const TD = "border-b border-gray-100 p-2.5 align-top";
const HIDE_MOBILE = "hidden sm:table-cell";
const EDIT_PANEL =
  "rounded-lg border border-gray-200 bg-gray-50 px-3 py-3.5 sm:px-4";
const SUBSECTION = "mb-1.5 text-[11px] font-bold text-gray-500";
const EMPTY_BOX =
  "rounded-lg border border-dashed border-gray-200 bg-gray-50 p-7 text-center";
const ADD_BTN =
  "cursor-pointer whitespace-nowrap rounded-md border border-[#ffe69c] bg-[#fff3cd] px-4 py-[7px] text-xs font-bold text-[#664d03] hover:bg-[#ffecb5]";
const EDIT_BTN =
  "cursor-pointer whitespace-nowrap rounded-md border-none bg-[#e7f1ff] px-2.5 py-1 text-xs font-semibold text-blue-600 shadow-[0_1px_3px_rgba(13,110,253,0.2),0_1px_2px_rgba(0,0,0,0.06)] transition-all hover:-translate-y-px hover:shadow-[0_3px_6px_rgba(13,110,253,0.3),0_2px_3px_rgba(0,0,0,0.08)]";
const REMOVE_BTN =
  "cursor-pointer whitespace-nowrap rounded-md border-none bg-[#fff5f5] px-2.5 py-1 text-xs font-semibold text-[#842029] shadow-[0_1px_3px_rgba(220,53,69,0.2),0_1px_2px_rgba(0,0,0,0.06)] transition-all hover:-translate-y-px hover:shadow-[0_3px_6px_rgba(220,53,69,0.3),0_2px_3px_rgba(0,0,0,0.08)]";
const DONE_BTN =
  "cursor-pointer whitespace-nowrap rounded-md border border-[#a3cfbb] bg-[#d1e7dd] px-2.5 py-1 text-xs font-semibold text-[#0f5132]";
const REMOVE_OUTLINE_BTN =
  "cursor-pointer whitespace-nowrap rounded-md border border-[#f5c6cb] bg-[#fff5f5] px-2.5 py-1 text-xs font-semibold text-[#842029]";
const FILE_BTN =
  "inline-flex cursor-pointer items-center rounded-md border border-gray-300 bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-900 shadow-sm hover:bg-gray-200";
const LATEST_TAG =
  "ml-1.5 rounded bg-[#d1e7dd] px-1.5 py-px text-[10px] font-bold text-[#0f5132]";
const DASH = <span className="text-gray-400">—</span>;

// ── react-select (ใช้ styles API ของไลบรารี — ใส่ className ตรงๆ ไม่ได้) ──
const SELECT_PROPS = {
  menuPortalTarget: typeof document !== "undefined" ? document.body : null,
  menuPosition: "fixed",
  styles: {
    menuPortal: (b) => ({ ...b, zIndex: 1000000 }),
    control: (b) => ({
      ...b,
      fontSize: "13px",
      minHeight: "38px",
      borderColor: "#dee2e6",
    }),
    option: (b) => ({ ...b, fontSize: "13px" }),
  },
};

// ══════════════════════════════════════════════════════════
// small components (อยู่นอก EditWorker — ไม่ถูกสร้างใหม่ทุก render)
// ══════════════════════════════════════════════════════════
function SectionHeader({ number, title, subtitle, accent, right }) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 pb-2 pt-5`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <div
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
            accent ? "bg-[#e53e3e]" : "bg-blue-600"
          }`}
        >
          {number}
        </div>
        <span
          className={`text-[15px] font-semibold ${
            accent ? "text-[#c53030]" : "text-gray-900"
          }`}
        >
          {title}
        </span>
        {subtitle && <span className="text-xs text-gray-500">{subtitle}</span>}
      </div>
      {right}
    </div>
  );
}

function UpdateButton({ onClick, saving, note }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
      {note}
      <button
        type="button"
        onClick={onClick}
        disabled={saving}
        className="cursor-pointer rounded-lg border-none bg-blue-600 px-5 py-[7px] text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {saving ? "Updating..." : "Update"}
      </button>
    </div>
  );
}

// ชื่อ cert ในรายการ — ชื่อในระบบ (ตัวหนา) + ชื่อในไฟล์ HR (ตัวเล็ก) ให้เทียบกันได้ทันที
const looseName = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[\s\-_/().,:;'"&]+/g, "");
function CertName({ training, rawName }) {
  if (!training) return <span className="text-gray-400">—</span>;
  // ชื่อในไฟล์ของใบนี้ (จาก import) — ถ้าไม่มี ใช้ "ชื่อที่ HR ใช้ในไฟล์" ของ training
  const fileName = rawName || training.fullName || "";
  const showFile = fileName && looseName(fileName) !== looseName(training.name);
  return (
    <div>
      <div className="font-medium text-gray-900">{training.name}</div>
      {showFile && (
        <div className="mt-0.5 text-[11px] text-gray-500">
          ในไฟล์: {fileName}
        </div>
      )}
    </div>
  );
}

function EditPanelHeader({ label, onDone, onRemove }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs font-semibold text-gray-500">{label}</span>
      <div className="flex gap-1.5">
        <button type="button" onClick={onDone} className={DONE_BTN}>
          ✓ Done
        </button>
        <button type="button" onClick={onRemove} className={REMOVE_OUTLINE_BTN}>
          ✕ Remove
        </button>
      </div>
    </div>
  );
}

function RowActions({ onEdit, onRemove }) {
  return (
    <div className="flex justify-end gap-1.5">
      <button type="button" onClick={onEdit} className={EDIT_BTN}>
        Edit
      </button>
      <button type="button" onClick={onRemove} className={REMOVE_BTN}>
        Remove
      </button>
    </div>
  );
}

function EmptyState({ title, hint }) {
  return (
    <div className={EMPTY_BOX}>
      <div className="text-[13px] text-gray-500">{title}</div>
      {hint && <div className="text-xs text-gray-400">{hint}</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// main
// ══════════════════════════════════════════════════════════
// เรียง certification: วันที่ออก (Issued) ล่าสุดอยู่บน · ไม่มีวันที่อยู่ล่างสุด (HR ขอ)
// completedDate เป็น "YYYY-MM-DD" จาก <input type="date"> → เทียบเป็นข้อความได้
const byIssuedDesc = (a, b) =>
  (b.completedDate || "").localeCompare(a.completedDate || "");

export default function EditWorker() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { backendUrl } = useContext(AppContent);

  const [positions, setPositions] = useState([]);
  const [globalTrainings, setGlobalTrainings] = useState([]);
  const [divisions, setDivisions] = useState([]);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [savingSection, setSavingSection] = useState(null);
  const [successMsg, setSuccessMsg] = useState("");
  const [error, setError] = useState("");

  // ── Tabs ──
  // profile      = Basic Info + Worker Status + Offshore Roster (แก้บ่อยสุด)
  // documents    = Passport + Certifications (อัปเดตตามรอบหมดอายุ)
  // cv           = Personal Details for CV + Past Deployment History
  // medical-exam = Medical Check-up Record (สรุป) + PE / Medical Exam Records
  const [activeTab, setActiveTab] = useState("profile");

  // ── Certifications ──
  const [certifications, setCertifications] = useState([]);
  const [removedCertIds, setRemovedCertIds] = useState([]);
  const [editingCertId, setEditingCertId] = useState(null);
  const [certSearch, setCertSearch] = useState("");
  const [certFormError, setCertFormError] = useState("");

  // ── Past Deployment History ──
  const [deployments, setDeployments] = useState([]);
  const [removedDeploymentIds, setRemovedDeploymentIds] = useState([]);
  const [editingDeploymentId, setEditingDeploymentId] = useState(null);

  // ── PE / Medical Exam ──
  const [medicalExams, setMedicalExams] = useState([]);
  const [removedMedicalExamIds, setRemovedMedicalExamIds] = useState([]);
  const [editingMedicalExamId, setEditingMedicalExamId] = useState(null);

  const [formData, setFormData] = useState({
    empCode: "",
    empId: "",
    fullName: "",
    fullNameTH: "",
    nationality: "",
    positionId: "",
    division: "",
    birthDate: "",
    startWorkDate: "",
    status: "active",
    availabilityStatus: "available",
    mobilizationStatus: "pending",
    isOffshore: false,
    isPermanent: false,
    healthRisk: "",
    healthNote: "",
    sseLevel: "",
    sseCompleted: "",
    passportNumber: "",
    passportExpiryDate: "",
    workPermitNo: "",
    workPermitExpiryDate: "",
    phone: "",
    email: "",
    notes: "",
    address: "",
    gender: "",
    height: "",
    weight: "",
    religion: "",
    language: "",
    education: "",
  });

  const [medicalData, setMedicalData] = useState({
    medicalId: null,
    confinedSpaceId: null,
    hospital: "",
    issuedDate: "",
    expiryDate: "",
    status: "",
    confinedSpaceStatus: "",
    notes: "",
  });

  // ── Photo ──
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [originalPhotoUrl, setOriginalPhotoUrl] = useState("");
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [certFileModal, setCertFileModal] = useState(null); // { url, name, isPdf } | null

  const [healthRiskOptions, setHealthRiskOptions] = useState([
    "low",
    "moderate",
    "high",
    "significant",
    "pending",
  ]);

  // ── ข้อความ "บันทึกสำเร็จ" หายเองใน 3 วินาที ──
  useEffect(() => {
    if (!successMsg) return;
    const t = setTimeout(() => setSuccessMsg(""), 3000);
    return () => clearTimeout(t);
  }, [successMsg]);

  useEffect(() => {
    axios
      .get(`${backendUrl}/api/workers/health-risk-options`, {
        withCredentials: true,
      })
      .then((res) =>
        setHealthRiskOptions((prev) => [...new Set([...prev, ...res.data])]),
      )
      .catch((err) => console.error(err));
  }, [backendUrl]);

  useEffect(() => {
    axios
      .get(`${backendUrl}/api/divisions`, { withCredentials: true })
      .then((res) => setDivisions(res.data.map((d) => d.name)))
      .catch((err) => console.error(err));
  }, [backendUrl]);

  // ── Sync Medical Check-up Record จาก PE record ล่าสุด ──
  //    issuedDate = exam date ล่าสุด, expiryDate = +1 ปี
  useEffect(() => {
    if (medicalExams.length === 0) return;
    const latestExam = findLatestExam(medicalExams);
    if (!latestExam?.examDate) return;

    const d = new Date(latestExam.examDate);
    const expiry = isNaN(d.getTime())
      ? ""
      : new Date(d.getFullYear() + 1, d.getMonth(), d.getDate())
          .toISOString()
          .slice(0, 10);

    setMedicalData((prev) => ({
      ...prev,
      issuedDate: latestExam.examDate,
      expiryDate: expiry,
    }));
  }, [medicalExams]);

  // ===========================================================
  // Fetch
  // ===========================================================
  const fetchWorkerData = async () => {
    try {
      setLoading(true);
      let posData = [];
      try {
        const r = await axios.get(`${backendUrl}/api/positions/manage`, {
          withCredentials: true,
        });
        posData = r.data;
      } catch {
        const r = await axios.get(`${backendUrl}/api/positions`, {
          withCredentials: true,
        });
        posData = r.data;
      }
      const [trainingRes, workerRes] = await Promise.all([
        axios.get(`${backendUrl}/api/trainings/global`, {
          withCredentials: true,
        }),
        axios.get(`${backendUrl}/api/workers/${id}`, {
          withCredentials: true,
        }),
      ]);

      setPositions(posData);
      setGlobalTrainings(trainingRes.data);

      const w = workerRes.data;

      setFormData({
        empCode: w.empCode || "",
        empId: w.empId || "",
        fullName: w.fullName || "",
        fullNameTH: w.fullNameTH || "",
        nationality: w.nationality || "",
        positionId: w.positionId || "",
        division: w.division || "",
        birthDate: toDateInput(w.birthDate),
        startWorkDate: toDateInput(w.startWorkDate),
        status: w.status || "active",
        availabilityStatus: w.availabilityStatus || "available",
        mobilizationStatus: w.mobilizationStatus || "pending",
        isOffshore: w.isOffshore || false,
        isPermanent: w.isPermanent || false,
        healthRisk: w.healthRisk || "",
        healthNote: w.healthNote || "",
        sseLevel: w.sseLevel || "",
        sseCompleted:
          w.sseCompleted === true
            ? "true"
            : w.sseCompleted === false
              ? "false"
              : "",
        passportNumber: w.passport?.passportNo || "",
        passportExpiryDate: toDateInput(w.passport?.expiryDate),
        workPermitNo: w.passport?.workPermitNo || "",
        workPermitExpiryDate: toDateInput(w.passport?.workPermitExpiryDate),
        phone: w.phone || "",
        email: w.email || "",
        notes: w.notes || "",
        address: w.address || "",
        gender: w.gender || "",
        height: w.height ?? "",
        weight: w.weight ?? "",
        religion: w.religion || "",
        language: w.language || "",
        education: w.education || "",
      });

      if (w.photoUrl) {
        const fullUrl = `${backendUrl}${w.photoUrl}`;
        setPhotoPreview(fullUrl);
        setOriginalPhotoUrl(fullUrl);
      }

      const rawCerts = w.trainings || w.certifications || [];
      setCertifications(
        rawCerts.map((t) => ({
          id: t.id,
          dbId: t.id,
          globalTrainingId: t.globalTrainingId || "",
          rawTrainingName: t.rawTrainingName || "", // ชื่อในไฟล์ HR ตอน import — แสดงเทียบในรายการ
          completedDate: toDateInput(t.completedDate),
          expiryDate: toDateInput(t.expiryDate),
          certFile: null,
          certFileUrl: t.certFileUrl || "",
          certFileName: t.certFileName || "",
          certFilePreviewUrl: null,
          removeCertFile: false,
        })).sort(byIssuedDesc),
      );

      // เฉพาะ record ที่ projectId = null (manual/historical) —
      // deployment จริงจาก Mobilization flow จัดการที่หน้า Mobilization
      const rawDeployments = (w.assignments || []).filter((a) => !a.projectId);
      setDeployments(
        rawDeployments.map((a) => {
          const { client, field } = parseProjectLabel(
            a.projectLabel,
            a.platform,
          );
          return {
            id: a.id,
            dbId: a.id,
            client,
            // Field แยกคอลัมน์แล้ว — ข้อมูลเก่าที่ไม่มี ใช้ค่าที่แยกจาก projectLabel
            field: a.field || field,
            positionId: a.positionId || "",
            platform: a.platform || "",
            mobDate: toDateInput(a.mobDate),
            demobDate: toDateInput(a.demobDate),
            travelTeamNo: a.travelTeamNo || "",
            travelOut: a.travelOut || "",
            travelBack: a.travelBack || "",
            remark: a.remark || "",
          };
        }),
      );

      const rawExams = w.medicalExamRecords || [];
      setMedicalExams(
        rawExams.map((r) => ({
          id: r.id,
          dbId: r.id,
          examDate: toDateInput(r.examDate),
          commentDate: toDateInput(r.commentDate),
          nextExamDate: toDateInput(r.nextExamDate),
          isLatest: r.isLatest,
          ...Object.fromEntries(
            EXAM_NUMERIC_FIELDS.map((k) => [k, r[k] ?? ""]),
          ),
          ...Object.fromEntries(EXAM_TEXT_FIELDS.map((k) => [k, r[k] || ""])),
        })),
      );

      // tolerant match กัน checkType สะกดต่าง
      const records = w.medicalChecks || [];
      const norm = (s) => (s || "").replace(/\s+/g, "").toLowerCase();
      const med = records.find((m) => norm(m.checkType) === "medicalcheckup");
      const cse = records.find(
        (m) => norm(m.checkType) === "confinedspaceentry",
      );

      setMedicalData({
        medicalId: med?.id || null,
        confinedSpaceId: cse?.id || null,
        hospital: med?.hospital || cse?.hospital || "",
        issuedDate: toDateInput(med?.issuedDate || cse?.issuedDate),
        expiryDate: toDateInput(med?.expiryDate || cse?.expiryDate),
        status: med?.status || "",
        confinedSpaceStatus: cse?.status || "",
        notes: med?.notes || cse?.notes || "",
      });
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load worker data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkerData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, backendUrl]);

  // ===========================================================
  // Handlers
  // ===========================================================
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const setField = (name, value) =>
    setFormData((prev) => ({ ...prev, [name]: value }));

  const handleMedicalChange = (e) => {
    const { name, value } = e.target;
    setMedicalData((prev) => ({ ...prev, [name]: value }));
  };

  // ── Photo ──
  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const removePhoto = () => {
    setPhotoFile(null);
    setPhotoPreview(originalPhotoUrl); // fallback กลับไปรูปเดิมใน DB
    const inputEl = document.getElementById("photo-upload-input");
    if (inputEl) inputEl.value = "";
  };

  const handlePrintCertFile = () => {
    if (!certFileModal) return;
    if (certFileModal.isPdf) {
      const iframe = document.getElementById("cert-file-print-frame");
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      }
    } else {
      const printWindow = window.open(certFileModal.url, "_blank");
      if (printWindow) {
        printWindow.onload = () => {
          printWindow.focus();
          printWindow.print();
        };
      }
    }
  };

  // ── Certifications ──
  const addCertification = () => {
    const newId = Date.now();
    setCertifications((prev) => [
      {
        id: newId,
        dbId: null,
        globalTrainingId: "",
        completedDate: "",
        expiryDate: "",
        certFile: null,
        certFileUrl: "",
        certFileName: "",
        certFilePreviewUrl: null,
        removeCertFile: false,
      },
      ...prev,
    ]);
    setEditingCertId(newId);
    setCertSearch("");
    setCertFormError("");
  };

  const removeCertification = (cert) => {
    if (cert.dbId) setRemovedCertIds((prev) => [...prev, cert.dbId]);
    setCertifications((prev) => prev.filter((c) => c.id !== cert.id));
    if (editingCertId === cert.id) setEditingCertId(null);
  };

  const handleCertChange = (localId, field, value) => {
    if (field === "globalTrainingId" && value) setCertFormError("");
    setCertifications((prev) =>
      prev.map((c) => (c.id === localId ? { ...c, [field]: value } : c)),
    );
  };

  const handleDoneCert = (cert) => {
    if (!cert.globalTrainingId) {
      setCertFormError("กรุณาเลือก Training / Certification ก่อนกด Done");
      return;
    }
    setCertFormError("");
    setEditingCertId(null);
    setCertifications((prev) => [...prev].sort(byIssuedDesc)); // จัดลำดับใหม่หลังแก้วันที่
  };

  const handleCertFileChange = (localId, file) => {
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setCertifications((prev) =>
      prev.map((c) => {
        if (c.id !== localId) return c;
        if (c.certFilePreviewUrl) URL.revokeObjectURL(c.certFilePreviewUrl);
        return {
          ...c,
          certFile: file,
          certFileName: file.name,
          certFilePreviewUrl: previewUrl,
          removeCertFile: false,
        };
      }),
    );
  };

  const clearCertFile = (localId) => {
    setCertifications((prev) =>
      prev.map((c) => {
        if (c.id !== localId) return c;
        if (c.certFilePreviewUrl) URL.revokeObjectURL(c.certFilePreviewUrl);
        return {
          ...c,
          certFile: null,
          certFileUrl: "",
          certFileName: "",
          certFilePreviewUrl: null,
          removeCertFile: true,
        };
      }),
    );
  };

  const certPreviewUrl = (cert) =>
    cert.certFile
      ? cert.certFilePreviewUrl
      : cert.certFileUrl
        ? `${backendUrl}${cert.certFileUrl}`
        : null;

  // ── Deployments ──
  const addDeployment = () => {
    const newId = Date.now();
    setDeployments((prev) => [
      {
        id: newId,
        dbId: null,
        client: "",
        field: "",
        positionId: "",
        platform: "",
        mobDate: "",
        demobDate: "",
        travelTeamNo: "",
        travelOut: "",
        travelBack: "",
        remark: "",
      },
      ...prev,
    ]);
    setEditingDeploymentId(newId);
  };

  const removeDeployment = (dep) => {
    if (dep.dbId) setRemovedDeploymentIds((prev) => [...prev, dep.dbId]);
    setDeployments((prev) => prev.filter((d) => d.id !== dep.id));
    if (editingDeploymentId === dep.id) setEditingDeploymentId(null);
  };

  const handleDeploymentChange = (localId, field, value) =>
    setDeployments((prev) =>
      prev.map((d) => (d.id === localId ? { ...d, [field]: value } : d)),
    );

  // ── Medical Exams ──
  const addMedicalExam = () => {
    const newId = Date.now();
    setMedicalExams((prev) => [emptyExam(newId), ...prev]);
    setEditingMedicalExamId(newId);
  };

  const removeMedicalExam = (exam) => {
    if (exam.dbId) setRemovedMedicalExamIds((prev) => [...prev, exam.dbId]);
    setMedicalExams((prev) => prev.filter((e) => e.id !== exam.id));
    if (editingMedicalExamId === exam.id) setEditingMedicalExamId(null);
  };

  const handleMedicalExamChange = (localId, field, value) =>
    setMedicalExams((prev) =>
      prev.map((e) => (e.id === localId ? { ...e, [field]: value } : e)),
    );

  // ===========================================================
  // Save functions
  // ===========================================================
  const buildWorkerPayload = () => ({
    empCode: formData.empCode,
    empId: formData.empId || null,
    fullName: formData.fullName,
    fullNameTH: formData.fullNameTH || null,
    nationality: formData.nationality || null,
    phone: formData.phone || null,
    email: formData.email || null,
    positionId: formData.positionId || null,
    division: formData.division || null,
    birthDate: formData.birthDate || null,
    startWorkDate: formData.startWorkDate || null,
    status: formData.status,
    availabilityStatus: formData.availabilityStatus,
    mobilizationStatus: formData.mobilizationStatus,
    isOffshore: formData.isOffshore,
    isPermanent: formData.isPermanent,
    healthRisk:
      medicalExams.some((e) => e.examDate) ? undefined : formData.healthRisk || null,
    healthNote: formData.healthNote || null,
    sseLevel: formData.sseLevel || null,
    sseCompleted:
      formData.sseCompleted === "" ? null : formData.sseCompleted === "true",
    notes: formData.notes || null,
    address: formData.address || null,
    gender: formData.gender || null,
    height: formData.height === "" ? null : formData.height,
    weight: formData.weight === "" ? null : formData.weight,
    religion: formData.religion || null,
    language: formData.language || null,
    education: formData.education || null,
  });

  const countIncompleteCerts = () =>
    certifications.filter(
      (c) =>
        !c.globalTrainingId &&
        (c.completedDate || c.expiryDate || c.certFile || c.certFileUrl),
    ).length;

  const incompleteCertMsg = (n) =>
    `มี Certification ที่ยังไม่ได้เลือก Training/Certification (${n} รายการ) — กรุณาเลือก training หรือลบแถวนั้นออกก่อนบันทึก`;

  const saveWorkerCore = async () => {
    if (!formData.empCode || !formData.fullName) {
      throw new Error("Employee Code and Full Name are required.");
    }
    await axios.put(`${backendUrl}/api/workers/${id}`, buildWorkerPayload(), {
      withCredentials: true,
    });
  };

  const savePassport = async () => {
    if (
      formData.passportNumber ||
      formData.passportExpiryDate ||
      formData.workPermitNo ||
      formData.workPermitExpiryDate
    ) {
      await axios.post(
        `${backendUrl}/api/workers/${id}/passport`,
        {
          passportNo: formData.passportNumber || null,
          expiryDate: formData.passportExpiryDate || null,
          workPermitNo: formData.workPermitNo || null,
          workPermitExpiryDate: formData.workPermitExpiryDate || null,
        },
        { withCredentials: true },
      );
    }
  };

  const saveCertifications = async () => {
    const incomplete = countIncompleteCerts();
    if (incomplete > 0) throw new Error(incompleteCertMsg(incomplete));

    const cleanedCerts = certifications.filter(
      (c) =>
        c.globalTrainingId ||
        c.completedDate ||
        c.expiryDate ||
        c.certFile ||
        c.certFileUrl,
    );

    for (const certId of removedCertIds) {
      await axios.delete(
        `${backendUrl}/api/workers/${id}/trainings/${certId}`,
        { withCredentials: true },
      );
    }
    setRemovedCertIds([]);

    for (const cert of cleanedCerts) {
      if (!cert.globalTrainingId) continue;
      const payload = {
        globalTrainingId: cert.globalTrainingId,
        completedDate: cert.completedDate || null,
        expiryDate: cert.expiryDate || null,
        source: "manual",
      };
      let certRecordId = cert.dbId;
      if (cert.dbId) {
        await axios.put(
          `${backendUrl}/api/workers/${id}/trainings/${cert.dbId}`,
          payload,
          { withCredentials: true },
        );
      } else {
        const res = await axios.post(
          `${backendUrl}/api/workers/${id}/trainings`,
          payload,
          { withCredentials: true },
        );
        certRecordId = res.data.id;
      }
      if (cert.certFile && certRecordId) {
        const fd = new FormData();
        fd.append("certFile", cert.certFile);
        await axios.post(
          `${backendUrl}/api/workers/${id}/trainings/${certRecordId}/cert-file`,
          fd,
          {
            withCredentials: true,
            headers: { "Content-Type": "multipart/form-data" },
          },
        );
      } else if (cert.removeCertFile && certRecordId) {
        await axios.delete(
          `${backendUrl}/api/workers/${id}/trainings/${certRecordId}/cert-file`,
          { withCredentials: true },
        );
      }
    }
  };

  const savePhotoIfNeeded = async () => {
    if (photoFile) {
      const fd = new FormData();
      fd.append("photo", photoFile);
      await axios.post(`${backendUrl}/api/workers/${id}/photo`, fd, {
        withCredentials: true,
        headers: { "Content-Type": "multipart/form-data" },
      });
      setPhotoFile(null);
    }
  };

  const saveDeployments = async () => {
    for (const depId of removedDeploymentIds) {
      await axios.delete(
        `${backendUrl}/api/workers/${id}/deployments/${depId}`,
        { withCredentials: true },
      );
    }
    setRemovedDeploymentIds([]);

    for (const dep of deployments) {
      if (!dep.client && !dep.mobDate) continue; // กันแถวว่าง
      const payload = {
        projectLabel: composeProjectLabel(dep.client, dep.field, dep.platform),
        positionId: dep.positionId || null,
        platform: dep.platform || null,
        mobDate: dep.mobDate || null,
        demobDate: dep.demobDate || null,
        field: dep.field || null,
        travelTeamNo: dep.travelTeamNo || null,
        travelOut: dep.travelOut || null,
        travelBack: dep.travelBack || null,
        remark: dep.remark || null,
      };
      if (dep.dbId) {
        await axios.put(
          `${backendUrl}/api/workers/${id}/deployments/${dep.dbId}`,
          payload,
          { withCredentials: true },
        );
      } else {
        await axios.post(
          `${backendUrl}/api/workers/${id}/deployments`,
          payload,
          { withCredentials: true },
        );
      }
    }
  };

  const saveMedicalExams = async () => {
    for (const examId of removedMedicalExamIds) {
      await axios.delete(
        `${backendUrl}/api/workers/${id}/medical-exam/${examId}`,
        { withCredentials: true },
      );
    }
    setRemovedMedicalExamIds([]);

    for (const exam of medicalExams) {
      if (!exam.examDate) continue; // ต้องมีวันที่ตรวจอย่างน้อย
      const payload = {
        examDate: exam.examDate,
        commentDate: exam.commentDate || null,
        // ส่งเป็น ISO เต็ม — backend ส่งต่อเข้า Prisma ตรงๆ (DateTime ไม่รับ "YYYY-MM-DD")
        ...Object.fromEntries(
          EXAM_DATE_FIELDS.map((k) => [
            k,
            exam[k] ? new Date(exam[k]).toISOString() : null,
          ]),
        ),
        ...Object.fromEntries(
          EXAM_NUMERIC_FIELDS.map((k) => [k, toNumOrNull(exam[k])]),
        ),
        ...Object.fromEntries(
          EXAM_TEXT_FIELDS.map((k) => [k, exam[k] || null]),
        ),
      };
      if (exam.dbId) {
        await axios.put(
          `${backendUrl}/api/workers/${id}/medical-exam/${exam.dbId}`,
          payload,
          { withCredentials: true },
        );
      } else {
        await axios.post(
          `${backendUrl}/api/workers/${id}/medical-exam`,
          payload,
          { withCredentials: true },
        );
      }
    }
  };

  const saveMedicalChecks = async () => {
    if (medicalData.hospital || medicalData.issuedDate || medicalData.status) {
      const payload = {
        checkType: "Medical Check up",
        hospital: medicalData.hospital || null,
        issuedDate: medicalData.issuedDate || null,
        expiryDate: medicalData.expiryDate || null,
        status: medicalData.status || "pending",
        notes: medicalData.notes || null,
      };
      if (medicalData.medicalId) {
        await axios.put(
          `${backendUrl}/api/workers/${id}/medical/${medicalData.medicalId}`,
          payload,
          { withCredentials: true },
        );
      } else {
        await axios.post(`${backendUrl}/api/workers/${id}/medical`, payload, {
          withCredentials: true,
        });
      }
    }

    if (medicalData.confinedSpaceStatus === "") {
      // เลือก N/A → ลบ record เดิมทิ้ง (ถ้ามี)
      if (medicalData.confinedSpaceId) {
        await axios.delete(
          `${backendUrl}/api/workers/${id}/medical/${medicalData.confinedSpaceId}`,
          { withCredentials: true },
        );
      }
    } else {
      const payload = {
        checkType: "Confined Space Entry",
        hospital: medicalData.hospital || null,
        issuedDate: medicalData.issuedDate || null,
        expiryDate: medicalData.expiryDate || null,
        status: medicalData.confinedSpaceStatus,
        notes: medicalData.notes || null,
      };
      if (medicalData.confinedSpaceId) {
        await axios.put(
          `${backendUrl}/api/workers/${id}/medical/${medicalData.confinedSpaceId}`,
          payload,
          { withCredentials: true },
        );
      } else {
        await axios.post(`${backendUrl}/api/workers/${id}/medical`, payload, {
          withCredentials: true,
        });
      }
    }
  };

  const errorMessage = (err) =>
    err.message && !err.response ? err.message : err.response?.data?.message;

  // ── รัน save ของ section แล้ว refetch ──
  const runSectionSave = async (sectionKey, saveFns) => {
    setError("");
    setSuccessMsg("");
    setSavingSection(sectionKey);
    try {
      for (const fn of saveFns) await fn();
      await fetchWorkerData();
      setSuccessMsg("บันทึกสำเร็จ");
    } catch (err) {
      console.error(`Save ${sectionKey} failed:`, err);
      setError(errorMessage(err) || "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setSavingSection(null);
    }
  };

  const handleSaveBasic = () => runSectionSave("basic", [saveWorkerCore]);
  const handleSaveStatus = () => runSectionSave("status", [saveWorkerCore]);
  const handleSaveRoster = () => runSectionSave("roster", [saveWorkerCore]);
  const handleSavePassport = () => runSectionSave("passport", [savePassport]);
  const handleSaveCerts = () => runSectionSave("certs", [saveCertifications]);
  const handleSaveCvPersonal = () =>
    runSectionSave("cv-personal", [saveWorkerCore, savePhotoIfNeeded]);
  const handleSaveDeployment = () =>
    runSectionSave("deployment", [saveDeployments]);
  const handleSaveMedicalSummary = () =>
    runSectionSave("medical-summary", [saveMedicalChecks]);
  const handleSaveMedicalExam = () =>
    runSectionSave("medical-exam", [saveMedicalExams]);

  // ── ปุ่มล่างสุด: save ทุกอย่างแล้วออก ──
  const handleSaveAllAndExit = async () => {
    setError("");
    setSuccessMsg("");

    const incomplete = countIncompleteCerts();
    if (incomplete > 0) {
      setError(incompleteCertMsg(incomplete));
      return;
    }
    if (!formData.empCode || !formData.fullName) {
      setError("Employee Code and Full Name are required.");
      return;
    }

    setSubmitting(true);
    try {
      await saveWorkerCore();
      await savePassport();
      await saveCertifications();
      await savePhotoIfNeeded();
      await saveDeployments();
      await saveMedicalExams();
      await saveMedicalChecks();
      navigate("/workers");
    } catch (err) {
      setError(errorMessage(err) || "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setSubmitting(false);
    }
  };

  // ===========================================================
  // Loading
  // ===========================================================
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1800px]">
        <div className="rounded-[10px] border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Loading worker data...
        </div>
      </div>
    );
  }

  // ===========================================================
  // Derived
  // ===========================================================
  const positionOptions = positions.map((p) => ({
    value: p.id,
    label: `${p.name}${p._count ? ` (${p._count.employees})` : ""}`,
  }));

  const positionNameById = (posId) =>
    positions.find((p) => p.id === posId)?.name || "—";

  const trainingOptions = globalTrainings.map((t) => ({
    value: t.id,
    label: `${t.name}${t.fullName ? ` - ${t.fullName}` : ""}`,
  }));

  const trainingNameStringById = (trainingId) => {
    const t = globalTrainings.find((t) => t.id === trainingId);
    if (!t) return "";
    return `${t.name}${t.fullName ? ` - ${t.fullName}` : ""}`;
  };

  const filteredCertifications = certifications.filter((cert) => {
    if (cert.id === editingCertId) return true; // แถวที่กำลังแก้ไข แสดงเสมอ
    if (!certSearch.trim()) return true;
    const q = certSearch.trim().toLowerCase();
    return `${trainingNameStringById(cert.globalTrainingId)} ${cert.rawTrainingName || ""}`
      .toLowerCase()
      .includes(q);
  });

  let divisionPool = [...divisions];
  if (formData.division && !divisionPool.includes(formData.division)) {
    divisionPool = [formData.division, ...divisionPool];
  }
  const departmentOptions = divisionPool.map((d) => ({ value: d, label: d }));

  const healthRiskSelectOptions = healthRiskOptions.map((v) => ({
    value: v,
    label: v,
  }));

  // Note ล่าสุดจาก PE record — แสดงอ้างอิงข้าง Health Note (ไม่ sync เข้า formData)
  const latestExamNote =
    medicalExams.length > 0 ? findLatestExam(medicalExams)?.note || "" : "";

  // PE record ล่าสุดที่มีวันที่ตรวจ — มีแล้ว Health Risk / Examination Date / Expiry Date
  // จะล็อก (อ่านอย่างเดียว) และใช้ค่าจาก record นี้ · ยังไม่มี → กรอกเองได้
  // (เช่น ผลตรวจที่มาจากไฟล์ Training Record ซึ่งไม่มีรายละเอียด PE)
  const latestExam = findLatestExam(medicalExams.filter((e) => e.examDate));
  const hasExams = !!latestExam;
  const SYNC_LABEL = (
    <span className="ml-1 font-normal normal-case tracking-normal text-blue-600">(จาก PE / Medical Exam Records ล่าสุด)</span>
  );

  // ===========================================================
  // Render
  // ===========================================================
  return (
    <div className="mx-auto w-full min-w-0 max-w-[1800px]">
      {/* ════════ Header ════════ */}
      <div className="mb-3 flex flex-col gap-3 border-b border-gray-200 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2.5">
            <span className="text-lg font-bold">Edit Worker</span>
            {formData.fullName && (
              <>
                <span className="text-lg font-bold text-gray-500">—</span>
                <span className="break-words text-lg font-bold text-gray-500">
                  {formData.fullName}
                </span>
              </>
            )}
            {formData.empId ? (
              <span
                className="rounded-md bg-sky-50 px-2 py-0.5 font-mono text-xs font-semibold text-blue-600"
                title="Employee ID — ใช้ login Worker App และอ้างอิงกับ Client"
              >
                                <span className="mr-1 font-sans font-normal text-blue-400">
                  Emp ID:
                </span>
                {formData.empId}
              </span>
            ) : (
              formData.empCode && (
                <span
                  className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs font-semibold text-gray-500"
                  title="ยังไม่มี Employee ID — แสดงรหัสภายในระบบแทน"
                >
                  {formData.empCode}
                </span>
              )
            )}
          </div>
          <span className="text-[13px] text-gray-500">
            Update worker details &amp; records
          </span>
        </div>
        <button
          onClick={() => navigate("/workers")}
          className="shrink-0 cursor-pointer self-start rounded-lg border border-gray-200 bg-white px-4 py-[7px] text-[13px] hover:bg-gray-50 sm:self-auto"
        >
          ← Back
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[#f5c6cb] bg-[#f8d7da] px-4 py-2.5 text-[13px] text-[#842029]">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="mb-4 rounded-lg border border-[#a3cfbb] bg-[#d1e7dd] px-4 py-2.5 text-[13px] text-[#0f5132]">
          ✓ {successMsg}
        </div>
      )}

      {/* ════════ Tab bar — มือถือเลื่อนแนวนอนได้ ════════ */}
      <div className="sticky top-[59px] z-20 flex gap-1 overflow-x-auto overflow-y-hidden border-b-2 border-gray-200 bg-white">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`-mb-0.5 shrink-0 cursor-pointer whitespace-nowrap border-x-0 border-b-2 border-t-0 border-solid bg-transparent px-3 py-2.5 text-[13px] sm:px-[18px] ${
              activeTab === key
                ? "border-blue-600 font-bold text-blue-600"
                : "border-transparent font-medium text-gray-500 hover:text-gray-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* กด Enter ในช่องกรอกจะไม่ submit form (เดิม = save ทุกอย่างแล้วออกจากหน้าทันที) */}
      <form onSubmit={(e) => e.preventDefault()}>
        {/* ════════════════════ TAB: Profile ════════════════════ */}
        {activeTab === "profile" && (
          <>
            {/* Section 1: Basic Information */}
            <div className={CARD}>
              <SectionHeader number="1" title="Basic Information" />
              <div className={BODY}>
                <div className={`${GRID3} mb-4`}>
                  <div>
                    <label className={LABEL}>
                      Employee Code <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      name="empCode"
                      value={formData.empCode}
                      onChange={handleChange}
                      required
                      disabled
                      title="เลขอ้างอิงพนักงานในระบบ เรียงตามลำดับที่สร้าง — แก้ไขไม่ได้เพื่อป้องกันรหัสซ้ำซ้อนหรืออ้างอิงผิดตัว"
                      className={INPUT}
                    />
                    <div className="mt-1 text-[11px] text-gray-400">
                      ลำดับการสร้างพนักงานในระบบ ไม่มีนัยสำคัญอื่น
                      และแก้ไขไม่ได้
                    </div>
                  </div>
                  <div>
                    <label className={LABEL}>Employee ID</label>
                    <input
                      type="text"
                      name="empId"
                      placeholder="e.g., 38561733"
                      value={formData.empId}
                      onChange={handleChange}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>Nationality</label>
                    <input
                      type="text"
                      name="nationality"
                      placeholder="e.g., Thai, Filipino"
                      value={formData.nationality}
                      onChange={handleChange}
                      className={INPUT}
                    />
                  </div>
                </div>

                <div className={`${GRID2} mb-4`}>
                  <div>
                    <label className={LABEL}>
                      Full Name (as per Passport){" "}
                      <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      name="fullName"
                      placeholder="e.g., Somchai Jaidee"
                      value={formData.fullName}
                      onChange={handleChange}
                      required
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>ชื่อ-นามสกุล (ภาษาไทย)</label>
                    <input
                      type="text"
                      name="fullNameTH"
                      placeholder="เช่น สมชาย ใจดี"
                      value={formData.fullNameTH}
                      onChange={handleChange}
                      className={INPUT}
                    />
                  </div>
                </div>

                <div className={`${GRID2} mb-4`}>
                  <div>
                    <label className={LABEL}>Position / Trade</label>
                    <Select
                      {...SELECT_PROPS}
                      options={positionOptions}
                      value={
                        positionOptions.find(
                          (o) => o.value === formData.positionId,
                        ) || null
                      }
                      onChange={(o) => setField("positionId", o ? o.value : "")}
                      placeholder="ค้นหา / เลือกตำแหน่ง..."
                      isClearable
                      noOptionsMessage={() => "ไม่มีตำแหน่ง"}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>Department</label>
                    <Select
                      {...SELECT_PROPS}
                      options={departmentOptions}
                      value={
                        departmentOptions.find(
                          (o) => o.value === formData.division,
                        ) || null
                      }
                      onChange={(o) => setField("division", o ? o.value : "")}
                      placeholder="ค้นหา / เลือกแผนก..."
                      isClearable
                      noOptionsMessage={() => "ไม่มีแผนก"}
                    />
                  </div>
                </div>

                <div className={`${GRID4} mb-4`}>
                  <div>
                    <label className={LABEL}>Date of Birth</label>
                    <input
                      type="date"
                      name="birthDate"
                      value={formData.birthDate}
                      onChange={handleChange}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>Start Work Date</label>
                    <input
                      type="date"
                      name="startWorkDate"
                      value={formData.startWorkDate}
                      onChange={handleChange}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>Phone</label>
                    <input
                      type="text"
                      name="phone"
                      placeholder="+66 xx xxx xxxx"
                      value={formData.phone}
                      onChange={handleChange}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>Email</label>
                    <input
                      type="email"
                      name="email"
                      placeholder="worker@email.com"
                      value={formData.email}
                      onChange={handleChange}
                      className={INPUT}
                    />
                  </div>
                </div>

                <div>
                  <label className={LABEL}>Notes</label>
                  <textarea
                    name="notes"
                    rows={3}
                    placeholder="Additional notes, restrictions, or remarks..."
                    value={formData.notes}
                    onChange={handleChange}
                    className={`${INPUT} resize-y`}
                  />
                </div>
                <UpdateButton
                  onClick={handleSaveBasic}
                  saving={savingSection === "basic"}
                />
              </div>
            </div>

            {/* Section 2: Worker Status */}
            <div className={CARD}>
              <SectionHeader number="2" title="Worker Status" />
              <div className={BODY}>
                <div className={`${GRID3} mb-4`}>
                  <div>
                    <label className={LABEL}>Worker Status</label>
                    <select
                      name="status"
                      value={formData.status}
                      onChange={handleChange}
                      className={INPUT}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                  <div>
                    <label className={LABEL}>Availability</label>
                    <select
                      name="availabilityStatus"
                      value={formData.availabilityStatus}
                      onChange={(e) => {
                        const value = e.target.value;
                        setFormData((prev) => ({
                          ...prev,
                          availabilityStatus: value,
                          mobilizationStatus:
                            value === "unavailable"
                              ? "on_site"
                              : prev.mobilizationStatus === "on_site"
                                ? "pending"
                                : prev.mobilizationStatus,
                        }));
                      }}
                      className={INPUT}
                    >
                      <option value="available">Available</option>
                      <option value="unavailable">Unavailable</option>
                    </select>
                  </div>
                  <div>
                    <label className={LABEL}>Mobilization Status</label>
                    <select
                      name="mobilizationStatus"
                      value={formData.mobilizationStatus}
                      onChange={(e) => {
                        const value = e.target.value;
                        setFormData((prev) => ({
                          ...prev,
                          mobilizationStatus: value,
                          availabilityStatus:
                            value === "on_site" ? "unavailable" : "available",
                        }));
                      }}
                      className={INPUT}
                    >
                      {formData.availabilityStatus === "unavailable" ? (
                        <option value="on_site">On-Site</option>
                      ) : (
                        <>
                          <option value="pending">Pending</option>
                          <option value="ready">Ready</option>
                        </>
                      )}
                    </select>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                  <input
                    type="checkbox"
                    id="isOffshore"
                    name="isOffshore"
                    checked={formData.isOffshore}
                    onChange={handleChange}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
                  />
                  <label htmlFor="isOffshore" className="cursor-pointer">
                    <div className="text-sm font-semibold text-gray-900">
                      Offshore Worker
                    </div>
                    <div className="text-xs text-gray-500">
                      Check if this worker is deployed to offshore locations
                    </div>
                  </label>
                </div>
                <UpdateButton
                  onClick={handleSaveStatus}
                  saving={savingSection === "status"}
                />
              </div>
            </div>

            {/* Section R: Offshore Roster */}
            <div className={CARD}>
              <SectionHeader
                number="R"
                title="Offshore Roster"
                subtitle="(ข้อมูลติดตัวพนักงาน — Health / SSE / Permanent)"
              />
              <div className={BODY}>
                <div className={`${GRID3} mb-4`}>
                  <div>
                    <label className={LABEL}>
                      Health Risk {hasExams && SYNC_LABEL}
                    </label>
                    {hasExams ? (
                      <div
                        title="ล็อกไว้ — ค่านี้มาจาก PE / Medical Exam record ล่าสุด · แก้ที่ tab 🏥 PE / Medical Exam"
                        className={`${READONLY_BOX} cursor-not-allowed ${
                          latestExam.healthRisk
                            ? "text-gray-900"
                            : "text-gray-400"
                        }`}
                      >
                        {latestExam.healthRisk || "— ไม่มีข้อมูล —"}
                      </div>
                    ) : (
                      <CreatableSelect
                        {...SELECT_PROPS}
                        options={healthRiskSelectOptions}
                        value={
                          formData.healthRisk
                            ? {
                                value: formData.healthRisk,
                                label: formData.healthRisk,
                              }
                            : null
                        }
                        onChange={(o) =>
                          setField("healthRisk", o ? o.value : "")
                        }
                        placeholder="เลือก หรือพิมพ์ค่าใหม่..."
                        isClearable
                        formatCreateLabel={(input) => `ใช้ "${input}"`}
                      />
                    )}
                  </div>
                  <div>
                    <label className={LABEL}>SSE Level</label>
                    <select
                      name="sseLevel"
                      value={formData.sseLevel}
                      onChange={handleChange}
                      className={INPUT}
                    >
                      <option value="">— None —</option>
                      <option value="new_sse">NEW SSE</option>
                      <option value="sse1">SSE1</option>
                      <option value="sse2">SSE2</option>
                    </select>
                  </div>
                  <div>
                    <label className={LABEL}>SSE Passed</label>
                    <select
                      name="sseCompleted"
                      value={formData.sseCompleted}
                      onChange={handleChange}
                      className={INPUT}
                    >
                      <option value="">— N/A —</option>
                      <option value="true">Completed</option>
                      <option value="false">Not yet</option>
                    </select>
                  </div>
                </div>

                <div className={`${GRID2} mb-4`}>
                  <div>
                    <label className={LABEL}>
                      Health Note จาก Medic (หมายเหตุสุขภาพ — แยกจาก Notes ทั่วไป)
                    </label>
                    <textarea
                      name="healthNote"
                      rows={4}
                      placeholder="เช่น ไขมันสูง / กรดยูริกสูง / ติดตามผล Medic"
                      value={formData.healthNote}
                      onChange={handleChange}
                      className={`${INPUT} resize-y`}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>
                      Note (จาก PE / Medical Exam ล่าสุด)
                    </label>
                    <div
                      title="ข้อความนี้มาจาก Note ของ PE / Medical Exam record ล่าสุด — แก้ที่ tab 🏥 PE / Medical Exam"
                      className={`box-border min-h-[88px] w-full overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] ${
                        latestExamNote
                          ? "cursor-help text-gray-900"
                          : "text-gray-400"
                      }`}
                    >
                      {latestExamNote || "— ไม่มีข้อมูล —"}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-lg border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3">
                  <input
                    type="checkbox"
                    id="isPermanent"
                    name="isPermanent"
                    checked={formData.isPermanent}
                    onChange={handleChange}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
                  />
                  <label htmlFor="isPermanent" className="cursor-pointer">
                    <div className="text-sm font-semibold text-gray-900">
                      Permanent Worker (พนักงานประจำ 🟩)
                    </div>
                    <div className="text-xs text-gray-500">
                      ติ๊กถ้าเป็นพนักงานประจำ (item เขียวในไฟล์ roster) —
                      Allocation จะเลือกก่อน
                    </div>
                  </label>
                </div>
                <UpdateButton
                  onClick={handleSaveRoster}
                  saving={savingSection === "roster"}
                />
              </div>
            </div>
          </>
        )}

        {/* ════════════════════ TAB: CV ════════════════════ */}
        {activeTab === "cv" && (
          <>
            {/* Section P: Personal Details for CV */}
            <div className={CARD}>
              <SectionHeader
                number="P"
                title="Personal Details for CV"
                subtitle="(ใช้ตอน Generate CV Summary — Allocation)"
              />
              <div className={BODY}>
                <div className="mb-4">
                  <label className={LABEL}>Address</label>
                  <textarea
                    name="address"
                    rows={2}
                    placeholder="e.g., 575/2 Moo.12 Tambon Tha Rong, Wichian Buri District, Phetchabun Province, Thailand"
                    value={formData.address}
                    onChange={handleChange}
                    className={`${INPUT} resize-y`}
                  />
                </div>
                <div className={`${GRID3} mb-4`}>
                  <div>
                    <label className={LABEL}>Sex</label>
                    <Select
                      {...SELECT_PROPS}
                      options={GENDER_OPTIONS}
                      value={
                        GENDER_OPTIONS.find(
                          (o) => o.value === formData.gender,
                        ) || null
                      }
                      onChange={(o) => setField("gender", o ? o.value : "")}
                      placeholder="— Select —"
                      isClearable
                    />
                  </div>
                  <div>
                    <label className={LABEL}>Height (cm)</label>
                    <input
                      type="number"
                      step="0.1"
                      name="height"
                      placeholder="e.g., 163.2"
                      value={formData.height}
                      onChange={handleChange}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>Weight (kg)</label>
                    <input
                      type="number"
                      step="0.1"
                      name="weight"
                      placeholder="e.g., 69"
                      value={formData.weight}
                      onChange={handleChange}
                      className={INPUT}
                    />
                  </div>
                </div>
                <div className={`${GRID2} mb-4`}>
                  <div>
                    <label className={LABEL}>Religion</label>
                    <input
                      type="text"
                      name="religion"
                      placeholder="e.g., Buddhism"
                      value={formData.religion}
                      onChange={handleChange}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>Language</label>
                    <input
                      type="text"
                      name="language"
                      placeholder="e.g., Moderate command in English"
                      value={formData.language}
                      onChange={handleChange}
                      className={INPUT}
                    />
                  </div>
                </div>
                {/* Education — ข้อความยาว (วุฒิ + สาขา + สถาบัน) → เต็มแถว ขยายได้ */}
                <div className="mb-4">
                  <label className={LABEL}>Education</label>
                  <textarea
                    name="education"
                    rows={2}
                    placeholder={"e.g., Vocational Certificate, Industrial , Automotive Technology Major\nBy Wichianburi Industrial And Community Education College"}
                    value={formData.education}
                    onChange={handleChange}
                    className={`${INPUT} resize-y`}
                  />
                </div>

                {/* Photo */}
                <div>
                  <label className={LABEL}>Photo</label>
                  <input
                    type="file"
                    id="photo-upload-input"
                    accept=".jpg,.jpeg,.png,.webp"
                    onChange={handlePhotoChange}
                    className="hidden"
                  />
                  <label htmlFor="photo-upload-input" className={FILE_BTN}>
                    Choose File
                  </label>
                  <div className="mt-1 text-[11px] text-gray-500">
                    รองรับ .jpg, .jpeg, .png, .webp — ขนาดไม่เกิน 5MB
                  </div>

                  {photoPreview && (
                    <div className="mt-2.5 flex max-w-[420px] items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
                      <img
                        src={photoPreview}
                        alt="preview"
                        onClick={() => setShowPhotoModal(true)}
                        title="คลิกเพื่อดูรูปขนาดเต็ม"
                        className="h-11 w-11 shrink-0 cursor-pointer rounded-md object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold">
                          {photoFile ? photoFile.name : "รูปปัจจุบัน"}
                        </div>
                        {photoFile && (
                          <div className="text-[11px] text-gray-500">
                            {formatFileSize(photoFile.size)}
                          </div>
                        )}
                      </div>
                      {photoFile && (
                        <button
                          type="button"
                          onClick={removePhoto}
                          title="ยกเลิกไฟล์ที่เลือก"
                          className="h-[26px] w-[26px] shrink-0 cursor-pointer rounded-md border border-[#f5c6cb] bg-white text-[#842029]"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <UpdateButton
                  onClick={handleSaveCvPersonal}
                  saving={savingSection === "cv-personal"}
                />
              </div>
            </div>

            {/* Section D: Past Deployment History */}
            <div className={CARD}>
              <SectionHeader
                number="D"
                title="Past Deployment History"
                subtitle="(Project References ในเรซูเม่ — สำหรับ backfill ประวัติเก่าก่อนเริ่มใช้ Mobilization)"
                right={
                  <button
                    type="button"
                    onClick={addDeployment}
                    className={ADD_BTN}
                  >
                    + Add Past Deployment
                  </button>
                }
              />
              <div className={BODY}>
                <div className="mb-4 rounded-lg border border-[#bee3f8] bg-sky-50 px-3.5 py-2.5 text-xs text-[#055160]">
                  ℹ️ ใช้เฉพาะประวัติ deploy ที่เกิด<strong>ก่อน</strong>
                  เริ่มใช้ระบบ (ของเก่าที่ไม่เคยผ่านหน้า Mobilization) — deploy
                  ใหม่หลังจากนี้ ระบบจะบันทึกให้อัตโนมัติเองที่หน้า Mobilization
                  ไม่ต้องมากรอกซ้ำที่นี่
                </div>

                {deployments.length === 0 ? (
                  <EmptyState
                    title="No past deployment records yet."
                    hint='Click "+ Add Past Deployment" to backfill old CV history.'
                  />
                ) : (
                  <table className="w-full border-collapse text-[13px]">
                    {/* หัวตารางตามไฟล์ประวัติลงงานของ HR — ภาษาไทย (อังกฤษ) */}
                    <thead>
                      <tr>
                        <th className={`${TH} ${HIDE_MOBILE}`}>ตำแหน่ง (Position)</th>
                        <th className={TH}>
                          Project
                          <div className="font-normal normal-case text-gray-400">
                            Traveling Team No.
                          </div>
                        </th>
                        <th className={`${TH} ${HIDE_MOBILE}`}>
                          Field
                          <div className="font-normal normal-case text-gray-400">
                            สถานที่เดินทาง (Platform)
                          </div>
                        </th>
                        <th className={TH}>วันลงงาน (MOB)</th>
                        <th className={`${TH} ${HIDE_MOBILE}`}>วันเดินทางกลับ (D-MOB)</th>
                        <th className={`${TH} ${HIDE_MOBILE}`}>
                          ขาไป / ขากลับ
                          <div className="font-normal normal-case text-gray-400">
                            หมายเหตุ
                          </div>
                        </th>
                        <th className={`${TH} text-right`}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deployments.map((dep, index) =>
                        editingDeploymentId === dep.id ? (
                          <tr key={dep.id}>
                            <td colSpan={7} className={TD}>
                              <div className={EDIT_PANEL}>
                                <EditPanelHeader
                                  label={`Deployment #${deployments.length - index}`}
                                  onDone={() => setEditingDeploymentId(null)}
                                  onRemove={() => removeDeployment(dep)}
                                />

                                {/* ลำดับช่องตามไฟล์ประวัติลงงานของ HR */}
                                <div className={GRID3}>
                                  <div>
                                    <label className={LABEL}>ตำแหน่ง (Position)</label>
                                    <Select
                                      {...SELECT_PROPS}
                                      options={positionOptions}
                                      value={
                                        positionOptions.find(
                                          (o) => o.value === dep.positionId,
                                        ) || null
                                      }
                                      onChange={(o) =>
                                        handleDeploymentChange(
                                          dep.id,
                                          "positionId",
                                          o ? o.value : "",
                                        )
                                      }
                                      placeholder="เลือกตำแหน่ง..."
                                      isClearable
                                    />
                                  </div>
                                  {DEPLOYMENT_TEXT_FIELDS.slice(0, 2).map(([key, label, ph]) => (
                                    <div key={key}>
                                      <label className={LABEL}>{label}</label>
                                      <input
                                        type="text"
                                        value={dep[key] || ""}
                                        onChange={(e) =>
                                          handleDeploymentChange(dep.id, key, e.target.value)
                                        }
                                        placeholder={ph}
                                        className={INPUT}
                                      />
                                    </div>
                                  ))}
                                </div>

                                <div className={`${GRID3} mt-3`}>
                                  {DEPLOYMENT_TEXT_FIELDS.slice(2, 3).map(([key, label, ph]) => (
                                    <div key={key}>
                                      <label className={LABEL}>{label}</label>
                                      <input
                                        type="text"
                                        value={dep[key] || ""}
                                        onChange={(e) =>
                                          handleDeploymentChange(dep.id, key, e.target.value)
                                        }
                                        placeholder={ph}
                                        className={INPUT}
                                      />
                                    </div>
                                  ))}
                                  <div>
                                    <label className={LABEL}>วันลงงาน (MOB)</label>
                                    <input
                                      type="date"
                                      value={dep.mobDate}
                                      onChange={(e) =>
                                        handleDeploymentChange(dep.id, "mobDate", e.target.value)
                                      }
                                      className={INPUT}
                                    />
                                  </div>
                                  <div>
                                    <label className={LABEL}>วันเดินทางกลับ (D-MOB)</label>
                                    <input
                                      type="date"
                                      value={dep.demobDate}
                                      onChange={(e) =>
                                        handleDeploymentChange(dep.id, "demobDate", e.target.value)
                                      }
                                      className={INPUT}
                                    />
                                  </div>
                                </div>

                                <div className={`${GRID3} mt-3`}>
                                  {DEPLOYMENT_TEXT_FIELDS.slice(3).map(([key, label, ph]) => (
                                    <div key={key}>
                                      <label className={LABEL}>{label}</label>
                                      <input
                                        type="text"
                                        value={dep[key] || ""}
                                        onChange={(e) =>
                                          handleDeploymentChange(dep.id, key, e.target.value)
                                        }
                                        placeholder={ph}
                                        className={INPUT}
                                      />
                                    </div>
                                  ))}
                                </div>

                                <div className="mt-3">
                                  <label className={LABEL}>หมายเหตุ</label>
                                  <input
                                    type="text"
                                    value={dep.remark || ""}
                                    onChange={(e) =>
                                      handleDeploymentChange(dep.id, "remark", e.target.value)
                                    }
                                    className={INPUT}
                                  />
                                </div>

                                {dep.client && (
                                  <div className="mt-3 break-words rounded-md bg-[#f0f7ff] px-2.5 py-1.5 text-[11px] text-blue-600">
                                    ข้อความใน CV: "
                                    {composeProjectLabel(dep.client, dep.field, dep.platform)}"
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        ) : (
                          <tr key={dep.id}>
                            <td className={`${TD} ${HIDE_MOBILE}`}>
                              {positionNameById(dep.positionId)}
                            </td>
                            <td className={TD}>
                              {dep.client || DASH}
                              {dep.travelTeamNo && (
                                <div className="text-[11px] text-gray-500">{dep.travelTeamNo}</div>
                              )}
                            </td>
                            <td className={`${TD} ${HIDE_MOBILE}`}>
                              {dep.field || DASH}
                              {dep.platform && (
                                <div className="text-[11px] text-gray-500">{dep.platform}</div>
                              )}
                            </td>
                            <td className={`${TD} whitespace-nowrap`}>
                              {formatDateDisplay(dep.mobDate)}
                            </td>
                            <td className={`${TD} ${HIDE_MOBILE} whitespace-nowrap`}>
                              {formatDateDisplay(dep.demobDate)}
                            </td>
                            <td className={`${TD} ${HIDE_MOBILE} text-xs`}>
                              {!dep.travelOut && !dep.travelBack && !dep.remark && DASH}
                              {dep.travelOut && (
                                <div className="whitespace-nowrap">
                                  <span className="text-gray-500">ไป:</span> {dep.travelOut}
                                </div>
                              )}
                              {dep.travelBack && (
                                <div className="whitespace-nowrap">
                                  <span className="text-gray-500">กลับ:</span> {dep.travelBack}
                                </div>
                              )}
                              {dep.remark && (
                                <div className="mt-0.5 text-[11px] text-gray-500">{dep.remark}</div>
                              )}
                            </td>
                            <td className={TD}>
                              <RowActions
                                onEdit={() => setEditingDeploymentId(dep.id)}
                                onRemove={() => removeDeployment(dep)}
                              />
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>

                )}
                <UpdateButton
                  onClick={handleSaveDeployment}
                  saving={savingSection === "deployment"}
                />
              </div>
            </div>
          </>
        )}

        {/* ════════════════════ TAB: Documents ════════════════════ */}
        {activeTab === "documents" && (
          <>
            {/* Section 3: Passport */}
            <div className={CARD}>
              <SectionHeader number="3" title="Passport Information" />
              <div className={BODY}>
                <div className={GRID4}>
                  <div>
                    <label className={LABEL}>Passport Number</label>
                    <input
                      type="text"
                      name="passportNumber"
                      placeholder="e.g., AA1234567"
                      value={formData.passportNumber}
                      onChange={handleChange}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>Passport Expiry Date</label>
                    <input
                      type="date"
                      name="passportExpiryDate"
                      value={formData.passportExpiryDate}
                      onChange={handleChange}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>Work Permit No.</label>
                    <input
                      type="text"
                      name="workPermitNo"
                      placeholder="e.g., WP-12345"
                      value={formData.workPermitNo}
                      onChange={handleChange}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>Work Permit Expiry Date</label>
                    <input
                      type="date"
                      name="workPermitExpiryDate"
                      value={formData.workPermitExpiryDate}
                      onChange={handleChange}
                      className={INPUT}
                    />
                  </div>
                </div>
                <UpdateButton
                  onClick={handleSavePassport}
                  saving={savingSection === "passport"}
                />
              </div>
            </div>

            {/* Section 4: Certifications */}
            <div className={CARD}>
              <SectionHeader
                number="4"
                title="Certifications"
                subtitle="(6G, BOSIET, H2S, etc.)"
                right={
                  <button
                    type="button"
                    onClick={addCertification}
                    className={ADD_BTN}
                  >
                    + Add Certification
                  </button>
                }
              />
              <div className={BODY}>
                {certifications.length > 0 && (
                  <div className="mb-3 flex flex-wrap items-center gap-2.5">
                    <input
                      type="text"
                      placeholder="🔍 ค้นหา training / certification..."
                      value={certSearch}
                      onChange={(e) => setCertSearch(e.target.value)}
                      className={`${INPUT} sm:max-w-[320px]`}
                    />
                    {certSearch && (
                      <span className="text-xs text-gray-500">
                        พบ {filteredCertifications.length} จาก{" "}
                        {certifications.length} รายการ
                      </span>
                    )}
                  </div>
                )}

                {certifications.length === 0 ? (
                  <EmptyState
                    title="No certifications added yet."
                    hint='Click "+ Add Certification" to add training records.'
                  />
                ) : (
                  <div className="max-h-[420px] overflow-y-auto rounded-lg border border-gray-100">
                    <table className="w-full border-collapse text-[13px]">
                      <thead>
                        <tr>
                          <th className={`${TH} sticky top-0 z-[1] bg-white`}>
                            Training / Certification
                          </th>
                          <th
                            className={`${TH} ${HIDE_MOBILE} sticky top-0 z-[1] w-[110px] bg-white`}
                          >
                            Issued Date
                          </th>
                          <th
                            className={`${TH} sticky top-0 z-[1] w-[100px] bg-white sm:w-[110px]`}
                          >
                            Expiry Date
                          </th>
                          <th
                            className={`${TH} ${HIDE_MOBILE} sticky top-0 z-[1] w-[70px] bg-white text-center`}
                          >
                            File
                          </th>
                          <th
                            className={`${TH} sticky top-0 z-[1] w-[140px] bg-white text-right`}
                          >
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCertifications.map((cert, index) => {
                          const previewUrl = certPreviewUrl(cert);
                          const isPdf = isPdfFile(
                            cert.certFileName || cert.certFileUrl,
                          );
                          const openFile = () =>
                            setCertFileModal({
                              url: previewUrl,
                              name: cert.certFileName || "certificate",
                              isPdf,
                            });

                          return editingCertId === cert.id ? (
                            <tr key={cert.id}>
                              <td colSpan={5} className={TD}>
                                <div className={EDIT_PANEL}>
                                  <EditPanelHeader
                                    label={`Certification #${filteredCertifications.length - index}`}
                                    onDone={() => handleDoneCert(cert)}
                                    onRemove={() => removeCertification(cert)}
                                  />
                                  <div className={GRID2}>
                                    <div className="sm:col-span-2">
                                      <label className={LABEL}>
                                        Training / Certification
                                      </label>
                                      <Select
                                        {...SELECT_PROPS}
                                        options={trainingOptions}
                                        value={
                                          trainingOptions.find(
                                            (o) =>
                                              o.value === cert.globalTrainingId,
                                          ) || null
                                        }
                                        onChange={(o) =>
                                          handleCertChange(
                                            cert.id,
                                            "globalTrainingId",
                                            o ? o.value : "",
                                          )
                                        }
                                        placeholder="ค้นหา / เลือก training..."
                                        isClearable
                                        maxMenuHeight={260}
                                        noOptionsMessage={() =>
                                          "ไม่มี training"
                                        }
                                      />
                                      {certFormError && (
                                        <div className="mt-1 text-[11px] font-semibold text-red-600">
                                          ⚠️ {certFormError}
                                        </div>
                                      )}
                                    </div>
                                    <div>
                                      <label className={LABEL}>
                                        Issued Date
                                      </label>
                                      <input
                                        type="date"
                                        value={cert.completedDate}
                                        onChange={(e) =>
                                          handleCertChange(
                                            cert.id,
                                            "completedDate",
                                            e.target.value,
                                          )
                                        }
                                        className={INPUT}
                                      />
                                    </div>
                                    <div>
                                      <label className={LABEL}>
                                        Expiry Date
                                      </label>
                                      <input
                                        type="date"
                                        value={cert.expiryDate}
                                        onChange={(e) =>
                                          handleCertChange(
                                            cert.id,
                                            "expiryDate",
                                            e.target.value,
                                          )
                                        }
                                        className={INPUT}
                                      />
                                    </div>
                                  </div>

                                  {/* Cert File Upload */}
                                  <div className="mt-3">
                                    <label className={LABEL}>
                                      Certificate File (รูป/PDF)
                                    </label>
                                    <input
                                      type="file"
                                      id={`cert-file-input-${cert.id}`}
                                      accept=".jpg,.jpeg,.png,.webp,.pdf"
                                      onChange={(e) =>
                                        handleCertFileChange(
                                          cert.id,
                                          e.target.files?.[0],
                                        )
                                      }
                                      className="hidden"
                                    />
                                    <label
                                      htmlFor={`cert-file-input-${cert.id}`}
                                      className={FILE_BTN}
                                    >
                                      Choose File
                                    </label>
                                    <div className="mt-1 text-[11px] text-gray-500">
                                      รองรับ .jpg, .jpeg, .png, .webp, .pdf —
                                      ขนาดไม่เกิน 5MB
                                    </div>

                                    {previewUrl && (
                                      <div className="mt-2 flex max-w-[380px] items-center gap-2.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5">
                                        <div
                                          onClick={openFile}
                                          className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-gray-200 ${
                                            isPdf ? "bg-gray-100" : "bg-white"
                                          }`}
                                        >
                                          {isPdf ? (
                                            <span className="text-lg">📄</span>
                                          ) : (
                                            <img
                                              src={previewUrl}
                                              alt={cert.certFileName}
                                              className="h-full w-full object-cover"
                                            />
                                          )}
                                        </div>
                                        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                                          {cert.certFile
                                            ? `${cert.certFileName} (ยังไม่ได้บันทึก)`
                                            : cert.certFileName || "ดูไฟล์"}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => clearCertFile(cert.id)}
                                          title="ลบไฟล์นี้"
                                          className="h-6 w-6 shrink-0 cursor-pointer rounded-md border border-[#f5c6cb] bg-white text-[11px] text-[#842029]"
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            <tr key={cert.id}>
                              <td className={`${TD} break-words`}>
                                <CertName
                                  training={globalTrainings.find(
                                    (t) => t.id === cert.globalTrainingId,
                                  )}
                                  rawName={cert.rawTrainingName}
                                />
                              </td>
                              <td
                                className={`${TD} ${HIDE_MOBILE} whitespace-nowrap`}
                              >
                                {formatDateDisplay(cert.completedDate)}
                              </td>
                              <td className={`${TD} whitespace-nowrap`}>
                                {formatDateDisplay(cert.expiryDate)}
                              </td>
                              <td
                                className={`${TD} ${HIDE_MOBILE} text-center`}
                              >
                                {!previewUrl ? (
                                  DASH
                                ) : (
                                  <div className="relative inline-block">
                                    <div
                                      onClick={openFile}
                                      title={
                                        cert.certFile
                                          ? `${cert.certFileName} (ยังไม่ได้บันทึก — กด Update เพื่อบันทึก)`
                                          : cert.certFileName
                                      }
                                      className={`mx-auto flex h-8 w-8 cursor-pointer items-center justify-center overflow-hidden rounded border border-gray-200 ${
                                        isPdf ? "bg-gray-100" : "bg-white"
                                      }`}
                                    >
                                      {isPdf ? (
                                        <span className="text-base">📄</span>
                                      ) : (
                                        <img
                                          src={previewUrl}
                                          alt={cert.certFileName}
                                          className="h-full w-full object-cover"
                                        />
                                      )}
                                    </div>
                                    {cert.certFile && (
                                      <span
                                        title="ยังไม่ได้บันทึก"
                                        className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-[#ffe69c] bg-[#fff3cd] text-[11px]"
                                      >
                                        🕓
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className={TD}>
                                <RowActions
                                  onEdit={() => {
                                    setEditingCertId(cert.id);
                                    setCertFormError("");
                                  }}
                                  onRemove={() => removeCertification(cert)}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <UpdateButton
                  onClick={handleSaveCerts}
                  saving={savingSection === "certs"}
                  note={
                    certifications.some((c) => c.certFile) && (
                      <span className="text-xs font-semibold text-red-600">
                        🕓 มีไฟล์รอบันทึก — กด Update เพื่อบันทึก
                      </span>
                    )
                  }
                />
              </div>
            </div>
          </>
        )}

        {/* ════════════════════ TAB: PE / Medical Exam ════════════════════ */}
        {activeTab === "medical-exam" && (
          <>
            {/* Section 5: Medical Check-up Record */}
            <div className={CARD}>
              <SectionHeader
                number="5"
                title="Medical Check-up Record"
                subtitle="(สรุปสถานะสำหรับ Compliance — Examination/Expiry Date sync จาก PE record ล่าสุดด้านล่างอัตโนมัติ)"
                accent
              />
              <div className={BODY}>
                <div className={`${GRID3} mb-4`}>
                  <div>
                    <label className={LABEL}>Hospital / Clinic</label>
                    <input
                      type="text"
                      name="hospital"
                      placeholder="e.g., Bangkok Hospital"
                      value={medicalData.hospital}
                      onChange={handleMedicalChange}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>
                      Examination Date {hasExams && SYNC_LABEL}
                    </label>
                    {hasExams ? (
                      <div
                        title="ล็อกไว้ — ค่านี้มาจาก Exam Date ของ PE / Medical Exam record ล่าสุดด้านล่าง"
                        className={`${READONLY_BOX} cursor-not-allowed ${
                          medicalData.issuedDate
                            ? "text-gray-900"
                            : "text-gray-400"
                        }`}
                      >
                        {medicalData.issuedDate
                          ? formatDateDisplay(medicalData.issuedDate)
                          : "— ไม่มีข้อมูล —"}
                      </div>
                    ) : (
                      <input
                        type="date"
                        name="issuedDate"
                        value={medicalData.issuedDate}
                        onChange={handleMedicalChange}
                        className={INPUT}
                      />
                    )}
                  </div>
                  <div>
                    <label className={LABEL}>
                      Expiry Date{" "}
                      {hasExams && (
                        <span className="ml-1 font-normal normal-case tracking-normal text-blue-600">
                          (Examination Date + 1 ปี)
                        </span>
                      )}
                    </label>
                    {hasExams ? (
                      <div
                        title="ล็อกไว้ — คำนวณอัตโนมัติ = Examination Date + 1 ปี"
                        className={`${READONLY_BOX} cursor-not-allowed ${
                          medicalData.expiryDate
                            ? "text-gray-900"
                            : "text-gray-400"
                        }`}
                      >
                        {medicalData.expiryDate
                          ? formatDateDisplay(medicalData.expiryDate)
                          : "— ไม่มีข้อมูล —"}
                      </div>
                    ) : (
                      <input
                        type="date"
                        name="expiryDate"
                        value={medicalData.expiryDate}
                        onChange={handleMedicalChange}
                        className={INPUT}
                      />
                    )}
                  </div>
                </div>
                <div className={GRID3}>
                  <div>
                    <label className={LABEL}>Medical Status</label>
                    <select
                      name="status"
                      value={medicalData.status}
                      onChange={handleMedicalChange}
                      className={INPUT}
                    >
                      <option value="">— Select —</option>
                      <option value="passed">Fit</option>
                      <option value="pending">Pending</option>
                      <option value="failed">Unfit</option>
                      <option value="not_required">Fit with Restriction</option>
                    </select>
                  </div>
                  <div>
                    <label className={LABEL}>Confined Space Medical</label>
                    <select
                      name="confinedSpaceStatus"
                      value={medicalData.confinedSpaceStatus}
                      onChange={handleMedicalChange}
                      className={INPUT}
                    >
                      <option value="">— N/A / Not assessed —</option>
                      <option value="passed">Fit</option>
                      <option value="failed">Unfit</option>
                    </select>
                  </div>
                  <div>
                    <label className={LABEL}>Notes</label>
                    <input
                      type="text"
                      name="notes"
                      placeholder="Restrictions, remarks..."
                      value={medicalData.notes}
                      onChange={handleMedicalChange}
                      className={INPUT}
                    />
                  </div>
                </div>
                <UpdateButton
                  onClick={handleSaveMedicalSummary}
                  saving={savingSection === "medical-summary"}
                />
              </div>
            </div>

            {/* PE / Medical Exam Records */}
            <div className={CARD}>
              <SectionHeader
                number={
                  <span role="img" aria-label="hospital">
                    🏥
                  </span>
                }
                title="PE / Medical Exam Records"
                subtitle="(ผลตรวจสุขภาพประจำปี — Health Risk บน Section R และ Medical Check-up Record ด้านบนจะ sync จาก record ล่าสุดที่นี่)"
                right={
                  <button
                    type="button"
                    onClick={addMedicalExam}
                    className={ADD_BTN}
                  >
                    + Add Exam Record
                  </button>
                }
              />
              <div className={BODY}>
                {medicalExams.length === 0 ? (
                  <EmptyState title="No medical exam records yet." />
                ) : (
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr>
                        <th className={TH}>Exam Date</th>
                        <th className={TH}>Health Risk</th>
                        <th className={`${TH} ${HIDE_MOBILE}`}>
                          Recommendation
                        </th>
                        <th className={`${TH} text-right`}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {medicalExams.map((exam, index) =>
                        editingMedicalExamId === exam.id ? (
                          <tr key={exam.id}>
                            <td colSpan={4} className={TD}>
                              <div className={EDIT_PANEL}>
                                <EditPanelHeader
                                  label={
                                    <>
                                      Exam Record #{medicalExams.length - index}
                                      {exam.isLatest && (
                                        <span className={LATEST_TAG}>
                                          LATEST
                                        </span>
                                      )}
                                    </>
                                  }
                                  onDone={() => setEditingMedicalExamId(null)}
                                  onRemove={() => removeMedicalExam(exam)}
                                />

                                {EXAM_SECTIONS.map((sec) => (
                                  <ExamFieldGroup
                                    key={sec.title}
                                    sec={sec}
                                    exam={exam}
                                    onChange={handleMedicalExamChange}
                                  />
                                ))}

                                <div className={SUBSECTION}>📝 สรุปผล / SUMMARY</div>
                                <div className="mb-3">
                                  <label className={LABEL}>หมายเหตุ / Note</label>
                                  <textarea
                                    rows={2}
                                    value={exam.note}
                                    onChange={(e) =>
                                      handleMedicalExamChange(
                                        exam.id,
                                        "note",
                                        e.target.value,
                                      )
                                    }
                                    className={`${INPUT} resize-y`}
                                  />
                                </div>
                                <div className={`${GRID2} mb-3`}>
                                  <div>
                                    <label className={LABEL}>
                                      ความเสี่ยงสุขภาพ / Health Risk
                                    </label>
                                    <CreatableSelect
                                      {...SELECT_PROPS}
                                      options={healthRiskSelectOptions}
                                      value={
                                        exam.healthRisk
                                          ? {
                                              value: exam.healthRisk,
                                              label: exam.healthRisk,
                                            }
                                          : null
                                      }
                                      onChange={(o) =>
                                        handleMedicalExamChange(
                                          exam.id,
                                          "healthRisk",
                                          o ? o.value : "",
                                        )
                                      }
                                      placeholder="เลือก หรือพิมพ์ค่าใหม่..."
                                      isClearable
                                      formatCreateLabel={(input) =>
                                        `ใช้ "${input}"`
                                      }
                                    />
                                  </div>
                                  <div>
                                    <label className={LABEL}>
                                      วันที่ลง Comment / Comment Date
                                    </label>
                                    <input
                                      type="date"
                                      value={exam.commentDate}
                                      onChange={(e) =>
                                        handleMedicalExamChange(
                                          exam.id,
                                          "commentDate",
                                          e.target.value,
                                        )
                                      }
                                      className={INPUT}
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className={LABEL}>
                                    คำแนะนำ / Recommendation
                                  </label>
                                  <textarea
                                    rows={3}
                                    value={exam.recommendation}
                                    onChange={(e) =>
                                      handleMedicalExamChange(
                                        exam.id,
                                        "recommendation",
                                        e.target.value,
                                      )
                                    }
                                    className={`${INPUT} resize-y`}
                                  />
                                </div>

                                <div className="mt-3">
                                  <ExamFieldGroup
                                    sec={EXAM_FOLLOWUP_SECTION}
                                    exam={exam}
                                    onChange={handleMedicalExamChange}
                                  />
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          <tr key={exam.id}>
                            <td className={`${TD} whitespace-nowrap`}>
                              {formatDateDisplay(exam.examDate)}
                            </td>
                            <td className={TD}>
                              {exam.healthRisk || DASH}
                              {exam.isLatest && (
                                <span className={LATEST_TAG}>LATEST</span>
                              )}
                            </td>
                            <td className={`${TD} ${HIDE_MOBILE}`}>
                              {exam.recommendation || DASH}
                            </td>
                            <td className={TD}>
                              <RowActions
                                onEdit={() => setEditingMedicalExamId(exam.id)}
                                onRemove={() => removeMedicalExam(exam)}
                              />
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                )}
                <UpdateButton
                  onClick={handleSaveMedicalExam}
                  saving={savingSection === "medical-exam"}
                />
              </div>
            </div>
          </>
        )}

        {/* ════════ Action Buttons ════════ */}
        <div className="sticky bottom-0 z-20 -mx-4 mt-4 flex flex-col-reverse gap-2 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => navigate("/workers")}
            disabled={submitting}
            className="cursor-pointer rounded-lg border border-gray-200 bg-white px-6 py-[9px] text-[13px] hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveAllAndExit}
            disabled={submitting}
            className="cursor-pointer rounded-lg border-none bg-blue-600 px-6 py-[9px] text-[13px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting ? "Saving All..." : "Save All & Exit"}
          </button>
        </div>
      </form>

      {/* ════════ Photo full-size modal ════════ */}
      {showPhotoModal && (
        <div
          onClick={() => setShowPhotoModal(false)}
          className="fixed inset-0 z-[2000000] flex cursor-zoom-out items-center justify-center bg-black/75 p-5"
        >
          <img
            src={photoPreview}
            alt="full preview"
            className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-[0_10px_40px_rgba(0,0,0,0.5)]"
          />
          <button
            type="button"
            onClick={() => setShowPhotoModal(false)}
            className="absolute right-6 top-5 h-9 w-9 cursor-pointer rounded-full border border-white/40 bg-white/15 text-lg text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* ════════ Certificate file modal ════════ */}
      {certFileModal && (
        <div
          onClick={() => setCertFileModal(null)}
          className="fixed inset-0 z-[2000000] flex items-center justify-center bg-black/75 p-3 sm:p-5"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[90vh] max-w-[95vw] flex-col gap-3 rounded-[10px] bg-white p-3 sm:max-w-[90vw] sm:p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0 max-w-[300px] truncate text-[13px] font-semibold">
                {certFileModal.name}
              </span>
              <div className="flex shrink-0 gap-2">
                <a
                  href={certFileModal.url}
                  download={certFileModal.name}
                  className="rounded-md border border-[#b6d4fe] bg-[#e7f1ff] px-3 py-1.5 text-xs font-semibold text-blue-600 no-underline"
                >
                  ⬇ Download
                </a>
                <button
                  type="button"
                  onClick={handlePrintCertFile}
                  className="cursor-pointer rounded-md border border-gray-300 bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-900"
                >
                  🖨 Print
                </button>
                <button
                  type="button"
                  onClick={() => setCertFileModal(null)}
                  className="h-[30px] w-[30px] cursor-pointer rounded-md border border-[#f5c6cb] bg-white text-[#842029]"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="overflow-auto">
              {certFileModal.isPdf ? (
                <iframe
                  id="cert-file-print-frame"
                  src={certFileModal.url}
                  title={certFileModal.name}
                  className="h-[80vh] w-[85vw] rounded-md border-none sm:w-[80vw]"
                />
              ) : (
                <img
                  src={certFileModal.url}
                  alt={certFileModal.name}
                  className="mx-auto block max-h-[80vh] max-w-[85vw] object-contain sm:max-w-[80vw]"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
