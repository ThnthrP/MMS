import express from "express";

import userAuth from "../middleware/userAuth.js";
import authorize from "../middleware/authorize.js";

import {
  getUserData,
  updateProfile,
  changePassword, // ← เพิ่ม
  updateUserRole,
  updateUserExtraRoles, // ← role เสริม
  updateUserByAdmin,
  getAllRoles,
  getAllUsers,
  createUser,
  deleteUser,
  forceDeleteUser, // ← เพิ่ม
  updateUserEmployee,
  getAvailableEmployees,
  createRole,
  updateRole, // ← เพิ่ม
  deleteRole,
  unlockUserLogin, // ← ปลดล็อกบัญชีที่ใส่รหัสผิดครบ 5 ครั้ง
} from "../controllers/userController.js";

const userRouter = express.Router();

// =====================================================
// Current User
// =====================================================

userRouter.get("/data", userAuth, getUserData);

userRouter.put("/update", userAuth, updateProfile);

userRouter.put("/change-password", userAuth, changePassword);

// =====================================================
// Admin
// =====================================================

userRouter.put(
  "/role",
  userAuth,
  authorize("system", "manage"),
  updateUserRole,
);

userRouter.get("/roles", userAuth, authorize("system", "manage"), getAllRoles);

userRouter.get("/all", userAuth, authorize("system", "manage"), getAllUsers);

// Admin — เพิ่มต่อจากของเดิม
userRouter.post("/", userAuth, authorize("system", "manage"), createUser);
userRouter.delete("/:id", userAuth, authorize("system", "manage"), deleteUser);
userRouter.delete(
  "/:id/force",
  userAuth,
  authorize("system", "manage"),
  forceDeleteUser,
);
userRouter.put(
  "/:id",
  userAuth,
  authorize("system", "manage"),
  updateUserByAdmin,
);
userRouter.put(
  "/:id/employee",
  userAuth,
  authorize("system", "manage"),
  updateUserEmployee,
);
// role เสริม — body: { roleIds: [...] } (ตั้งทั้งชุด)
userRouter.put(
  "/:id/extra-roles",
  userAuth,
  authorize("system", "manage"),
  updateUserExtraRoles,
);
// ปลดล็อกบัญชีที่ใส่รหัสผ่านผิดครบ 5 ครั้ง (ไม่ต้องรอ 15 นาที)
userRouter.put(
  "/:id/unlock-login",
  userAuth,
  authorize("system", "manage"),
  unlockUserLogin,
);
userRouter.get(
  "/available-employees",
  userAuth,
  authorize("system", "manage"),
  getAvailableEmployees,
);

userRouter.post("/roles", userAuth, authorize("system", "manage"), createRole);
userRouter.put(
  "/roles/:id",
  userAuth,
  authorize("system", "manage"),
  updateRole,
);
userRouter.delete(
  "/roles/:id",
  userAuth,
  authorize("system", "manage"),
  deleteRole,
);

export default userRouter;
