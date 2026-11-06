// ============================================================
// scripts/backfillRequestedBy.js
// แก้ "REQUESTED BY" ของตำแหน่งที่สร้างไปแล้ว (เดิมเป็น System Admin ทุกแถว
// เพราะ addProjectRequest ใช้ user คนแรกใน DB) ให้เป็นคนที่เพิ่มตำแหน่งจริง
//
// หาคนเพิ่มจริงจาก AuditLog: POST /api/projects/:projectId/requests
//   จับคู่ด้วย projectId + positionId และเวลาที่ใกล้ที่สุด (ห่างไม่เกิน 10 นาที)
//   ตำแหน่งที่หา log ไม่เจอ (สร้างก่อนเปิด Audit Log / สร้างทางอื่น) → ไม่แตะ
//
// ใช้งาน (ในโฟลเดอร์ backend, ไม่ต้อง sudo):
//   node scripts/backfillRequestedBy.js           ← ดูผลอย่างเดียว (ไม่เขียน DB)
//   node scripts/backfillRequestedBy.js --apply   ← เขียนจริง
// ============================================================
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const MAX_GAP_MS = 10 * 60 * 1000;

async function main() {
  const requests = await prisma.manpowerRequest.findMany({
    select: {
      id: true,
      projectId: true,
      positionId: true,
      createdAt: true,
      requestedById: true,
      position: { select: { name: true } },
    },
  });

  const paths = [...new Set(requests.map((r) => `/api/projects/${r.projectId}/requests`))];
  const logs = await prisma.auditLog.findMany({
    where: { method: "POST", success: true, userId: { not: null }, path: { in: paths } },
    select: { id: true, userId: true, path: true, createdAt: true, details: true },
    orderBy: { createdAt: "asc" },
  });

  const used = new Set(); // 1 log ใช้ได้กับ 1 ตำแหน่ง
  const users = new Map(
    (await prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );

  let changed = 0;
  let same = 0;
  let notFound = 0;

  for (const r of requests) {
    const path = `/api/projects/${r.projectId}/requests`;
    const candidates = logs.filter(
      (l) =>
        !used.has(l.id) &&
        l.path === path &&
        l.details?.body?.positionId === r.positionId &&
        Math.abs(new Date(l.createdAt) - new Date(r.createdAt)) <= MAX_GAP_MS,
    );
    if (candidates.length === 0) {
      notFound++;
      continue;
    }
    candidates.sort(
      (a, b) =>
        Math.abs(new Date(a.createdAt) - new Date(r.createdAt)) -
        Math.abs(new Date(b.createdAt) - new Date(r.createdAt)),
    );
    const log = candidates[0];
    used.add(log.id);

    if (!users.has(log.userId) || log.userId === r.requestedById) {
      same++;
      continue;
    }
    changed++;
    console.log(
      `${APPLY ? "UPDATE" : "would update"} ${r.position?.name || r.positionId} ` +
        `(${r.id.slice(0, 8)}): ${users.get(r.requestedById) || "?"} → ${users.get(log.userId)}`,
    );
    if (APPLY) {
      await prisma.manpowerRequest.update({
        where: { id: r.id },
        data: { requestedById: log.userId },
      });
    }
  }

  console.log(
    `\nตำแหน่งทั้งหมด ${requests.length} · ${APPLY ? "แก้แล้ว" : "จะแก้"} ${changed} · ` +
      `ถูกอยู่แล้ว ${same} · ไม่พบ log ${notFound}` +
      (APPLY ? "" : "\n(ยังไม่ได้เขียน DB — ตรวจรายการแล้วรันซ้ำด้วย --apply)"),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
