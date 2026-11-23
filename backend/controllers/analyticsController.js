import * as service from "../services/analyticsService.js";
import { PrismaClient } from "@prisma/client";
import { buildPeTrackingWorkbook } from "../scripts/chevron/lib/buildPeTrackingWorkbook.js";

const prisma = new PrismaClient();

// GET /api/analytics?clientId=...  (clientId optional — โหมด multi: นับ Projects เฉพาะลูกค้านั้น)
export async function getAnalytics(req, res) {
  try {
    const { clientId } = req.query;
    const data = await service.getAnalytics({ clientId });
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
}

// GET /api/analytics/deployment?year=2026&quarter=3&clientId=...
//   quarter optional — ไม่ใส่ = ทั้งปี, ไม่ใส่ year เลย = all-time
//   clientId optional — ไม่ใส่ = ทุกลูกค้า
export async function getDeploymentReport(req, res) {
  try {
    const { year, quarter, clientId } = req.query;
    const data = await service.getDeploymentReport({ year, quarter, clientId });
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
}

// GET /api/analytics/export-pe-tracking
// Streams an .xlsx reconstructing the original "PE tracking" file from
// the latest MedicalExamRecord per employee. See
// scripts/chevron/lib/peTrackingColumns.js for documented gaps
// (col E, cols AL–AO cannot be recovered from the current schema).
export async function exportPeTracking(req, res) {
  try {
    const workbook = await buildPeTrackingWorkbook(prisma);

    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="PE-tracking-export-${dateStr}.xlsx"`,
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
}
