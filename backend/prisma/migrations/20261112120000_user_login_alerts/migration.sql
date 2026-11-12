-- แจ้งเจ้าของบัญชีว่ามีการใส่รหัสผ่านผิด (ต่อจาก 20261112110000_user_login_lockout)
-- เพิ่มคอลัมน์อย่างเดียว มีค่าเริ่มต้น — ไม่กระทบข้อมูลเดิม
ALTER TABLE "User" ADD COLUMN "failedSinceLastLogin" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lastFailedLoginAt" TIMESTAMP(3);
