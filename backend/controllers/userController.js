import prisma from "../config/prisma.js";
// บนสุดของไฟล์ เพิ่ม:
import bcrypt from "bcryptjs"; // ⚠ ใช้ตัวเดียวกับที่ authController ใช้ตอน login (ดูหมายเหตุ)
import {
  USER_ROLES_INCLUDE,
  USER_ROLES_LIGHT_INCLUDE,
  PRIMARY_ONLY_ROLES,
  roleNamesOf,
  permissionsOf,
  extraRolesOut,
} from "../utils/roles.js";
import { setAuditContext } from "../utils/auditLogger.js";

// ประกอบชื่อแสดงผลจาก ชื่อ + นามสกุล (User.name)
const composeName = (first, last) =>
  [first, last]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" ");

// ตัด field ลับออกก่อนส่งกลับ frontend
// extraRoles (ถ้า include มา) แปลงเป็น [{ id, name }]
const sanitizeUser = ({ password, resetOtp, resetOtpExpireAt, ...u }) =>
  u.extraRoles ? { ...u, extraRoles: extraRolesOut(u) } : u;

// =====================================================
// GET CURRENT USER
// =====================================================

export const getUserData = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },

      include: {
        ...USER_ROLES_INCLUDE, // role หลัก + role เสริม
        employee: true,
      },
    });

    if (!user) {
      return res.json({
        success: false,
        message: "User not found",
      });
    }

    return res.json({
      success: true,

      userData: {
        id: user.id,
        titlePrefix: user.titlePrefix,
        firstName: user.firstName,
        lastName: user.lastName,
        name: user.name,
        email: user.email,
        phone: user.phone,
        department: user.department,

        // role หลัก — โค้ดเดิมที่อ่าน userData.role ยังใช้ได้
        role: {
          id: user.role?.id,
          name: user.role?.name,
        },
        // role เสริม + ชื่อ role ทั้งหมด (หลักอยู่ตัวแรก) — เช็กสิทธิ์ด้วย roleNames
        extraRoles: extraRolesOut(user),
        roleNames: roleNamesOf(user),

        employee: user.employee,

        permissions: permissionsOf(user),
      },
    });
  } catch (error) {
    return res.json({
      success: false,
      message: error.message,
    });
  }
};

// =====================================================
// UPDATE PROFILE
// =====================================================

export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { firstName, lastName, name, phone, department, titlePrefix } =
      req.body;

    const data = { phone, department, titlePrefix };
    if (firstName !== undefined) {
      if (!firstName.trim()) {
        return res.json({ success: false, message: "กรุณากรอกชื่อ" });
      }
      data.firstName = firstName.trim();
      data.lastName = lastName?.trim() || null;
      data.name = composeName(firstName, lastName);
    } else if (name !== undefined) {
      data.name = name; // หน้า Profile เดิมที่ยังส่ง name มา — ยังใช้ได้
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data,
    });

    return res.json({ success: true, user: sanitizeUser(updatedUser) });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};

// =====================================================
// CHANGE PASSWORD (self-service — ต้องยืนยัน currentPassword ก่อนเสมอ)
// =====================================================

export const changePassword = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.json({
        success: false,
        message: "currentPassword และ newPassword จำเป็นต้องกรอก",
      });
    }
    if (newPassword.length < 8) {
      return res.json({
        success: false,
        message: "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร",
      });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.json({ success: false, message: "User not found" });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.json({
        success: false,
        message: "รหัสผ่านปัจจุบันไม่ถูกต้อง",
      });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });

    return res.json({ success: true });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};

// =====================================================
// UPDATE USER ROLE
// =====================================================

export const updateUserRole = async (req, res) => {
  try {
    const { userId, roleId } = req.body;

    if (req.user.id === userId) {
      return res.json({
        success: false,
        message: "Cannot change your own role",
      });
    }

    // role หลักใหม่ซ้ำกับ role เสริม → เอาออกจาก role เสริม
    const [, updatedUser] = await prisma.$transaction([
      prisma.userRole.deleteMany({ where: { userId, roleId } }),
      prisma.user.update({
        where: {
          id: userId,
        },

        data: {
          roleId,
        },
      }),
    ]);

    return res.json({
      success: true,
      user: sanitizeUser(updatedUser),
    });
  } catch (error) {
    return res.json({
      success: false,
      message: error.message,
    });
  }
};

// =====================================================
// GET ALL ROLES
// =====================================================

export const getAllRoles = async (req, res) => {
  try {
    const roles = await prisma.role.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { users: true, extraUsers: true } } },
    });

    return res.json({
      success: true,
      roles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        userCount: r._count.users + r._count.extraUsers, // นับทั้ง role หลักและ role เสริม
        primaryCount: r._count.users,
        extraCount: r._count.extraUsers,
      })),
    });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};

// =====================================================
// GET ALL USERS
// =====================================================

export const getAllUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: {
        ...USER_ROLES_LIGHT_INCLUDE,
        employee: true,
      },

      orderBy: {
        name: "asc",
      },
    });

    return res.json({
      success: true,
      users: users.map(sanitizeUser),
    });
  } catch (error) {
    return res.json({
      success: false,
      message: error.message,
    });
  }
};

// =====================================================
// CREATE USER
// =====================================================
export const createUser = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      roleId,
      employeeId,
      titlePrefix,
    } = req.body;
    if (!firstName?.trim() || !email || !password || !roleId) {
      return res.json({
        success: false,
        message: "ชื่อ, email, password, role จำเป็นต้องกรอก",
      });
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing)
      return res.json({ success: false, message: "Email already in use" });

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        firstName: firstName.trim(),
        lastName: lastName?.trim() || null,
        name: composeName(firstName, lastName),
        email,
        password: hashed,
        roleId,
        employeeId: employeeId || null,
        titlePrefix: titlePrefix || null,
      },
      include: { ...USER_ROLES_LIGHT_INCLUDE, employee: true },
    });
    return res.json({ success: true, user: sanitizeUser(user) });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};

// =====================================================
// DELETE USER
// =====================================================
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (req.user.id === id) {
      return res.json({
        success: false,
        message: "Cannot delete your own account",
      });
    }
    await prisma.user.delete({ where: { id } });
    return res.json({ success: true });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};

// =====================================================
// FORCE DELETE USER (DEV ONLY)
// ตัด/ลบ record ที่เกี่ยวข้องออกก่อน แล้วค่อยลบ user จริง
// หมายเหตุ: ถ้า user เคยสร้าง ManpowerRequest ไว้ จะยัง error อยู่
// เพราะ ManpowerRequest.requestedById เป็น field บังคับ (ไม่ nullable)
// — ตั้งใจปล่อยให้ error ตรงนี้ เพื่อกันไม่ให้ข้อมูล request ในระบบ
// เสียหายโดยไม่ตั้งใจ ถ้าเจอกรณีนี้ต้องจัดการ request เหล่านั้นด้วยมือก่อน
// =====================================================
export const forceDeleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (req.user.id === id) {
      return res.json({
        success: false,
        message: "Cannot delete your own account",
      });
    }

    await prisma.$transaction([
      prisma.notification.deleteMany({ where: { userId: id } }),
      prisma.workflowLog.updateMany({
        where: { userId: id },
        data: { userId: null },
      }),
      prisma.clientApproval.updateMany({
        where: { decidedById: id },
        data: { decidedById: null },
      }),
      prisma.performanceReview.updateMany({
        where: { reviewedById: id },
        data: { reviewedById: null },
      }),
      prisma.trainingRequestBatch.updateMany({
        where: { requestedById: id },
        data: { requestedById: null },
      }),
      prisma.projectMessage.deleteMany({ where: { senderId: id } }),
      prisma.user.delete({ where: { id } }),
    ]);

    return res.json({ success: true });
  } catch (error) {
    return res.json({
      success: false,
      message:
        error.code === "P2003"
          ? "ลบไม่สำเร็จ — user นี้เคยสร้าง ManpowerRequest ไว้ ต้องจัดการ request เหล่านั้นก่อน"
          : error.message,
    });
  }
};

// =====================================================
// LINK / UNLINK EMPLOYEE (employeeId = null เพื่อ unlink)
// =====================================================
export const updateUserEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const { employeeId } = req.body;
    const user = await prisma.user.update({
      where: { id },
      data: { employeeId: employeeId || null },
      include: { ...USER_ROLES_LIGHT_INCLUDE, employee: true },
    });
    return res.json({ success: true, user: sanitizeUser(user) });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};

// =====================================================
// AVAILABLE EMPLOYEES (ยังไม่ผูกกับ user คนไหน)
// =====================================================
export const getAvailableEmployees = async (req, res) => {
  try {
    const employees = await prisma.employee.findMany({
      where: { user: null }, // User.employeeId @unique → back-relation
      select: { id: true, empCode: true, fullName: true },
      orderBy: { fullName: "asc" },
    });
    return res.json({ success: true, employees });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};

// =====================================================
// CREATE ROLE
// =====================================================
export const createRole = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.json({ success: false, message: "Role name is required" });
    }
    const normalized = name.trim().toLowerCase();

    const existing = await prisma.role.findUnique({
      where: { name: normalized },
    });
    if (existing) {
      return res.json({ success: false, message: "Role already exists" });
    }

    const role = await prisma.role.create({ data: { name: normalized } });
    return res.json({ success: true, role });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};

// =====================================================
// UPDATE ROLE (rename) — ไม่กระทบ user ที่ผูกอยู่ เพราะผูกด้วย roleId ไม่ใช่ name
// =====================================================
export const updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.json({ success: false, message: "Role name is required" });
    }
    const normalized = name.trim().toLowerCase();

    const existing = await prisma.role.findUnique({
      where: { name: normalized },
    });
    if (existing && existing.id !== id) {
      return res.json({ success: false, message: "Role name already exists" });
    }

    const role = await prisma.role.update({
      where: { id },
      data: { name: normalized },
    });
    return res.json({ success: true, role });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};

// =====================================================
// DELETE ROLE
// กันลบถ้ายังมี user ผูกกับ role นี้อยู่ (ป้องกัน user เหลือ roleId ชี้ไป role ที่ไม่มีอยู่จริง)
// =====================================================
export const deleteRole = async (req, res) => {
  try {
    const { id } = req.params;

    const userCount =
      (await prisma.user.count({ where: { roleId: id } })) +
      (await prisma.userRole.count({ where: { roleId: id } })); // role เสริมด้วย
    if (userCount > 0) {
      return res.json({
        success: false,
        message: `ลบไม่ได้ — มี ${userCount} user ใช้ role นี้อยู่ กรุณาเปลี่ยน role ของ user เหล่านั้นก่อน`,
      });
    }

    // กันลบ role ที่ยังผูก permission อยู่ (ล้าง RolePermission ก่อน)
    await prisma.rolePermission.deleteMany({ where: { roleId: id } });
    await prisma.role.delete({ where: { id } });

    return res.json({ success: true });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};

// =====================================================
// UPDATE USER (ADMIN) — แก้ name/email/titlePrefix ของ user คนอื่น
// =====================================================
export const updateUserByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, email, titlePrefix } = req.body;

    if (!firstName?.trim() || !email) {
      return res.json({
        success: false,
        message: "ชื่อ และ email จำเป็นต้องกรอก",
      });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && existing.id !== id) {
      return res.json({ success: false, message: "Email นี้มีคนใช้แล้ว" });
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        firstName: firstName.trim(),
        lastName: lastName?.trim() || null,
        name: composeName(firstName, lastName),
        email,
        titlePrefix: titlePrefix || null,
      },
      include: { ...USER_ROLES_LIGHT_INCLUDE, employee: true },
    });

    return res.json({ success: true, user: sanitizeUser(updatedUser) });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};

// =====================================================
// UPDATE EXTRA ROLES (ADMIN) — ตั้ง role เสริมทั้งชุด
// body: { roleIds: [...] } — ส่ง [] เพื่อลบ role เสริมทั้งหมด
// =====================================================
export const updateUserExtraRoles = async (req, res) => {
  try {
    const { id } = req.params;
    const { roleIds } = req.body;

    if (!Array.isArray(roleIds)) {
      return res.json({ success: false, message: "roleIds ต้องเป็น array" });
    }
    if (req.user.id === id) {
      return res.json({
        success: false,
        message: "Cannot change your own role",
      });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.json({ success: false, message: "User not found" });
    }

    // ไม่ซ้ำ และไม่ซ้ำกับ role หลัก
    const wanted = [...new Set(roleIds.filter(Boolean))].filter(
      (rid) => rid !== user.roleId,
    );

    const roles = await prisma.role.findMany({ where: { id: { in: wanted } } });
    if (roles.length !== wanted.length) {
      return res.json({ success: false, message: "มี role ที่ไม่พบในระบบ" });
    }
    const blocked = roles.filter((r) => PRIMARY_ONLY_ROLES.includes(r.name));
    if (blocked.length) {
      return res.json({
        success: false,
        message: `role "${blocked[0].name}" ต้องตั้งเป็น role หลักเท่านั้น`,
      });
    }

    await prisma.$transaction([
      prisma.userRole.deleteMany({ where: { userId: id } }),
      ...(wanted.length
        ? [
            prisma.userRole.createMany({
              data: wanted.map((roleId) => ({ userId: id, roleId })),
            }),
          ]
        : []),
    ]);

    const updated = await prisma.user.findUnique({
      where: { id },
      include: { ...USER_ROLES_LIGHT_INCLUDE, employee: true },
    });
    return res.json({ success: true, user: sanitizeUser(updated) });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};

// =====================================================
// UNLOCK LOGIN (ADMIN) — ปลดล็อกบัญชีที่ใส่รหัสผ่านผิดครบ 5 ครั้ง ไม่ต้องรอ 15 นาที
// ใช้เมื่อยืนยันแล้วว่าเป็นเจ้าของบัญชีจำรหัสผิดเอง (ไม่ใช่คนอื่นพยายามเข้า)
// =====================================================
export const unlockUserLogin = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true },
    });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    await prisma.user.update({
      where: { id },
      // failedSinceLastLogin ไม่ล้าง — เจ้าของบัญชียังเห็นแจ้งเตือนว่ามีการใส่รหัสผิดตอนล็อกอินครั้งถัดไป
      data: { failedLoginAttempts: 0, loginLockedUntil: null },
    });

    setAuditContext(req, {
      summary: `ปลดล็อกบัญชี ${user.name || ""} (${user.email})`.trim(),
      resourceId: user.id,
    });

    return res.json({ success: true, message: "ปลดล็อกบัญชีแล้ว" });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};
