// ══════════════════════════════════════════════════════════
// ลบประวัติลงงานเก่า (Past Deployment History ในหน้า Edit Worker ส่วน D) ทั้งหมด — ก่อน import ไฟล์ใหม่
//
//   node scripts/clearPastDeployments.js            ← dry-run: นับให้ดูก่อน ไม่ลบ
//   node scripts/clearPastDeployments.js --apply    ← ลบจริง
//
// ลบเฉพาะ Assignment ที่ projectId = null และ bookingId = null และมีข้อมูลแบบประวัติลงงาน
//   (projectLabel หรือ travelTeamNo) = แถวที่กรอกในส่วน D หรือ import จากไฟล์ HR
// ไม่แตะ: การ Deploy จากหน้า Mobilization (มี projectId) · แถวจาก booking · แถวที่ไม่มี projectLabel
//   (ถ้ามีแถวไม่มี projectLabel จะแจ้งจำนวนไว้ — อาจมาจาก roster import อย่าลบเองถ้ายังไม่เช็ค)
// ⚠ backup DB ก่อนรัน --apply
// ══════════════════════════════════════════════════════════
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const PAST = {
  projectId: null,
  bookingId: null,
  OR: [{ projectLabel: { not: null } }, { travelTeamNo: { not: null } }],
};

async function main() {
  const [past, unlabeled, live, people] = await Promise.all([
    prisma.assignment.count({ where: PAST }),
    prisma.assignment.count({
      where: { projectId: null, projectLabel: null, travelTeamNo: null },
    }),
    prisma.assignment.count({ where: { projectId: { not: null } } }),
    prisma.assignment.groupBy({ by: ["employeeId"], where: PAST }),
  ]);

  console.log("══════════════════════════════");
  console.log(`ประวัติลงงาน (ส่วน D) ที่จะลบ : ${past} แถว · พนักงาน ${people.length} คน`);
  console.log(`ไม่แตะ — Deploy จากหน้า Mobilization : ${live} แถว`);
  if (unlabeled > 0)
    console.log(
      `ไม่แตะ — แถวไม่มี project ไม่มี projectLabel : ${unlabeled} แถว (อาจมาจาก roster import — เช็คก่อนถ้าจะลบ)`,
    );

  if (!APPLY) {
    console.log("\nDRY-RUN — ยังไม่ลบ · ตรวจตัวเลขแล้วรันซ้ำพร้อม --apply");
    return;
  }
  const { count } = await prisma.assignment.deleteMany({ where: PAST });
  console.log(`\nลบแล้ว ${count} แถว`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
