-- กันเดารหัสผ่านของ MMS หลังบ้าน (แบบเดียวกับ PIN ของ Worker App)
-- เพิ่มคอลัมน์อย่างเดียว มีค่าเริ่มต้น — ไม่กระทบข้อมูลเดิม
ALTER TABLE "User" ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "loginLockedUntil" TIMESTAMP(3);
