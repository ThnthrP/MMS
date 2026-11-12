import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../config/prisma.js";
import transporter from "../config/nodemailer.js";
import { PASSWORD_RESET_TEMPLATE } from "../config/emailTemplates.js";
import { clientIp } from "../utils/auditLogger.js";

const isProd = process.env.NODE_ENV === "production";

// ================= กันเดารหัสผ่าน (MMS หลังบ้าน) =================
// แบบเดียวกับ Worker App: ผิดครบ 5 ครั้ง → ล็อกบัญชี 15 นาที (เก็บใน DB — restart แล้วไม่หาย)
// + จำกัดต่อ IP: ผิดรวม 20 ครั้งใน 15 นาที (กันไล่เดาหลายอีเมลจากเครื่องเดียว) — เก็บในหน่วยความจำ
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const IP_MAX_FAILS = 20;
const IP_WINDOW_MS = 15 * 60 * 1000;

// ข้อความเดียวทั้งอีเมลไม่มี / รหัสผิด — ไม่บอกคนนอกว่าอีเมลไหนมีบัญชี
const INVALID_LOGIN = "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
const TOO_MANY_FROM_IP = "พยายามเข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่";

// hash หลอก — อีเมลที่ไม่มีในระบบก็ยังเสียเวลา bcrypt เท่ากัน (กันจับเวลาตอบเพื่อเดาอีเมล)
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 10);

const ipFails = new Map(); // ip -> { count, resetAt }

const ipBlocked = (ip) => {
  const r = ip && ipFails.get(ip);
  if (!r) return false;
  if (r.resetAt <= Date.now()) {
    ipFails.delete(ip);
    return false;
  }
  return r.count >= IP_MAX_FAILS;
};

const noteIpFail = (ip) => {
  if (!ip) return;
  const now = Date.now();
  const r = ipFails.get(ip);
  if (!r || r.resetAt <= now) ipFails.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
  else r.count += 1;
  // กัน Map โตไม่หยุด — ล้างรายการที่หมดเวลาแล้ว
  if (ipFails.size > 5000) for (const [k, v] of ipFails) if (v.resetAt <= now) ipFails.delete(k);
};

const lockedMessage = (user) => {
  if (!user?.loginLockedUntil || user.loginLockedUntil <= new Date()) return null;
  const minutesLeft = Math.ceil((user.loginLockedUntil.getTime() - Date.now()) / 60000);
  return `บัญชีถูกล็อกชั่วคราวเพราะใส่รหัสผ่านผิดหลายครั้ง ลองใหม่อีกครั้งใน ${minutesLeft} นาที`;
};

// นับครั้งที่ผิด (increment ใน DB — กดพร้อมกันหลายแท็บก็นับครบ) ครบแล้วล็อก
async function registerFailedLogin(user) {
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: { increment: 1 } },
    select: { failedLoginAttempts: true },
  });
  if (updated.failedLoginAttempts < MAX_FAILED_ATTEMPTS) return null;
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, loginLockedUntil: new Date(Date.now() + LOCK_DURATION_MS) },
  });
  return "ใส่รหัสผ่านผิดหลายครั้งเกินไป บัญชีถูกล็อกชั่วคราว 15 นาที";
}

const cookieOptions = {
  httpOnly: true,
  secure: isProd, // prod(https)=true, local(http)=false
  sameSite: isProd ? "none" : "lax", // cross-site ต้อง none
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

// // ================= REGISTER =================
// export const register = async (req, res) => {
//   const { name, email, password } = req.body;

//   if (!name || !email || !password) {
//     return res.json({
//       success: false,
//       message: "Missing Details",
//     });
//   }

//   try {
//     const existingUser = await prisma.user.findUnique({
//       where: { email },
//     });

//     if (existingUser) {
//       return res.json({
//         success: false,
//         message: "User already exists",
//       });
//     }

//     const hashedPassword = await bcrypt.hash(password, 10);

//     // ── แก้ตาม role rename: manpower → manpower_supply ──
//     const userRole = await prisma.role.findUnique({
//       where: {
//         name: "manpower_supply",
//       },
//     });

//     if (!userRole) {
//       return res.json({
//         success: false,
//         message: "Default role not found",
//       });
//     }

//     await prisma.user.create({
//       data: {
//         name,
//         email,
//         password: hashedPassword,
//         roleId: userRole.id,
//       },
//     });

//     return res.json({
//       success: true,
//       message: "User registered successfully",
//     });
//   } catch (error) {
//     return res.json({
//       success: false,
//       message: error.message,
//     });
//   }
// };

// ================= LOGIN =================
export const login = async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const password = req.body?.password;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "กรุณากรอกอีเมลและรหัสผ่าน",
    });
  }

  const ip = clientIp(req);
  if (ipBlocked(ip)) {
    return res.status(429).json({ success: false, message: TOO_MANY_FROM_IP });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    // ล็อกอยู่ → ไม่ต้องเช็กรหัส (กันเดาต่อระหว่างล็อก)
    const locked = lockedMessage(user);
    if (locked) {
      noteIpFail(ip);
      return res.status(429).json({ success: false, message: locked });
    }

    // อีเมลไม่มีในระบบก็ compare กับ hash หลอก — เวลาตอบเท่ากับกรณีรหัสผิด
    const isMatch = await bcrypt.compare(String(password), user?.password || DUMMY_HASH);

    if (!user || !isMatch) {
      noteIpFail(ip);
      const lockMsg = user ? await registerFailedLogin(user) : null;
      return res
        .status(lockMsg ? 429 : 401)
        .json({ success: false, message: lockMsg || INVALID_LOGIN });
    }

    // สำเร็จ → ล้างตัวนับ (เขียน DB เฉพาะตอนที่เคยผิด)
    if (user.failedLoginAttempts || user.loginLockedUntil) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, loginLockedUntil: null },
      });
    }

    const token = jwt.sign(
      {
        userId: user.id,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      },
    );

    // res.cookie("token", token, {
    //   httpOnly: true,
    //   sameSite: "lax",
    //   secure: false,
    //   maxAge: 7 * 24 * 60 * 60 * 1000,
    // });

    res.cookie("token", token, cookieOptions);

    return res.json({
      success: true,
      message: "Login successful",

      user: {
        id: user.id,
        name: user.name,
        email: user.email,

        role: user.role?.name,

        permissions:
          user.role?.permissions?.map(
            (p) => `${p.permission.resource}:${p.permission.action}`,
          ) || [],
      },
    });
  } catch (error) {
    console.error("[auth] login:", error);
    // ไม่ส่ง error.message ของ DB กลับไปให้คนนอกเห็น
    return res.status(500).json({
      success: false,
      message: "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่",
    });
  }
};

// ================= LOGOUT =================
export const logout = async (req, res) => {
  try {
    // res.clearCookie("token");

    res.clearCookie("token", {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
    });

    return res.json({
      success: true,
    });
  } catch (error) {
    return res.json({
      success: false,
      message: error.message,
    });
  }
};

// ================= AUTH CHECK =================
export const isAuthenticated = async (req, res) => {
  try {
    return res.json({
      success: true,
    });
  } catch (error) {
    return res.json({
      success: false,
      message: error.message,
    });
  }
};

// ================= SEND RESET OTP =================
export const sendResetOtp = async (req, res) => {
  const { email } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.json({
        success: false,
        message: "User not found",
      });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));

    await prisma.user.update({
      where: { email },
      data: {
        resetOtp: otp,
        resetOtpExpireAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    const mailOption = {
      from: process.env.SENDER_EMAIL,
      to: user.email,
      subject: "Password Reset OTP",
      html: PASSWORD_RESET_TEMPLATE.replace("{{otp}}", otp).replace(
        "{{email}}",
        user.email,
      ),
    };

    await transporter.sendMail(mailOption);

    return res.json({
      success: true,
      message: "OTP sent to your email",
    });
  } catch (error) {
    return res.json({
      success: false,
      message: error.message,
    });
  }
};

// ================= RESET PASSWORD =================
export const resetPassword = async (req, res) => {
  const { email, otp, newPassword } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.json({
        success: false,
        message: "User not found",
      });
    }

    if (!email || !otp || !newPassword) {
      return res.json({
        success: false,
        message: "Missing fields",
      });
    }

    if (user.resetOtp !== otp) {
      return res.json({
        success: false,
        message: "Invalid OTP",
      });
    }

    if (!user.resetOtpExpireAt) {
      return res.json({
        success: false,
        message: "OTP not requested",
      });
    }

    if (new Date(user.resetOtpExpireAt) < new Date()) {
      return res.json({
        success: false,
        message: "OTP Expired",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { email },
      data: {
        password: hashedPassword,
        resetOtp: "",
        resetOtpExpireAt: null,
        // ตั้งรหัสใหม่แล้ว → ปลดล็อกบัญชีด้วย
        failedLoginAttempts: 0,
        loginLockedUntil: null,
      },
    });

    return res.json({
      success: true,
      message: "Password has been reset successfully",
    });
  } catch (error) {
    return res.json({
      success: false,
      message: error.message,
    });
  }
};
