-- ตำแหน่ง ณ รอบลงงานนั้น (ข้อความตามที่ HR กรอก) — แยกจากตำแหน่งปัจจุบันของพนักงาน
ALTER TABLE "Assignment" ADD COLUMN "positionLabel" TEXT;

-- ย้าย "ตำแหน่งตามไฟล์: X" ที่ importer รุ่นก่อนเขียนไว้ในหมายเหตุ มาไว้ที่ positionLabel
UPDATE "Assignment"
SET "positionLabel" = btrim(substring("remark" from 'ตำแหน่งตามไฟล์: ([^·]*)'))
WHERE "remark" LIKE '%ตำแหน่งตามไฟล์:%';

-- ลบข้อความนั้นออกจากหมายเหตุ (คงส่วนอื่น เช่น "วันกลับตามแผน")
UPDATE "Assignment"
SET "remark" = NULLIF(
  btrim(regexp_replace("remark", '\s*(·\s*)?ตำแหน่งตามไฟล์: [^·]*(·\s*)?', ' · ', 'g'), ' ·'),
  ''
)
WHERE "remark" LIKE '%ตำแหน่งตามไฟล์:%';
