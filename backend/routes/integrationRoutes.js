import express from "express";
import * as controller from "../controllers/integrationController.js";
import serviceAuth from "../middleware/serviceAuth.js";

const router = express.Router();

// ── PTA (Timesheet) — อ่านอย่างเดียว ใช้ service token ไม่ใช่ login ──
router.get(
  "/pta/master-data",
  serviceAuth("PTA_SERVICE_TOKEN"),
  controller.getPtaMasterData,
);

export default router;
