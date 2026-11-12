import { useState, useEffect, useContext, useMemo } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { AppContent } from "../../context/AppContext";

// ══════════════════════════════════════════════════════════
// constants
// ══════════════════════════════════════════════════════════
// สี badge ตาม role — จับจาก "คำ" ในชื่อ (role จริงคือ hr_officer, manpower_supply,
// project_engineer ฯลฯ — เดิม map แบบตรงตัว "hr"/"manpower" เลยได้สีเทาหมด)
const ROLE_TONES = [
  ["admin", "bg-[#ede7f6] text-[#5e35b1]"],
  ["manpower", "bg-[#e3f2fd] text-[#1565c0]"],
  ["hr", "bg-[#e0f2f1] text-[#00695c]"],
  ["project", "bg-[#fff3e0] text-[#e65100]"],
  ["pe", "bg-[#fff3e0] text-[#e65100]"],
  ["safety", "bg-[#fce4ec] text-[#ad1457]"],
  ["expert", "bg-[#f1f8e9] text-[#558b2f]"],
  ["nurse", "bg-[#e8eaf6] text-[#3949ab]"],
];
const roleTone = (name) => {
  const n = (name || "").toLowerCase();
  const hit = ROLE_TONES.find(([key]) => n === key || n.startsWith(`${key}_`));
  return hit ? hit[1] : "bg-gray-100 text-gray-500";
};

// role ที่ตั้งเป็น role เสริมไม่ได้ (ต้องเป็น role หลักเท่านั้น) — ตรงกับ PRIMARY_ONLY_ROLES ฝั่ง backend
const PRIMARY_ONLY_ROLES = ["admin"];

// คำนำหน้าชื่อ — เก็บแยกจาก name เสมอ (field titlePrefix ใน schema)
const TITLE_PREFIX_OPTIONS = ["", "นาย", "นาง", "นางสาว", "Mr.", "Mrs.", "Ms."];

// Force Delete — แสดงเฉพาะตอนรัน dev server (Vite) ไม่หลุดไป production
// const SHOW_FORCE_DELETE = import.meta.env.DEV;

// Force Delete — แสดงตอน dev หรือเมื่อ build ด้วย VITE_SHOW_FORCE_DELETE=true
const SHOW_FORCE_DELETE =
  import.meta.env.DEV || import.meta.env.VITE_SHOW_FORCE_DELETE === "true";

// สถานะการล็อกบัญชี (ใส่รหัสผ่านผิดครบ 5 ครั้ง → ล็อก 15 นาที — authController.login)
const lockInfo = (u) => {
  const until = u.loginLockedUntil ? new Date(u.loginLockedUntil) : null;
  return until && until > new Date() ? until : null;
};
const fmtClock = (d) =>
  d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

const emptyAddForm = {
  titlePrefix: "",
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  roleId: "",
  employeeId: "",
};

// กรอบ modal (หน้าเพจหลักไม่ใช้การ์ดแล้ว — คั่นด้วยเส้นแทน)
const MODAL_BOX = "overflow-hidden rounded-[10px] border border-gray-200 bg-white";
const FIELD_LABEL =
  "mb-[5px] block text-[11px] font-bold uppercase tracking-[0.4px] text-gray-500";
const INPUT =
  "box-border w-full rounded-lg border border-gray-300 bg-white px-3 py-[9px] text-[13px] outline-none focus:border-blue-400";
const SELECT_SM =
  "rounded-md border border-gray-300 bg-white px-2 py-[5px] text-xs outline-none focus:border-blue-400 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400";
const BTN_SM =
  "cursor-pointer whitespace-nowrap rounded-md border px-3 py-[5px] text-xs font-semibold disabled:cursor-not-allowed";
const BTN_PRIMARY =
  "cursor-pointer rounded-md border-none bg-[#2B2F78] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#22265f] disabled:cursor-default disabled:bg-gray-400";
const BTN_GHOST =
  "cursor-pointer rounded-lg border border-gray-200 bg-white px-4 py-2 text-[13px] font-semibold text-gray-500 hover:bg-gray-50";
const FILTER_LABEL =
  "mb-1 block text-xs font-semibold uppercase tracking-[0.4px] text-gray-500";
const FIELD =
  "box-border h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-[13px] text-gray-900 outline-none focus:border-blue-500";
const TH =
  "whitespace-nowrap border-b border-gray-200 bg-gray-50 px-3.5 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.3px] text-gray-500";
const TD = "border-b border-gray-100 px-3.5 py-3 align-middle text-[13px]";
const ACT_BTN =
  "inline-flex h-7 cursor-pointer items-center justify-center whitespace-nowrap rounded-md border-none px-3 text-xs font-semibold transition-all disabled:cursor-not-allowed";
const LIFT_WHITE =
  "bg-white text-gray-700 shadow-[0_1px_3px_rgba(0,0,0,0.15),0_1px_2px_rgba(0,0,0,0.08)] hover:-translate-y-px hover:shadow-[0_3px_6px_rgba(0,0,0,0.18),0_2px_3px_rgba(0,0,0,0.1)]";
const LIFT_RED =
  "bg-[#fff5f5] text-[#842029] shadow-[0_1px_3px_rgba(220,53,69,0.15),0_1px_2px_rgba(0,0,0,0.06)] hover:-translate-y-px hover:shadow-[0_3px_6px_rgba(220,53,69,0.25),0_2px_3px_rgba(0,0,0,0.08)]";
const LIFT_DANGER =
  "bg-[#f8d7da] text-[#842029] shadow-[0_1px_3px_rgba(220,53,69,0.25),0_1px_2px_rgba(0,0,0,0.06)] hover:-translate-y-px hover:shadow-[0_3px_6px_rgba(220,53,69,0.35),0_2px_3px_rgba(0,0,0,0.08)]";
const BTN_DISABLED = "bg-gray-100 text-gray-400 shadow-none";

// ══════════════════════════════════════════════════════════
// small components
// ══════════════════════════════════════════════════════════
function RoleBadge({ name }) {
  return (
    <span
      className={`whitespace-nowrap rounded-md px-2.5 py-0.5 text-[11px] font-bold capitalize ${roleTone(name)}`}
    >
      {name || "—"}
    </span>
  );
}

// ไอคอนตา (เปิด/ปิดการแสดง password) — inline SVG
function EyeIcon({ open }) {
  return open ? (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.6 18.6 0 0 1 4.22-5.44M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 8 11 8a18.6 18.6 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

// กรอบ modal ที่ใช้ร่วมกันทั้ง 3 ตัว
function Modal({ title, maxW = "max-w-[440px]", onClose, footer, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/50 p-3 sm:p-5"
      onClick={onClose}
    >
      <div
        className={`${MODAL_BOX} flex max-h-[90vh] w-full ${maxW} flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between bg-[#1e3a5f] px-5 py-3.5 text-white">
          <span className="text-[15px] font-bold">{title}</span>
          <button
            onClick={onClose}
            className="cursor-pointer border-none bg-transparent text-xl leading-none text-white"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

function NameFields({ value, onChange }) {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[110px_1fr_1fr]">
      <div>
        <label className={FIELD_LABEL}>คำนำหน้า</label>
        <select
          className={INPUT}
          value={value.titlePrefix}
          onChange={(e) => onChange({ ...value, titlePrefix: e.target.value })}
        >
          {TITLE_PREFIX_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t || "— ไม่ระบุ —"}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={FIELD_LABEL}>ชื่อ *</label>
        <input
          className={INPUT}
          placeholder="เช่น สมชาย"
          value={value.firstName}
          onChange={(e) => onChange({ ...value, firstName: e.target.value })}
        />
      </div>
      <div>
        <label className={FIELD_LABEL}>นามสกุล</label>
        <input
          className={INPUT}
          placeholder="เช่น ใจดี"
          value={value.lastName}
          onChange={(e) => onChange({ ...value, lastName: e.target.value })}
        />
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// main
// ══════════════════════════════════════════════════════════
export default function AdminUsers() {
  const { backendUrl, userData, getUserData } = useContext(AppContent);

  const [users, setUsers] = useState([]);
  const [roleList, setRoleList] = useState([]);
  const [availableEmps, setAvailableEmps] = useState([]);
  const [roleDraft, setRoleDraft] = useState({}); // { userId: roleId } — แก้ค้างก่อน Save
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState(""); // role.id
  const [linkFilter, setLinkFilter] = useState(""); // "" | "linked" | "unlinked"
  const [loading, setLoading] = useState(true);
  const [savingRoleUserId, setSavingRoleUserId] = useState(null);
  const [linkingUserId, setLinkingUserId] = useState(null);
  const [savingExtraUserId, setSavingExtraUserId] = useState(null);
  const [unlockingUserId, setUnlockingUserId] = useState(null);

  // ── roles modal ──
  const [showRoles, setShowRoles] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [creatingRole, setCreatingRole] = useState(false);
  const [deletingRoleId, setDeletingRoleId] = useState(null);
  const [editingRoleId, setEditingRoleId] = useState(null);
  const [editRoleName, setEditRoleName] = useState("");
  const [savingRoleId, setSavingRoleId] = useState(null);

  // ── add user modal ──
  const [showAdd, setShowAdd] = useState(false);
  const [showAddPassword, setShowAddPassword] = useState(false);
  const [form, setForm] = useState(emptyAddForm);
  const [saving, setSaving] = useState(false);

  // ── edit user modal (ไม่มี password) ──
  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState({
    titlePrefix: "",
    firstName: "",
    lastName: "",
    email: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);

  // keepDrafts: เก็บ role ที่แก้ค้างของแถวอื่นไว้ (เดิม Save แถวหนึ่ง → แถวอื่นที่แก้ค้างหายหมด)
  const fetchAll = async ({ keepDrafts = false } = {}) => {
    try {
      if (!keepDrafts) setLoading(true);
      const [userRes, roleRes, empRes] = await Promise.all([
        axios.get(`${backendUrl}/api/user/all`, { withCredentials: true }),
        axios.get(`${backendUrl}/api/user/roles`, { withCredentials: true }),
        axios.get(`${backendUrl}/api/user/available-employees`, {
          withCredentials: true,
        }),
      ]);
      if (userRes.data.success) {
        const list = userRes.data.users;
        setUsers(list);
        setRoleDraft((prev) => {
          const next = {};
          list.forEach((u) => {
            next[u.id] =
              keepDrafts && prev[u.id] !== undefined ? prev[u.id] : u.role?.id;
          });
          return next;
        });
      }
      if (roleRes.data.success) setRoleList(roleRes.data.roles);
      if (empRes.data.success) setAvailableEmps(empRes.data.employees);
    } catch (error) {
      console.error(error);
      toast.error("โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl]);

  const isSelf = (id) => id === userData?.id;
  const errMsg = (error, fallback) => error.response?.data?.message || fallback;

  // ══════════ Roles ══════════
  const handleCreateRole = async () => {
    if (!newRoleName.trim()) {
      toast.error("กรอกชื่อ role");
      return;
    }
    if (creatingRole) return;
    try {
      setCreatingRole(true);
      const res = await axios.post(
        `${backendUrl}/api/user/roles`,
        { name: newRoleName.trim() },
        { withCredentials: true },
      );
      if (res.data.success) {
        toast.success("เพิ่ม role แล้ว");
        setNewRoleName("");
        fetchAll({ keepDrafts: true });
      } else {
        toast.error(res.data.message || "เพิ่มไม่สำเร็จ");
      }
    } catch (error) {
      console.error(error);
      toast.error(errMsg(error, "เกิดข้อผิดพลาด"));
    } finally {
      setCreatingRole(false);
    }
  };

  const handleDeleteRole = async (role) => {
    if (!window.confirm(`ลบ role "${role.name}"?`)) return;
    try {
      setDeletingRoleId(role.id);
      const res = await axios.delete(
        `${backendUrl}/api/user/roles/${role.id}`,
        {
          withCredentials: true,
        },
      );
      if (res.data.success) {
        toast.success("ลบ role แล้ว");
        fetchAll({ keepDrafts: true });
      } else {
        toast.error(res.data.message || "ลบไม่สำเร็จ");
      }
    } catch (error) {
      console.error(error);
      toast.error(errMsg(error, "เกิดข้อผิดพลาด"));
    } finally {
      setDeletingRoleId(null);
    }
  };

  const startEditRole = (role) => {
    setEditingRoleId(role.id);
    setEditRoleName(role.name);
  };
  const cancelEditRole = () => {
    setEditingRoleId(null);
    setEditRoleName("");
  };

  const handleSaveRoleName = async (role) => {
    const trimmed = editRoleName.trim();
    if (!trimmed) {
      toast.error("กรอกชื่อ role");
      return;
    }
    if (trimmed === role.name) {
      cancelEditRole();
      return;
    }
    if (savingRoleId) return;
    try {
      setSavingRoleId(role.id);
      const res = await axios.put(
        `${backendUrl}/api/user/roles/${role.id}`,
        { name: trimmed },
        { withCredentials: true },
      );
      if (res.data.success) {
        toast.success("แก้ไขชื่อ role แล้ว");
        cancelEditRole();
        fetchAll({ keepDrafts: true });
      } else {
        toast.error(res.data.message || "แก้ไขไม่สำเร็จ");
      }
    } catch (error) {
      console.error(error);
      toast.error(errMsg(error, "เกิดข้อผิดพลาด"));
    } finally {
      setSavingRoleId(null);
    }
  };

  // ══════════ Users ══════════
  const handleSaveRole = async (userId) => {
    try {
      setSavingRoleUserId(userId);
      const res = await axios.put(
        `${backendUrl}/api/user/role`,
        { userId, roleId: roleDraft[userId] },
        { withCredentials: true },
      );
      if (res.data.success) {
        toast.success("อัปเดต role แล้ว");
        // อัปเดตเฉพาะแถวนี้ — draft ของแถวอื่นยังอยู่
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId
              ? {
                  ...u,
                  role:
                    roleList.find((r) => r.id === roleDraft[userId]) || u.role,
                }
              : u,
          ),
        );
        fetchAll({ keepDrafts: true });
      } else {
        toast.error(res.data.message || "อัปเดตไม่สำเร็จ");
      }
    } catch (error) {
      console.error(error);
      toast.error(errMsg(error, "เกิดข้อผิดพลาด"));
    } finally {
      setSavingRoleUserId(null);
    }
  };

  // role เสริม — ส่งทั้งชุด (roleIds) ไปแทนที่ของเดิม บันทึกทันที
  const handleSaveExtraRoles = async (u, roleIds) => {
    try {
      setSavingExtraUserId(u.id);
      const res = await axios.put(
        `${backendUrl}/api/user/${u.id}/extra-roles`,
        { roleIds },
        { withCredentials: true },
      );
      if (res.data.success) {
        toast.success("อัปเดต role เสริมแล้ว");
        fetchAll({ keepDrafts: true });
      } else {
        toast.error(res.data.message || "อัปเดตไม่สำเร็จ");
      }
    } catch (error) {
      console.error(error);
      toast.error(errMsg(error, "เกิดข้อผิดพลาด"));
    } finally {
      setSavingExtraUserId(null);
    }
  };

  const resetRoleDraft = (u) =>
    setRoleDraft((p) => ({ ...p, [u.id]: u.role?.id }));

  const handleLinkEmployee = async (userId, employeeId) => {
    try {
      setLinkingUserId(userId);
      const res = await axios.put(
        `${backendUrl}/api/user/${userId}/employee`,
        { employeeId: employeeId || null },
        { withCredentials: true },
      );
      if (res.data.success) {
        toast.success(employeeId ? "ผูก worker แล้ว" : "ยกเลิกการผูกแล้ว");
        fetchAll({ keepDrafts: true });
      } else {
        toast.error(res.data.message || "ไม่สำเร็จ");
      }
    } catch (error) {
      console.error(error);
      toast.error(errMsg(error, "เกิดข้อผิดพลาด"));
    } finally {
      setLinkingUserId(null);
    }
  };

  // ปลดล็อกบัญชีที่ใส่รหัสผ่านผิดครบ 5 ครั้ง — ใช้เมื่อยืนยันแล้วว่าเป็นเจ้าของบัญชีจำรหัสผิดเอง
  const handleUnlock = async (u) => {
    if (
      !window.confirm(
        `ปลดล็อกบัญชี "${u.name}"?\n\nควรยืนยันกับเจ้าของบัญชีก่อนว่าเป็นคนใส่รหัสผิดเอง — ถ้าไม่ใช่ อาจมีคนพยายามเข้าบัญชีนี้ ให้เจ้าของเปลี่ยนรหัสผ่าน`,
      )
    )
      return;
    try {
      setUnlockingUserId(u.id);
      const res = await axios.put(
        `${backendUrl}/api/user/${u.id}/unlock-login`,
        {},
        { withCredentials: true },
      );
      if (res.data.success) {
        toast.success("ปลดล็อกบัญชีแล้ว");
        fetchAll({ keepDrafts: true });
      } else {
        toast.error(res.data.message || "ปลดล็อกไม่สำเร็จ");
      }
    } catch (error) {
      console.error(error);
      toast.error(errMsg(error, "เกิดข้อผิดพลาด"));
    } finally {
      setUnlockingUserId(null);
    }
  };

  const handleDelete = async (u) => {
    if (!window.confirm(`ลบผู้ใช้ "${u.name}"?`)) return;
    try {
      const res = await axios.delete(`${backendUrl}/api/user/${u.id}`, {
        withCredentials: true,
      });
      if (res.data.success) {
        toast.success("ลบผู้ใช้แล้ว");
        fetchAll({ keepDrafts: true });
      } else {
        toast.error(res.data.message || "ลบไม่สำเร็จ");
      }
    } catch (error) {
      console.error(error);
      toast.error(errMsg(error, "เกิดข้อผิดพลาด"));
    }
  };

  // Force delete (DEV ONLY) — ลบ Notification/WorkflowLog ถาวร และตัดการอ้างอิงใน
  // ClientApproval/PerformanceReview/ProjectMessage; ถ้าเคยสร้าง ManpowerRequest
  // backend จะ error (field required) เพื่อกันข้อมูลสำคัญหาย
  const handleForceDelete = async (u) => {
    if (
      !window.confirm(
        `⚠️ FORCE DELETE (DEV ONLY)\n\nลบ "${u.name}" แบบถาวรพร้อมข้อมูลที่เกี่ยวข้องทั้งหมด (แจ้งเตือน, log)\n\nใช้เฉพาะช่วงพัฒนา/ทดสอบเท่านั้น — ยืนยันหรือไม่?`,
      )
    )
      return;
    try {
      const res = await axios.delete(`${backendUrl}/api/user/${u.id}/force`, {
        withCredentials: true,
      });
      if (res.data.success) {
        toast.success("Force delete สำเร็จ");
        fetchAll({ keepDrafts: true });
      } else {
        toast.error(res.data.message || "Force delete ไม่สำเร็จ");
      }
    } catch (error) {
      console.error(error);
      toast.error(
        errMsg(
          error,
          "Force delete ไม่สำเร็จ — user นี้อาจเคยสร้าง request ไว้",
        ),
      );
    }
  };

  const closeAdd = () => {
    setShowAdd(false);
    setShowAddPassword(false);
    setForm(emptyAddForm);
  };

  const handleCreate = async () => {
    if (
      !form.firstName.trim() ||
      !form.email.trim() ||
      !form.password ||
      !form.roleId
    ) {
      toast.error("กรอกชื่อ, email, password, role ให้ครบ");
      return;
    }
    try {
      setSaving(true);
      const res = await axios.post(
        `${backendUrl}/api/user`,
        {
          ...form,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim() || null,
          email: form.email.trim(),
          titlePrefix: form.titlePrefix || null,
        },
        { withCredentials: true },
      );
      if (res.data.success) {
        toast.success("สร้างผู้ใช้แล้ว");
        closeAdd();
        fetchAll({ keepDrafts: true });
      } else {
        toast.error(res.data.message || "สร้างไม่สำเร็จ");
      }
    } catch (error) {
      console.error(error);
      // เดิมขึ้นแค่ "เกิดข้อผิดพลาด" — เช่น email ซ้ำ ผู้ใช้ไม่รู้ว่าเพราะอะไร
      toast.error(errMsg(error, "เกิดข้อผิดพลาด"));
    } finally {
      setSaving(false);
    }
  };

  const openEditUser = (u) => {
    setEditingUser(u);
    setEditForm({
      titlePrefix: u.titlePrefix || "",
      firstName: u.firstName ?? u.name ?? "",
      lastName: u.lastName ?? "",
      email: u.email || "",
    });
  };
  const closeEditUser = () => {
    setEditingUser(null);
    setEditForm({ titlePrefix: "", firstName: "", lastName: "", email: "" });
  };

  const handleSaveEditUser = async () => {
    if (!editForm.firstName.trim() || !editForm.email.trim()) {
      toast.error("กรอกชื่อและ email ให้ครบ");
      return;
    }
    try {
      setSavingEdit(true);
      const editingSelf = editingUser.id === userData?.id;
      const res = await axios.put(
        `${backendUrl}/api/user/${editingUser.id}`,
        {
          titlePrefix: editForm.titlePrefix || null,
          firstName: editForm.firstName.trim(),
          lastName: editForm.lastName.trim() || null,
          email: editForm.email.trim(),
        },
        { withCredentials: true },
      );
      if (res.data.success) {
        toast.success("แก้ไขข้อมูลผู้ใช้แล้ว");
        closeEditUser();
        fetchAll({ keepDrafts: true });
        // แก้ข้อมูลตัวเอง → sync AppContext ให้ Navbar/Profile เปลี่ยนทันที
        if (editingSelf && getUserData) getUserData();
      } else {
        toast.error(res.data.message || "แก้ไขไม่สำเร็จ");
      }
    } catch (error) {
      console.error(error);
      toast.error(errMsg(error, "เกิดข้อผิดพลาด"));
    } finally {
      setSavingEdit(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (
        roleFilter &&
        u.role?.id !== roleFilter &&
        !(u.extraRoles || []).some((r) => r.id === roleFilter)
      )
        return false;
      if (linkFilter === "linked" && !u.employee) return false;
      if (linkFilter === "unlinked" && u.employee) return false;
      if (!q) return true;
      return [
        u.name,
        u.titlePrefix ? `${u.titlePrefix}${u.name}` : "",
        u.email,
        ...(u.extraRoles || []).map((r) => r.name),
        u.employee?.fullName,
        u.employee?.empCode,
      ].some((v) =>
        String(v || "")
          .toLowerCase()
          .includes(q),
      );
    });
  }, [users, search, roleFilter, linkFilter]);

  // จำนวนผู้ใช้ต่อ role (หลัก + เสริม) — แสดงใน dropdown
  const roleCount = (roleId) =>
    users.filter(
      (u) =>
        u.role?.id === roleId ||
        (u.extraRoles || []).some((r) => r.id === roleId),
    ).length;

  const hasFilter = search || roleFilter || linkFilter;
  const resetFilters = () => {
    setSearch("");
    setRoleFilter("");
    setLinkFilter("");
  };

  // ── ส่วนที่ใช้ทั้งตารางและการ์ด ──
  const displayName = (u) =>
    u.titlePrefix ? `${u.titlePrefix}${u.name}` : u.name;

  const renderName = (u) => {
    const lockedUntil = lockInfo(u);
    return (
      <>
        <span className="font-bold">{displayName(u)}</span>
        {isSelf(u.id) && (
          <span className="ml-1.5 text-[10px] text-gray-400">(you)</span>
        )}
        {lockedUntil ? (
          <div
            className="mt-1 inline-flex items-center gap-1 rounded-md bg-[#f8d7da] px-2 py-0.5 text-[11px] font-bold text-[#842029]"
            title="ใส่รหัสผ่านผิดครบ 5 ครั้ง — ปลดล็อกเองอัตโนมัติเมื่อครบเวลา หรือกด 🔓 ปลดล็อก"
          >
            🔒 ล็อกถึง {fmtClock(lockedUntil)}
          </div>
        ) : (
          u.failedLoginAttempts > 0 && (
            <div className="mt-0.5 text-[11px] text-[#b45309]" title="ล็อกเมื่อผิดครบ 5 ครั้ง · ล้างเมื่อเข้าสู่ระบบสำเร็จ">
              ใส่รหัสผิด {u.failedLoginAttempts}/5 ครั้ง
            </div>
          )
        )}
      </>
    );
  };

  // Role: ตัวเอง = badge อย่างเดียว (เปลี่ยนไม่ได้) / คนอื่น = dropdown + ปุ่ม Save
  // ที่โผล่เฉพาะตอนเปลี่ยน (เดิมโชว์ badge + dropdown ซ้ำกัน และปุ่ม Save อยู่ไกลในคอลัมน์ Actions)
  const renderRole = (u) => {
    if (isSelf(u.id)) {
      return (
        <span title="เปลี่ยน role ตัวเองไม่ได้">
          <RoleBadge name={u.role?.name} />
        </span>
      );
    }
    const dirty = roleDraft[u.id] !== u.role?.id;
    const saving = savingRoleUserId === u.id;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={roleDraft[u.id] || ""}
          onChange={(e) =>
            setRoleDraft((p) => ({ ...p, [u.id]: e.target.value }))
          }
          className={`${SELECT_SM} max-w-[180px] cursor-pointer ${
            dirty ? "border-blue-500 bg-blue-50" : ""
          }`}
        >
          {roleList.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {dirty && (
          <>
            <button
              onClick={() => handleSaveRole(u.id)}
              disabled={saving}
              className={`${BTN_SM} border-[#2B2F78] bg-[#2B2F78] text-white hover:bg-[#22265f]`}
            >
              {saving ? "…" : "Save"}
            </button>
            <button
              onClick={() => resetRoleDraft(u)}
              disabled={saving}
              title="ยกเลิกการเปลี่ยน"
              className={`${BTN_SM} border-gray-200 bg-white px-2 text-gray-500 hover:bg-gray-50`}
            >
              ↺
            </button>
          </>
        )}
      </div>
    );
  };

  // Role เสริม: ป้าย + ✕ เอาออก / dropdown "＋ เพิ่ม" — บันทึกทันที
  // ตัวเอง = ป้ายอย่างเดียว (เปลี่ยน role ตัวเองไม่ได้)
  const renderExtraRoles = (u) => {
    const extras = u.extraRoles || [];
    const extraIds = extras.map((r) => r.id);
    const self = isSelf(u.id);
    const saving = savingExtraUserId === u.id;
    const addable = roleList.filter(
      (r) =>
        r.id !== u.role?.id &&
        !extraIds.includes(r.id) &&
        !PRIMARY_ONLY_ROLES.includes(r.name),
    );
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {extras.length === 0 && self && (
          <span className="text-xs text-gray-400">—</span>
        )}
        {extras.map((r) => (
          <span
            key={r.id}
            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md py-0.5 pl-2.5 text-[11px] font-bold capitalize ${
              self ? "pr-2.5" : "pr-1"
            } ${roleTone(r.name)}`}
          >
            {r.name}
            {!self && (
              <button
                type="button"
                disabled={saving}
                title={`เอา ${r.name} ออก`}
                onClick={() => {
                  if (!window.confirm(`เอา role เสริม "${r.name}" ออกจาก ${u.name}?`)) return;
                  handleSaveExtraRoles(
                    u,
                    extraIds.filter((id) => id !== r.id),
                  );
                }}
                className="cursor-pointer rounded border-none bg-transparent px-1 text-[11px] leading-none opacity-60 hover:opacity-100 disabled:cursor-not-allowed"
              >
                ✕
              </button>
            )}
          </span>
        ))}
        {!self && addable.length > 0 && (
          <select
            value=""
            disabled={saving}
            onChange={(e) =>
              e.target.value &&
              handleSaveExtraRoles(u, [...extraIds, e.target.value])
            }
            title="เพิ่ม role เสริม"
            className={`${SELECT_SM} max-w-[120px] cursor-pointer text-gray-500`}
          >
            <option value="">{saving ? "…" : "＋ เพิ่ม"}</option>
            {addable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  };

  const renderLinkedWorker = (u) => {
    // ตัวเลือก = available + คนที่ผูกอยู่ตอนนี้
    const empOptions = [...availableEmps];
    if (u.employee && !empOptions.find((e) => e.id === u.employee.id)) {
      empOptions.unshift(u.employee);
    }
    return (
      <select
        value={u.employee?.id || ""}
        onChange={(e) => handleLinkEmployee(u.id, e.target.value)}
        disabled={linkingUserId === u.id}
        className={`${SELECT_SM} w-full max-w-[280px] cursor-pointer`}
      >
        <option value="">— None —</option>
        {empOptions.map((e) => (
          <option key={e.id} value={e.id}>
            {e.fullName} ({e.empCode})
          </option>
        ))}
      </select>
    );
  };

  const renderActions = (u) => {
    const self = isSelf(u.id);
    const lockedUntil = lockInfo(u);
    return (
      <div className="flex flex-nowrap gap-1.5">
        {lockedUntil && (
          <button
            onClick={() => handleUnlock(u)}
            disabled={unlockingUserId === u.id}
            title={`ปลดล็อกทันที (ไม่ต้องรอถึง ${fmtClock(lockedUntil)})`}
            className={`${ACT_BTN} ${LIFT_WHITE} text-[#2B2F78]`}
          >
            {unlockingUserId === u.id ? "…" : "🔓 ปลดล็อก"}
          </button>
        )}
        <button
          title="แก้ไขข้อมูลผู้ใช้"
          onClick={() => openEditUser(u)}
          className={`${ACT_BTN} ${LIFT_WHITE} w-7 px-0 text-[13px]`}
        >
          ✏️
        </button>
        <button
          onClick={() => handleDelete(u)}
          disabled={self}
          title={self ? "ลบบัญชีตัวเองไม่ได้" : "ลบผู้ใช้"}
          className={`${ACT_BTN} ${self ? BTN_DISABLED : LIFT_RED}`}
        >
          Delete
        </button>
        {SHOW_FORCE_DELETE && (
          <button
            onClick={() => handleForceDelete(u)}
            disabled={self}
            title={
              self
                ? "ลบบัญชีตัวเองไม่ได้"
                : "DEV ONLY — ลบพร้อมข้อมูลที่เกี่ยวข้องแบบถาวร"
            }
            className={`${ACT_BTN} text-[11px] font-bold ${
              self ? BTN_DISABLED : LIFT_DANGER
            }`}
          >
            ⚠ Force Delete
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1800px]">
      {/* ════════ Header — ชื่อหน้าแสดงที่แท็บ "Users" ด้านบนแล้ว ════════ */}
      <div className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-gray-500">
          จัดการบัญชีผู้ใช้ · role หลัก / role เสริม · การผูกกับ worker
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowRoles(true)}
            className="flex-1 cursor-pointer whitespace-nowrap rounded-md border border-[#2B2F78] bg-white px-4 py-2 text-[13px] font-semibold text-[#2B2F78] hover:bg-[#2B2F78]/5 sm:flex-none"
          >
            ⚙ Manage Roles
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className={`${BTN_PRIMARY} flex-1 whitespace-nowrap sm:flex-none`}
          >
            ＋ Add User
          </button>
        </div>
      </div>

      {/* ════════ Filters — คั่นด้วยเส้น ════════ */}
      <div className="border-y border-gray-200 py-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
          <div className="min-w-0 sm:col-span-2 lg:col-span-1">
            <label className={FILTER_LABEL}>
              Search{" "}
              <span className="normal-case tracking-normal text-gray-400">
                (ชื่อ / Email / Worker ที่ผูก)
              </span>
            </label>
            <input
              type="text"
              placeholder="🔍 เช่น สมชาย, hr@experteam.co.th..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={FIELD}
            />
          </div>
          <div className="min-w-0">
            <label className={FILTER_LABEL}>Role</label>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className={FIELD}
            >
              <option value="">ทั้งหมด</option>
              {roleList.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({roleCount(r.id)})
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label className={FILTER_LABEL}>Linked Worker</label>
            <select
              value={linkFilter}
              onChange={(e) => setLinkFilter(e.target.value)}
              className={FIELD}
            >
              <option value="">ทั้งหมด</option>
              <option value="linked">ผูก worker แล้ว</option>
              <option value="unlinked">ยังไม่ผูก (None)</option>
            </select>
          </div>
        </div>
      </div>

      {/* จำนวน + ล้าง filter */}
      {!loading && (
        <div className="flex items-center gap-3 py-2 text-xs text-gray-500">
          <span>
            {hasFilter ? (
              <>
                พบ <strong className="text-gray-900">{filtered.length}</strong>{" "}
                จาก {users.length} คน
              </>
            ) : (
              <>ทั้งหมด {users.length} คน</>
            )}
          </span>
          {hasFilter && (
            <button
              onClick={resetFilters}
              className="cursor-pointer border-none bg-transparent p-0 text-xs font-semibold text-[#dc3545] hover:underline"
            >
              ✕ ล้างทั้งหมด
            </button>
          )}
        </div>
      )}

      {/* ════════ List ════════ */}
      <div className="border-y border-gray-200">
        {loading ? (
          <div className="p-7 text-center text-gray-500">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-7 text-center text-gray-500">
            {hasFilter ? "ไม่พบผู้ใช้ตามเงื่อนไขที่เลือก" : "ไม่พบผู้ใช้"}
          </div>
        ) : (
          <>
            {/* ── ต่ำกว่า lg: รายการคั่นเส้น ── */}
            <div className="divide-y divide-gray-200 lg:hidden">
              {filtered.map((u) => (
                <div key={u.id} className="py-3 text-[13px]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div>{renderName(u)}</div>
                      <div className="break-all text-xs text-gray-500">
                        {u.email}
                      </div>
                    </div>
                    {renderActions(u)}
                  </div>
                  <div className="mt-2.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="w-[52px] shrink-0 text-[10px] font-semibold uppercase text-gray-400">
                        Role
                      </span>
                      {renderRole(u)}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-[52px] shrink-0 text-[10px] font-semibold uppercase text-gray-400">
                        เสริม
                      </span>
                      {renderExtraRoles(u)}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-[52px] shrink-0 text-[10px] font-semibold uppercase text-gray-400">
                        Worker
                      </span>
                      <div className="min-w-0 flex-1">
                        {renderLinkedWorker(u)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* ── lg+: ตาราง ── */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={TH}>Name</th>
                    <th className={TH}>Email</th>
                    <th className={TH}>Role</th>
                    <th className={TH}>Role เสริม</th>
                    <th className={TH}>Linked Worker</th>
                    <th className={TH}>Actions</th>
                  </tr>
                </thead>
                <tbody className="[&>tr:last-child>td]:border-b-0">
                  {filtered.map((u) => (
                    <tr key={u.id} className="hover:bg-gray-50">
                      <td className={TD}>{renderName(u)}</td>
                      <td className={`${TD} text-gray-500`}>{u.email}</td>
                      <td className={TD}>{renderRole(u)}</td>
                      <td className={TD}>{renderExtraRoles(u)}</td>
                      <td className={TD}>{renderLinkedWorker(u)}</td>
                      <td className={TD}>{renderActions(u)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ════════ Add User modal ════════ */}
      {showAdd && (
        <Modal
          title="＋ Add User"
          onClose={closeAdd}
          footer={
            <>
              <button onClick={closeAdd} className={BTN_GHOST}>
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={saving}
                className={BTN_PRIMARY}
              >
                {saving ? "Creating…" : "Create User"}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-3.5 p-5">
            <NameFields
              value={form}
              onChange={(v) => setForm((f) => ({ ...f, ...v }))}
            />

            <div>
              <label className={FIELD_LABEL}>Email</label>
              <input
                className={INPUT}
                placeholder="เช่น somchai@experteam.co.th"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>

            <div>
              <label className={FIELD_LABEL}>Password</label>
              <div className="relative">
                <input
                  className={`${INPUT} pr-10`}
                  placeholder="ตั้งรหัสผ่านให้ผู้ใช้"
                  type={showAddPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowAddPassword((p) => !p)}
                  title={showAddPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                  className="absolute right-2.5 top-1/2 flex -translate-y-1/2 cursor-pointer items-center border-none bg-transparent p-0 text-gray-500"
                >
                  <EyeIcon open={showAddPassword} />
                </button>
              </div>
            </div>

            <div>
              <label className={FIELD_LABEL}>Role</label>
              <select
                className={INPUT}
                value={form.roleId}
                onChange={(e) => setForm({ ...form, roleId: e.target.value })}
              >
                <option value="">-- Select Role --</option>
                {roleList.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={FIELD_LABEL}>
                Linked Worker{" "}
                <span className="font-normal normal-case">(ไม่บังคับ)</span>
              </label>
              <select
                className={INPUT}
                value={form.employeeId}
                onChange={(e) =>
                  setForm({ ...form, employeeId: e.target.value })
                }
              >
                <option value="">— None —</option>
                {availableEmps.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName} ({e.empCode})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Modal>
      )}

      {/* ════════ Edit User modal ════════ */}
      {editingUser && (
        <Modal
          title="✏️ Edit User"
          onClose={closeEditUser}
          footer={
            <>
              <button onClick={closeEditUser} className={BTN_GHOST}>
                Cancel
              </button>
              <button
                onClick={handleSaveEditUser}
                disabled={savingEdit}
                className={BTN_PRIMARY}
              >
                {savingEdit ? "Saving…" : "Save Changes"}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-3.5 p-5">
            <NameFields
              value={editForm}
              onChange={(v) => setEditForm((f) => ({ ...f, ...v }))}
            />
            <div>
              <label className={FIELD_LABEL}>Email</label>
              <input
                className={INPUT}
                type="email"
                value={editForm.email}
                onChange={(e) =>
                  setEditForm({ ...editForm, email: e.target.value })
                }
              />
            </div>
            <div className="text-[11px] leading-normal text-gray-400">
              เปลี่ยน Role, Role เสริม หรือ Linked Worker ได้จากตารางหลักโดยตรง —
              ไม่ต้องเปิด modal นี้
              ส่วนรหัสผ่านผู้ใช้ต้องเปลี่ยนด้วยตัวเองผ่านหน้า Profile
            </div>
          </div>
        </Modal>
      )}

      {/* ════════ Manage Roles modal ════════ */}
      {showRoles && (
        <Modal
          title="⚙ Manage Roles"
          maxW="max-w-[460px]"
          onClose={() => {
            cancelEditRole();
            setShowRoles(false);
          }}
          footer={
            <button
              onClick={() => {
                cancelEditRole();
                setShowRoles(false);
              }}
              className={BTN_GHOST}
            >
              Close
            </button>
          }
        >
          {/* Add new role */}
          <div className="flex gap-2 border-b border-gray-200 px-5 py-4">
            <input
              className={INPUT}
              placeholder="ชื่อ role ใหม่ เช่น supervisor"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateRole()}
            />
            <button
              onClick={handleCreateRole}
              disabled={creatingRole}
              className="shrink-0 cursor-pointer whitespace-nowrap rounded-lg border-none bg-[#198754] px-4 py-[9px] text-[13px] font-bold text-white hover:bg-[#157347] disabled:cursor-default disabled:bg-gray-400"
            >
              {creatingRole ? "..." : "+ Add"}
            </button>
          </div>

          {/* Role list */}
          <div className="px-5 py-3">
            {roleList.length === 0 ? (
              <div className="p-5 text-center text-gray-500">ยังไม่มี role</div>
            ) : (
              roleList.map((r) => {
                const inUse = (r.userCount ?? 0) > 0;
                const editing = editingRoleId === r.id;
                return (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 border-b border-gray-100 py-2"
                  >
                    {editing ? (
                      <div className="flex flex-1 items-center gap-2">
                        <input
                          value={editRoleName}
                          onChange={(e) => setEditRoleName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveRoleName(r);
                            if (e.key === "Escape") {
                              e.stopPropagation(); // ไม่ปิด modal ทั้งอัน
                              cancelEditRole();
                            }
                          }}
                          autoFocus
                          className={`${SELECT_SM} min-w-0 flex-1 px-2.5 py-1.5`}
                        />
                        <button
                          onClick={() => handleSaveRoleName(r)}
                          disabled={savingRoleId === r.id}
                          className="cursor-pointer whitespace-nowrap rounded-md border-none bg-[#2B2F78] px-2.5 py-1 text-[11px] font-bold text-white disabled:bg-gray-400"
                        >
                          {savingRoleId === r.id ? "..." : "บันทึก"}
                        </button>
                        <button
                          onClick={cancelEditRole}
                          className="cursor-pointer whitespace-nowrap rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-500"
                        >
                          ยกเลิก
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <RoleBadge name={r.name} />
                          <span className="text-[11px] text-gray-400">
                            {inUse
                              ? `${r.userCount} user ใช้อยู่${
                                  r.extraCount
                                    ? ` (เป็น role เสริม ${r.extraCount})`
                                    : ""
                                }`
                              : "ไม่มีคนใช้"}
                          </span>
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          <button
                            onClick={() => startEditRole(r)}
                            title="แก้ไขชื่อ role"
                            className="cursor-pointer rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteRole(r)}
                            disabled={inUse || deletingRoleId === r.id}
                            title={
                              inUse
                                ? "มี user ใช้ role นี้อยู่ ลบไม่ได้"
                                : "ลบ role"
                            }
                            className={`rounded-md border bg-white px-2.5 py-1 text-[11px] font-semibold ${
                              inUse
                                ? "cursor-not-allowed border-gray-200 text-gray-400"
                                : "cursor-pointer border-[#f5c2c7] text-[#842029] hover:bg-red-50"
                            }`}
                          >
                            {deletingRoleId === r.id ? "..." : "Delete"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
