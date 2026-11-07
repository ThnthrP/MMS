-- ประวัติเดินทางของ Past Deployment History (ตามไฟล์ "แจ้งการเดินทางกลับ" ของ HR)
-- เพิ่มคอลัมน์ว่างทั้งหมด (nullable) — ไม่กระทบข้อมูลเดิม
ALTER TABLE "Assignment" ADD COLUMN "travelTeamNo" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "travelOut" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "travelBack" TEXT;
