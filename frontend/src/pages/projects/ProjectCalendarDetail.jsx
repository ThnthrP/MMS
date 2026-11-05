import { useState, useEffect, useContext, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import axios from "axios";
import { AppContent } from "../../context/AppContext";
import {
  fmtDate,
  fmtShort,
  projectCode,
  StageBadge,
  StageStepper,
} from "./calendarShared";
import HistoryPanel from "./HistoryPanel";

// ══════════════════════════════════════════════════════════
// Manpower Calendar — รายละเอียด requirement
//   1) Timeline ขั้นตอน (ยึด flowchart ISO)
//   2) ตารางวันทำงานรายคน (R = วันพักก่อนลงงาน · MB = วันลงงาน · DM = วันกลับ)
//   3) แท็บ: ทีม & ตำแหน่ง · Check In · Rest Day · ผู้ประเมิน
//   ขวา) ประวัติ — ใครทำอะไร เมื่อไร
// ══════════════════════════════════════════════════════════

const CARD = "rounded-[10px] border border-gray-200 bg-white";
const CARD_HEAD =
  "flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 text-[13px] font-bold sm:px-5";
const GO_BTN =
  "inline-flex items-center rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 no-underline hover:bg-gray-50";
const LINK = "text-xs font-semibold text-blue-600 no-underline hover:underline";
const MAX_DAYS = 120;
const MAX_REST_SHOWN = 30; // แสดงวันพัก (R) ในตารางไม่เกินกี่วันก่อน MOB

const DAY_MS = 86400000;
const dayStart = (d) => {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate());
};
const sameDay = (a, b) => a && b && dayStart(a).getTime() === dayStart(b).getTime();
const addDays = (d, n) => new Date(d.getTime() + n * DAY_MS);

// [ป้าย, สี, คำอธิบาย (tooltip)] — คำเดียวกับหน้า Assign Names (Proposed / Approved)
const CONFIRM_LABEL = {
  confirmed: ["✓ ตอบรับ", "bg-emerald-100 text-emerald-800", "พนักงานกดตอบรับงานใน Worker App แล้ว"],
  rejected: ["✕ ปฏิเสธ", "bg-red-100 text-red-700", "พนักงานกดปฏิเสธงานใน Worker App — ต้องหาคนแทน"],
  pending: ["รอตอบรับ", "bg-amber-100 text-amber-800", "Approve แล้ว รอพนักงานกดตอบรับใน Worker App"],
};
const CAND_LABEL = {
  approved: ["Approved", "bg-blue-100 text-blue-800", "Approve แล้วที่ Assign Names (หรือ PE อนุมัติ)"],
  proposed: ["Proposed", "bg-gray-100 text-gray-600", "เสนอชื่อแล้ว ยังไม่ Approve — กด Approve ที่ Assign Names"],
  rejected: ["ไม่อนุมัติ", "bg-red-100 text-red-700", "ไม่อนุมัติรายชื่อนี้"],
};
const CHECK_LABEL = {
  alcohol_test: "แอลกอฮอล์",
  drug_test: "สารเสพติด",
  ppe_inspection: "PPE",
  baggage_inspection: "กระเป๋า",
  blood_pressure_check: "ความดัน",
};

function Pill({ cls, children, title }) {
  return (
    <span title={title} className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>
      {children}
    </span>
  );
}

function PersonCell({ id, name, sub }) {
  return (
    <div className="min-w-0">
      <Link to={`/workers/${id}`} className="font-semibold text-gray-900 no-underline hover:text-blue-600">
        {name || "—"}
      </Link>
      {sub && <div className="text-[10px] text-gray-500">{sub}</div>}
    </div>
  );
}

const restText = (r) =>
  r?.restDays == null
    ? null
    : `พัก ${r.restDays}${r.requiredRest != null ? `/${r.requiredRest}` : ""}`;

// ── ตารางวันทำงาน ──
function DayGrid({ project, restByEmp }) {
  const rows = project.employees;
  const range = useMemo(() => {
    const dates = [
      project.startDate,
      project.endDate,
      ...rows.flatMap((e) => [e.mobDate, e.demobDate]),
      // วันพักก่อนลงงาน (ไม่เกิน MAX_REST_SHOWN วัน)
      ...rows.map((e) => {
        const r = restByEmp.get(e.employeeId);
        if (!r?.prevDemobDate || !e.mobDate) return null;
        const from = addDays(dayStart(r.prevDemobDate), 1);
        const limit = addDays(dayStart(e.mobDate), -MAX_REST_SHOWN);
        return from > limit ? from : limit;
      }),
    ]
      .filter(Boolean)
      .map(dayStart);
    if (dates.length === 0) return [];
    const from = addDays(new Date(Math.min(...dates)), -1);
    const to = addDays(new Date(Math.max(...dates)), 2);
    const n = Math.min(MAX_DAYS, Math.round((to - from) / DAY_MS) + 1);
    return Array.from({ length: n }, (_, i) => addDays(from, i));
  }, [project, rows, restByEmp]);

  if (rows.length === 0)
    return (
      <div className="p-6 text-center text-xs text-gray-400">
        ยังไม่มีพนักงานลงตารางวันทำงาน (กำหนด MOB / D-MOB ที่ Worker Schedule)
      </div>
    );
  if (range.length === 0)
    return <div className="p-6 text-center text-xs text-gray-400">ยังไม่มีวันที่ MOB / D-MOB</div>;

  const today = dayStart(new Date());
  const months = [];
  range.forEach((d, i) => {
    const label = d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
    if (!months.length || months[months.length - 1].label !== label) months.push({ label, start: i, span: 1 });
    else months[months.length - 1].span++;
  });

  return (
    <div>
      {/* เลื่อนแนวนอนเฉพาะตาราง — คำอธิบายสัญลักษณ์ด้านล่างอยู่กับที่ */}
      <div className="overflow-x-auto">
      <table className="border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="sticky left-0 z-[2] min-w-[190px] bg-white" />
            {months.map((m) => (
              <th
                key={m.label}
                colSpan={m.span}
                className="border-b border-l border-gray-200 bg-gray-50 px-1 py-1 text-left font-semibold text-gray-600"
              >
                {m.label}
              </th>
            ))}
            <th className="bg-white" />
          </tr>
          <tr>
            <th className="sticky left-0 z-[2] bg-white px-3 py-1 text-left text-[10px] font-semibold text-gray-500 shadow-[1px_0_0_#e5e7eb]">
              พนักงาน
            </th>
            {range.map((d) => (
              <th
                key={d.getTime()}
                className={`w-7 min-w-[28px] border-b border-gray-200 py-1 text-center font-medium ${
                  sameDay(d, today) ? "bg-blue-600 text-white" : "text-gray-500"
                }`}
              >
                {d.getDate()}
              </th>
            ))}
            <th className="px-2 text-left text-[10px] font-semibold text-gray-500">Platform · พัก</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e, ri) => {
            const mob = e.mobDate ? dayStart(e.mobDate) : null;
            const demob = e.demobDate ? dayStart(e.demobDate) : null;
            const r = restByEmp.get(e.employeeId);
            const prevDemob = r?.prevDemobDate ? dayStart(r.prevDemobDate) : null;
            return (
              <tr key={`${e.employeeId}-${ri}`} className="border-t border-gray-100">
                <td className="sticky left-0 z-[1] bg-white px-3 py-1.5 shadow-[1px_0_0_#e5e7eb]">
                  <PersonCell
                    id={e.employeeId}
                    name={e.fullName}
                    sub={`${e.empId || e.empCode} · ${e.requestedPosition || "—"}`}
                  />
                </td>
                {range.map((d) => {
                  const isMob = mob && sameDay(d, mob);
                  const isDemob = demob && sameDay(d, demob);
                  const onJob = mob && d > mob && (!demob || d < demob);
                  const isRest =
                    mob && prevDemob && d > prevDemob && d < mob && (mob - d) / DAY_MS <= MAX_REST_SHOWN;
                  const isPrevDemob = prevDemob && sameDay(d, prevDemob) && (mob - d) / DAY_MS <= MAX_REST_SHOWN;
                  let cls = "";
                  let txt = "";
                  if (isMob) {
                    cls = e.hangarFailed ? "bg-red-600 text-white" : "bg-[#b91c1c] text-white";
                    txt = e.hangarFailed ? "✕" : "MB";
                  } else if (isDemob) {
                    cls = "bg-[#7f1d1d] text-white";
                    txt = "DM";
                  } else if (onJob) {
                    cls = "bg-red-100 text-red-800";
                    txt = Math.round((d - mob) / DAY_MS);
                  } else if (isPrevDemob) {
                    cls = "bg-gray-200 text-gray-500";
                    txt = "จบ";
                  } else if (isRest) {
                    cls = "bg-rose-50 text-rose-500";
                    txt = "R";
                  }
                  return (
                    <td
                      key={d.getTime()}
                      title={
                        isMob
                          ? `MOB ${fmtDate(mob)}${e.hangarFailed ? " — ตรวจไม่ผ่าน" : ""}`
                          : isDemob
                            ? `D-MOB ${fmtDate(demob)}`
                            : isPrevDemob
                              ? `จบงานก่อนหน้า${r?.prevProject ? ` (${r.prevProject})` : ""}`
                              : isRest
                                ? "วันพักก่อนลงงาน"
                                : undefined
                      }
                      className={`h-8 border-l border-white text-center text-[10px] font-semibold ${cls} ${
                        sameDay(d, today) && !cls ? "bg-blue-50" : ""
                      }`}
                    >
                      {txt}
                    </td>
                  );
                })}
                <td className="whitespace-nowrap px-2 text-gray-600">
                  {e.platform || "—"}
                  {restText(r) && (
                    <span className={`ml-1.5 font-semibold ${r.enough === false ? "text-red-600" : "text-emerald-700"}`}>
                      · {restText(r)} {r.enough === false ? "✕" : r.enough ? "✓" : ""}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-100 px-4 py-2 text-[10px] text-gray-500">
        <span><b className="rounded bg-gray-200 px-1 text-gray-500">จบ</b> จบงานก่อนหน้า</span>
        <span><b className="rounded bg-rose-50 px-1 text-rose-500">R</b> วันพักก่อนลงงาน</span>
        <span><b className="rounded bg-[#b91c1c] px-1 text-white">MB</b> วันลงงาน (MOB)</span>
        <span><b className="rounded bg-red-100 px-1 text-red-800">1 2 3</b> วันที่อยู่บนงาน</span>
        <span><b className="rounded bg-[#7f1d1d] px-1 text-white">DM</b> วันกลับ (D-MOB)</span>
        <span><b className="rounded bg-red-600 px-1 text-white">✕</b> Check In ไม่ผ่าน (ตรวจก่อนเดินทาง)</span>
        <span><b className="rounded bg-blue-600 px-1 text-white">วันนี้</b></span>
        <span>พัก x/y = พักแล้ว x วัน / ควรพัก y วัน</span>
      </div>
    </div>
  );
}

// ── แท็บ: ทีม & ตำแหน่ง ──
function TeamTab({ p }) {
  if (!p.team?.length)
    return <div className="p-6 text-center text-xs text-gray-400">ยังไม่มีตำแหน่ง — เพิ่มที่หน้า Requirement</div>;
  return (
    <div className="divide-y divide-gray-100">
      {p.team.map((t) => {
        const approved = t.members.filter((m) => m.status === "approved").length;
        return (
          <div key={t.requestId} className="px-4 py-3 sm:px-5">
            <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
              <span className="text-[13px] font-bold">{t.position}</span>
              <span className={`text-xs ${approved >= t.quantity ? "text-emerald-700" : "text-red-600"}`}>
                อนุมัติ {approved}/{t.quantity}
              </span>
            </div>
            {t.members.length === 0 ? (
              <div className="text-xs text-gray-400">— ยังไม่มีรายชื่อ</div>
            ) : (
              <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
                {t.members.map((m) => {
                  const [cl, cc, ct] = CAND_LABEL[m.status] || CAND_LABEL.proposed;
                  const [fl, fc, ft] = CONFIRM_LABEL[m.workerConfirmStatus] || CONFIRM_LABEL.pending;
                  return (
                    <div key={m.employeeId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2 text-xs">
                      <PersonCell id={m.employeeId} name={m.fullName} sub={`${m.empId || m.empCode} · ${m.employeePosition || "—"}`} />
                      <div className="flex flex-wrap gap-1">
                        <Pill cls={cc} title={ct}>{cl}</Pill>
                        {m.status === "approved" && <Pill cls={fc} title={ft}>{fl}</Pill>}
                        <Pill
                          cls={m.medicalOk ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}
                          title={
                            m.medicalExpiry
                              ? `ผลตรวจสุขภาพหมดอายุ ${fmtDate(m.medicalExpiry)} — ${m.medicalOk ? "ใช้ได้ถึงวันเริ่มงาน" : "ไม่ทันวันเริ่มงาน หรือผลไม่ผ่าน"}`
                              : "ไม่มีผลตรวจสุขภาพ — จองที่ Medical Bookings"
                          }
                        >
                          {m.medicalOk ? "สุขภาพ ✓" : "สุขภาพ ✕"}
                        </Pill>
                        {m.pendingTraining > 0 && (
                          <Pill cls="bg-amber-100 text-amber-800" title={`มีคำขออบรม ${m.pendingTraining} หลักสูตรที่ Training Bookings รอ HR ยืนยัน`}>
                            รออบรม {m.pendingTraining}
                          </Pill>
                        )}
                        {m.mobDate && <Pill cls="bg-red-50 text-red-700">MOB {fmtShort(m.mobDate)}</Pill>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── แท็บ: Check In (1 เที่ยว = คนที่ MOB วันเดียวกัน) ──
function CheckInTab({ p }) {
  const [sel, setSel] = useState(0);
  const trips = p.trips || [];
  if (trips.length === 0)
    return <div className="p-6 text-center text-xs text-gray-400">ยังไม่มีเที่ยวเดินทาง — กำหนดวัน MOB ที่ Worker Schedule</div>;
  const t = trips[Math.min(sel, trips.length - 1)];
  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]">
      {/* รายการเที่ยว */}
      <div className="border-b border-gray-100 md:border-b-0 md:border-r">
        <div className={`px-4 py-2 text-[11px] font-semibold ${trips.every((x) => x.allChecked) ? "text-emerald-700" : "text-gray-500"}`}>
          {trips.every((x) => x.allChecked) ? "✓ ตรวจครบทุกเที่ยวแล้ว" : `${trips.length} เที่ยว`}
        </div>
        {trips.map((x, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setSel(i)}
            className={`block w-full cursor-pointer border-0 border-l-4 px-4 py-2 text-left text-xs ${
              i === sel ? "border-l-[#F16726] bg-orange-50" : "border-l-transparent bg-white hover:bg-gray-50"
            }`}
          >
            <div className="font-bold">MOB · เที่ยว {x.no}</div>
            <div className="text-gray-500">
              {fmtDate(x.mobDate)} · {x.travelers.length} คน
              {x.failed > 0 && <span className="ml-1 font-semibold text-red-600">· ไม่ผ่าน {x.failed}</span>}
            </div>
          </button>
        ))}
      </div>

      {/* รายละเอียดเที่ยว */}
      <div className="min-w-0">
        <div className="grid grid-cols-2 gap-3 border-b border-gray-100 px-4 py-3 text-xs sm:grid-cols-4">
          {[
            ["เที่ยว", `MOB · เที่ยว ${t.no}`],
            ["วันเดินทาง", fmtDate(t.mobDate)],
            ["ผู้เดินทาง", `${t.travelers.length} คน`],
            ["เรือ", t.vessels.join(", ") || "—"],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="text-[10px] text-gray-500">{k}</div>
              <div className="font-semibold">{v}</div>
            </div>
          ))}
          <div className="col-span-2 sm:col-span-4">
            <div className="text-[10px] text-gray-500">เส้นทาง</div>
            <div className="font-semibold">{t.route}</div>
          </div>
        </div>
        <div className="divide-y divide-gray-100">
          {t.travelers.map((x, i) => (
            <div key={x.employeeId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <span className="w-5 text-right text-gray-400">{i + 1}.</span>
                <PersonCell id={x.employeeId} name={x.fullName} sub={`${x.empId || x.empCode} · ${x.position || "—"}`} />
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Pill cls={x.vesselDone ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-500"}>
                  เรือ {x.vesselName || "—"}
                  {x.departureDate ? ` · ${fmtShort(x.departureDate)}` : ""}
                </Pill>
                {x.transportType && <Pill cls="bg-gray-100 text-gray-600">รถ {x.transportType}</Pill>}
                {x.hotelName && <Pill cls="bg-gray-100 text-gray-600">ที่พัก {x.hotelName}</Pill>}
                {x.checks.length === 0 ? (
                  <Pill cls="bg-gray-100 text-gray-400">ยังไม่มีรายการตรวจ</Pill>
                ) : (
                  x.checks.map((c) => (
                    <Pill
                      key={c.taskType}
                      cls={
                        c.resultStatus === "fail"
                          ? "bg-red-100 text-red-700"
                          : c.resultStatus === "pass" || c.status === "completed"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                      }
                      title={c.measuredValue || undefined}
                    >
                      {CHECK_LABEL[c.taskType] || c.taskType}{" "}
                      {c.resultStatus === "fail" ? "✕" : c.resultStatus === "pass" || c.status === "completed" ? "✓" : "…"}
                    </Pill>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-100 px-4 py-2 text-right">
          <Link to={`/mobilization?projectId=${p.id}`} className={LINK}>
            บันทึกผลตรวจ / ข้อมูลเดินทางที่ Worker Schedule →
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── แท็บ: Rest Day ──
function RestDayTab({ p }) {
  const rows = p.restDays || [];
  if (rows.length === 0)
    return <div className="p-6 text-center text-xs text-gray-400">ยังไม่มีพนักงานลงตารางวันทำงาน</div>;
  const short = rows.filter((r) => r.enough === false).length;
  return (
    <div>
      <div className="px-4 py-2 text-[11px] text-gray-500 sm:px-5">
        นับจาก D-MOB งานก่อนหน้า ถึงวัน MOB งานนี้ · ควรพัก = {Math.round((p.restRatio || 0.5) * 100)}% ของจำนวนวันที่อยู่บนงานรอบก่อน
        {short > 0 && <span className="ml-1 font-semibold text-red-600">· พักไม่พอ {short} คน</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-gray-50 text-[10px] font-semibold text-gray-500">
              <th className="px-4 py-2 text-left">พนักงาน</th>
              <th className="px-3 py-2 text-left">งานก่อนหน้า</th>
              <th className="px-3 py-2 text-left">D-MOB ก่อนหน้า</th>
              <th className="px-3 py-2 text-left">MOB งานนี้</th>
              <th className="px-3 py-2 text-center">อยู่บนงานรอบก่อน</th>
              <th className="px-3 py-2 text-center">พัก</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employeeId} className="border-t border-gray-100">
                <td className="px-4 py-2"><PersonCell id={r.employeeId} name={r.fullName} sub={r.empId || r.empCode} /></td>
                <td className="px-3 py-2 text-gray-600">{r.prevProject || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2">{fmtDate(r.prevDemobDate)}</td>
                <td className="whitespace-nowrap px-3 py-2">{fmtDate(r.mobDate)}</td>
                <td className="px-3 py-2 text-center">{r.prevHitchDays != null ? `${r.prevHitchDays} วัน` : "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-center">
                  {r.restDays == null ? (
                    <span className="text-gray-400">ไม่มีงานก่อนหน้า</span>
                  ) : (
                    <span className={`font-semibold ${r.enough === false ? "text-red-600" : "text-emerald-700"}`}>
                      {r.restDays}
                      {r.requiredRest != null ? `/${r.requiredRest}` : ""} วัน {r.enough === false ? "✕" : r.enough ? "✓" : ""}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── แท็บ: ผู้ประเมิน (ดูอย่างเดียว — ประเมินที่ Worker Schedule › Post-Project Review) ──
function ReviewTab({ p }) {
  const rows = p.reviews || [];
  const done = rows.filter((r) => r.reviewed).length;
  if (rows.length === 0)
    return <div className="p-6 text-center text-xs text-gray-400">ยังไม่มีพนักงานลงงานในโปรเจกต์นี้</div>;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs sm:px-5">
        <span className="font-semibold">
          ผังผู้ประเมิน <span className="font-normal text-gray-500">· ใครประเมินใคร</span>
        </span>
        <span className={done === rows.length ? "font-semibold text-emerald-700" : "font-semibold text-[#c2410c]"}>
          ประเมินแล้ว {done}/{rows.length}
        </span>
      </div>
      <div className="divide-y divide-gray-100 border-t border-gray-100">
        {rows.map((r) => (
          <div key={r.employeeId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs sm:px-5">
            <PersonCell id={r.employeeId} name={r.fullName} sub={`${r.position || "—"} · ${r.empId || r.empCode}`} />
            {r.reviewed ? (
              <span className="text-gray-600">
                <span className="text-[#f5a623]">{"★".repeat(r.rating || 0)}</span>
                <span className="text-gray-300">{"★".repeat(5 - (r.rating || 0))}</span>
                <span className="ml-2">โดย {r.reviewer || "—"} · {fmtShort(r.reviewedAt)}</span>
              </span>
            ) : (
              <Pill cls="bg-amber-100 text-amber-800">⚠ ยังไม่ประเมิน</Pill>
            )}
          </div>
        ))}
      </div>
      <div className="border-t border-gray-100 px-4 py-2 text-right">
        <Link to={`/review?projectId=${p.id}`} className={LINK}>
          ประเมินที่ Worker Schedule › Post-Project Review →
        </Link>
      </div>
    </div>
  );
}

export default function ProjectCalendarDetail() {
  const { id } = useParams();
  const { backendUrl } = useContext(AppContent);
  const [p, setP] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("team");
  const [showHistory, setShowHistory] = useState(true);

  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    setLoading(true);
    axios
      .get(`${backendUrl}/api/supervisor/projects-overview/${id}`, { withCredentials: true })
      .then((res) => setP(res.data))
      .catch((err) => setError(err.response?.data?.message || "โหลดข้อมูลไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, [backendUrl, id, reloadKey]);

  // ลบข้อมูลลงงานของคนที่ไม่ได้ Approve แล้ว (endpoint เดียวกับปุ่ม Undeploy ใน Worker Schedule)
  const undeployOrphan = async (o) => {
    if (!window.confirm(`Undeploy ${o.fullName}? (ลบข้อมูลลงงานในโปรเจกต์นี้)`)) return;
    try {
      await axios.post(
        `${backendUrl}/api/mobilization/undeploy`,
        { projectId: id, employeeId: o.employeeId },
        { withCredentials: true },
      );
      setReloadKey((k) => k + 1);
    } catch (err) {
      alert(err.response?.data?.message || "Undeploy ไม่สำเร็จ");
    }
  };

  const restByEmp = useMemo(
    () => new Map((p?.restDays || []).map((r) => [r.employeeId, r])),
    [p],
  );

  if (loading) return <div className="p-4 text-gray-500">Loading...</div>;
  if (!p) return <div className="p-4 text-gray-500">{error || "ไม่พบ requirement"}</div>;

  const code = projectCode(p);
  const need = p.requests.reduce((n, r) => n + r.quantity, 0);
  const approvedTotal = (p.team || []).reduce(
    (n, t) => n + t.members.filter((m) => m.status === "approved").length,
    0,
  );
  const restShort = (p.restDays || []).filter((r) => r.enough === false).length;
  const reviewed = (p.reviews || []).filter((r) => r.reviewed).length;
  const tripsChecked = (p.trips || []).filter((t) => t.allChecked).length;

  const TABS = [
    ["team", "ทีม & ตำแหน่ง", `${approvedTotal}/${need}`, approvedTotal < need],
    ["checkin", "Check In", `${tripsChecked}/${(p.trips || []).length}`, tripsChecked < (p.trips || []).length],
    ["rest", "Rest Day", restShort || "", restShort > 0],
    ["review", "ผู้ประเมิน", `${reviewed}/${(p.reviews || []).length}`, reviewed < (p.reviews || []).length],
  ];

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1800px]">
      {/* ════════ Header ════════ */}
      <div className="mb-4">
        <Link to="/projects-overview" className="mb-2 inline-block text-[13px] text-gray-500 no-underline hover:text-gray-700">
          ← Manpower Calendar
        </Link>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h4 className="mb-1 break-words text-xl font-bold">
              {code && <span className="mr-2 font-mono text-blue-600">{code}</span>}
              {p.name}
            </h4>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-gray-500">
              <span>ลูกค้า <b className="text-gray-800">{p.client || "—"}</b></span>
              {p.contract && <span>Contract <b className="text-gray-800">{p.contract}</b></span>}
              <span>Location <b className="text-gray-800">{p.location || "—"}</b></span>
              <span>
                ช่วงทำงาน <b className="text-gray-800">{fmtDate(p.startDate)} – {fmtDate(p.endDate)}</b>
              </span>
              <span>{p.isOffshore ? "Offshore" : "Onshore"}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link to={`/projects/${p.id}`} className={GO_BTN}>Requirement →</Link>
            <Link to={`/allocation?projectId=${p.id}`} className={GO_BTN}>Assign Names →</Link>
            <Link to={`/mobilization?projectId=${p.id}`} className={GO_BTN}>Worker Schedule →</Link>
            {!showHistory && (
              <button type="button" onClick={() => setShowHistory(true)} className={`${GO_BTN} cursor-pointer`}>
                🕘 ประวัติ
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={`grid grid-cols-1 items-start gap-4 ${showHistory ? "2xl:grid-cols-[minmax(0,1fr)_340px]" : ""}`}>
        <div className="min-w-0">
          {/* ════════ 1) Timeline ขั้นตอน ════════ */}
          <div className={`${CARD} mb-4`}>
            <div className={CARD_HEAD}>
              <span>ขั้นตอนการดำเนินงาน</span>
              <span className="flex items-center gap-2 text-xs font-normal text-gray-500">
                ตอนนี้อยู่ที่ <StageBadge stage={p.currentStage} />
              </span>
            </div>
            <div className="px-3 py-4 sm:px-5">
              <StageStepper stages={p.stages} projectId={p.id} />
            </div>
          </div>

          {/* ════════ 2) ตารางวันทำงาน ════════ */}
          <div className={`${CARD} mb-4 overflow-hidden`}>
            <div className={CARD_HEAD}>
              <span>ช่วงเวลาทำงาน · {p.employees.length} คนลงตาราง / ต้องการ {need} คน</span>
              <Link to={`/mobilization?projectId=${p.id}`} className={LINK}>
                แก้วัน MOB / D-MOB ที่ Worker Schedule →
              </Link>
            </div>
            {p.orphanAssignments?.length > 0 && (
              <div className="border-b border-gray-200 bg-[#fff5f5] px-3 py-2 text-xs sm:px-5">
                <div className="font-semibold text-[#842029]">
                  ⚠ Deploy ค้าง {p.orphanAssignments.length} คน — ไม่ได้ Approve แล้ว (ไม่นับในตารางและขั้นตอน)
                </div>
                {p.orphanAssignments.map((o) => (
                  <div key={o.employeeId} className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold text-gray-800">{o.fullName}</span>
                    <span className="text-gray-500">
                      {o.empId || o.empCode} · MOB {o.mobDate ? fmtDate(o.mobDate) : "—"}
                    </span>
                    <button
                      type="button"
                      onClick={() => undeployOrphan(o)}
                      className="cursor-pointer rounded-md border border-[#dc3545] bg-white px-2.5 py-0.5 font-semibold text-[#dc3545] hover:bg-red-50"
                    >
                      Undeploy
                    </button>
                  </div>
                ))}
              </div>
            )}
            <DayGrid project={p} restByEmp={restByEmp} />
          </div>

          {/* ════════ 3) แท็บ ════════ */}
          <div className={`${CARD} overflow-hidden`}>
            <div className="flex gap-1 overflow-x-auto border-b border-gray-200 bg-gray-50 px-2 pt-2">
              {TABS.map(([key, label, count, warn]) => {
                const active = tab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={`-mb-px flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-t-md border px-3.5 py-2 text-[13px] ${
                      active
                        ? "border-gray-200 border-b-white bg-white font-bold text-[#c2410c]"
                        : "border-transparent bg-transparent text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    {label}
                    {count !== "" && (
                      <span
                        className={`rounded-full px-1.5 text-[10px] font-bold ${
                          warn ? "bg-red-500 text-white" : "bg-emerald-100 text-emerald-800"
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {tab === "team" && <TeamTab p={p} />}
            {tab === "checkin" && <CheckInTab p={p} />}
            {tab === "rest" && <RestDayTab p={p} />}
            {tab === "review" && <ReviewTab p={p} />}
          </div>

          {p.notes && (
            <div className={`${CARD} mt-4 px-4 py-3 text-xs text-gray-700 sm:px-5`}>
              <div className="mb-1 text-[10px] font-semibold uppercase text-gray-500">Remarks</div>
              <div className="whitespace-pre-wrap break-words">{p.notes}</div>
            </div>
          )}
        </div>

        {/* ════════ ขวา: ประวัติ ════════ */}
        {showHistory && (
          <HistoryPanel projectId={p.id} onClose={() => setShowHistory(false)} />
        )}
      </div>
    </div>
  );
}
