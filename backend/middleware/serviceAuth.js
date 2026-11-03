// ============================================================
// middleware/serviceAuth.js
// ยืนยันตัวตน "ระบบอื่น" ที่เรียก API ของ MMS (ไม่ใช่ user ที่ login)
// ใช้ header: Authorization: Bearer <token>
// token เก็บใน .env (เช่น PTA_SERVICE_TOKEN) — ไม่ตั้ง = ปิด endpoint (503)
// ============================================================
import crypto from "crypto";

export default function serviceAuth(envName) {
  return (req, res, next) => {
    const expected = process.env[envName]?.trim();
    if (!expected) {
      return res.status(503).json({ message: "Integration is not configured" });
    }

    const header = req.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    next();
  };
}
