import express from "express";
import cors from "cors";
import "dotenv/config";
import cookieParser from "cookie-parser";
import multer from "multer";

import authRouter from "./routes/authRoutes.js";
import userRouter from "./routes/userRoutes.js";

import trainingMatrixRoutes from "./routes/trainingMatrix.routes.js";
import workerRoutes from "./routes/workerRoutes.js";
import positionRoutes from "./routes/positionRoutes.js";
import trainingRoutes from "./routes/trainingMatrix.routes.js";

import complianceRoutes from "./routes/complianceRoutes.js";
import projectRoutes from "./routes/projectRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";
import allocationRoutes from "./routes/allocationRoutes.js";
import mobilizationRoutes from "./routes/mobilizationRoutes.js";

import reviewRoutes from "./routes/reviewRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";

import dashboardRoutes from "./routes/dashboardRoutes.js";

import divisionRoutes from "./routes/divisionRoutes.js";

import globalTrainingRoutes from "./routes/globalTrainingRoutes.js";

import notificationRoutes from "./routes/notificationRoutes.js";

import trainingRequestRoutes from "./routes/trainingRequestRoutes.js";
import medicalRequestRoutes from "./routes/medicalRequestRoutes.js";

import supervisorRoutes from "./routes/supervisorRoutes.js";

import projectMessageRoutes from "./routes/projectMessageRoutes.js";

import clientTrainingRoutes from "./routes/clientTrainingRoutes.js";

import employeeBanRoutes from "./routes/employeeBanRoutes.js";

import workerAppRoutes from "./routes/workerAppRoutes.js";

import employeePinRoutes from "./routes/employeePinRoutes.js";

import leaveRequestRoutes from "./routes/leaveRequestRoutes.js";

import matchExceptionRoutes from "./routes/matchExceptionRoutes.js";

import auditTrail from "./middleware/auditTrail.js";
import auditLogRoutes from "./routes/auditLogRoutes.js";
import { purgeOldAuditLogs } from "./utils/auditLogger.js";

import dataImportRoutes from "./routes/dataImportRoutes.js";

import { startNotificationJobs } from "./services/emailWorker.js";

import integrationRoutes from "./routes/integrationRoutes.js";   // ไว้กับ import อื่นๆ

// import safetyRouter from "./routes/safetyRoutes.js";
// import medicalRouter from "./routes/medicalRoutes.js";
// import requestRouter from "./routes/requestRoutes.js";

// import bookingRouter from "./routes/bookingRoutes.js";
// import vehicleRouter from "./routes/vehicleRoutes.js";
// import costRouter from "./routes/costRoutes.js";

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const port = process.env.PORT || 4000;
const allowedOrigins = [
  process.env.CLIENT_URL?.trim(),
  // "http://localhost:5173",
  "http://localhost:5175",
].filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
};

// middleware
app.use(express.json());
app.use(cookieParser());
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use("/api", auditTrail); // ← เพิ่ม: บันทึก audit log ทุก route ใต้ /api

// routes
app.get("/", (req, res) => res.send("API Working"));
app.use("/api/auth", authRouter);
app.use("/api/user", userRouter);
// ต้องอยู่ก่อน app.use("/api", clientTrainingRoutes) — route นั้นครอบทุก /api/* และตรวจ login ของ user
app.use("/api/integration", integrationRoutes);

// app.use("/uploads", express.static("uploads"));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api/training-matrix", trainingMatrixRoutes);
app.use("/api/workers", workerRoutes);
app.use("/api/positions", positionRoutes);
app.use("/api/trainings", trainingRoutes);

app.use("/api/compliance", complianceRoutes);

app.use("/api/projects", projectRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/allocation", allocationRoutes);
app.use("/api/match-exceptions", matchExceptionRoutes);
app.use("/api/mobilization", mobilizationRoutes);

app.use("/api/review", reviewRoutes);
app.use("/api/analytics", analyticsRoutes);

app.use("/api/dashboard", dashboardRoutes);

app.use("/api/divisions", divisionRoutes);

app.use("/api/global-trainings", globalTrainingRoutes);

app.use("/api/notifications", notificationRoutes);

app.use("/api/training-requests", trainingRequestRoutes);
app.use("/api/medical-requests", medicalRequestRoutes);

app.use("/api/supervisor", supervisorRoutes);

app.use("/api/project-messages", projectMessageRoutes);

app.use("/api", clientTrainingRoutes);

app.use("/api/employees", employeeBanRoutes);

app.use("/api/employees", employeePinRoutes); // ← เพิ่ม วางต่อจาก employeeBanRoutes ได้เลย
app.use("/api/leave-requests", leaveRequestRoutes); // ← เพิ่ม วางต่อจาก employeePinRoutes ได้เลย

app.use("/api/worker", workerAppRoutes); // ← เพิ่มบรรทัดนี้ (วางใกล้ๆ app.use("/api/employees", ...))

app.use("/api/audit-logs", auditLogRoutes);

app.use("/api/admin/import", dataImportRoutes);

// app.use("/api/safety", safetyRouter);
// app.use("/api/medical", medicalRouter);
// app.use("/api/request", requestRouter);

// AUDIT_RETENTION_DAYS ใน .env เช่น 730 (= 2 ปี) — ไม่ตั้ง = เก็บตลอด
const retention = Number(process.env.AUDIT_RETENTION_DAYS || 0);
if (retention > 0) {
  purgeOldAuditLogs(retention);
  setInterval(() => purgeOldAuditLogs(retention), 24 * 60 * 60 * 1000);
}

// start server
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
  // คิวอีเมลแจ้งเตือน + ตรวจเลยกำหนดตอบรับ (services/emailWorker.js)
  startNotificationJobs();
});

app.use((err, req, res, next) => {
  if (
    err instanceof multer.MulterError ||
    err.message?.includes("รองรับเฉพาะ")
  ) {
    return res.status(400).json({ message: err.message });
  }
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});
