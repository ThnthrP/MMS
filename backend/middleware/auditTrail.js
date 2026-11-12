// ============================================================
// middleware/auditTrail.js
// บันทึก Audit Log อัตโนมัติ "ที่เดียว" — mount ครั้งเดียวใน server.js
// ไม่ต้องไปแก้ทุกไฟล์ route/controller
//
// หลักการ:
//  - เก็บเฉพาะ request ที่ "เปลี่ยนข้อมูล" (POST/PUT/PATCH/DELETE) + login/logout
//    GET (แค่เปิดดู) ไม่เก็บ — ไม่งั้น log ล้น และไม่ใช่สิ่งที่ผู้บริหารต้องการดู
//  - รอ response เสร็จก่อน (res.on("finish")) → ตอนนั้น userAuth / workerAuth
//    ของแต่ละ route ตั้ง req.user / req.employeeId ไว้แล้ว จึงรู้ว่าใครทำ
//  - ดักค่า res.json(...) เพื่อดู success: false (หลาย controller ตอบ 200 แต่ success:false)
//  - เขียน DB แบบ fire-and-forget — ไม่ทำให้ API ช้าลง และถ้าเขียน log พลาด งานหลักไม่พัง
// ============================================================
import {
  actionFrom,
  clientIp,
  diffObjects,
  logAudit,
  moduleFromPath,
  resolveActor,
  resourceIdFrom,
  sanitize,
} from "../utils/auditLogger.js";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// path ที่ไม่ต้อง log (เสียงรบกวน / ไม่ใช่การกระทำทางธุรกิจ)
const SKIP_PATTERNS = [
  /^\/api\/audit-logs/, // หน้า audit log เอง
  /^\/api\/auth\/is-auth/,
  /^\/api\/worker\/auth\/is-auth/,
  /^\/api\/notifications\/.*(read|seen)/, // กดอ่านแจ้งเตือน
  /^\/api\/allocation\/(eligibility|workers|projects)/, // POST ที่จริงๆ คือ "ค้นหา/คำนวณ"
];

// ป้ายภาษาไทยสำหรับ summary อัตโนมัติ
const ACTION_TH = {
  CREATE: "เพิ่ม",
  UPDATE: "แก้ไข",
  DELETE: "ลบ",
  LOGIN: "เข้าสู่ระบบ",
  LOGOUT: "ออกจากระบบ",
  LOGIN_FAILED: "เข้าสู่ระบบไม่สำเร็จ",
  APPROVE: "อนุมัติ",
  REJECT: "ไม่อนุมัติ",
  REVOKE: "ยกเลิกอนุมัติ",
  DECISION: "ตัดสินผล",
  IMPORT: "นำเข้า/ทำรายการกลุ่ม",
  UPLOAD: "อัปโหลดไฟล์",
  EXPORT: "ส่งออก",
  CREDENTIAL: "ตั้ง/เปลี่ยนรหัส",
};

function autoSummary(action, module, resourceId) {
  const verb = ACTION_TH[action] || action;
  if (action === "LOGIN" || action === "LOGOUT" || action === "LOGIN_FAILED") return verb;
  return `${verb} ${module}${resourceId ? ` #${String(resourceId).slice(0, 8)}` : ""}`;
}

function filesInfo(req) {
  const list = [];
  if (req.file) list.push(req.file);
  if (Array.isArray(req.files)) list.push(...req.files);
  else if (req.files && typeof req.files === "object") Object.values(req.files).forEach((a) => list.push(...a));
  return list.length
    ? list.map((f) => ({ field: f.fieldname, name: f.originalname, size: f.size, type: f.mimetype }))
    : undefined;
}

export default function auditTrail(req, res, next) {
  const method = req.method;
  const path = (req.originalUrl || req.url || "").split("?")[0];

  if (!MUTATING.has(method) || SKIP_PATTERNS.some((re) => re.test(path))) {
    return next();
  }

  // ดักค่าที่ controller ตอบกลับ (เฉพาะ success / message — ไม่เก็บ data ทั้งก้อน)
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    try {
      if (body && typeof body === "object") {
        res.locals.auditResult = {
          success: body.success,
          message: typeof body.message === "string" ? body.message.slice(0, 300) : undefined,
          // ถ้าสร้างของใหม่ ลองหยิบ id ที่ตอบกลับมา
          createdId:
            body.id || body.data?.id || body.worker?.id || body.project?.id || body.user?.id || undefined,
        };
      }
    } catch {
      /* ignore */
    }
    return originalJson(body);
  };

  res.on("finish", () => {
    // ไม่ await — ไม่บล็อกอะไร
    (async () => {
      const ctx = req.audit || {};
      if (ctx.skip) return;

      const result = res.locals.auditResult || {};
      const status = res.statusCode;
      const success = status < 400 && result.success !== false;

      let action = ctx.action || actionFrom(method, path);
      if (action === "LOGIN" && !success) action = "LOGIN_FAILED";

      // ส่ง action ไปด้วย — login ใช้ได้เฉพาะ token ที่เพิ่งออก ไม่ใช่ cookie ที่ค้างอยู่ในเบราว์เซอร์
      const actor = await resolveActor(req, res, { action });

      // request ที่ไม่มีใครล็อกอิน + ไม่ใช่ความพยายาม login → ข้าม (เช่น 401 จาก bot)
      if (actor.actorType === "anonymous" && action !== "LOGIN_FAILED" && action !== "LOGIN") return;

      const module = ctx.module || moduleFromPath(path);
      const resourceId =
        ctx.resourceId || resourceIdFrom(req) || (method === "POST" ? result.createdId : null) || null;

      // login ไม่สำเร็จ — เก็บ identifier ที่พิมพ์มา (ไม่เก็บรหัสผ่าน) ไว้ดูว่ามีใครพยายามเข้า
      const loginId =
        action === "LOGIN_FAILED" || action === "LOGIN"
          ? req.body?.email || req.body?.empId || req.body?.empCode || req.body?.username || null
          : null;

      const changes = ctx.before || ctx.after ? diffObjects(ctx.before, ctx.after, { ignore: ctx.ignore }) : undefined;

      await logAudit({
        ...actor,
        actorName: actor.actorName || loginId || null,
        action,
        module,
        resourceId,
        summary:
          ctx.summary ||
          autoSummary(action, module, resourceId) + (loginId && actor.actorType === "anonymous" ? ` (${loginId})` : ""),
        success,
        statusCode: status,
        method,
        path,
        ip: clientIp(req),
        userAgent: req.headers["user-agent"],
        details: {
          ...(Object.keys(req.params || {}).length ? { params: req.params } : {}),
          ...(Object.keys(req.query || {}).length ? { query: req.query } : {}),
          ...(req.body && Object.keys(req.body).length ? { body: sanitize(req.body) } : {}),
          ...(filesInfo(req) ? { files: filesInfo(req) } : {}),
          ...(changes && Object.keys(changes).length ? { changes } : {}),
          ...(ctx.extra ? { extra: ctx.extra } : {}),
          ...(result.message ? { message: result.message } : {}),
        },
      });
    })().catch((err) => console.error("[audit] finish handler:", err.message));
  });

  next();
}
