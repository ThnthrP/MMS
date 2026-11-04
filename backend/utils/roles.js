// ============================================================
// roles.js — 1 user มีได้หลาย role
//   role หลัก  = User.roleId (user.role)
//   role เสริม = UserRole (user.extraRoles[].role)
// สิทธิ์ของ user = รวมทุก role — เช็ก role ผ่าน helper ในไฟล์นี้เสมอ
// อย่าเช็ก user.role.name ตรงๆ (จะเห็นแค่ role หลัก)
// ============================================================

// role ที่ห้ามเป็น role เสริม — ต้องตั้งเป็น role หลักเท่านั้น
export const PRIMARY_ONLY_ROLES = ["admin"];

const PERMISSIONS_INCLUDE = {
  permissions: { include: { permission: true } },
};

// include สำหรับ prisma.user.find* เมื่อต้องการ role ทั้งหมด + permission
export const USER_ROLES_INCLUDE = {
  role: { include: PERMISSIONS_INCLUDE },
  extraRoles: { include: { role: { include: PERMISSIONS_INCLUDE } } },
};

// include แบบเบา (ไม่เอา permission) — ใช้ในรายการ user
export const USER_ROLES_LIGHT_INCLUDE = {
  role: true,
  extraRoles: { include: { role: true } },
};

// ชื่อ role ทั้งหมดของ user — role หลักอยู่ตัวแรก
export const roleNamesOf = (user) => {
  if (Array.isArray(user?.roleNames)) return user.roleNames;
  const names = [];
  if (user?.role?.name) names.push(user.role.name);
  for (const ur of user?.extraRoles || []) {
    const n = ur?.role?.name;
    if (n && !names.includes(n)) names.push(n);
  }
  return names;
};

export const hasRole = (user, roleName) => roleNamesOf(user).includes(roleName);

export const hasAnyRole = (user, roleList = []) =>
  roleNamesOf(user).some((r) => roleList.includes(r));

// สิทธิ์รวมจากทุก role (ไม่ซ้ำ) — รูปแบบ "resource:action"
export const permissionsOf = (user) => {
  const set = new Set();
  const roles = [user?.role, ...(user?.extraRoles || []).map((ur) => ur?.role)];
  for (const r of roles) {
    for (const rp of r?.permissions || []) {
      if (rp?.permission) set.add(`${rp.permission.resource}:${rp.permission.action}`);
    }
  }
  return [...set];
};

// ข้อความแสดง role เช่น "manpower_supply + project_engineer" (ใช้ใน Audit Log)
export const roleLabel = (user) => roleNamesOf(user).join(" + ");

// where ของ prisma.user — user ที่มี roleName เป็น role หลัก "หรือ" role เสริม
export const userHasRoleWhere = (roleName) => ({
  OR: [
    { role: { name: roleName } },
    { extraRoles: { some: { role: { name: roleName } } } },
  ],
});

// role เสริมในรูปแบบที่ส่งให้ frontend: [{ id, name }]
export const extraRolesOut = (user) =>
  (user?.extraRoles || [])
    .map((ur) => ur?.role)
    .filter(Boolean)
    .map((r) => ({ id: r.id, name: r.name }));

// ── กลุ่ม role สำหรับแจ้งเตือน / สิทธิ์ — แก้ที่นี่ที่เดียว ──
export const ROLE_GROUPS = {
  HR: ["hr_officer", "hr_supervisor", "personal_record_officer", "training_officer"],
  MP: ["manpower_supply", "project_engineer"],
  SAFETY: ["safety_officer", "safety_manager"],
};
