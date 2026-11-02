// ============================================================
// services/emailWorker.js
// ส่งอีเมลจากคิว EmailOutbox ทุก 1 นาที + งานตรวจตามเวลา (เลยกำหนดตอบรับ ทุก 1 ชั่วโมง)
// เริ่มจาก server.js: startNotificationJobs()
//
// .env
//   EMAIL_ENABLED=true        ปิด/เปิดการส่งจริง (ไม่ตั้ง = ปิด → คิวถูกเก็บเป็น disabled)
//   EMAIL_FROM="MMS System <...>"   ไม่ตั้ง = "MMS System" <SENDER_EMAIL>
//   APP_BASE_URL=http://192.168.121.36   ใช้สร้างลิงก์ในอีเมล
//   EMAIL_REDIRECT_TO=you@...  (local/test) ส่งทุกฉบับเข้ากล่องนี้แทนผู้รับจริง
//
// ลองส่งซ้ำเมื่อพลาด: หลัง 1, 5, 30 นาที แล้วเลิก (status = failed)
// pm2 หลาย instance ก็ไม่ส่งซ้ำ — จอง row ด้วย updateMany(status queued → sending) ก่อนส่ง
// ============================================================
import prisma from "../config/prisma.js";
import transporter from "../config/nodemailer.js";
import { checkOverdueResponses } from "./notifyService.js";

const SEND_EVERY_MS = 60 * 1000;
const OVERDUE_EVERY_MS = 60 * 60 * 1000;
const BATCH = 20;
const RETRY_MINUTES = [1, 5, 30]; // ครั้งที่ 2, 3, 4
const STUCK_MS = 10 * 60 * 1000; // "sending" ค้างนานกว่านี้ (process ตายกลางทาง) → คืนเข้าคิว

const enabled = () => String(process.env.EMAIL_ENABLED || "").toLowerCase() === "true";

const fromAddress = () =>
  process.env.EMAIL_FROM?.trim() ||
  (process.env.SENDER_EMAIL ? `"MMS System" <${process.env.SENDER_EMAIL.trim()}>` : undefined);

let running = false;

export async function sendQueuedEmails() {
  if (!enabled() || running) return 0;
  running = true;
  let sent = 0;
  try {
    await prisma.emailOutbox.updateMany({
      where: { status: "sending", nextAttemptAt: { lt: new Date(Date.now() - STUCK_MS) } },
      data: { status: "queued" },
    });

    const due = await prisma.emailOutbox.findMany({
      where: { status: "queued", nextAttemptAt: { lte: new Date() } },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }], // "urgent" > "now" > "digest"
      take: BATCH,
    });

    const redirect = process.env.EMAIL_REDIRECT_TO?.trim();

    for (const m of due) {
      const claimed = await prisma.emailOutbox.updateMany({
        where: { id: m.id, status: "queued" },
        data: { status: "sending", nextAttemptAt: new Date() },
      });
      if (claimed.count !== 1) continue;

      try {
        await transporter.sendMail({
          from: fromAddress(),
          to: redirect || m.toEmail,
          subject: redirect ? `[ถึง ${m.toEmail}] ${m.subject}` : m.subject,
          text: m.text,
          html: m.html,
        });
        await prisma.emailOutbox.update({
          where: { id: m.id },
          data: { status: "sent", sentAt: new Date(), attempts: { increment: 1 }, lastError: null },
        });
        sent++;
      } catch (err) {
        const attempts = m.attempts + 1;
        const wait = RETRY_MINUTES[attempts - 1];
        await prisma.emailOutbox.update({
          where: { id: m.id },
          data: {
            attempts,
            lastError: String(err?.message || err).slice(0, 2000),
            status: wait ? "queued" : "failed",
            nextAttemptAt: wait ? new Date(Date.now() + wait * 60000) : new Date(),
          },
        });
        console.error(`[email] ส่งไม่สำเร็จ (${attempts}) ${m.type} → ${m.toEmail}: ${err?.message}`);
      }
    }
  } catch (err) {
    console.error("[email] worker error:", err.message);
  } finally {
    running = false;
  }
  return sent;
}

async function runOverdueCheck() {
  try {
    const n = await checkOverdueResponses();
    if (n) console.log(`[notify] เลยกำหนดตอบรับ: แจ้ง ${n} ฉบับ`);
  } catch (err) {
    console.error("[notify] overdue check error:", err.message);
  }
}

let started = false;
export function startNotificationJobs() {
  if (started) return;
  started = true;
  console.log(
    `📧 Email notifications: ${enabled() ? "ON" : "OFF (EMAIL_ENABLED ไม่ใช่ true)"}${
      process.env.EMAIL_REDIRECT_TO ? ` · redirect → ${process.env.EMAIL_REDIRECT_TO}` : ""
    }`,
  );
  setInterval(sendQueuedEmails, SEND_EVERY_MS);
  setTimeout(sendQueuedEmails, 5000);
  setInterval(runOverdueCheck, OVERDUE_EVERY_MS);
  setTimeout(runOverdueCheck, 60 * 1000);
}
