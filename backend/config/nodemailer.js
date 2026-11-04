import nodemailer from "nodemailer";

// ค่า SMTP มาจาก .env — ไม่ตั้ง SMTP_HOST = ใช้ Brevo แบบเดิม
const port = Number(process.env.SMTP_PORT) || 587;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp-relay.brevo.com",
  port,
  // 465 = SSL ตั้งแต่ต้น · 587 = STARTTLS (secure: false)
  secure:
    String(process.env.SMTP_SECURE || "").toLowerCase() === "true" ||
    port === 465,
  // บาง relay ของบริษัทไม่ต้อง login (อนุญาตตาม IP) → ไม่ตั้ง SMTP_USER ได้
  auth: process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    : undefined,
  tls: { rejectUnauthorized: false },
});

export default transporter;
