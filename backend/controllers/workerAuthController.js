import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../config/prisma.js";
import { notifyRoles } from "../services/notificationService.js";

const isProd = process.env.NODE_ENV === "production";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 นาที

const workerCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 วัน — session ยาวกว่า admin เพราะเป็น mobile app
};

// ================= helpers =================

// พนักงานถูกล็อก → แจ้ง admin + manpower ในกระดิ่ง (พนักงานจะโทรหาทีมนี้ตามข้อความหน้า login)
//   ห้ามทำให้ login พัง — ยิงแล้วไม่รอ
function notifyWorkerLocked(employee) {
  if (!employee) return;
  const who = [employee.empId, employee.fullNameEN || employee.fullName].filter(Boolean).join(" ");
  notifyRoles(["admin", "manpower_supply"], {
    type: "security",
    title: "🔒 พนักงานถูกล็อก Worker App",
    message: `${who || "พนักงาน"} กรอก PIN ผิด ${MAX_FAILED_ATTEMPTS} ครั้ง · ล็อก 15 นาที · ถ้าพนักงานลืม PIN ให้ตั้ง PIN ใหม่ที่ Bulk Set PIN`,
    link: employee.id ? `/workers/${employee.id}` : null,
  }).catch((err) => console.error("[worker-auth] notify:", err.message));
}

// นับครั้งที่กรอก PIN ผิด — ครบ MAX_FAILED_ATTEMPTS ล็อก 15 นาที
// ใช้ร่วมกันทั้งตอน login และตอนกรอก PIN เดิมเพื่อเปลี่ยน PIN (กันเดา PIN ผ่านหน้าเปลี่ยน PIN)
//   Worker App บอกจำนวนครั้งที่เหลือได้ — ระบบบอก "ไม่พบรหัสพนักงานนี้" อยู่แล้ว จึงไม่มีความลับให้ปิด
//   คืน { locked, message } — message ใช้แทนข้อความ "PIN ไม่ถูกต้อง" เดิม
async function registerFailedAttempt(pinRow, employee, wrongLabel = "PIN ไม่ถูกต้อง") {
  const newFailedAttempts = pinRow.failedAttempts + 1;
  const shouldLock = newFailedAttempts >= MAX_FAILED_ATTEMPTS;

  await prisma.employeePin.update({
    where: { employeeId: pinRow.employeeId },
    data: {
      failedAttempts: shouldLock ? 0 : newFailedAttempts,
      lockedUntil: shouldLock ? new Date(Date.now() + LOCK_DURATION_MS) : null,
    },
  });

  if (shouldLock) {
    notifyWorkerLocked(employee);
    return {
      locked: true,
      message: `กรอก PIN ผิดครบ ${MAX_FAILED_ATTEMPTS} ครั้ง บัญชีถูกล็อกชั่วคราว 15 นาที — ถ้าลืม PIN ติดต่อทีม Manpower / HR`,
    };
  }
  const left = MAX_FAILED_ATTEMPTS - newFailedAttempts;
  return {
    locked: false,
    message: `${wrongLabel} (เหลืออีก ${left} ครั้ง ก่อนถูกล็อก 15 นาที)`,
  };
}

function lockedMessage(pinRow) {
  if (!pinRow.lockedUntil || pinRow.lockedUntil <= new Date()) return null;
  const minutesLeft = Math.ceil(
    (pinRow.lockedUntil.getTime() - Date.now()) / 60000,
  );
  return `บัญชีถูกล็อกชั่วคราว ลองใหม่อีกครั้งใน ${minutesLeft} นาที`;
}

// ตรวจ PIN ใหม่ที่พนักงานตั้งเอง — คืนข้อความ error หรือ null ถ้าผ่าน
// กัน PIN ที่คนอื่นเดาง่าย: เลขซ้ำ, เลขเรียง, รหัสพนักงาน, วันเกิด
export function validateNewPin(pin, employee) {
  if (!/^\d{6}$/.test(pin)) return "PIN ต้องเป็นตัวเลข 6 หลัก";

  if (/^(\d)\1{5}$/.test(pin)) {
    return "ห้ามใช้เลขเดียวกันทั้งหมด เช่น 111111";
  }

  // เลขเรียงขึ้นหรือลง เช่น 123456, 654321, 890123
  const digits = pin.split("").map(Number);
  const steps = digits.slice(1).map((d, i) => (d - digits[i] + 10) % 10);
  if (steps.every((s) => s === 1) || steps.every((s) => s === 9)) {
    return "ห้ามใช้เลขเรียง เช่น 123456 หรือ 654321";
  }

  const empIdDigits = String(employee?.empId || "").replace(/\D/g, "");
  if (empIdDigits.length >= 6 && empIdDigits.endsWith(pin)) {
    return "ห้ามใช้รหัสพนักงานเป็น PIN";
  }

  // วันเกิดแบบ วว ดด ปป (ค.ศ. และ พ.ศ.) — เพื่อนร่วมงานเดาได้ง่าย
  if (employee?.birthDate) {
    const b = new Date(employee.birthDate);
    const dd = String(b.getUTCDate()).padStart(2, "0");
    const mm = String(b.getUTCMonth() + 1).padStart(2, "0");
    const yCE = String(b.getUTCFullYear() % 100).padStart(2, "0");
    const yBE = String((b.getUTCFullYear() + 543) % 100).padStart(2, "0");
    const birthPins = [
      `${dd}${mm}${yCE}`,
      `${dd}${mm}${yBE}`,
      `${yCE}${mm}${dd}`,
      `${yBE}${mm}${dd}`,
    ];
    if (birthPins.includes(pin)) return "ห้ามใช้วันเกิดเป็น PIN";
  }

  return null;
}

// ================= WORKER LOGIN (MP Code + PIN) =================
export const workerLogin = async (req, res) => {
  const { empId, pin } = req.body;

  if (!empId || !pin) {
    return res.json({
      success: false,
      message: "กรุณากรอกรหัสพนักงานและ PIN",
    });
  }

  try {
    const employee = await prisma.employee.findUnique({
      where: { empId },
      include: { pin: true },
    });

    if (!employee) {
      return res.json({
        success: false,
        message: "ไม่พบรหัสพนักงานนี้ — ติดต่อทีม Manpower",
      });
    }

    if (employee.status !== "active") {
      return res.json({
        success: false,
        message: "บัญชีพนักงานนี้ไม่สามารถใช้งานได้ — ติดต่อทีม Manpower",
      });
    }

    if (!employee.pin) {
      return res.json({
        success: false,
        message: "ยังไม่ได้ตั้งค่า PIN — ติดต่อทีม Manpower",
      });
    }

    // เช็ค lockout ก่อนเช็ค PIN
    const locked = lockedMessage(employee.pin);
    if (locked) return res.json({ success: false, message: locked });

    const isMatch = await bcrypt.compare(String(pin), employee.pin.pinHash);

    if (!isMatch) {
      const fail = await registerFailedAttempt(employee.pin, employee);
      return res.json({ success: false, message: fail.message });
    }

    // ล็อกอินสำเร็จ — reset failed attempts
    await prisma.employeePin.update({
      where: { employeeId: employee.id },
      data: { failedAttempts: 0, lockedUntil: null },
    });

    const token = jwt.sign(
      { employeeId: employee.id, type: "worker" },
      process.env.JWT_SECRET,
      { expiresIn: "30d" },
    );

    res.cookie("workerToken", token, workerCookieOptions);

    return res.json({
      success: true,
      message: "เข้าสู่ระบบสำเร็จ",
      // true = ยังใช้ PIN ที่ HR ตั้งให้ → frontend ต้องพาไปหน้าตั้ง PIN ใหม่ก่อน
      mustChangePin: employee.pin.mustChange,
      employee: {
        id: employee.id,
        empId: employee.empId,
        fullName: employee.fullName,
        photoUrl: employee.photoUrl,
      },
    });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};

// ================= CHANGE PIN (พนักงานตั้ง PIN เอง) =================
// ต้องผ่าน workerAuth — ใช้ทั้งตอนบังคับเปลี่ยนครั้งแรก และเปลี่ยนเองจากแท็บ "ของฉัน"
export const changePin = async (req, res) => {
  const { currentPin, newPin, confirmPin } = req.body;

  if (!currentPin || !newPin) {
    return res.json({
      success: false,
      message: "กรุณากรอก PIN เดิมและ PIN ใหม่",
    });
  }

  if (confirmPin !== undefined && String(newPin) !== String(confirmPin)) {
    return res.json({
      success: false,
      message: "PIN ใหม่ทั้ง 2 ช่องไม่ตรงกัน",
    });
  }

  try {
    const pinRow = await prisma.employeePin.findUnique({
      where: { employeeId: req.employeeId },
    });

    if (!pinRow) {
      return res.json({
        success: false,
        message: "ยังไม่ได้ตั้งค่า PIN — ติดต่อทีม Manpower",
      });
    }

    const locked = lockedMessage(pinRow);
    if (locked) return res.json({ success: false, message: locked });

    const isMatch = await bcrypt.compare(String(currentPin), pinRow.pinHash);
    if (!isMatch) {
      const fail = await registerFailedAttempt(pinRow, req.employee, "PIN เดิมไม่ถูกต้อง");
      return res.json({ success: false, message: fail.message });
    }

    const newPinStr = String(newPin);

    if (newPinStr === String(currentPin)) {
      return res.json({
        success: false,
        message: "PIN ใหม่ต้องไม่ซ้ำกับ PIN เดิม",
      });
    }

    const invalid = validateNewPin(newPinStr, req.employee);
    if (invalid) return res.json({ success: false, message: invalid });

    const pinHash = await bcrypt.hash(newPinStr, 10);

    await prisma.employeePin.update({
      where: { employeeId: req.employeeId },
      data: {
        pinHash,
        mustChange: false,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });

    return res.json({ success: true, message: "เปลี่ยน PIN สำเร็จ" });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};

// ================= WORKER LOGOUT =================
export const workerLogout = async (req, res) => {
  try {
    res.clearCookie("workerToken", {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
    });
    return res.json({ success: true });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};

// ================= AUTH CHECK =================
// คืน mustChangePin ด้วย — คนที่ login ค้างไว้ก่อนอัปเดต (session 30 วัน)
// จะถูกพาไปตั้ง PIN ใหม่ตอนเปิดแอปครั้งถัดไป
export const workerIsAuthenticated = async (req, res) => {
  try {
    const pinRow = await prisma.employeePin.findUnique({
      where: { employeeId: req.employeeId },
      select: { mustChange: true },
    });
    return res.json({
      success: true,
      employee: req.employee,
      mustChangePin: !!pinRow?.mustChange,
    });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};
