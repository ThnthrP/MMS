import express from "express";
import * as controller from "../controllers/trainingRequestController.js";
import userAuth from "../middleware/userAuth.js";
import requireRole from "../middleware/requireRole.js";
import { getTrainingItems } from "../controllers/bookingListController.js";
import { ROLE_GROUPS } from "../utils/roles.js";

const router = express.Router();
router.use(userAuth);

// role ที่ส่งคำขอได้
const REQUESTER_ROLES = [
  ...new Set(["admin", ...ROLE_GROUPS.HR, ...ROLE_GROUPS.MP, "safety_manager"]),
];
// role ที่จัดการคำขอ (ดูรายการ / ยืนยัน / ปฏิเสธ)
const HR_ROLES = ["admin", ...ROLE_GROUPS.HR];

// ต้องอยู่ก่อน "/:id" — ไม่งั้น "availability" ถูกตีความเป็น id
// ใช้ทั้งการ์ด Request training และ Request medical (เตือนคนที่ติดงานช่วงนั้น)
// รายการรายคน (หน้า Training Bookings) — ต้องอยู่ก่อน "/:id"
router.get("/items", requireRole(...HR_ROLES), getTrainingItems);

router.get(
  "/availability",
  requireRole(...REQUESTER_ROLES),
  controller.getAvailability,
);

router.get("/:id", controller.getBatch); // ทุก role login แล้วดูได้

router.post("/", requireRole(...REQUESTER_ROLES), controller.createBatch);

// list ทั้งหมด — กลุ่ม HR เท่านั้น
router.get("/", requireRole(...HR_ROLES), controller.getAllBatches);

router.patch("/:id", requireRole(...HR_ROLES), controller.updateStatus);
router.patch("/:id/items", requireRole(...HR_ROLES), controller.decideItems);

export default router;
