// ============================================================
// sidebarMenu.js
// Experteam Manpower Management System (MMS) - Production Ready
// ============================================================
//
// เมนูจัดตาม flow ISO / โปรแกรมตัวอย่างของลูกค้า แบ่ง section ตามช่วงของ flow:
//   OVERVIEW      My Dashboard · Compliance · Reports
//   OPERATIONS    Projects & Positions · Manpower Requirements · Assign Names ·
//                 Manpower Calendar · Bookings · Training Plan ·
//                 Worker Schedule · Worker Pool   (ISO 1–12)
//   SETTINGS      Training Matrix · Departments
//   ADMIN         Users & Roles · Audit Log · Data Import (admin เท่านั้น)
//
// 1 เมนู = หลายหน้าเดิมได้ (tabs) — แสดงเป็นแท็บด้านบนของหน้า (MenuTabs.jsx)
// URL ของทุกหน้ายังเหมือนเดิม → ลิงก์ในแจ้งเตือน / bookmark เดิมใช้ได้ต่อ
//
// สิทธิ์: กำหนดที่ tab — เมนูจะแสดงถ้ามีอย่างน้อย 1 tab ที่ role เข้าได้
// และกดเมนูแล้วไปที่ tab แรกที่ role นั้นเข้าได้
// ⚠ enforcement จริงอยู่ที่ allowRoles ใน AppRouter.jsx — ต้อง sync กันเสมอ
//
// ── Role scheme (9 roles ปัจจุบันในระบบ) ──
//   admin, project_engineer, manpower_supply, hr_supervisor,
//   personal_record_officer, hr_officer, safety_manager, safety_officer,
//   training_officer
// ============================================================

import {
  LayoutDashboard,
  CalendarRange,
  BarChart3,
  BadgeCheck,
  ClipboardList,
  UserPlus,
  GraduationCap,
  ClipboardCheck,
  Ship,
  Users,
  Settings2,
  ListChecks,
  Building2,
  ShieldCheck,
  History,
  Upload,
} from "lucide-react";

// ── ชุด role ที่ใช้ซ้ำ (ตรงกับ allowRoles ใน AppRouter.jsx) ──
const HR_CORE = [
  "admin",
  "manpower_supply",
  "hr_supervisor",
  "personal_record_officer",
  "hr_officer",
  "training_officer",
];

const R = {
  dashboard: [...HR_CORE, "safety_manager", "safety_officer"],
  compliance: [...HR_CORE, "safety_manager"],
  reports: HR_CORE,
  projects: [...HR_CORE, "project_engineer", "safety_manager"],
  allocation: [...HR_CORE, "project_engineer", "safety_manager"],
  peApprovals: [...HR_CORE, "project_engineer"],
  projectsOverview: [...HR_CORE, "project_engineer"],
  workers: [...HR_CORE, "safety_manager"],
  mobilization: [
    ...HR_CORE,
    "project_engineer",
    "safety_manager",
    "safety_officer",
  ],
  review: [...HR_CORE, "project_engineer"],
  requests: HR_CORE,
  certifications: [...HR_CORE, "safety_manager"],
  settings: HR_CORE,
  admin: ["admin"],
};

// item: { name, icon (lucide-react), tabs, badge? }
// tab: { name, path, roles, prefixes? }
//   prefixes = หน้าลูกที่ถือว่าอยู่ใต้ tab นี้ (เช่น /workers/:id) — ใช้ไฮไลต์เมนู
export const APP_MENU = [
  // ── ภาพรวม: ดูสถานะ / ใบรับรอง / รายงาน ──
  {
    section: "OVERVIEW",
    items: [
      {
        name: "My Dashboard",
        icon: LayoutDashboard,
        tabs: [{ name: "Overview", path: "/", roles: R.dashboard }],
        badge: true,
      },
      // ใบรับรอง/ผลตรวจสุขภาพรายคน — HR ใช้ทุกวัน (เดิมเป็นแท็บใต้ My Dashboard)
      {
        name: "Compliance",
        icon: BadgeCheck,
        tabs: [{ name: "Compliance Center", path: "/compliance", roles: R.compliance }],
      },
      // รายงานสรุปของผู้บริหาร (เดิมเป็นแท็บ Reports ใต้ My Dashboard — หายาก)
      // ปลายทางของ flow: หลังประเมิน (Post-Project Review) และปิดโปรเจกต์ → ดูภาพรวมรายไตรมาส/ปี
      {
        name: "Reports",
        icon: BarChart3,
        tabs: [{ name: "Analytics & Reports", path: "/reports", roles: R.reports }],
      },
    ],
  },

  // ── งานหลัก (ISO ขั้น 1–12) เรียงตาม flow เป็นกลุ่มเดียว — แบบโปรแกรมตัวอย่าง ──
  //   ลูกค้าแจ้งความต้องการ → จัดรายชื่อ (+ ตรวจวันว่างใน Manpower Calendar)
  //   → อบรม/ตรวจสุขภาพ → ลงงาน/รับกลับ/ประเมิน → ข้อมูลพนักงาน
  {
    section: "OPERATIONS",
    items: [
      // จุดเริ่มของ flow: ON Number (Master Project Register) → + New requirement
      {
        name: "Projects & Positions",
        icon: Settings2,
        tabs: [
          { name: "Projects", path: "/projects", roles: R.projects },
          { name: "Positions", path: "/positions", roles: R.settings },
        ],
      },
      {
        name: "Manpower Requirements",
        icon: ClipboardList,
        tabs: [
          {
            // รายการตำแหน่งที่ขอทั้งหมด (แบบโปรแกรมตัวอย่าง) — คลิกแถว → /projects/:id
            name: "Requirements",
            path: "/requirements",
            roles: R.projects,
            prefixes: ["/projects/"],
          },
        ],
      },
      {
        name: "Assign Names",
        icon: UserPlus,
        tabs: [
          { name: "Assign Names", path: "/allocation", roles: R.allocation },
          { name: "PE Approvals", path: "/pe-approvals", roles: R.peApprovals },
        ],
      },
      {
        name: "Manpower Calendar",
        icon: CalendarRange,
        tabs: [
          {
            name: "Manpower Calendar",
            path: "/projects-overview",
            roles: R.projectsOverview,
            prefixes: ["/projects-overview/"],
          },
        ],
      },
      // คำขอถึง HR: ขออบรม / ขอตรวจสุขภาพ — ติดตามสถานะ + ส่งคำขอใหม่
      {
        name: "Bookings",
        icon: ClipboardCheck,
        tabs: [
          {
            name: "Training Bookings",
            path: "/requests-history",
            roles: R.requests,
            prefixes: ["/training-requests/"],
          },
          {
            name: "Medical Bookings",
            path: "/medical-bookings",
            roles: R.requests,
            prefixes: ["/medical-requests/"],
          },
          // เลือกหลักสูตร → ดูว่าใครมี / หมดอายุ / ยังไม่มี → ส่งคำขออบรม (เดิมแท็บ Training Courses)
          { name: "Request Training", path: "/certifications", roles: R.certifications },
        ],
      },
      // อบรมที่กำลังดำเนินอยู่ / กำลังจะเริ่ม → อบรมเสร็จ → บันทึกผล (cert) เข้าระบบ
      {
        name: "Training Plan",
        icon: GraduationCap,
        tabs: [
          { name: "Training Calendar", path: "/training-plan", roles: R.certifications },
          { name: "บันทึกผลอบรม", path: "/certifications/bulk-add", roles: R.requests },
          { name: "เพิ่มแผนอบรม", path: "/training-plan/new", roles: R.requests },
        ],
      },
      {
        name: "Worker Schedule",
        icon: Ship,
        tabs: [
          { name: "Mobilization", path: "/mobilization", roles: R.mobilization },
          { name: "Post-Project Review", path: "/review", roles: R.review },
        ],
      },
      {
        name: "Worker Pool",
        icon: Users,
        tabs: [
          {
            name: "Workers",
            path: "/workers",
            roles: R.workers,
            prefixes: ["/workers/"], // รวม /workers/add, /workers/:id, /workers/:id/edit
          },
        ],
      },
    ],
  },

  // ── ข้อมูลตั้งต้น: เซ็ตตอนเริ่ม นานๆ แก้ที ──
  {
    section: "SETTINGS",
    items: [
      // ข้อกำหนด training ของลูกค้า — ดู (Matrix) → แก้ (Matrix Editor) → รายการ training กลาง
      {
        name: "Training Matrix",
        icon: ListChecks,
        tabs: [
          { name: "Training Matrix", path: "/training-matrix", roles: R.settings },
          { name: "Matrix Editor", path: "/positions/matrix", roles: R.settings },
          { name: "Trainings", path: "/trainings", roles: R.settings },
        ],
      },
      // ตัวเลือกแผนกในฟอร์มพนักงาน — หน้าเดียว
      {
        name: "Departments",
        icon: Building2,
        tabs: [{ name: "Departments", path: "/divisions", roles: R.settings }],
      },
    ],
  },

  // ── ADMIN: เครื่องมือผู้ดูแลระบบ — ไม่อยู่ใน flow งานปกติ ──
  {
    section: "ADMIN",
    items: [
      {
        name: "Users & Roles",
        icon: ShieldCheck,
        tabs: [
          { name: "Users", path: "/users", roles: R.admin },
          {
            name: "Bulk Set PIN",
            path: "/workers/bulk-set-pin",
            roles: R.admin,
          },
        ],
      },
      {
        name: "Audit Log",
        icon: History,
        tabs: [{ name: "Audit Log", path: "/audit-logs", roles: R.admin }],
      },
      {
        name: "Data Import",
        icon: Upload,
        tabs: [{ name: "Data Import", path: "/data-import", roles: R.admin }],
      },
    ],
  },
];

// ══════════════════════════════════════════════════════════
// helpers — ใช้ร่วมกันใน Sidebar.jsx และ MenuTabs.jsx
// ══════════════════════════════════════════════════════════

// role ทั้งหมดของ user (role หลัก + role เสริม ถ้ามี)
export const userRoleNames = (user) =>
  Array.isArray(user?.roleNames)
    ? user.roleNames
    : [user?.role?.name, ...(user?.extraRoles || []).map((r) => r?.name)].filter(
        Boolean,
      );

export const canSee = (roles, user) =>
  !roles || userRoleNames(user).some((r) => roles.includes(r));

// tab ที่ user เข้าได้ของเมนูนั้น
export const visibleTabs = (item, user) =>
  item.tabs.filter((t) => canSee(t.roles, user));

// หา { item, tab } ของ path ปัจจุบัน — ตรงตัวก่อน แล้วค่อยดู prefixes
// (กัน /workers/bulk-set-pin ไปตกที่ Worker Pool เพราะ prefix /workers/)
export const findMenuEntry = (pathname) => {
  const all = APP_MENU.flatMap((g) =>
    g.items.flatMap((item) => item.tabs.map((tab) => ({ item, tab }))),
  );
  return (
    all.find(({ tab }) => tab.path === pathname) ||
    all.find(({ tab }) =>
      (tab.prefixes || []).some((p) => pathname.startsWith(p)),
    ) ||
    null
  );
};
