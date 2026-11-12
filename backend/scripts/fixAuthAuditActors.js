// ============================================================
// scripts/fixAuthAuditActors.js — แก้ audit log เก่าที่ลงชื่อผู้กระทำผิด (รันครั้งเดียว)
//
// ปัญหาเดิม: login/logout ของ MMS หลังบ้าน (/api/auth/*) ไปหยิบ workerToken ที่ค้างอยู่ในเบราว์เซอร์
//   → ลงชื่อเป็นพนักงาน (Worker App) แทนคนที่ล็อกอินจริง
//   และ login สำเร็จที่ไม่มี workerToken ถูกบันทึกเป็น "ไม่ได้ล็อกอิน" (anonymous)
//
// แก้แบบนี้:
//   LOGIN สำเร็จ   → หา user จากอีเมลที่บันทึกไว้ใน details.body.email → ลงชื่อ user คนนั้น
//   LOGIN_FAILED  → anonymous + อีเมลที่พิมพ์มา
//   LOGOUT        → anonymous "ไม่ทราบผู้ใช้" (log เดิมไม่มีข้อมูลพอระบุตัวคนจริง)
//
// ใช้:  node scripts/fixAuthAuditActors.js           ← ดูอย่างเดียว (dry-run)
//       node scripts/fixAuthAuditActors.js --apply   ← แก้จริง
// แสดงแค่จำนวนและ id ของ log — ไม่พิมพ์ชื่อ / อีเมล
// ============================================================
import prisma from "../config/prisma.js";
import { USER_ROLES_LIGHT_INCLUDE, roleLabel } from "../utils/roles.js";

const APPLY = process.argv.includes("--apply");
const UNKNOWN_LOGOUT = "ไม่ทราบผู้ใช้ (บันทึกก่อนแก้ระบบ 12 พ.ย. 2569)";

const rows = await prisma.auditLog.findMany({
  where: {
    path: { startsWith: "/api/auth/" },
    action: { in: ["LOGIN", "LOGIN_FAILED", "LOGOUT"] },
    OR: [
      { actorType: "worker" },
      { action: "LOGIN", success: true, actorType: { not: "user" } },
    ],
  },
  select: { id: true, action: true, success: true, actorType: true, details: true },
  orderBy: { createdAt: "asc" },
});

const userCache = new Map();
async function findUser(email) {
  if (!email) return null;
  if (userCache.has(email)) return userCache.get(email);
  const u = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, ...USER_ROLES_LIGHT_INCLUDE },
  });
  const data = u ? { userId: u.id, actorName: u.name || u.email, actorRole: roleLabel(u) || null } : null;
  userCache.set(email, data);
  return data;
}

const plan = { loginToUser: [], loginNoMatch: [], failedToAnon: [], logoutToUnknown: [] };
const updates = [];

for (const r of rows) {
  const email = typeof r.details?.body?.email === "string" ? r.details.body.email.trim() : null;

  if (r.action === "LOGIN" && r.success) {
    const u = await findUser(email);
    if (u) {
      plan.loginToUser.push(r.id);
      updates.push({ id: r.id, data: { actorType: "user", employeeId: null, ...u } });
    } else {
      plan.loginNoMatch.push(r.id); // อีเมลไม่ตรงกับ user ปัจจุบัน (เช่นถูกลบไปแล้ว)
      updates.push({
        id: r.id,
        data: { actorType: "anonymous", employeeId: null, userId: null, actorRole: null, actorName: email },
      });
    }
  } else if (r.action === "LOGIN_FAILED" || (r.action === "LOGIN" && !r.success)) {
    plan.failedToAnon.push(r.id);
    updates.push({
      id: r.id,
      data: { actorType: "anonymous", employeeId: null, userId: null, actorRole: null, actorName: email },
    });
  } else if (r.action === "LOGOUT") {
    plan.logoutToUnknown.push(r.id);
    updates.push({
      id: r.id,
      data: { actorType: "anonymous", employeeId: null, userId: null, actorRole: null, actorName: UNKNOWN_LOGOUT },
    });
  }
}

console.log(`พบ audit log ที่ต้องแก้ ${rows.length} แถว`);
console.log(`  LOGIN สำเร็จ → ลงชื่อ user ที่ถูกต้อง : ${plan.loginToUser.length}`);
console.log(`  LOGIN สำเร็จ แต่ไม่พบ user จากอีเมล   : ${plan.loginNoMatch.length} → anonymous`);
console.log(`  LOGIN ไม่ผ่าน → anonymous             : ${plan.failedToAnon.length}`);
console.log(`  LOGOUT → ไม่ทราบผู้ใช้                 : ${plan.logoutToUnknown.length}`);
if (plan.loginNoMatch.length) console.log(`  id ที่ไม่พบ user: ${plan.loginNoMatch.join(", ")}`);

if (!APPLY) {
  console.log("\n(dry-run) ยังไม่ได้แก้อะไร — ตรวจตัวเลขแล้วรันซ้ำด้วย --apply");
} else {
  let done = 0;
  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100);
    await prisma.$transaction(chunk.map((u) => prisma.auditLog.update({ where: { id: u.id }, data: u.data })));
    done += chunk.length;
  }
  console.log(`\nแก้แล้ว ${done} แถว`);
}

await prisma.$disconnect();
