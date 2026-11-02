// ============================================================
// services/emailTemplates.js
// โครงอีเมลเดียวกันทุกฉบับ (ตาม MMS — Email Notification Spec › รูปแบบ email):
//   Subject: [MMS] [ป้าย] เรื่อง — ON Number · ตำแหน่ง/ชื่อ
//   1) เกิดอะไร 1 ประโยค  2) ตารางสั้น  3) สิ่งที่ต้องทำ  4) ปุ่มเดียว  5) ท้ายอีเมล
// ข้อห้าม: ไม่มีค่าผลตรวจสุขภาพ / รหัสผ่าน / PIN ในอีเมล
// ============================================================

export const LABEL = {
  urgent: "ด่วน",
  action: "ต้องดำเนินการ",
  info: "แจ้งเพื่อทราบ",
  digest: "สรุปประจำวัน",
};

// ข้อความที่ผู้ใช้พิมพ์ (เช่นเหตุผลปฏิเสธ) ต้อง escape เสมอก่อนใส่ใน HTML
export const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const TZ = "Asia/Bangkok";

export const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: TZ,
      })
    : "—";

export const fmtDateTimeTH = (d) =>
  new Date(d).toLocaleString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  }) + " น.";

// "14 Aug 2026 (อีก 12 วัน)"
export const fmtMob = (d) => {
  if (!d) return "ยังไม่กำหนด";
  const days = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
  const rel =
    days > 0 ? `อีก ${days} วัน` : days === 0 ? "วันนี้" : `ผ่านมาแล้ว ${-days} วัน`;
  return `${fmtDate(d)} (${rel})`;
};

const baseUrl = () =>
  (process.env.APP_BASE_URL || process.env.CLIENT_URL || "").trim().replace(/\/+$/, "");

export const appLink = (path) => `${baseUrl()}${path || "/"}`;

const COLOR = { urgent: "#b42318", action: "#b54708", info: "#2B2F78", digest: "#2B2F78" };

/**
 * สร้างอีเมล 1 ฉบับ
 * @param {object} p
 * @param {"urgent"|"action"|"info"|"digest"} p.label
 * @param {string} p.topic      เรื่อง เช่น "พนักงานปฏิเสธงาน"
 * @param {string} [p.ref]      ต่อท้าย subject เช่น "OF/00-01/2026 · Pipe Fitter A"
 * @param {string} p.lead       บรรทัดแรก — เกิดอะไร
 * @param {Array<[string,string]>} p.rows  ตารางสั้น [หัว, ค่า] (ค่าเป็นข้อความธรรมดา จะถูก escape)
 * @param {string} [p.todo]     สิ่งที่ต้องทำ
 * @param {{label:string, path:string}} [p.button]
 */
export function renderEmail({ label, topic, ref, lead, rows = [], todo, button }) {
  const subject = `[MMS] [${LABEL[label]}] ${topic}${ref ? ` — ${ref}` : ""}`;
  const url = button ? appLink(button.path) : null;
  const footer =
    "อีเมลอัตโนมัติจาก MMS — ไม่ต้องตอบกลับ · ลิงก์เปิดได้จากเครือข่ายบริษัท";

  const keyW = Math.max(0, ...rows.map(([k]) => k.length)) + 2;
  const text = [
    lead,
    "",
    ...rows.map(([k, v]) => `${k.padEnd(keyW)}${v ?? "—"}`),
    ...(todo ? ["", `สิ่งที่ต้องทำ: ${todo}`] : []),
    ...(url ? ["", `${button.label}: ${url}`] : []),
    "",
    "—",
    footer,
  ].join("\n");

  const color = COLOR[label] || COLOR.info;
  const html = `<!doctype html>
<html><body style="margin:0;background:#f4f5f7;font-family:Tahoma,'Leelawadee UI',Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px">
<tr><td style="padding:16px 24px;border-bottom:3px solid ${color}">
  <span style="display:inline-block;background:${color};color:#fff;font-size:12px;font-weight:bold;padding:2px 8px;border-radius:4px">${esc(LABEL[label])}</span>
  <div style="margin-top:8px;font-size:17px;font-weight:bold">${esc(topic)}</div>
  ${ref ? `<div style="margin-top:2px;font-size:13px;color:#6b7280">${esc(ref)}</div>` : ""}
</td></tr>
<tr><td style="padding:20px 24px 4px;font-size:14px;line-height:1.6">${esc(lead)}</td></tr>
${
  rows.length
    ? `<tr><td style="padding:8px 24px">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse">
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap;vertical-align:top;border-bottom:1px solid #f3f4f6">${esc(k)}</td><td style="padding:6px 0;vertical-align:top;border-bottom:1px solid #f3f4f6;white-space:pre-wrap">${esc(v ?? "—")}</td></tr>`,
  )
  .join("\n")}
</table></td></tr>`
    : ""
}
${
  todo
    ? `<tr><td style="padding:12px 24px 4px;font-size:14px"><b>สิ่งที่ต้องทำ:</b> ${esc(todo)}</td></tr>`
    : ""
}
${
  url
    ? `<tr><td style="padding:16px 24px 8px"><a href="${esc(url)}" style="display:inline-block;background:#2B2F78;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:10px 18px;border-radius:6px">${esc(button.label)}</a></td></tr>`
    : ""
}
<tr><td style="padding:16px 24px;font-size:12px;color:#9ca3af;border-top:1px solid #f3f4f6">${esc(footer)}</td></tr>
</table>
</td></tr></table>
</body></html>`;

  return { subject, html, text };
}
