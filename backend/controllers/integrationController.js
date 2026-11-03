// ============================================================
// controllers/integrationController.js
// ข้อมูลที่ระบบอื่นดึงจาก MMS — ส่งเฉพาะที่จำเป็น
// ห้ามเพิ่มข้อมูลสุขภาพ / เบอร์โทร / เลขบัตร / PIN ลงใน response
// ============================================================
import prisma from "../config/prisma.js";

// GET /api/integration/pta/master-data
// positions → PTA Trade, employees (active) → PTA Worker, projects (active + มีรหัส ON) → PTA Project
export async function getPtaMasterData(req, res) {
  try {
    const [positions, employees, projects] = await Promise.all([
      prisma.position.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.employee.findMany({
        where: { status: "active" },
        select: { id: true, empCode: true, fullName: true, positionId: true },
        orderBy: { fullName: "asc" },
      }),
      prisma.project.findMany({
        where: { status: "active", masterProjectRecordId: { not: null } },
        select: {
          id: true,
          name: true,
          masterProjectRecord: { select: { projectCode: true, jobTitle: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    // หลาย Project ใน MMS อาจผูกรหัส ON เดียวกัน → PTA ใช้รหัส ON เป็น key จึงรวมเป็นรายการเดียว
    const byCode = new Map();
    for (const p of projects) {
      const code = p.masterProjectRecord?.projectCode?.trim();
      if (!code || byCode.has(code)) continue;
      byCode.set(code, {
        code,
        name: p.masterProjectRecord.jobTitle?.trim() || p.name,
      });
    }

    res.json({
      generatedAt: new Date().toISOString(),
      positions,
      employees: employees.map((e) => ({
        id: e.id,
        empCode: e.empCode,
        name: e.fullName,
        positionId: e.positionId,
      })),
      projects: [...byCode.values()],
    });
  } catch (err) {
    console.error("[integration] pta master-data:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
