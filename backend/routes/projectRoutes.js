import express from "express";
import * as controller from "../controllers/projectController.js";
import userAuth from "../middleware/userAuth.js";

const router = express.Router();

// ต้อง login ก่อนถึงจะเรียก route ใดๆ ในไฟล์นี้ได้
router.use(userAuth);

router.get("/master-records/years", controller.getMasterProjectYears);
router.get("/master-records/browse", controller.browseMasterProjectRecords);
router.get("/master-records", controller.searchMasterProjectRecords); // ← ต้องอยู่ก่อน "/:id"
router.get("/deletable", controller.getDeletableProjects); // ← ต้องอยู่ก่อน "/:id"
router.get("/", controller.getProjects);
router.get("/:id", controller.getProjectById);

// ── Write — ยกเลิกจำกัด role ──
router.post("/", controller.createProject);
router.put("/:id", controller.updateProject);
// ลบ project: controller เช็คเอง — เฉพาะ admin ที่เป็นผู้สร้าง project (ดูจาก Audit Log)
router.delete("/:id", controller.deleteProject);

router.post("/:id/requests", controller.addProjectRequest);
router.put("/:id/requests/:requestId", controller.updateProjectRequest);
router.delete("/:id/requests/:requestId", controller.deleteProjectRequest);

export default router;
