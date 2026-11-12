// ============================================================
// utils/auditLogger.js
// ตัวช่วยกลางของ Audit Log — ใช้โดย middleware/auditTrail.js
// และ controller ที่อยากใส่รายละเอียดเพิ่ม (before/after, summary)
// ============================================================
import jwt from "jsonwebtoken";
import prisma from "../config/prisma.js";
import { USER_ROLES_LIGHT_INCLUDE, roleLabel } from "./roles.js";

// ── field ที่ห้ามเก็บลง log เด็ดขาด (เทียบแบบ lowercase, ตัด _ - ออก) ──
const SENSITIVE_KEYS = [
  "password",
  "newpassword",
  "oldpassword",
  "currentpassword",
  "confirmpassword",
  "pin",
  "newpin",
  "oldpin",
  "currentpin",
  "confirmpin",
  "token",
  "accesstoken",
  "refreshtoken",
  "otp",
  "secret",
];

const MAX_STRING = 500; // ตัดข้อความยาวเกิน
const MAX_ARRAY = 50; // array ยาวเก็บแค่ 50 ตัวแรก
const MAX_DEPTH = 5;

const normKey = (k) => String(k).toLowerCase().replace(/[_\-\s]/g, "");

export function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return "[…]";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const arr = value.slice(0, MAX_ARRAY).map((v) => sanitize(v, depth + 1));
    if (value.length > MAX_ARRAY) arr.push(`[+${value.length - MAX_ARRAY} more]`);
    return arr;
  }
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.includes(normKey(k)) ? "[REDACTED]" : sanitize(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > MAX_STRING) {
    return value.slice(0, MAX_STRING) + "…";
  }
  return value;
}

// ── หาความต่างระหว่าง before / after (ใช้กับการแก้ไข) ──
// คืน { field: { from, to } } เฉพาะ field ที่เปลี่ยน
export function diffObjects(before = {}, after = {}, { ignore = [] } = {}) {
  const skip = new Set(["updatedAt", "createdAt", ...ignore]);
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const changes = {};
  for (const k of keys) {
    if (skip.has(k)) continue;
    const a = before?.[k];
    const b = after?.[k];
    // ข้าม relation/object ซ้อน — เทียบเฉพาะค่า primitive / Date
    const isObj = (v) => v && typeof v === "object" && !(v instanceof Date);
    if (isObj(a) || isObj(b)) continue;
    const na = a instanceof Date ? a.toISOString() : a ?? null;
    const nb = b instanceof Date ? b.toISOString() : b ?? null;
    if (na !== nb) {
      changes[k] = SENSITIVE_KEYS.includes(normKey(k))
        ? { from: "[REDACTED]", to: "[REDACTED]" }
        : { from: na, to: nb };
    }
  }
  return changes;
}

// ── ชื่อ module จาก path: /api/<segment>/... ──
// segment ที่ไม่อยู่ใน map จะใช้ชื่อ segment ตรงๆ (log ไม่หาย แค่ชื่อไม่สวย)
export const MODULE_MAP = {
  auth: "auth",
  user: "users",
  workers: "workers",
  employees: "workers",
  "training-matrix": "training_matrix",
  positions: "positions",
  trainings: "trainings",
  "global-trainings": "trainings",
  compliance: "compliance",
  projects: "projects",
  clients: "clients",
  allocation: "allocation",
  "match-exceptions": "pe_approvals",
  mobilization: "mobilization",
  review: "review",
  analytics: "reports",
  dashboard: "dashboard",
  divisions: "divisions",
  notifications: "notifications",
  "training-requests": "training_requests",
  "medical-requests": "medical_requests",
  supervisor: "supervisor",
  "project-messages": "project_messages",
  "leave-requests": "leave_requests",
  worker: "worker_app",
};

export function moduleFromPath(path = "") {
  const seg = path.replace(/^\/api\//, "").split(/[/?]/)[0];
  return MODULE_MAP[seg] || seg || "unknown";
}

// ── action จาก method + คำใน path ──
export function actionFrom(method, path = "") {
  const p = path.toLowerCase();
  if (/\/logout\b/.test(p)) return "LOGOUT";
  if (/\/login\b/.test(p)) return "LOGIN";
  if (/change-pin|change-password|reset-password|set-pin|bulk-set-pin/.test(p)) return "CREDENTIAL";
  if (/\/(unapprove|revoke)\b/.test(p)) return "REVOKE";
  if (/\/(approve|approved)\b/.test(p)) return "APPROVE";
  if (/\/(reject|rejected)\b/.test(p)) return "REJECT";
  if (/\/decision\b/.test(p)) return "DECISION";
  if (/\/(import|bulk)/.test(p)) return "IMPORT";
  if (/\/(upload|photo|file|document|attachment)/.test(p)) return "UPLOAD";
  if (/\/export\b/.test(p)) return "EXPORT";
  if (method === "POST") return "CREATE";
  if (method === "PUT" || method === "PATCH") return "UPDATE";
  if (method === "DELETE") return "DELETE";
  return method;
}

// ── หา id ของ resource จาก params / path ──
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
export function resourceIdFrom(req) {
  const params = req.params || {};
  const fromParams = params.id || Object.values(params).find((v) => typeof v === "string");
  if (fromParams) return String(fromParams);
  const m = (req.originalUrl || "").match(UUID_RE);
  if (m) return m[0];
  const numeric = (req.originalUrl || "").split("?")[0].match(/\/(\d+)(?:\/|$)/);
  return numeric ? numeric[1] : null;
}

export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  const ip = (fwd ? String(fwd).split(",")[0] : req.socket?.remoteAddress) || "";
  return ip.replace(/^::ffff:/, "") || null;
}

// ── ข้อมูลผู้ใช้ (ชื่อ + role) — cache 5 นาที กันยิง DB ทุก request ──
// role = ทุก role ของ user เช่น "manpower_supply + project_engineer"
const actorCache = new Map();
const CACHE_MS = 5 * 60 * 1000;

async function lookupUser(userId) {
  const hit = actorCache.get(`u:${userId}`);
  if (hit && hit.exp > Date.now()) return hit.data;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, ...USER_ROLES_LIGHT_INCLUDE },
  });
  const data = u ? { name: u.name || u.email, role: roleLabel(u) || null } : null;
  actorCache.set(`u:${userId}`, { data, exp: Date.now() + CACHE_MS });
  return data;
}

async function lookupEmployee(employeeId) {
  const hit = actorCache.get(`e:${employeeId}`);
  if (hit && hit.exp > Date.now()) return hit.data;
  const e = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { empId: true, empCode: true, fullName: true, fullNameEN: true },
  });
  const data = e
    ? {
        name: [e.empId || e.empCode, e.fullNameEN || e.fullName].filter(Boolean).join(" "),
        role: "worker",
      }
    : null;
  actorCache.set(`e:${employeeId}`, { data, exp: Date.now() + CACHE_MS });
  return data;
}

// ── cookie ของแต่ละช่องทาง (ต้องตรงกับ authController / workerAuthController) ──
//   MMS หลังบ้าน = "token"       payload { userId }
//   Worker App   = "workerToken" payload { employeeId, type: "worker" }
const CHANNEL_COOKIE = { user: "token", worker: "workerToken" };

// path ของ Worker App ทั้งหมดอยู่ใต้ /api/worker/ (ไม่ใช่ /api/workers ของหลังบ้าน)
export const channelFromPath = (path = "") =>
  /^\/api\/worker(\/|$)/.test(path) ? "worker" : "user";

// ถอด JWT จาก cookie — ใช้กรณี req.user / req.employeeId ไม่ถูกตั้ง (route login / logout ไม่ผ่าน userAuth)
//   • ดูเฉพาะ cookie ของช่องทางนั้น — เบราว์เซอร์เดียวกันอาจมีทั้ง token และ workerToken
//     (เดิมดูทุก cookie แล้วเจอ workerToken ก่อน → login/logout ของ MMS ถูกลงชื่อเป็นพนักงาน)
//   • responseOnly (ใช้กับ login) = ดูเฉพาะ Set-Cookie ที่เพิ่งออก — login ไม่สำเร็จจะไม่มี
//     จึงเป็น anonymous ไม่ใช่คนที่ยังล็อกอินค้างอยู่ในเบราว์เซอร์นั้น
function actorFromCookies(req, res, { channel = "user", responseOnly = false } = {}) {
  const secret = process.env.JWT_SECRET;
  const want = CHANNEL_COOKIE[channel];
  if (!secret || !want) return {};

  const pairs = [];
  const setCookie = res?.getHeader?.("set-cookie");
  for (const c of [].concat(setCookie || [])) {
    const m = String(c).match(/^([^=]+)=([^;]*)/);
    if (m && m[2]) pairs.push([m[1].trim(), decodeURIComponent(m[2])]);
  }
  if (!responseOnly) pairs.push(...Object.entries(req.cookies || {}));

  for (const [name, raw] of pairs) {
    if (name !== want) continue;
    if (!raw || typeof raw !== "string" || raw.split(".").length !== 3) continue;
    try {
      const p = jwt.verify(raw, secret);
      if (channel === "worker" && p?.type === "worker" && p.employeeId) return { employeeId: p.employeeId };
      // token ของ MMS ใช้ userId (เดิมเช็ก p.id ซึ่งไม่มีใน payload → ไม่เคยจับได้)
      if (channel === "user" && p?.type !== "worker" && (p?.userId || p?.id)) return { userId: p.userId || p.id };
    } catch {
      /* token หมดอายุ/ไม่ใช่ของเรา — ข้าม */
    }
  }
  return {};
}

// ── ระบุตัวผู้กระทำ ──
//   action = action ของ request นี้ (ส่งมาจาก auditTrail) — ใช้แยกกรณี login
export async function resolveActor(req, res, { action } = {}) {
  const path = (req.originalUrl || req.url || "").split("?")[0];
  const channel = channelFromPath(path);

  // ตัวตนที่ userAuth / workerAuth ตั้งไว้ = เชื่อถือได้เสมอ
  let userId = req.user?.id || null;
  let employeeId = req.employeeId || req.employee?.id || null;

  // ไม่มี (route login / logout) → ถอดจาก cookie ของช่องทางตาม path เท่านั้น
  if (!userId && !employeeId) {
    const isLogin = action === "LOGIN" || action === "LOGIN_FAILED";
    const fromCookie = actorFromCookies(req, res, { channel, responseOnly: isLogin });
    userId = fromCookie.userId || null;
    employeeId = fromCookie.employeeId || null;
  }

  try {
    if (userId) {
      const u = await lookupUser(userId);
      return { actorType: "user", userId, actorName: u?.name || null, actorRole: u?.role || null };
    }
    if (employeeId) {
      const e = await lookupEmployee(employeeId);
      return { actorType: "worker", employeeId, actorName: e?.name || null, actorRole: "worker" };
    }
  } catch (err) {
    console.error("[audit] resolveActor:", err.message);
  }
  return { actorType: "anonymous" };
}

// ── บันทึก log ตรงๆ (ใช้ได้ทุกที่ เช่น cron, service) — ไม่ throw, ไม่ทำให้งานหลักพัง ──
export async function logAudit(entry) {
  try {
    await prisma.auditLog.create({
      data: {
        actorType: entry.actorType || "user",
        userId: entry.userId || null,
        employeeId: entry.employeeId || null,
        actorName: entry.actorName || null,
        actorRole: entry.actorRole || null,
        action: entry.action,
        module: entry.module,
        resourceId: entry.resourceId ? String(entry.resourceId) : null,
        summary: entry.summary ? String(entry.summary).slice(0, 1000) : null,
        success: entry.success !== false,
        statusCode: entry.statusCode ?? null,
        method: entry.method || null,
        path: entry.path ? String(entry.path).slice(0, 500) : null,
        ip: entry.ip || null,
        userAgent: entry.userAgent ? String(entry.userAgent).slice(0, 300) : null,
        details: entry.details ? sanitize(entry.details) : undefined,
      },
    });
  } catch (err) {
    console.error("[audit] write failed:", err.message);
  }
}

// ============================================================
// ใช้ใน controller (ทางเลือก) — เติมรายละเอียดให้ log ของ request นี้
// middleware จะเอาไปรวมตอนบันทึก ไม่ต้องเรียก logAudit เอง
//
//   setAuditContext(req, {
//     summary: `แก้ไขข้อมูลพนักงาน ${emp.empId} ${emp.firstName}`,
//     resourceId: emp.id,
//     before, after,            // → เก็บเฉพาะ field ที่เปลี่ยน
//   });
//
//   setAuditContext(req, { skip: true });   // ไม่ต้อง log request นี้
// ============================================================
export function setAuditContext(req, ctx = {}) {
  req.audit = { ...(req.audit || {}), ...ctx };
}

// ── ลบ log เก่า (retention) — เรียกจาก server.js ──
export async function purgeOldAuditLogs(days) {
  const n = Number(days);
  if (!n || n <= 0) return 0;
  const cutoff = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  try {
    const { count } = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (count) console.log(`[audit] purged ${count} logs older than ${n} days`);
    return count;
  } catch (err) {
    console.error("[audit] purge failed:", err.message);
    return 0;
  }
}
