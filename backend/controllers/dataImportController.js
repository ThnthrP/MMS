// ============================================================
// controllers/dataImportController.js
// POST /api/admin/import/employee-trainings?dryRun=1   → preview (ไม่เขียน DB)
// POST /api/admin/import/employee-trainings            → นำเข้าจริง
// POST /api/admin/import/pe-tracking?dryRun=1          → preview ผลตรวจสุขภาพ (PE tracking)
// POST /api/admin/import/pe-tracking                   → นำเข้าจริง
// ไฟล์ประมวลผลใน memory เท่านั้น — ไม่บันทึกลง disk (มีข้อมูลส่วนบุคคล)
// ============================================================
import { runTrainingImport } from "../services/trainingImportService.js";
import { runPeTrackingImport } from "../services/peTrackingImportService.js";
import { setAuditContext } from "../utils/auditLogger.js";

export async function importEmployeeTrainings(req, res) {
  const flag = (v) => ["1", "true", "yes"].includes(String(v || "").toLowerCase());
  const dryRun = flag(req.query.dryRun);
  const createMissing = flag(req.query.createMissing);
  // โหมด multi-client: ลูกค้าของไฟล์ (ใช้ contract ของลูกค้านั้นจับคู่ชื่อ training) · ไม่ส่ง = Chevron
  const clientName = String(req.query.clientName || "").trim().slice(0, 100) || undefined;

  // preview ไม่ต้องลง audit log
  if (dryRun) setAuditContext(req, { skip: true });

  if (!req.file) {
    return res.status(400).json({ success: false, message: "กรุณาเลือกไฟล์ Excel (.xlsx / .xls)" });
  }

  // multer ส่งชื่อไฟล์ภาษาไทยมาเป็น latin1 → แปลงกลับเป็น utf8
  const fileName = Buffer.from(req.file.originalname, "latin1").toString("utf8");

  try {
    const report = await runTrainingImport({
      buffer: req.file.buffer,
      fileName,
      dryRun,
      createMissing,
      clientName,
    });

    if (!dryRun) {
      const c = report.counts;
      setAuditContext(req, {
        summary:
          `นำเข้า Training Record "${fileName}" (${report.client}) — ` +
          `พนักงาน ${report.employeesMatched} คน` +
          (c.employeeCreate ? `, สร้างพนักงานใหม่ ${c.employeeCreate} คน` : "") +
          `, training ใหม่ ${c.trainingCreate}, อัปเดต ${c.trainingUpdate}, ` +
          `medical ${c.medicalCreate + c.medicalUpdate}, passport ${c.passportUpsert}` +
          (c.errors ? `, error ${c.errors}` : ""),
      });
    }

    return res.json({
      success: true,
      message: dryRun ? "ตรวจสอบไฟล์เรียบร้อย (ยังไม่บันทึก)" : "นำเข้าข้อมูลเรียบร้อย",
      data: report,
    });
  } catch (err) {
    console.error("importEmployeeTrainings:", err);
    return res.status(400).json({ success: false, message: err.message || "นำเข้าไม่สำเร็จ" });
  }
}

// ── PE tracking (ผลตรวจสุขภาพประจำปี) ──
export async function importPeTracking(req, res) {
  const flag = (v) => ["1", "true", "yes"].includes(String(v || "").toLowerCase());
  const dryRun = flag(req.query.dryRun);
  const createMissing = flag(req.query.createMissing);
  if (dryRun) setAuditContext(req, { skip: true });

  if (!req.file) {
    return res.status(400).json({ success: false, message: "กรุณาเลือกไฟล์ Excel (.xlsx / .xls)" });
  }
  const fileName = Buffer.from(req.file.originalname, "latin1").toString("utf8");

  try {
    const report = await runPeTrackingImport({ buffer: req.file.buffer, fileName, dryRun, createMissing });

    if (!dryRun) {
      const c = report.counts;
      setAuditContext(req, {
        summary:
          `นำเข้า PE Tracking "${fileName}" — พนักงาน ${report.employeesMatched} คน, ` +
          (c.employeeCreate ? `สร้างพนักงานใหม่ ${c.employeeCreate} คน, ` : "") +
          `PE ใหม่ ${c.examCreate}, อัปเดต ${c.examUpdate}, Medical Check-up ${c.medicalSync}, ` +
          `Permanent ${c.permanentSet}, NEW SSE ${c.newSseSet}` +
          (c.errors ? `, error ${c.errors}` : ""),
      });
    }

    return res.json({
      success: true,
      message: dryRun ? "ตรวจสอบไฟล์เรียบร้อย (ยังไม่บันทึก)" : "นำเข้าข้อมูลเรียบร้อย",
      data: report,
    });
  } catch (err) {
    console.error("importPeTracking:", err);
    return res.status(400).json({ success: false, message: err.message || "นำเข้าไม่สำเร็จ" });
  }
}
