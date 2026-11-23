import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SIXTY_DAYS = 60 * 86400000;

// clientId (โหมด multi) — กรองเฉพาะข้อมูลที่ผูกกับ project ของลูกค้านั้น (Project → Contract → Client)
//   ไม่ส่ง / ค่าว่าง = ทุกลูกค้า (เหมือนเดิม) · พนักงาน / cert เป็น Worker Pool รวม ไม่กรอง
const projectClientWhere = (clientId) =>
  typeof clientId === "string" && clientId.trim()
    ? { contract: { clientId: clientId.trim() } }
    : {};

// ════════════════════════════════════════════════════════════════
// GET — aggregate ทั้งหมดสำหรับ Analytics & Reports (คืน JSON ก้อนเดียว)
//   clientId → นับเฉพาะ Projects ของลูกค้านั้น (ส่วนอื่นเป็นพนักงานทั้งหมด)
// ════════════════════════════════════════════════════════════════
export async function getAnalytics({ clientId } = {}) {
  const [employees, projects, trainings] = await Promise.all([
    prisma.employee.findMany({
      select: {
        id: true,
        division: true,
        status: true,
        availabilityStatus: true,
        mobilizationStatus: true,
        position: { select: { name: true } },
      },
    }),
    prisma.project.findMany({
      where: projectClientWhere(clientId),
      select: { status: true },
    }),
    prisma.employeeTraining.findMany({
      where: { isLatest: true },
      select: { expiryDate: true },
    }),
  ]);

  // ── Headcount by Division (department) ──
  const divMap = {};
  for (const e of employees) {
    const key = e.division || "Unspecified";
    divMap[key] = (divMap[key] || 0) + 1;
  }
  const headcountByDivision = Object.entries(divMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // ── Top Positions / Trades ──
  const posMap = {};
  for (const e of employees) {
    const key = e.position?.name || "Unassigned";
    posMap[key] = (posMap[key] || 0) + 1;
  }
  const topPositions = Object.entries(posMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // ── Projects ──
  const projectStats = {
    total: projects.length,
    active: projects.filter((p) => p.status === "active").length,
    completed: projects.filter((p) => p.status === "completed").length,
  };

  // ── Worker status — แยก 2 กลุ่ม ──
  const mobilization = { pending: 0, ready: 0, on_site: 0 };
  const availability = { available: 0, unavailable: 0 };
  const employeeStatus = { active: 0, inactive: 0, resigned: 0, suspended: 0 };
  for (const e of employees) {
    if (mobilization[e.mobilizationStatus] !== undefined)
      mobilization[e.mobilizationStatus]++;
    if (availability[e.availabilityStatus] !== undefined)
      availability[e.availabilityStatus]++;
    if (employeeStatus[e.status] !== undefined) employeeStatus[e.status]++;
  }

  // ── Certification compliance buckets (logic เดียวกับ Compliance) ──
  const now = Date.now();
  let valid = 0,
    expiring = 0,
    expired = 0;
  for (const t of trainings) {
    if (!t.expiryDate) {
      valid++;
      continue;
    }
    const exp = new Date(t.expiryDate).getTime();
    if (isNaN(exp)) {
      valid++;
      continue;
    }
    const diff = exp - now;
    if (diff < 0) expired++;
    else if (diff <= SIXTY_DAYS) expiring++;
    else valid++;
  }

  return {
    generatedAt: new Date().toISOString(),
    totalWorkers: employees.length,
    headcountByDivision,
    topPositions,
    projects: projectStats,
    workerMobilization: mobilization,
    workerAvailability: availability,
    employeeStatus,
    certCompliance: {
      valid,
      expiring,
      expired,
      total: valid + expiring + expired,
    },
  };
} // ← ปิด getAnalytics ตรงนี้

// ════════════════════════════════════════════════════════════════
// ใหม่: Position/Onshore-Offshore/Project breakdown
// นับจาก Assignment จริง (ตำแหน่งตอน deploy) ไม่ใช่ Employee.position
// filter ตาม mobDate — year บังคับ, quarter ไม่ใส่ = ทั้งปี
// ════════════════════════════════════════════════════════════════
function getDateRange(year, quarter) {
  if (!year) return null;
  const y = Number(year);
  if (!quarter) {
    return {
      start: new Date(Date.UTC(y, 0, 1)),
      end: new Date(Date.UTC(y + 1, 0, 1)),
    };
  }
  const q = Number(quarter);
  const startMonth = (q - 1) * 3;
  return {
    start: new Date(Date.UTC(y, startMonth, 1)),
    end: new Date(Date.UTC(y, startMonth + 3, 1)),
  };
}

export async function getDeploymentReport({ year, quarter, clientId } = {}) {
  const range = getDateRange(year, quarter);
  const clientWhere = projectClientWhere(clientId);

  const assignments = await prisma.assignment.findMany({
    where: {
      status: { not: "cancelled" },
      projectId: { not: null },
      ...(range ? { mobDate: { gte: range.start, lt: range.end } } : {}),
      // เฉพาะการลงงานใน project ของลูกค้าที่เลือก (โหมด multi)
      ...(clientWhere.contract ? { project: { is: clientWhere } } : {}),
    },
    select: {
      employeeId: true,
      position: { select: { id: true, name: true } },
      project: {
        select: {
          id: true,
          name: true,
          isOffshore: true,
          masterProjectRecordId: true,
          masterProjectRecord: {
            select: { projectCode: true, jobTitle: true },
          },
        },
      },
    },
  });

  const positionMap = {};
  for (const a of assignments) {
    const key = a.position?.name || "Unassigned";
    if (!positionMap[key]) positionMap[key] = new Set();
    positionMap[key].add(a.employeeId);
  }
  const positionUsage = Object.entries(positionMap)
    .map(([name, set]) => ({ name, count: set.size }))
    .sort((a, b) => b.count - a.count);

  const siteType = { onshore: 0, offshore: 0, unspecified: 0 };
  for (const a of assignments) {
    if (a.project?.isOffshore === true) siteType.offshore++;
    else if (a.project?.isOffshore === false) siteType.onshore++;
    else siteType.unspecified++;
  }

  const projectMap = {};
  for (const a of assignments) {
    const p = a.project;
    if (!p) continue;
    const key = p.masterProjectRecordId || p.id;
    if (!projectMap[key]) {
      projectMap[key] = {
        projectCode: p.masterProjectRecord?.projectCode || null,
        jobTitle: p.masterProjectRecord?.jobTitle || p.name,
        employees: new Set(),
        positions: {},
      };
    }
    projectMap[key].employees.add(a.employeeId);
    const posName = a.position?.name || "Unassigned";
    projectMap[key].positions[posName] =
      (projectMap[key].positions[posName] || 0) + 1;
  }
  const byProject = Object.values(projectMap)
    .map((v) => ({
      projectCode: v.projectCode,
      jobTitle: v.jobTitle,
      employeeCount: v.employees.size,
      positions: Object.entries(v.positions)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.employeeCount - a.employeeCount);

  return {
    filter: {
      year: year ? Number(year) : null,
      quarter: quarter ? Number(quarter) : null,
      clientId: clientWhere.contract ? clientWhere.contract.clientId : null,
    },
    positionUsage,
    siteType,
    byProject,
  };
}
