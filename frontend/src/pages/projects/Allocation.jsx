import { useState, useEffect, useContext, useRef, useMemo } from "react";
import axios from "axios";
import Select from "react-select";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppContent } from "../../context/AppContext";
import useStickyState from "../../hooks/useStickyState";
import {
  buildWorkerOptions,
  filterWorkerOption,
  nameTH,
  workerLabel,
} from "../../utils/workerSearch";
import {
  PrintModal,
  ResumePage,
  SkillMatrixTable,
  exportSkillMatrixExcel,
  fmtShort,
  calcAge,
  EXCEL_BTN,
} from "../../components/print/PrintDocs";

// อายุเกษียณ (ปรับได้ตามนโยบายบริษัท)
const RETIREMENT_AGE = 60;

const SSE_LABEL = { new_sse: "NEW SSE", sse1: "SSE1", sse2: "SSE2" };

const MEDICAL_STATUS_LABEL = {
  passed: "Fit",
  pending: "Pending",
  failed: "Unfit",
  not_required: "Fit w/ Restriction",
};

const EMP_TYPES = [
  ["permanent", "Permanent"],
  ["nonpermanent", "Non-Permanent"],
  ["new_sse", "New SSE"],
  ["all", "All"],
];
const SORTS = [
  ["dayoff", "Rest Days"],
  ["match", "% Match"],
];

// เหตุผลขออนุมัติ PE — "other" ต้องพิมพ์เอง
const EXCEPTION_REASONS = [
  ["no_full_match", "ไม่มีคนที่ครบ 100% ว่างในช่วงนี้"],
  ["experienced", "มีประสบการณ์ในตำแหน่งนี้"],
  ["training_booked", "HR นัดอบรม training ที่ขาดแล้ว"],
  ["other", "อื่นๆ"],
];

// ══════════════════════════════════════════════════════════
// Tailwind class ที่ใช้ซ้ำ
// ══════════════════════════════════════════════════════════
const LABEL =
  "mb-1 block text-xs font-semibold uppercase tracking-[0.4px] text-gray-500";
// z-index กำหนดแยกต่อหัวคอลัมน์ใน WorkerTable (หัวที่ตรึงซ้ายต้องอยู่บนสุด)
const TH =
  "sticky top-0 bg-white px-3 py-2.5 text-[11px] font-semibold tracking-[0.5px] text-gray-500 shadow-[inset_0_-1px_0_#dee2e6]";
const TD = "px-3 py-3 align-middle";
// ตรึง checkbox + NAME ไว้ซ้ายเวลาเลื่อนตารางแนวนอน
// bg-inherit = ใช้สีพื้นของแถว (รวมสีตอน hover / ตอนเลือก) กันข้อความคอลัมน์อื่นลอดข้างใต้
// เส้นแบ่งใช้ ::after เพราะ border ของตารางแบบ border-collapse ไม่เลื่อนตาม sticky
// คอลัมน์ checkbox กว้าง 72px (มีคำว่า "เลือกทั้งหมด" อยู่เหนือ checkbox ที่หัวตาราง)
//   NAME จึงตรึงที่ left-[72px] — แก้ความกว้างต้องแก้ทั้ง 3 จุด (col / STICKY_NAME / หัว NAME)
const STICKY_CHECK = "sticky left-0 z-[2] bg-inherit text-center";
const NAME_DIVIDER =
  "after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-gray-200 after:content-['']";
const STICKY_NAME = `sticky left-[72px] z-[2] bg-inherit ${NAME_DIVIDER}`;
const MODAL_HEAD =
  "flex shrink-0 items-center justify-between gap-3 px-4 py-3.5 text-white sm:px-6";
const MODAL_FOOT =
  "flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-gray-200 px-4 py-3.5 sm:px-6";
const CLOSE_X =
  "shrink-0 cursor-pointer border-none bg-transparent text-xl leading-none text-white";
const BTN_OUTLINE =
  "cursor-pointer rounded-lg border border-gray-200 bg-white px-5 py-2 text-[13px] hover:bg-gray-50";
const BTN_GREEN =
  "cursor-pointer rounded-lg border-none bg-[#198754] font-semibold text-white hover:bg-[#157347] disabled:cursor-not-allowed disabled:opacity-60";
const LINK_TEXT =
  "cursor-pointer border-none bg-transparent p-0 font-semibold text-blue-600 hover:underline";
const DASH = <span className="text-gray-400">—</span>;

// ── สี badge ──
const TONE = {
  green: "bg-[#d1e7dd] text-[#0f5132]",
  yellow: "bg-[#fff3cd] text-[#664d03]",
  orange: "bg-[#ffe0b2] text-[#8a4b00]",
  red: "bg-[#f8d7da] text-[#842029]",
  darkRed: "bg-[#f5c2c7] text-[#58151c]",
  blue: "bg-[#cfe2ff] text-[#084298]",
  gray: "bg-gray-100 text-gray-500",
  grayDark: "bg-gray-100 text-gray-700",
};

// ── react-select (ใช้ styles API ของไลบรารี — ใส่ className ตรงๆ ไม่ได้) ──
const SELECT_PORTAL = {
  menuPortalTarget: typeof document !== "undefined" ? document.body : null,
  menuPosition: "fixed",
};

const customSelectStyles = {
  control: (b) => ({
    ...b,
    borderColor: "#dee2e6",
    borderRadius: "8px",
    minHeight: "36px",
    fontSize: "13px",
    boxShadow: "none",
    "&:hover": { borderColor: "#86b7fe" },
  }),
  option: (b) => ({ ...b, fontSize: "13px" }),
  placeholder: (b) => ({ ...b, fontSize: "13px", color: "#6c757d" }),
  menuPortal: (b) => ({ ...b, zIndex: 9999 }),
  singleValue: (b) => ({
    ...b,
    whiteSpace: "normal",
    wordBreak: "break-word",
    overflow: "visible",
    lineHeight: "1.3",
  }),
  valueContainer: (b) => ({ ...b, padding: "6px 8px" }),
};

const projectSelectStyles = {
  ...customSelectStyles,
  menu: (b) => ({ ...b, minWidth: "min(560px, calc(100vw - 40px))" }),
  menuList: (b) => ({ ...b, maxHeight: "360px" }),
};

const quickSelectStyles = {
  control: (b) => ({
    ...b,
    minHeight: "38px",
    fontSize: "13px",
    borderColor: "#dee2e6",
    boxShadow: "none",
    "&:hover": { borderColor: "#86b7fe" },
  }),
  option: (b) => ({ ...b, fontSize: "13px" }),
  placeholder: (b) => ({ ...b, fontSize: "13px", color: "#6c757d" }),
  multiValue: (b) => ({ ...b, background: "#e7f1ff" }),
  multiValueLabel: (b) => ({
    ...b,
    color: "#0d6efd",
    fontSize: "12px",
    fontWeight: 600,
  }),
  menuPortal: (b) => ({ ...b, zIndex: 9999 }),
};

// ══════════════════════════════════════════════════════════
// helpers
// ══════════════════════════════════════════════════════════
const healthRiskDisplay = (raw) => {
  const n = (raw || "").toLowerCase();
  if (n.includes("significant"))
    return { label: "Significant", tone: "darkRed" };
  if (n.includes("moderate")) return { label: "Moderate", tone: "yellow" };
  if (n.includes("high")) return { label: "High", tone: "red" };
  if (n.includes("low")) return { label: "Low", tone: "green" };
  if (n.includes("pending")) return { label: "Pending", tone: "gray" };
  return { label: raw, tone: "grayDark" };
};

const getRetirementInfo = (birthDate) => {
  if (!birthDate) return null;
  const dob = new Date(birthDate);
  if (isNaN(dob.getTime())) return null;
  const now = new Date();
  const retireDate = new Date(dob);
  retireDate.setFullYear(dob.getFullYear() + RETIREMENT_AGE);
  let monthsLeft =
    (retireDate.getFullYear() - now.getFullYear()) * 12 +
    (retireDate.getMonth() - now.getMonth());
  if (now.getDate() > retireDate.getDate()) monthsLeft -= 1;
  if (monthsLeft <= 0) return { label: "⚠ Over retirement age", tone: "red" };
  if (monthsLeft <= 6)
    return { label: `⚠ Retires in ${monthsLeft} mo`, tone: "orange" };
  if (monthsLeft <= 12)
    return { label: `⚠ Retires in ${monthsLeft} mo`, tone: "yellow" };
  return null;
};

const daysUntil = (d) =>
  Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);

const fmtBanDate = (d) => new Date(d).toLocaleDateString("en-GB");

const matchColor = (pct) =>
  pct === 100
    ? "text-[#198754]"
    : pct >= 70
      ? "text-[#cc8400]"
      : "text-[#dc3545]";

// ══════════════════════════════════════════════════════════
// small components (อยู่นอก Allocation — ไม่ถูกสร้างใหม่ทุก render)
// ══════════════════════════════════════════════════════════
function Pill({ tone, title, className = "", children }) {
  return (
    <span
      title={title}
      className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold ${TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

function MiniTag({ tone, title, children }) {
  return (
    <span
      title={title}
      className={`inline-block rounded px-[5px] text-[10px] font-bold ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

// รหัสพนักงาน + ตำแหน่งปัจจุบัน (แสดงตำแหน่งเฉพาะกรณีไม่ตรงกับ position request)
function EmpMeta({ emp, requestPositionId }) {
  const otherPosition =
    emp?.position?.name && emp.positionId !== requestPositionId
      ? emp.position.name
      : null;
  return (
    <div className="text-[11px] text-gray-500">
      {emp?.empId || "—"}
      {otherPosition && (
        <span
          className="text-[#b45309]"
          title="ตำแหน่งปัจจุบันของพนักงานไม่ตรงกับ position request"
        >
          {" "}
          · ตำแหน่งปัจจุบัน {otherPosition}
        </span>
      )}
    </div>
  );
}

// หนึ่งคนในกล่องสถานะ PE: "รหัส ชื่อ %" บรรทัดเดียว
// ตำแหน่งที่ไม่ตรง / เหตุผลที่ไม่อนุมัติ ขึ้นบรรทัดล่างเฉพาะกรณีที่มี
function PeRow({ emp, requestPositionId, pct, note }) {
  const otherPosition =
    emp?.position?.name && emp.positionId !== requestPositionId
      ? emp.position.name
      : null;
  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-baseline gap-x-1.5 text-[13px]">
        <span className="text-[11px] text-gray-500">{emp?.empId || "—"}</span>
        <span className="font-semibold text-gray-900">{emp?.fullName}</span>
        {pct != null && (
          <span className="text-[11px] font-semibold text-[#cc8400]">
            {pct}%
          </span>
        )}
      </div>
      {otherPosition && (
        <div
          className="text-[11px] text-[#b45309]"
          title="ตำแหน่งปัจจุบันของพนักงานไม่ตรงกับ position request"
        >
          ตำแหน่งปัจจุบัน {otherPosition}
        </div>
      )}
      {note && <div className="break-words text-[11px]">เหตุผล: {note}</div>}
    </div>
  );
}

// ── modal กลางจอ (Health Note / Eligibility / ตะกร้า) ──
function Modal({ onClose, maxW, z = "z-[999999]", children }) {
  return (
    <div
      className={`fixed inset-0 ${z} flex items-center justify-center bg-black/50 p-3 sm:p-5`}
      onClick={onClose}
    >
      <div
        className={`flex max-h-[85vh] w-full ${maxW} flex-col overflow-hidden rounded-[10px] bg-white`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function ModalHeader({ title, onClose, bg = "bg-[#1e3a5f]" }) {
  return (
    <div className={`${MODAL_HEAD} ${bg}`}>
      <span className="min-w-0 text-base font-semibold">{title}</span>
      <button
        type="button"
        onClick={onClose}
        title="ปิด (Esc)"
        className={CLOSE_X}
      >
        ✕
      </button>
    </div>
  );
}

// ── ช่องเลือกแบบปุ่มกลุ่ม (Type / Sort by) ──
function ButtonGroup({ label, options, value, onChange, activeClass }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-gray-500">{label}</span>
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`cursor-pointer rounded-md border px-3 py-[5px] text-xs font-semibold ${
            value === key
              ? activeClass
              : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// ตาราง Worker — ใช้ร่วมกันทั้งตารางหลัก และตาราง "ค้นหา Worker คนใดก็ได้"
// ══════════════════════════════════════════════════════════
// % MATCH / REST DAYS อยู่ต่อจากชื่อ — เป็นตัวตัดสินว่าเลือกได้ไหม และใช้เรียงลำดับ
// (จอเล็กไม่ต้องเลื่อนไปขวาเพื่อกด "ขออนุมัติ PE")
const COLUMNS = [
  ["NAME", "text-left", "w-[26%]"],
  ["% MATCH", "text-center", "w-[17%]"],
  ["REST DAYS", "text-center", "w-[13%]"],
  ["RETIREMENT", "text-center", "w-[13%]"],
  ["HEALTH RISK", "text-left", "w-[15%]"],
  ["MEDICAL", "text-left", "w-[16%]"],
];

// withAction = เพิ่มคอลัมน์ปุ่ม "+ เพิ่ม" ท้ายแถว
function WorkerTable({
  leadHeader,
  withAction = false,
  maxH = "max-h-[560px]",
  children,
}) {
  return (
    <div className={`${maxH} overflow-auto`}>
      <table className="w-full min-w-[840px] table-fixed border-collapse text-[13px]">
        <colgroup>
          <col className="w-[72px]" />
          {COLUMNS.map(([h, , w]) => (
            <col key={h} className={w} />
          ))}
          {withAction && <col className="w-[96px]" />}
        </colgroup>
        <thead>
          <tr>
            <th className={`${TH.replace("px-3 ", "px-1 ")} left-0 z-[3] text-center`}>
              {leadHeader}
            </th>
            {COLUMNS.map(([h, align]) => (
              <th
                key={h}
                className={`${TH} ${align} ${
                  h === "NAME" ? `left-[72px] z-[3] ${NAME_DIVIDER}` : "z-[1]"
                }`}
              >
                {h}
              </th>
            ))}
            {withAction && (
              <th className={`${TH} z-[1] text-center`}>ACTIONS</th>
            )}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function EmptyRow({ children }) {
  return (
    <tr>
      <td colSpan={8} className="p-10 text-center text-[13px] text-gray-500">
        {children}
      </td>
    </tr>
  );
}

function NameCell({ w, info, dim, onViewGap }) {
  return (
    <td className={`${TD} ${STICKY_NAME}`}>
      {/* opacity ใส่ที่เนื้อหา ไม่ใส่ที่ td — td ที่ตรึงไว้ต้องทึบ */}
      <div className={dim ? "opacity-60" : ""}>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onViewGap();
            }}
            title="คลิกดู eligibility"
            className="cursor-pointer border-none bg-transparent p-0 text-left font-semibold text-gray-900 hover:text-blue-600"
          >
            {w.fullName}
          </button>
          {info?.isPermanent && (
            <MiniTag tone="green" title="Permanent worker">
              PERM
            </MiniTag>
          )}
          {info?.sseLevel && SSE_LABEL[info.sseLevel] && (
            <MiniTag
              tone={info.sseCompleted ? "blue" : "yellow"}
              title={info.sseCompleted ? "SSE Completed" : "SSE not completed"}
            >
              {SSE_LABEL[info.sseLevel]}
              {info.sseCompleted ? " ✓" : ""}
            </MiniTag>
          )}
        </div>
        {nameTH(w) && <div className="text-xs text-gray-600">{nameTH(w)}</div>}
        <div className="text-[11px] text-gray-500">
          {w.empId}
          {w.position?.name ? ` · ${w.position.name}` : ""}
        </div>
        {info?.activeBan && (
          <div className="mt-1">
            <MiniTag tone="red" title={info.activeBan.reason || "Banned"}>
              🚫 Banned until {fmtBanDate(info.activeBan.bannedUntil)}
            </MiniTag>
          </div>
        )}
      </div>
    </td>
  );
}

// ปุ่ม "+ เพิ่ม" ท้ายแถว — กดได้เฉพาะคนที่ % Match ครบ / PE อนุมัติแล้ว และไม่ถูกแบน
// กดไม่ได้ → ยังแสดงปุ่มแต่เป็นสีเทา + ชี้แล้วบอกเหตุผล (ผู้ใช้รู้ว่าคอลัมน์นี้มีไว้ทำอะไร)
function AddCell({ enabled, busy, onAdd, reason }) {
  return (
    <td className={`${TD} text-center`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (enabled) onAdd();
        }}
        disabled={!enabled || busy}
        title={enabled ? "เพิ่มเข้ารายชื่อที่จัดแล้ว" : reason}
        className={`whitespace-nowrap rounded-md border px-3 py-1 text-xs font-semibold transition-colors ${
          enabled
            ? "cursor-pointer border-[#a3cfbb] bg-[#e8f5ee] text-[#146c43] hover:border-[#198754] hover:bg-[#198754] hover:text-white disabled:cursor-wait disabled:opacity-60"
            : "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-300"
        }`}
      >
        + เพิ่ม
      </button>
    </td>
  );
}

// เหตุผลที่ยังเพิ่มไม่ได้ (แสดงตอนชี้ที่ปุ่มสีเทา)
const addBlockedReason = (w, exception) => {
  if (!w) return "ยังไม่มีข้อมูล % Match ของคนนี้";
  if (w.activeBan) return `ถูกแบนถึง ${fmtBanDate(w.activeBan.bannedUntil)}`;
  if (w.matchPct === null || w.matchPct === undefined)
    return "ยังไม่มี Training Matrix ของตำแหน่งนี้ — ตั้งที่ Projects & Positions › Matrix Editor";
  if (exception?.status === "pending") return "รอ PE อนุมัติอยู่";
  if (exception?.status === "rejected")
    return "PE ไม่อนุมัติ — กด “ขออนุมัติใหม่” ที่คอลัมน์ % MATCH";
  return "% Match ยังไม่ครบ 100% — กด “ขออนุมัติ PE” ที่คอลัมน์ % MATCH ก่อน";
};

function RetirementCell({ birthDate }) {
  const retire = getRetirementInfo(birthDate);
  const age = calcAge(birthDate);
  return (
    <td className={`${TD} whitespace-nowrap text-center`}>
      {retire ? (
        <Pill
          tone={retire.tone}
          title={age !== null ? `อายุ ${age} ปี` : undefined}
        >
          {retire.label}
        </Pill>
      ) : age !== null ? (
        <span
          className="text-[11px] text-gray-500"
          title={`อายุ ${age} ปี · เกษียณตอน ${RETIREMENT_AGE} (ยังเหลือ >12 เดือน)`}
        >
          อายุ {age}
        </span>
      ) : (
        <span className="text-gray-400" title="ไม่มีข้อมูลวันเกิด (birthDate)">
          —
        </span>
      )}
    </td>
  );
}

function HealthCell({ info, onOpenNote }) {
  const health = info?.healthRisk ? healthRiskDisplay(info.healthRisk) : null;
  const note = info?.latestExamNote || info?.healthNote || null;
  return (
    <td className={TD}>
      {health || note ? (
        <div className="flex max-w-[120px] flex-col gap-0.5">
          {health && (
            <Pill tone={health.tone} className="self-start">
              {health.label}
            </Pill>
          )}
          {note && (
            <button
              type="button"
              title={note}
              onClick={(e) => {
                e.stopPropagation();
                onOpenNote(note);
              }}
              className="max-w-[120px] cursor-pointer truncate border-none bg-transparent p-0 text-left text-[10px] text-gray-500 underline decoration-dotted"
            >
              📄 {note}
            </button>
          )}
        </div>
      ) : (
        DASH
      )}
    </td>
  );
}

// ── Medical: badge "ใบด่วนแค่ไหน" + ผลตรวจจริง + ลิงก์แจ้ง HR ──
function MedicalCell({ expiry, status, canRequest, inCart, onToggleRequest }) {
  const requestLink = (reason) =>
    canRequest && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleRequest(reason);
        }}
        title="แจ้ง HR ให้จัด Medical Check-up"
        className={`mt-0.5 cursor-pointer border-none bg-transparent p-0 text-left text-[10px] font-semibold ${
          inCart ? "text-[#664d03]" : "text-blue-600 hover:underline"
        }`}
      >
        {inCart ? "☑ อยู่ในคำขอแล้ว" : "📨 แจ้ง HR"}
      </button>
    );

  // Unfit ต้องขึ้นเสมอ ไม่ว่าใบจะยังไม่หมดอายุก็ตาม (ตรวจแล้วไม่ผ่านจริง)
  if (status === "failed") {
    return (
      <td className={TD}>
        <div className="flex flex-col items-start gap-0.5">
          <Pill tone="red">Unfit</Pill>
          {expiry && (
            <span className="text-[10px] text-gray-500">
              Exp {fmtShort(expiry)}
            </span>
          )}
        </div>
      </td>
    );
  }

  const valid = expiry && !isNaN(new Date(expiry).getTime());

  // ไม่มีใบตรวจ — ให้แจ้ง HR ได้ (เดิมขึ้นแค่ "—" กดแจ้งไม่ได้)
  if (!valid) {
    return (
      <td className={TD}>
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-[11px] text-gray-400">ไม่มีข้อมูล</span>
          {requestLink("no_record")}
        </div>
      </td>
    );
  }

  const days = daysUntil(expiry);
  const [label, tone] =
    days < 0
      ? ["Overdue", "red"]
      : days <= 30
        ? ["Due soon", "yellow"]
        : ["Valid", "green"];
  const statusText = MEDICAL_STATUS_LABEL[status] || null;

  return (
    <td className={TD}>
      <div className="flex flex-col items-start gap-0.5">
        <Pill tone={tone}>{label}</Pill>
        {statusText && (
          <span className="text-[10px] font-semibold text-gray-700">
            {statusText}
          </span>
        )}
        <span className="text-[10px] text-gray-500">
          Exp {fmtShort(expiry)}
        </span>
        {days <= 30 && requestLink(days < 0 ? "overdue" : "due_soon")}
      </div>
    </td>
  );
}

function DayOffCell({ dayOff, platform }) {
  let content;
  if (dayOff === null || dayOff === undefined) {
    content = DASH;
  } else if (dayOff < 0) {
    content = (
      <span
        className="font-semibold text-[#dc3545]"
        title={`ยังไม่ถึง D-MOB อีก ${Math.abs(dayOff)} วัน (ยังอยู่บนแท่น)`}
      >
        {dayOff}d
      </span>
    );
  } else {
    const color =
      dayOff > 30
        ? "text-[#198754]"
        : dayOff >= 15
          ? "text-blue-600"
          : "text-gray-500";
    content = (
      <span
        className={`font-semibold ${color}`}
        title={`พักมาแล้ว ${dayOff} วัน (พ้น D-MOB)`}
      >
        {dayOff}d off
      </span>
    );
  }
  return (
    <td
      className={`${TD} whitespace-nowrap text-center`}
      title={platform ? `แท่นล่าสุด: ${platform}` : ""}
    >
      {content}
    </td>
  );
}

function ExceptionStatus({ exception, onRequest }) {
  const status = exception?.status;
  if (status === "pending")
    return (
      <span
        className="text-[10px] font-semibold text-[#b08900]"
        title="ส่งคำขอแล้ว รอ PE พิจารณา"
      >
        ⏳ รอ PE อนุมัติ
      </span>
    );
  if (status === "approved")
    return (
      <span
        className="text-[10px] font-semibold text-[#198754]"
        title={
          exception.decisionNote || "PE อนุมัติแล้ว — อยู่ในหน้า Mobilization"
        }
      >
        ✓ PE อนุมัติแล้ว
      </span>
    );
  return (
    <>
      {status === "rejected" ? (
        <span
          className="text-[10px] font-semibold text-[#dc3545]"
          title={exception.decisionNote || ""}
        >
          ✕ PE ไม่อนุมัติ
        </span>
      ) : (
        <span className="text-[10px] font-semibold text-[#dc3545]">
          ต้องครบ 100%
        </span>
      )}
      {onRequest && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRequest();
          }}
          className="cursor-pointer rounded-md border border-[#cc8400] bg-[#fff8e1] px-2 py-[2px] text-[10px] font-semibold text-[#8a5a00] hover:bg-[#fff3cd]"
        >
          {status === "rejected" ? "ขออนุมัติใหม่" : "ขออนุมัติ PE"}
        </button>
      )}
    </>
  );
}

// state: "need_request" | "loading" | "none" | "ready"
function MatchCell({
  state = "ready",
  pct,
  missing,
  onViewGap,
  exception,
  onRequestException,
}) {
  let content;
  if (state === "need_request") {
    content = (
      <span className="text-[10px] text-gray-400">เลือก position ก่อน</span>
    );
  } else if (state === "loading") {
    content = <span className="text-gray-400">...</span>;
  } else if (state === "none") {
    content = DASH;
  } else if (pct === null || pct === undefined) {
    content = (
      <span
        title="ยังไม่มี Training Matrix สำหรับตำแหน่งนี้ + Client นี้ — ไปที่ Manage Positions → Matrix Editor เพื่อเพิ่ม"
        className="cursor-help text-[11px] font-semibold text-[#b08900]"
      >
        ⚠ No Matrix
      </span>
    );
  } else {
    content = (
      <div className="flex flex-col items-center gap-0.5">
        <span
          className={`text-[13px] font-bold ${matchColor(pct)}`}
          title={missing?.join(", ")}
        >
          {pct}% Match
        </span>
        {pct !== 100 && (
          <ExceptionStatus
            exception={exception}
            onRequest={onRequestException}
          />
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onViewGap();
          }}
          className={`${LINK_TEXT} text-[11px]`}
        >
          🔍 ดู Gap →
        </button>
      </div>
    );
  }
  return (
    <td className={`${TD} whitespace-nowrap px-2 text-center`}>{content}</td>
  );
}

// ══════════════════════════════════════════════════════════
// main
// ══════════════════════════════════════════════════════════
export default function Allocation() {
  const { backendUrl } = useContext(AppContent);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const canManageAllocation = true;

  // ── Project / Request ──
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useStickyState(
    "alloc_projectId",
    "",
  );
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedRequestId, setSelectedRequestId] = useStickyState(
    "alloc_requestId",
    "",
  );
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [positionFilterId, setPositionFilterId] = useStickyState(
    "alloc_positionFilterId",
    "",
  );
  const [allPositions, setAllPositions] = useState([]);
  // รายการตำแหน่งด้านซ้าย: ปิด = แสดงเฉพาะตำแหน่งที่ยังต้องทำอะไรต่อ
  const [showAllPositions, setShowAllPositions] = useStickyState(
    "alloc_showAllPositions",
    false,
  );

  // ── Matching workers ──
  const [workers, setWorkers] = useState([]);
  const [selectedWorkerIds, setSelectedWorkerIds] = useState([]);
  const [loadingWorkers, setLoadingWorkers] = useState(false);
  const [workerSearch, setWorkerSearch] = useState("");
  const [sortBy, setSortBy] = useStickyState("alloc_sortBy", "dayoff");
  const [empType, setEmpType] = useStickyState("alloc_empType", "permanent");
  const [addingShortlist, setAddingShortlist] = useState(false);
  const findReqIdRef = useRef(0);

  // ── Quick search (ค้นหา Worker คนใดก็ได้) ──
  const [allWorkers, setAllWorkers] = useState([]);
  const [quickPickedWorkers, setQuickPickedWorkers] = useState([]);
  const [quickMatchResults, setQuickMatchResults] = useState({});
  const [loadingQuickMatch, setLoadingQuickMatch] = useState(false);

  // ── Shortlist ──
  const [shortlist, setShortlist] = useState([]);
  const [loadingShortlist, setLoadingShortlist] = useState(false);
  const [approvedExpanded, setApprovedExpanded] = useState({});
  // แผง "รายชื่อที่จัดแล้ว" — ปุ่มที่หัวตำแหน่ง กดแล้วแสดงทับเนื้อหาด้านล่าง
  const [assignedOpen, setAssignedOpen] = useState(false);
  const assignedRef = useRef(null);
  useEffect(() => {
    if (!assignedOpen) return;
    const onDown = (e) => {
      // คลิกนอกแผง → ปิด (แต่ไม่ปิดถ้าคลิกใน modal / dropdown ที่ portal ไปที่ body)
      if (assignedRef.current && !assignedRef.current.contains(e.target) && !e.target.closest?.("[role=dialog], [class*=-menu]"))
        setAssignedOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setAssignedOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [assignedOpen]);

  // ── Modals ──
  const [eligibilityModal, setEligibilityModal] = useState(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const [activeClientTab, setActiveClientTab] = useState(0);
  const [healthNoteModal, setHealthNoteModal] = useState(null);
  const [cvModal, setCvModal] = useState(null);
  const [cvLoading, setCvLoading] = useState(false);
  const [rosterModal, setRosterModal] = useState(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [skillMatrixModal, setSkillMatrixModal] = useState(null);
  const [skillMatrixLoading, setSkillMatrixLoading] = useState(false);

  // ── Training cart ──
  const [trainingCart, setTrainingCart] = useState([]);
  const [sendingCart, setSendingCart] = useState(false);
  const [cartReviewOpen, setCartReviewOpen] = useState(false);

  // ── Medical cart ──
  const [medicalCart, setMedicalCart] = useState([]);
  const [sendingMedicalCart, setSendingMedicalCart] = useState(false);
  const [medicalCartReviewOpen, setMedicalCartReviewOpen] = useState(false);

  const [exceptions, setExceptions] = useState({}); // { [employeeId]: { status, decisionNote, ... } }
  const [exceptionModal, setExceptionModal] = useState(null); // worker object
  const [exceptionReasonType, setExceptionReasonType] = useState(""); // key ใน EXCEPTION_REASONS
  const [exceptionReason, setExceptionReason] = useState(""); // รายละเอียด / ข้อความกรณี "อื่นๆ"
  const [sendingException, setSendingException] = useState(false);
  // ===========================================================
  // Fetch
  // ===========================================================
  const fetchProjects = async () => {
    try {
      const res = await axios.get(`${backendUrl}/api/allocation/projects`, {
        withCredentials: true,
      });
      setProjects(res.data);
    } catch (error) {
      console.error(error);
    }
  };

  const fetchShortlist = async (projectId) => {
    try {
      setLoadingShortlist(true);
      const res = await axios.get(
        `${backendUrl}/api/allocation/shortlist/${projectId}`,
        { withCredentials: true },
      );
      setShortlist(res.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingShortlist(false);
    }
  };

  const fetchExceptions = async (requestId) => {
    if (!requestId) {
      setExceptions({});
      return;
    }
    try {
      const res = await axios.get(
        `${backendUrl}/api/match-exceptions/request/${requestId}`,
        { withCredentials: true },
      );
      setExceptions(Object.fromEntries(res.data.map((e) => [e.employeeId, e])));
    } catch (err) {
      console.error(err);
    }
  };

  const handleFindWorkers = async (
    requestOverride,
    projectOverride,
    positionIdOverride,
  ) => {
    const req = requestOverride ?? selectedRequest;
    const proj = projectOverride ?? selectedProject;
    const posId = positionIdOverride ?? req?.position?.id;
    if (!req) return;
    // กันผลเก่ามาทับผลใหม่ เวลาเปลี่ยนตำแหน่งเร็วๆ ติดกัน
    const reqId = ++findReqIdRef.current;
    try {
      setLoadingWorkers(true);
      setSelectedWorkerIds([]);
      const res = await axios.get(`${backendUrl}/api/allocation/workers`, {
        withCredentials: true,
        params: {
          positionId: posId,
          matrixPositionId: req.position?.id,
          requestId: req.id,
          contractId: proj?.contractId,
        },
      });
      if (reqId === findReqIdRef.current) setWorkers(res.data);
    } catch (error) {
      console.error(error);
    } finally {
      if (reqId === findReqIdRef.current) setLoadingWorkers(false);
    }
  };

  useEffect(() => {
    fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchExceptions(selectedRequest?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRequest?.id]);

  useEffect(() => {
    axios
      .get(`${backendUrl}/api/positions/manage`, { withCredentials: true })
      .then((res) => setAllPositions(res.data || []))
      .catch(() =>
        axios
          .get(`${backendUrl}/api/positions`, { withCredentials: true })
          .then((res) => setAllPositions(res.data || []))
          .catch((err) => console.error(err)),
      );
    axios
      .get(`${backendUrl}/api/workers`, { withCredentials: true })
      .then((res) => setAllWorkers(res.data || []))
      .catch((err) => console.error(err));
  }, [backendUrl]);

  useEffect(() => {
    const pid = searchParams.get("projectId");
    if (pid) setSelectedProjectId(pid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedProject(null);
      return;
    }
    const proj = projects.find((p) => p.id === selectedProjectId);
    setSelectedProject(proj || null);
    if (proj) {
      fetchShortlist(selectedProjectId);
      if (selectedRequestId && !selectedRequest) {
        const req = proj.requests?.find((r) => r.id === selectedRequestId);
        if (req) setSelectedRequest(req);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, projects]);

  // โหลด worker อัตโนมัติครั้งแรก เมื่อ restore project/request จาก localStorage ได้
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    if (selectedProject && selectedRequest) {
      restoredRef.current = true;
      const posId = positionFilterId || selectedRequest.position?.id;
      if (!positionFilterId)
        setPositionFilterId(selectedRequest.position?.id || "");
      handleFindWorkers(selectedRequest, selectedProject, posId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject, selectedRequest]);

  // % Match ของคนที่เลือกจาก quick search
  useEffect(() => {
    const employeeIds = quickPickedWorkers.map((w) => w.id);
    if (!selectedRequest || employeeIds.length === 0) {
      setQuickMatchResults({});
      return;
    }
    let ignore = false;
    setLoadingQuickMatch(true);
    axios
      .get(`${backendUrl}/api/allocation/workers`, {
        withCredentials: true,
        params: {
          positionId: selectedRequest.position?.id,
          requestId: selectedRequest.id,
          contractId: selectedProject?.contractId,
          employeeIds: employeeIds.join(","),
        },
      })
      .then((res) => {
        if (ignore) return;
        const map = {};
        res.data.forEach((w) => (map[w.id] = w));
        setQuickMatchResults(map);
      })
      .catch((err) => console.error(err))
      .finally(() => {
        if (!ignore) setLoadingQuickMatch(false);
      });
    return () => {
      ignore = true;
    };
  }, [backendUrl, quickPickedWorkers, selectedRequest, selectedProject]);

  // ชื่อไฟล์ตอน Save PDF
  useEffect(() => {
    const originalTitle = document.title;
    if (cvModal) {
      document.title = `CV_Summary_${cvModal.project?.name || "Project"}`;
    } else if (rosterModal) {
      document.title = `Roster_MOB-DMOB_${rosterModal.project?.name || "Project"}`;
    } else if (skillMatrixModal) {
      document.title = `Skill_Matrix_${skillMatrixModal.project?.name || "Project"}`;
    }
    return () => {
      document.title = originalTitle;
    };
  }, [cvModal, rosterModal, skillMatrixModal]);

  // Esc ปิด modal บนสุดทีละตัว (modal พิมพ์เอกสารจัดการ Esc เองใน PrintModal)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (exceptionModal && !sendingException) setExceptionModal(null);
      else if (medicalCartReviewOpen) setMedicalCartReviewOpen(false);
      else if (cartReviewOpen) setCartReviewOpen(false);
      else if (healthNoteModal) setHealthNoteModal(null);
      else if (eligibilityModal) setEligibilityModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    medicalCartReviewOpen,
    cartReviewOpen,
    healthNoteModal,
    eligibilityModal,
    exceptionModal,
    sendingException,
  ]);

  // ===========================================================
  // Derived
  // ===========================================================
  const permCount = workers.filter((w) => w.isPermanent).length;
  const newSseCount = workers.filter((w) => w.sseLevel === "new_sse").length;

  const isWorkerSelectable = (w) =>
    !w.activeBan &&
    (w.matchPct === 100 || exceptions[w.id]?.status === "approved");

  const displayedWorkers = [...workers]
    .filter((w) => {
      if (
        empType === "permanent" &&
        (!w.isPermanent || w.sseLevel === "new_sse")
      )
        return false;
      if (
        empType === "nonpermanent" &&
        (w.isPermanent || w.sseLevel === "new_sse")
      )
        return false;
      if (empType === "new_sse" && w.sseLevel !== "new_sse") return false;
      const q = workerSearch.trim().toLowerCase();
      if (!q) return true;
      return (
        String(w.fullName || "")
          .toLowerCase()
          .includes(q) ||
        String(w.fullNameTH || "")
          .toLowerCase()
          .includes(q) ||
        String(w.fullNameEN || "")
          .toLowerCase()
          .includes(q) ||
        String(w.empCode || "")
          .toLowerCase()
          .includes(q) ||
        String(w.empId || "")
          .toLowerCase()
          .includes(q)
      );
    })
    .sort((a, b) => {
      if (!!a.isPermanent !== !!b.isPermanent) return a.isPermanent ? -1 : 1;
      if (sortBy === "dayoff")
        return (b.dayOff ?? -Infinity) - (a.dayOff ?? -Infinity);
      return (b.matchPct ?? -1) - (a.matchPct ?? -1);
    });

  const selectableDisplayedWorkers =
    displayedWorkers.filter(isWorkerSelectable);
  const allDisplayedSelected =
    selectableDisplayedWorkers.length > 0 &&
    selectableDisplayedWorkers.every((w) => selectedWorkerIds.includes(w.id));

  const totalShortlisted = shortlist.reduce(
    (sum, r) => sum + (r.candidates?.length ?? 0),
    0,
  );

  const requestsWithCandidates = shortlist.filter(
    (r) => (r.candidates?.length ?? 0) > 0,
  );
  // คนที่ยังรอ PE อนุมัติ (% Match ไม่ครบ) — ยังไม่อยู่ใน candidates แต่ต้องรอให้จบก่อน
  const totalPendingPe = shortlist.reduce(
    (sum, r) => sum + (r.peExceptions?.pending?.length ?? 0),
    0,
  );
  const everyCandidateApproved =
    requestsWithCandidates.length > 0 &&
    requestsWithCandidates.every((r) =>
      r.candidates.every((c) => c.status === "approved"),
    );
  const allApproved = everyCandidateApproved && totalPendingPe === 0;

  const currentRequestShortlisted = selectedRequest
    ? (shortlist.find((s) => s.requestId === selectedRequest.id)?.candidates
        ?.length ?? 0)
    : 0;
  const remaining = selectedRequest
    ? Math.max(0, selectedRequest.quantity - currentRequestShortlisted)
    : 0;

  // สรุปคำขออนุมัติ PE ของ position request ที่เลือกอยู่
  const exceptionCounts = Object.values(exceptions).reduce(
    (acc, e) => ({ ...acc, [e.status]: (acc[e.status] || 0) + 1 }),
    { pending: 0, approved: 0, rejected: 0 },
  );

  const projectOptions = projects.map((p) => {
    const codePart = p.masterProjectRecord?.projectCode
      ? `[${p.masterProjectRecord.projectCode}] `
      : "";
    const parts = [];
    if (p.location) parts.push(p.location);
    if (p.startDate) parts.push(`Start ${fmtShort(p.startDate)}`);
    const disambiguator =
      parts.length > 0 ? parts.join(" · ") : `#${p.id.slice(-6)}`;
    return {
      value: p.id,
      label: `${codePart}${p.name} — ${p.contract?.client?.name} · ${disambiguator}`,
    };
  });

  const positionFilterOptions = allPositions.map((p) => ({
    value: p.id,
    label: `${p.name}${p._count ? ` (${p._count.employees})` : ""}`,
  }));

  // ค้นหา Worker คนใดก็ได้ — คนที่ตำแหน่งตรงกับตำแหน่งที่เลือกขึ้นก่อน
  const requestPositionId = selectedRequest?.position?.id;
  const quickSearchOptions = useMemo(() => {
    const byId = new Map(allWorkers.map((w) => [w.id, w]));
    const opts = buildWorkerOptions(allWorkers).map((o) => {
      const worker = byId.get(o.value);
      const posId = worker?.positionId ?? worker?.position?.id;
      return {
        ...o,
        worker,
        samePosition: !!requestPositionId && posId === requestPositionId,
      };
    });
    return [
      ...opts.filter((o) => o.samePosition),
      ...opts.filter((o) => !o.samePosition),
    ];
  }, [allWorkers, requestPositionId]);

  const clientName = selectedProject?.contract?.client?.name;

  // ===========================================================
  // Handlers — Workers / Shortlist
  // ===========================================================
  const toggleWorker = (id) =>
    setSelectedWorkerIds((prev) =>
      prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id],
    );

  const toggleAll = () => {
    const ids = selectableDisplayedWorkers.map((w) => w.id);
    if (allDisplayedSelected) {
      const set = new Set(ids);
      setSelectedWorkerIds((prev) => prev.filter((id) => !set.has(id)));
    } else {
      setSelectedWorkerIds((prev) => [...new Set([...prev, ...ids])]);
    }
  };

  const removeQuickWorker = (id) =>
    setQuickPickedWorkers((prev) => prev.filter((p) => p.id !== id));

  // ids = รายชื่อที่จะเพิ่ม (ตารางหลัก = ที่ติ๊กไว้, quick search = คนที่เลือกในช่องค้นหา)
  const handleAddToShortlist = async (ids) => {
    if (!selectedRequest?.id || ids.length === 0 || addingShortlist) return;

    // เฉพาะคนที่ eligible จริง (100% match + ไม่ถูกแบน)
    const eligibleIds = ids.filter((id) => {
      const w = workers.find((x) => x.id === id) || quickMatchResults[id];
      return w && isWorkerSelectable(w);
    });

    if (eligibleIds.length === 0) {
      alert(
        "ไม่มีคนที่เลือกได้ — ต้อง % Match ครบ 100% หรือ PE อนุมัติแล้ว และไม่ถูกแบน",
      );
      return;
    }
    if (eligibleIds.length < ids.length) {
      const skip = ids.length - eligibleIds.length;
      if (
        !window.confirm(
          `มี ${skip} คนที่ยังเลือกไม่ได้ (% Match ไม่ครบและ PE ยังไม่อนุมัติ หรือถูกแบน) จะถูกข้าม — ดำเนินการต่อ?`,
        )
      )
        return;
    }

    try {
      setAddingShortlist(true);
      await axios.post(
        `${backendUrl}/api/allocation/shortlist`,
        { requestId: selectedRequest.id, employeeIds: eligibleIds },
        { withCredentials: true },
      );
      // เอาออกเฉพาะคนที่เพิ่มสำเร็จ (กด "+ เพิ่ม" ทีละคนได้ คนอื่นที่เลือกไว้ยังอยู่)
      const added = new Set(eligibleIds);
      setSelectedWorkerIds((prev) => prev.filter((id) => !added.has(id)));
      setQuickPickedWorkers((prev) => prev.filter((p) => !added.has(p.id)));
      fetchShortlist(selectedProjectId);
      handleFindWorkers();
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.message || "เพิ่มเข้า Shortlist ไม่สำเร็จ");
    } finally {
      setAddingShortlist(false);
    }
  };

  const callShortlistApi = async (fn, failMsg) => {
    try {
      await fn();
      fetchShortlist(selectedProjectId);
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.message || failMsg);
    }
  };

  const handleApprove = (candidateIds, requestId) =>
    callShortlistApi(
      () =>
        axios.put(
          `${backendUrl}/api/allocation/approve`,
          { candidateIds, requestId },
          { withCredentials: true },
        ),
      "Approve ไม่สำเร็จ",
    );

  const handleUnapprove = (candidateIds, requestId) =>
    callShortlistApi(
      () =>
        axios.put(
          `${backendUrl}/api/allocation/unapprove`,
          { candidateIds, requestId },
          { withCredentials: true },
        ),
      "ยกเลิก Approve ไม่สำเร็จ",
    );

  const handleRemoveFromShortlist = (candidateId) =>
    callShortlistApi(async () => {
      await axios.delete(
        `${backendUrl}/api/allocation/candidate/${candidateId}`,
        { withCredentials: true },
      );
      if (selectedRequest) handleFindWorkers();
    }, "เอาออกจาก Shortlist ไม่สำเร็จ");

  // ===========================================================
  // Handlers — ขออนุมัติ PE (% Match ไม่ครบ)
  // ===========================================================
  const openExceptionModal = (w) => {
    setExceptionReasonType("");
    setExceptionReason("");
    setExceptionModal(w);
  };

  // รวมเป็นข้อความเดียวส่งให้ backend: "เหตุผล — รายละเอียด" หรือข้อความที่พิมพ์เอง
  const composeExceptionReason = () => {
    const detail = exceptionReason.trim();
    if (exceptionReasonType === "other") return detail;
    const label = EXCEPTION_REASONS.find(
      ([k]) => k === exceptionReasonType,
    )?.[1];
    if (!label) return "";
    return detail ? `${label} — ${detail}` : label;
  };
  const exceptionReasonReady = composeExceptionReason() !== "";

  const submitException = async () => {
    if (!exceptionModal || !selectedRequest || sendingException) return;
    try {
      setSendingException(true);
      const res = await axios.post(
        `${backendUrl}/api/match-exceptions`,
        {
          requestId: selectedRequest.id,
          employeeIds: [exceptionModal.id],
          reason: composeExceptionReason(),
        },
        { withCredentials: true },
      );
      if (res.data.created > 0) {
        alert(`ส่งคำขอให้ PE แล้ว — ${exceptionModal.fullName}`);
      } else {
        alert(res.data.skipped?.[0]?.reason || "ไม่ได้ส่งคำขอ");
      }
      setExceptionModal(null);
      fetchExceptions(selectedRequest.id);
      fetchShortlist(selectedProjectId); // อัปเดตจำนวน "รอ PE" ใน Step 9
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || "ส่งคำขอไม่สำเร็จ");
    } finally {
      setSendingException(false);
    }
  };

  // ===========================================================
  // Handlers — เอกสาร (CV / Roster / Skill Matrix)
  // ===========================================================
  const loadDoc = async (path, setLoading, onData, failMsg) => {
    if (!selectedProjectId || totalShortlisted === 0) return;
    try {
      setLoading(true);
      const res = await axios.get(
        `${backendUrl}/api/allocation/${path}/${selectedProjectId}`,
        { withCredentials: true },
      );
      onData(res.data);
    } catch (error) {
      console.error(error);
      alert(failMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateCv = () =>
    loadDoc(
      "cv-summary",
      setCvLoading,
      setCvModal,
      "โหลด CV Summary ไม่สำเร็จ",
    );

  const handleGenerateRoster = () =>
    loadDoc(
      "roster",
      setRosterLoading,
      (data) =>
        setRosterModal({
          ...data,
          rows: data.rows.map((r) => ({
            ...r,
            from: r.from ?? "",
            remark: r.remark ?? "",
          })),
        }),
      "โหลด Roster ไม่สำเร็จ",
    );

  const handleGenerateSkillMatrix = () =>
    loadDoc(
      "skill-matrix",
      setSkillMatrixLoading,
      setSkillMatrixModal,
      "โหลด Skill Matrix ไม่สำเร็จ",
    );

  const handleExportSkillMatrixExcel = () => {
    if (!skillMatrixModal) return;
    const { project, trainings, rows } = skillMatrixModal;
    exportSkillMatrixExcel({
      title: `${project?.name ?? ""} — ${project?.client ?? ""}`,
      trainings,
      rows,
      fileName: `SkillMatrix_${project?.name || "export"}.xlsx`,
    });
  };

  const updateRosterField = (employeeId, field, value) =>
    setRosterModal((prev) => ({
      ...prev,
      rows: prev.rows.map((r) =>
        r.employeeId === employeeId ? { ...r, [field]: value } : r,
      ),
    }));

  const handleViewEligibility = async (worker) => {
    try {
      setEligibilityLoading(true);
      setActiveClientTab(0);
      const res = await axios.get(
        `${backendUrl}/api/allocation/eligibility/${worker.id}`,
        {
          withCredentials: true,
          params: selectedRequest
            ? {
                positionId: selectedRequest.position?.id,
                contractId: selectedProject?.contractId,
              }
            : undefined,
        },
      );
      setEligibilityModal(res.data);
    } catch (error) {
      console.error(error);
      alert("โหลดข้อมูล Eligibility ไม่สำเร็จ");
    } finally {
      setEligibilityLoading(false);
    }
  };

  // ===========================================================
  // Handlers — ตะกร้า Training / Medical
  // ===========================================================
  const isInTrainingCart = (employeeId, trainingId) =>
    trainingCart.some(
      (c) => c.employeeId === employeeId && c.trainingId === trainingId,
    );

  const toggleTrainingCartItem = (item, cName) => {
    if (!canManageAllocation || !eligibilityModal) return;
    const { employeeId, fullName } = eligibilityModal;
    setTrainingCart((prev) => {
      const exists = prev.some(
        (c) => c.employeeId === employeeId && c.trainingId === item.trainingId,
      );
      if (exists)
        return prev.filter(
          (c) =>
            !(c.employeeId === employeeId && c.trainingId === item.trainingId),
        );
      return [
        ...prev,
        {
          employeeId,
          employeeName: fullName,
          trainingName: item.name,
          trainingId: item.trainingId,
          clientName: cName,
        },
      ];
    });
  };

  const addAllMissingToCart = (missing, cName) => {
    if (!canManageAllocation || !eligibilityModal) return;
    const { employeeId, fullName } = eligibilityModal;
    setTrainingCart((prev) => {
      const existing = new Set(
        prev
          .filter((c) => c.employeeId === employeeId)
          .map((c) => c.trainingId),
      );
      const additions = missing
        .filter((item) => !existing.has(item.trainingId))
        .map((item) => ({
          employeeId,
          employeeName: fullName,
          trainingName: item.name,
          trainingId: item.trainingId,
          clientName: cName,
        }));
      return [...prev, ...additions];
    });
  };

  // ล้างเฉพาะ training ของกลุ่มนี้ ของพนักงานคนนี้ — ไม่แตะรายการอื่น
  const removeAllMissingFromCart = (missing) => {
    if (!eligibilityModal) return;
    const ids = new Set(missing.map((item) => item.trainingId));
    setTrainingCart((prev) =>
      prev.filter(
        (c) =>
          !(
            c.employeeId === eligibilityModal.employeeId &&
            ids.has(c.trainingId)
          ),
      ),
    );
  };

  const removeFromTrainingCart = (employeeId, trainingId) =>
    setTrainingCart((prev) =>
      prev.filter(
        (c) => !(c.employeeId === employeeId && c.trainingId === trainingId),
      ),
    );

  const handleSendCart = async () => {
    if (trainingCart.length === 0 || sendingCart) return;
    try {
      setSendingCart(true);
      await axios.post(
        `${backendUrl}/api/training-requests`,
        {
          items: trainingCart.map((c) => ({
            employeeId: c.employeeId,
            globalTrainingId: c.trainingId,
            clientName: c.clientName,
          })),
        },
        { withCredentials: true },
      );
      alert(`แจ้ง HR ให้จัด training ${trainingCart.length} รายการแล้ว`);
      setTrainingCart([]);
      setCartReviewOpen(false);
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || "ส่งคำขอ Training ไม่สำเร็จ");
    } finally {
      setSendingCart(false);
    }
  };

  const isInMedicalCart = (employeeId) =>
    medicalCart.some((c) => c.employeeId === employeeId);

  const toggleMedicalCart = (worker, reason) =>
    setMedicalCart((prev) => {
      if (prev.some((c) => c.employeeId === worker.id))
        return prev.filter((c) => c.employeeId !== worker.id);
      return [
        ...prev,
        {
          employeeId: worker.id,
          employeeName: worker.fullName,
          clientName,
          reason, // "overdue" | "no_record" | "due_soon"
        },
      ];
    });

  const handleSendMedicalCart = async () => {
    if (medicalCart.length === 0 || sendingMedicalCart) return;
    try {
      setSendingMedicalCart(true);
      await axios.post(
        `${backendUrl}/api/medical-requests`,
        {
          items: medicalCart.map((c) => ({
            employeeId: c.employeeId,
            clientName: c.clientName,
            reason: c.reason,
          })),
        },
        { withCredentials: true },
      );
      alert(`แจ้ง HR ให้จัด Medical Check-up ${medicalCart.length} คนแล้ว`);
      setMedicalCart([]);
      setMedicalCartReviewOpen(false);
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || "ส่งคำขอ Medical ไม่สำเร็จ");
    } finally {
      setSendingMedicalCart(false);
    }
  };

  // ===========================================================
  // ตำแหน่ง (รายการด้านซ้าย)
  // ===========================================================
  const requestStats = (r) => {
    const sl = shortlist.find((s) => s.requestId === r.id);
    const cands = sl?.candidates ?? [];
    const approved = cands.filter((c) => c.status === "approved").length;
    const proposed = cands.length - approved;
    const pendingPe = sl?.peExceptions?.pending?.length ?? 0;
    const missing = Math.max(0, r.quantity - cands.length);
    return {
      approved,
      proposed,
      pendingPe,
      missing,
      needsAction: missing > 0 || proposed > 0 || pendingPe > 0,
    };
  };

  const projectRequests = selectedProject?.requests ?? [];
  const shownRequests = showAllPositions
    ? projectRequests
    : projectRequests.filter(
        (r) => requestStats(r).needsAction || r.id === selectedRequest?.id,
      );

  const selectRequest = (req) => {
    restoredRef.current = true; // กันโหลดซ้ำจาก effect restore
    setSelectedRequest(req);
    setSelectedRequestId(req ? req.id : "");
    setPositionFilterId(req?.position?.id || "");
    setWorkers([]);
    setSelectedWorkerIds([]);
    if (req) handleFindWorkers(req, selectedProject, req.position?.id);
  };

  // เลือกโปรเจกต์แล้วยังไม่ได้เลือกตำแหน่ง → เลือกตำแหน่งแรกที่ยังขาดคนให้เลย
  const shortlistReady =
    !loadingShortlist &&
    shortlist.every((s) => projectRequests.some((r) => r.id === s.requestId));
  useEffect(() => {
    if (!selectedProject || selectedRequest || !shortlistReady) return;
    // กำลัง restore ตำแหน่งเดิมจาก localStorage
    if (projectRequests.some((r) => r.id === selectedRequestId)) return;
    const first =
      projectRequests.find((r) => requestStats(r).missing > 0) ||
      projectRequests.find((r) => requestStats(r).needsAction) ||
      projectRequests[0];
    if (first) selectRequest(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject, selectedRequest, shortlistReady]);

  // ===========================================================
  // Render helpers
  // ===========================================================
  const renderMedical = (info) => (
    <MedicalCell
      expiry={info.medicalExpiry}
      status={info.medicalStatus}
      canRequest={canManageAllocation}
      inCart={isInMedicalCart(info.id)}
      onToggleRequest={(reason) => toggleMedicalCart(info, reason)}
    />
  );

  const openNote = (name) => (note) => setHealthNoteModal({ name, note });

  const emptyWorkerMessage =
    empType === "permanent" && permCount === 0
      ? 'ไม่มี Permanent worker ในผลลัพธ์ — กด "Non-Permanent" หรือ "All" (หรือยังไม่ได้ import ข้อมูล isPermanent)'
      : empType === "nonpermanent" && permCount === workers.length
        ? 'มีแต่ Permanent — กด "All" เพื่อดูทั้งหมด'
        : empType === "new_sse" && newSseCount === 0
          ? 'ไม่มี New SSE ในผลลัพธ์นี้ — กด "All" เพื่อดูทั้งหมด'
          : workerSearch
            ? `ไม่พบ worker ที่ตรงกับ "${workerSearch}"`
            : "ไม่มีรายชื่อ";

  const hasCart = trainingCart.length > 0 || medicalCart.length > 0;

  // ===========================================================
  // Render
  // ===========================================================
  // ── รายชื่อที่จัดแล้วของตำแหน่งที่เลือก (เดิมคือ Step 9 — ตอนนี้แสดงทีละตำแหน่ง) ──
  const selectedShortlist = selectedRequest
    ? shortlist.find((s) => s.requestId === selectedRequest.id)
    : null;
  // จำนวนสำหรับ badge บนปุ่ม "รายชื่อที่จัดแล้ว"
  const assignedCounts = (() => {
    const all = selectedShortlist?.candidates ?? [];
    const visible = all.filter((c) => !(c.viaPeApproval && c.status === "approved"));
    return {
      proposed: visible.filter((c) => c.status !== "approved").length,
      approved: visible.filter((c) => c.status === "approved").length,
      pePending: selectedShortlist?.peExceptions?.pending?.length ?? 0,
      peRejected: selectedShortlist?.peExceptions?.rejected?.length ?? 0,
    };
  })();
  const assignedTotal =
    assignedCounts.proposed +
    assignedCounts.approved +
    assignedCounts.pePending +
    assignedCounts.peRejected;
  const BADGE =
    "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white";

  const renderAssigned = (req) => {
    if (!req) return null;
    const pe = req.peExceptions ?? { pending: [], rejected: [] };
    const all = req.candidates ?? [];
    // คนที่ PE อนุมัติ → ไปหน้า Mobilization เลย ไม่แสดงในรายชื่อ
    const peApproved = all.filter(
      (c) => c.viaPeApproval && c.status === "approved",
    );
    const visible = all.filter(
      (c) => !(c.viaPeApproval && c.status === "approved"),
    );
    const proposed = visible.filter((c) => c.status !== "approved");
    const approved = visible.filter((c) => c.status === "approved");
    const approvedOpen = !!approvedExpanded[req.requestId];

    if (!all.length && !pe.pending.length && !pe.rejected.length)
      return (
        <div className="py-3 text-[13px] text-gray-400">
          ยังไม่มีรายชื่อ — กด “+ เพิ่ม” ในตาราง Worker Pool
        </div>
      );

    return (
      <div className="flex flex-col gap-y-2">
        {/* ซ้าย: รออนุมัติ (Proposed) + Approved */}
        <div className="min-w-0">
          {visible.length === 0 && (
            <div className="py-2 text-[13px] text-gray-400">
              ยังไม่มีรายชื่อที่จัดในตำแหน่งนี้
            </div>
          )}
          {proposed.map((c) => (
            <div
              key={c.id}
              className="mb-1.5 flex items-center justify-between gap-2 rounded-md border border-[#ffe69c] bg-[#fffdf5] px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-[13px] font-semibold">
                  {c.employee?.fullName}
                </div>
                <EmpMeta
                  emp={c.employee}
                  requestPositionId={req.position?.id}
                />
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Pill tone="yellow">Proposed</Pill>
                <button
                  type="button"
                  onClick={() => handleApprove([c.id], req.requestId)}
                  title="Approve คนนี้"
                  className="cursor-pointer whitespace-nowrap rounded-md border border-[#198754] bg-[#198754] px-2.5 py-[3px] text-[11px] font-semibold text-white hover:bg-[#157347]"
                >
                  ✓ Approve
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveFromShortlist(c.id)}
                  title="เอาออกจาก shortlist"
                  className="cursor-pointer border-none bg-transparent px-0.5 text-sm leading-none text-gray-400 hover:text-[#dc3545]"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
          {proposed.length > 1 && (
            <button
              type="button"
              onClick={() =>
                handleApprove(
                  proposed.map((c) => c.id),
                  req.requestId,
                )
              }
              className="mb-2 cursor-pointer border-none bg-transparent p-0 text-xs font-semibold text-[#198754] hover:underline"
            >
              ✓ Approve ทั้งหมด ({proposed.length})
            </button>
          )}

          {approved.length > 0 && (
            <div className="mt-1">
              <button
                type="button"
                onClick={() =>
                  setApprovedExpanded((prev) => ({
                    ...prev,
                    [req.requestId]: !prev[req.requestId],
                  }))
                }
                className="inline-flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-xs font-semibold text-[#198754]"
              >
                {approvedOpen ? "▾" : "▸"} ✓ Approved {approved.length} คน —{" "}
                {approvedOpen ? "ซ่อนรายชื่อ" : "ดูรายชื่อ"}
              </button>
              {approvedOpen && (
                <div className="mt-1.5">
                  {approved.map((c) => (
                    <div
                      key={c.id}
                      className="mb-1.5 flex items-center justify-between gap-2 rounded-md border border-[#badbcc] bg-[#f0fff4] px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold">
                          {c.employee?.fullName}
                        </div>
                        <EmpMeta
                          emp={c.employee}
                          requestPositionId={req.position?.id}
                        />
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Pill tone="green">✓ Approved</Pill>
                        <button
                          type="button"
                          onClick={() => handleUnapprove([c.id], req.requestId)}
                          title="ยกเลิก approve (กลับเป็น Proposed)"
                          className="cursor-pointer border-none bg-transparent px-0.5 text-sm leading-none text-gray-400 hover:text-gray-700"
                        >
                          ↩
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ขวา: สถานะคำขอ PE (% Match ไม่ครบ) — แสดงให้รู้ ไม่มีปุ่มให้กด */}
        {(pe.pending.length > 0 ||
          peApproved.length > 0 ||
          pe.rejected.length > 0) && (
          <div className="min-w-0">
            {pe.pending.length > 0 && (
              <div className="mb-2 rounded-md bg-[#fff8e1] px-3 py-2 text-[#664d03]">
                <div className="text-[11px] font-semibold">
                  ⏳ รอ PE อนุมัติ {pe.pending.length} คน
                </div>
                {pe.pending.map((e) => (
                  <PeRow
                    key={e.employeeId}
                    emp={e.employee}
                    requestPositionId={req.position?.id}
                    pct={e.matchPct}
                  />
                ))}
              </div>
            )}
            {peApproved.length > 0 && (
              <div className="mb-2 rounded-md bg-[#f0fff4] px-3 py-2 text-[#0f5132]">
                <div className="text-[11px] font-semibold">
                  🚀 PE อนุมัติ {peApproved.length} คน — อยู่ในหน้า Mobilization
                  แล้ว
                </div>
                {peApproved.map((c) => (
                  <PeRow
                    key={c.id}
                    emp={c.employee}
                    requestPositionId={req.position?.id}
                    pct={c.matchPct}
                  />
                ))}
              </div>
            )}
            {pe.rejected.length > 0 && (
              <div className="mb-2 rounded-md bg-[#fff5f5] px-3 py-2 text-[#842029]">
                <div className="text-[11px] font-semibold">
                  ✕ PE ไม่อนุมัติ {pe.rejected.length} คน
                </div>
                {pe.rejected.map((e) => (
                  <PeRow
                    key={e.employeeId}
                    emp={e.employee}
                    requestPositionId={req.position?.id}
                    pct={e.matchPct}
                    note={e.decisionNote}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const SECTION_HEAD =
    "mb-2 flex flex-wrap items-center justify-between gap-2 text-[13px] font-bold text-gray-900";
  const DOC_BTN =
    "inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-white";

  return (
    <div className={hasCart ? "pb-[140px]" : ""}>
      <div className="mx-auto w-full min-w-0 max-w-[1800px]">
        {/* ════════ แถบบน: โปรเจกต์ + เอกสาร ════════ */}
        <div className="flex flex-col gap-3 border-b border-gray-200 pb-3 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <label className={LABEL}>Project</label>
            <Select
              {...SELECT_PORTAL}
              options={projectOptions}
              styles={projectSelectStyles}
              value={
                projectOptions.find((o) => o.value === selectedProjectId) ||
                null
              }
              onChange={(o) => {
                setSelectedProjectId(o ? o.value : "");
                setSelectedRequestId("");
                setSelectedRequest(null);
                setWorkers([]);
                setSelectedWorkerIds([]);
                if (!o) setShortlist([]);
              }}
              placeholder="-- เลือกโปรเจกต์ --"
              isClearable
              noOptionsMessage={() => "No projects found"}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={handleGenerateCv}
              disabled={totalShortlisted === 0 || cvLoading}
              className={DOC_BTN}
            >
              {cvLoading ? "Generating..." : "📄 CV Summary"}
            </button>
            <button
              type="button"
              onClick={handleGenerateRoster}
              disabled={totalShortlisted === 0 || rosterLoading}
              className={DOC_BTN}
            >
              {rosterLoading ? "Generating..." : "🛫 Roster (MOB/D-MOB)"}
            </button>
            <button
              type="button"
              onClick={handleGenerateSkillMatrix}
              disabled={totalShortlisted === 0 || skillMatrixLoading}
              className={DOC_BTN}
            >
              {skillMatrixLoading ? "Generating..." : "📋 Skill Matrix"}
            </button>
            {selectedProjectId && (
              <button
                type="button"
                onClick={() =>
                  navigate(`/projects/${selectedProjectId}?tab=discussion`)
                }
                className={`${DOC_BTN} text-blue-600`}
              >
                💬 ส่งไฟล์ให้ PE →
              </button>
            )}
          </div>
        </div>

        {/* ════════ แจ้งสถานะทั้งโปรเจกต์ ════════ */}
        {allApproved && (
          <button
            type="button"
            onClick={() =>
              navigate(`/mobilization?projectId=${selectedProjectId}`)
            }
            className="mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border-none bg-[#198754] py-2 text-[13px] font-bold text-white hover:bg-[#157347]"
          >
            🚀 ทุกคน Approve แล้ว — ไป Mobilization →
          </button>
        )}
        {everyCandidateApproved && totalPendingPe > 0 && (
          <div className="mt-3 rounded-lg border border-[#ffe69c] bg-[#fff8e1] px-3 py-2 text-center text-xs font-semibold text-[#664d03]">
            ⏳ รอ PE อนุมัติอีก {totalPendingPe} คน — ครบแล้วจึงไป Mobilization
            ได้
          </div>
        )}
        {selectedProjectId &&
          selectedProject &&
          projectRequests.length === 0 && (
            <div className="mt-3 rounded-lg border border-[#ffe69c] bg-[#fff8e1] px-3.5 py-2.5 text-[13px] text-[#664d03]">
              ⚠ โปรเจกต์นี้ยังไม่มีตำแหน่ง —{" "}
              <button
                type="button"
                onClick={() => navigate(`/projects/${selectedProjectId}`)}
                className={`${LINK_TEXT} underline`}
              >
                เพิ่มตำแหน่งที่หน้า Requirement →
              </button>
            </div>
          )}

        {!selectedProject ? (
          <div className="p-12 text-center text-[13px] text-gray-500">
            เลือกโปรเจกต์ด้านบน เพื่อเริ่มจัดรายชื่อ
          </div>
        ) : (
          projectRequests.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-[250px_minmax(0,1fr)]">
              {/* ════════ ซ้าย: ตำแหน่ง ════════ */}
              <aside className="border-b border-gray-200 py-3 lg:border-b-0 lg:border-r lg:pr-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.4px] text-gray-500">
                    ตำแหน่ง ({projectRequests.length})
                  </span>
                  <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-600">
                    <input
                      type="checkbox"
                      checked={!!showAllPositions}
                      onChange={(e) => setShowAllPositions(e.target.checked)}
                      className="h-3.5 w-3.5"
                    />
                    แสดงทุกตำแหน่ง
                  </label>
                </div>
                {shownRequests.length === 0 ? (
                  <div className="rounded-md bg-[#f0fff4] px-3 py-3 text-center text-xs font-semibold text-[#198754]">
                    ✓ ทุกตำแหน่งจัดครบแล้ว
                  </div>
                ) : (
                  // จอใหญ่: เลื่อนเฉพาะรายการตำแหน่ง — ตำแหน่งเยอะไม่ดันหน้ายาว
                  <div className="flex flex-col gap-1 lg:max-h-[max(240px,calc(100vh-330px))] lg:overflow-y-auto lg:pr-1.5 lg:[scrollbar-width:thin]">
                    {shownRequests.map((r) => {
                      const st = requestStats(r);
                      const active = r.id === selectedRequest?.id;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => selectRequest(r)}
                          className={`w-full cursor-pointer rounded-md border px-3 py-2 text-left transition ${
                            active
                              ? "border-[#F16726] bg-orange-50 shadow-[inset_3px_0_0_#F16726]"
                              : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span
                              className={`min-w-0 break-words text-[13px] font-semibold ${
                                active ? "text-[#c2410c]" : "text-gray-900"
                              }`}
                            >
                              {r.position?.name}
                            </span>
                            <span className="shrink-0 text-xs text-gray-500">
                              × {r.quantity}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {st.missing > 0 ? (
                              <Pill tone="red">ขาด {st.missing} คน</Pill>
                            ) : !st.needsAction ? (
                              <Pill tone="green">✓ ครบ</Pill>
                            ) : null}
                            {st.proposed > 0 && (
                              <Pill tone="yellow">
                                รอ approve {st.proposed}
                              </Pill>
                            )}
                            {st.pendingPe > 0 && (
                              <Pill tone="orange">รอ PE {st.pendingPe}</Pill>
                            )}
                            {st.approved > 0 && st.needsAction && (
                              <Pill tone="gray">approved {st.approved}</Pill>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                {!showAllPositions &&
                  shownRequests.length < projectRequests.length && (
                    <div className="mt-2 text-[11px] text-gray-400">
                      ซ่อนตำแหน่งที่ครบแล้ว{" "}
                      {projectRequests.length - shownRequests.length} ตำแหน่ง
                    </div>
                  )}
              </aside>

              {/* ════════ ขวา: ตำแหน่งที่เลือก ════════ */}
              <section className="min-w-0 py-3 lg:pl-5">
                {!selectedRequest ? (
                  <div className="p-10 text-center text-[13px] text-gray-500">
                    เลือกตำแหน่งทางซ้าย
                  </div>
                ) : (
                  <>
                    {/* หัวตำแหน่ง + ปุ่มรายชื่อที่จัดแล้ว (แผงลอยทับเนื้อหา) */}
                    <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-gray-200 pb-3">
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
                        <h2 className="m-0 text-lg font-bold">
                          {selectedRequest.position?.name}
                          <span className="ml-1.5 text-sm font-normal text-gray-500">
                            × {selectedRequest.quantity}
                          </span>
                        </h2>
                        <span className="flex flex-wrap gap-x-3 text-xs text-gray-500">
                          <span>
                            จัดแล้ว{" "}
                            <strong
                              className={
                                currentRequestShortlisted > 0
                                  ? "text-[#198754]"
                                  : "text-gray-500"
                              }
                            >
                              {currentRequestShortlisted}
                            </strong>
                          </span>
                          <span>
                            ยังขาด{" "}
                            <strong
                              className={
                                remaining > 0
                                  ? "text-[#dc3545]"
                                  : "text-[#198754]"
                              }
                            >
                              {remaining}
                            </strong>
                          </span>
                          {exceptionCounts.pending + exceptionCounts.approved >
                            0 && (
                            <span title="คำขออนุมัติ PE (% Match ไม่ครบ) ของตำแหน่งนี้">
                              PE: รอ{" "}
                              <strong className="text-[#b08900]">
                                {exceptionCounts.pending}
                              </strong>
                              {" · "}อนุมัติ{" "}
                              <strong className="text-[#198754]">
                                {exceptionCounts.approved}
                              </strong>
                            </span>
                          )}
                        </span>
                      </div>

                      <div ref={assignedRef} className="relative ml-auto">
                        <button
                          type="button"
                          onClick={() => setAssignedOpen((o) => !o)}
                          aria-expanded={assignedOpen}
                          title={
                            assignedCounts.proposed ||
                            assignedCounts.pePending ||
                            assignedCounts.peRejected
                              ? "มีรายการรอดำเนินการ — กดเพื่อดู"
                              : "ดูรายชื่อที่จัดแล้ว"
                          }
                          className={`inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                            assignedOpen
                              ? "border-[#2B2F78] bg-[#2B2F78] text-white"
                              : assignedCounts.proposed
                                ? "border-[#f0b400] bg-[#fffbeb] text-gray-800 hover:bg-[#fff3cd]"
                                : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
                          }`}
                        >
                          รายชื่อที่จัดแล้ว
                          {assignedCounts.approved > 0 && (
                            <span
                              className={`${BADGE} bg-[#198754]`}
                              title={`Approved ${assignedCounts.approved} คน`}
                            >
                              {assignedCounts.approved}
                            </span>
                          )}
                          {assignedCounts.proposed > 0 && (
                            <span
                              className={`${BADGE} bg-[#e0a800]`}
                              title={`รอ Approve ${assignedCounts.proposed} คน`}
                            >
                              {assignedCounts.proposed}
                            </span>
                          )}
                          {assignedCounts.pePending > 0 && (
                            <span
                              className={`${BADGE} bg-[#fd7e14]`}
                              title={`รอ PE อนุมัติ ${assignedCounts.pePending} คน`}
                            >
                              {assignedCounts.pePending}
                            </span>
                          )}
                          {assignedCounts.peRejected > 0 && (
                            <span
                              className={`${BADGE} bg-[#dc3545]`}
                              title={`PE ไม่อนุมัติ ${assignedCounts.peRejected} คน`}
                            >
                              {assignedCounts.peRejected}
                            </span>
                          )}
                          {assignedTotal === 0 && (
                            <span className="text-xs font-normal opacity-70">0</span>
                          )}
                          <span className="text-[10px] opacity-70">
                            {assignedOpen ? "▲" : "▼"}
                          </span>
                        </button>

                        {assignedOpen && (
                          <div className="absolute right-0 top-full z-30 mt-2 w-[min(560px,calc(100vw-32px))] rounded-lg border border-gray-200 bg-white shadow-[0_10px_30px_rgba(0,0,0,0.15)]">
                            <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-2.5">
                              <div className="min-w-0 text-[13px] font-bold">
                                รายชื่อที่จัดแล้ว ·{" "}
                                <span className="font-semibold text-gray-500">
                                  {selectedRequest.position?.name}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setAssignedOpen(false)}
                                title="ปิด (Esc)"
                                className="cursor-pointer border-none bg-transparent px-1 text-base leading-none text-gray-400 hover:text-gray-700"
                              >
                                ✕
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 border-b border-gray-100 px-4 py-1.5 text-[11px] text-gray-500">
                              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#198754]" />Approved</span>
                              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#e0a800]" />รอ Approve</span>
                              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#fd7e14]" />รอ PE อนุมัติ</span>
                              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#dc3545]" />PE ไม่อนุมัติ</span>
                            </div>
                            <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
                              {loadingShortlist && !selectedShortlist ? (
                                <div className="py-3 text-[13px] text-gray-400">
                                  Loading...
                                </div>
                              ) : (
                                renderAssigned(
                                  selectedShortlist || {
                                    requestId: selectedRequest.id,
                                    position: selectedRequest.position,
                                    candidates: [],
                                  },
                                )
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ── เพิ่มจาก Worker Pool ── */}
                    <div className="pt-3">
                      <div className={SECTION_HEAD}>
                        <span>เพิ่มจาก Worker Pool</span>
                        {selectedWorkerIds.length > 0 &&
                          canManageAllocation && (
                            <button
                              type="button"
                              onClick={() =>
                                handleAddToShortlist(selectedWorkerIds)
                              }
                              disabled={addingShortlist}
                              className={`${BTN_GREEN} px-4 py-[7px] text-[13px]`}
                            >
                              {addingShortlist
                                ? "กำลังเพิ่ม..."
                                : `👥 เพิ่มที่เลือก (${selectedWorkerIds.length})`}
                            </button>
                          )}
                      </div>

                      {/* ค้นหาคนใดก็ได้ — เปิดอยู่ตลอด (เดิมต้องกดปุ่มก่อน) */}
                      <div className="mb-3 rounded-lg bg-gray-50 px-3 py-2.5">
                        <label className="mb-1 block text-[11px] font-semibold text-gray-500">
                          🔍 ค้นหาพนักงานคนใดก็ได้ (Employee ID / ชื่อไทย /
                          ชื่ออังกฤษ) — คนที่ตำแหน่งตรงขึ้นก่อน
                        </label>
                        <div className="max-w-[560px]">
                          <Select
                            {...SELECT_PORTAL}
                            isMulti
                            options={quickSearchOptions}
                            filterOption={filterWorkerOption}
                            value={quickPickedWorkers.map((w) => ({
                              value: w.id,
                              label: workerLabel(w),
                              worker: w,
                            }))}
                            onChange={(opts) =>
                              setQuickPickedWorkers(
                                (opts || []).map((o) => o.worker),
                              )
                            }
                            controlShouldRenderValue={false}
                            isClearable={false}
                            backspaceRemovesValue={false}
                            hideSelectedOptions={false}
                            closeMenuOnSelect={false}
                            formatOptionLabel={(o, { context }) =>
                              context === "menu" ? (
                                <span className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    readOnly
                                    tabIndex={-1}
                                    checked={quickPickedWorkers.some(
                                      (w) => w.id === o.value,
                                    )}
                                    className="pointer-events-none h-3.5 w-3.5 shrink-0"
                                  />
                                  <span className="min-w-0 flex-1">
                                    {o.label}
                                  </span>
                                  {o.samePosition && (
                                    <MiniTag tone="green">ตรงตำแหน่ง</MiniTag>
                                  )}
                                </span>
                              ) : (
                                o.label
                              )
                            }
                            placeholder={
                              quickPickedWorkers.length > 0
                                ? `ค้นหาเพิ่ม... (เลือกแล้ว ${quickPickedWorkers.length} คน)`
                                : "พิมพ์ ID หรือชื่อ แล้วเลือก → ขึ้นในตารางพร้อมปุ่ม + เพิ่ม"
                            }
                            noOptionsMessage={() => "ไม่พบ worker"}
                            styles={{
                              ...quickSelectStyles,
                              option: (b, s) => ({
                                ...b,
                                fontSize: "13px",
                                cursor: "pointer",
                                backgroundColor: s.isSelected
                                  ? s.isFocused
                                    ? "#dbeafe"
                                    : "#eff6ff"
                                  : s.isFocused
                                    ? "#f3f4f6"
                                    : "white",
                                color: s.isSelected ? "#1d4ed8" : "#111827",
                                fontWeight: s.isSelected ? 600 : 400,
                              }),
                            }}
                          />
                        </div>

                        {quickPickedWorkers.length > 0 && (
                          <div className="mt-2.5 overflow-hidden rounded-lg border border-gray-200 bg-white">
                            <div className="flex flex-wrap items-center gap-2 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700">
                              ✅ เลือกจากการค้นหา {quickPickedWorkers.length} คน
                              <button
                                type="button"
                                onClick={() => setQuickPickedWorkers([])}
                                className="cursor-pointer border-none bg-transparent p-0 text-[11px] font-normal text-[#dc3545] underline hover:text-[#a71d2a]"
                              >
                                ล้างทั้งหมด
                              </button>
                            </div>
                            <WorkerTable
                              leadHeader={null}
                              withAction={canManageAllocation}
                              maxH="max-h-[360px]"
                            >
                              {quickPickedWorkers.map((w) => {
                                const matched = quickMatchResults[w.id];
                                const matchState = loadingQuickMatch
                                  ? "loading"
                                  : !matched
                                    ? "none"
                                    : "ready";
                                return (
                                  <tr
                                    key={w.id}
                                    className="border-t border-gray-100 bg-white"
                                  >
                                    <td className={`${TD} ${STICKY_CHECK}`}>
                                      <button
                                        type="button"
                                        onClick={() => removeQuickWorker(w.id)}
                                        title="เอาออก"
                                        className="cursor-pointer border-none bg-transparent p-0 text-sm leading-none text-[#dc3545]"
                                      >
                                        ✕
                                      </button>
                                    </td>
                                    <NameCell
                                      w={w}
                                      info={matched}
                                      onViewGap={() => handleViewEligibility(w)}
                                    />
                                    <MatchCell
                                      state={matchState}
                                      pct={matched?.matchPct}
                                      missing={matched?.missingTrainings}
                                      onViewGap={() => handleViewEligibility(w)}
                                      exception={exceptions[w.id]}
                                      onRequestException={
                                        canManageAllocation &&
                                        matched &&
                                        !matched.activeBan
                                          ? () => openExceptionModal(matched)
                                          : undefined
                                      }
                                    />
                                    {matched ? (
                                      <DayOffCell
                                        dayOff={matched.dayOff}
                                        platform={matched.platform}
                                      />
                                    ) : (
                                      <td className={`${TD} text-center`}>
                                        {DASH}
                                      </td>
                                    )}
                                    <RetirementCell birthDate={w.birthDate} />
                                    <HealthCell
                                      info={matched}
                                      onOpenNote={openNote(w.fullName)}
                                    />
                                    {matched ? (
                                      renderMedical(matched)
                                    ) : (
                                      <td className={TD}>{DASH}</td>
                                    )}
                                    {canManageAllocation && (
                                      <AddCell
                                        enabled={
                                          !!matched &&
                                          !loadingQuickMatch &&
                                          isWorkerSelectable(matched)
                                        }
                                        busy={addingShortlist}
                                        reason={
                                          loadingQuickMatch
                                            ? "กำลังตรวจ % Match..."
                                            : addBlockedReason(
                                                matched,
                                                exceptions[w.id],
                                              )
                                        }
                                        onAdd={() =>
                                          handleAddToShortlist([w.id])
                                        }
                                      />
                                    )}
                                  </tr>
                                );
                              })}
                            </WorkerTable>
                          </div>
                        )}
                      </div>

                      {/* รายชื่อที่ระบบแนะนำ (ตำแหน่งตรง + ว่าง) */}
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        <span className="text-[13px] font-semibold text-gray-900">
                          พนักงานที่ว่าง
                        </span>
                        <span className="rounded-xl bg-blue-600 px-2.5 py-0.5 text-xs font-semibold text-white">
                          {workers.length} คน
                        </span>
                        <span>
                          · Permanent {permCount} · New SSE {newSseCount}
                        </span>
                      </div>

                      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                        <div className="w-full min-w-[220px] sm:w-[280px]">
                          <Select
                            {...SELECT_PORTAL}
                            options={positionFilterOptions}
                            styles={customSelectStyles}
                            value={
                              positionFilterOptions.find(
                                (o) => o.value === positionFilterId,
                              ) || null
                            }
                            onChange={(o) => {
                              const newPosId = o ? o.value : "";
                              setPositionFilterId(newPosId);
                              handleFindWorkers(
                                selectedRequest,
                                selectedProject,
                                newPosId,
                              );
                            }}
                            placeholder="ตำแหน่งปัจจุบันของพนักงาน..."
                            noOptionsMessage={() => "ไม่มีตำแหน่ง"}
                          />
                        </div>
                        <ButtonGroup
                          label="Type:"
                          options={EMP_TYPES}
                          value={empType}
                          onChange={setEmpType}
                          activeClass="border-[#198754] bg-[#198754] text-white"
                        />
                        <ButtonGroup
                          label="Sort:"
                          options={SORTS}
                          value={sortBy}
                          onChange={setSortBy}
                          activeClass="border-blue-600 bg-blue-600 text-white"
                        />
                        <div className="relative min-w-[180px] flex-1 sm:max-w-[260px]">
                          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-gray-400">
                            🔍
                          </span>
                          <input
                            type="text"
                            placeholder="กรองในรายการนี้..."
                            value={workerSearch}
                            onChange={(e) => setWorkerSearch(e.target.value)}
                            className="box-border w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-7 text-[13px] outline-none focus:border-blue-400"
                          />
                          {workerSearch && (
                            <button
                              type="button"
                              onClick={() => setWorkerSearch("")}
                              title="Clear"
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer border-none bg-transparent p-0 text-[13px] text-gray-400 hover:text-gray-600"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="rounded-lg border border-gray-200">
                        <WorkerTable
                          withAction={canManageAllocation}
                          leadHeader={
                            canManageAllocation && (
                              // คำกำกับอยู่เหนือ checkbox — คอลัมน์แคบ ไม่เบียดคอลัมน์ NAME
                              <label
                                title="เลือกทั้งหมด (เฉพาะคนที่ % Match = 100% หรือ PE อนุมัติแล้ว)"
                                className={`flex flex-col items-center gap-1 whitespace-nowrap text-[10px] font-semibold leading-none tracking-normal ${
                                  selectableDisplayedWorkers.length === 0
                                    ? "cursor-not-allowed opacity-50"
                                    : "cursor-pointer"
                                }`}
                              >
                                เลือกทั้งหมด
                                <input
                                  type="checkbox"
                                  checked={allDisplayedSelected}
                                  onChange={toggleAll}
                                  disabled={
                                    selectableDisplayedWorkers.length === 0
                                  }
                                  className="h-[15px] w-[15px] cursor-pointer disabled:cursor-not-allowed"
                                />
                              </label>
                            )
                          }
                        >
                          {loadingWorkers ? (
                            <EmptyRow>Finding workers...</EmptyRow>
                          ) : workers.length === 0 ? (
                            <EmptyRow>
                              ไม่มีพนักงานที่ว่างในตำแหน่งนี้ —
                              ลองเปลี่ยนตำแหน่ง หรือค้นหาคนใดก็ได้ด้านบน
                            </EmptyRow>
                          ) : displayedWorkers.length === 0 ? (
                            <EmptyRow>{emptyWorkerMessage}</EmptyRow>
                          ) : (
                            displayedWorkers.map((w) => {
                              const selected = selectedWorkerIds.includes(w.id);
                              const selectable = isWorkerSelectable(w);
                              const clickable =
                                canManageAllocation && selectable;
                              return (
                                <tr
                                  key={w.id}
                                  onClick={
                                    clickable
                                      ? () => toggleWorker(w.id)
                                      : undefined
                                  }
                                  title={
                                    canManageAllocation && !selectable
                                      ? "เลือกได้เฉพาะคนที่ % Match = 100% หรือ PE อนุมัติแล้ว"
                                      : undefined
                                  }
                                  className={`border-b border-gray-100 last:border-b-0 ${
                                    selected ? "bg-[#f0f7ff]" : "bg-white"
                                  } ${clickable ? "cursor-pointer hover:bg-gray-50" : ""}`}
                                >
                                  <td className={`${TD} ${STICKY_CHECK}`}>
                                    {canManageAllocation && (
                                      <input
                                        type="checkbox"
                                        checked={selected}
                                        disabled={!selectable}
                                        onChange={() => toggleWorker(w.id)}
                                        onClick={(e) => e.stopPropagation()}
                                        title={
                                          w.activeBan
                                            ? `พนักงานถูกแบนถึง ${fmtBanDate(w.activeBan.bannedUntil)}`
                                            : !selectable
                                              ? "% Match ต้องครบ 100% หรือขออนุมัติ PE ก่อน"
                                              : ""
                                        }
                                        className="h-[15px] w-[15px] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                                      />
                                    )}
                                  </td>
                                  <NameCell
                                    w={w}
                                    info={w}
                                    dim={!selectable}
                                    onViewGap={() => handleViewEligibility(w)}
                                  />
                                  <MatchCell
                                    pct={w.matchPct}
                                    missing={w.missingTrainings}
                                    onViewGap={() => handleViewEligibility(w)}
                                    exception={exceptions[w.id]}
                                    onRequestException={
                                      canManageAllocation && !w.activeBan
                                        ? () => openExceptionModal(w)
                                        : undefined
                                    }
                                  />
                                  <DayOffCell
                                    dayOff={w.dayOff}
                                    platform={w.platform}
                                  />
                                  <RetirementCell birthDate={w.birthDate} />
                                  <HealthCell
                                    info={w}
                                    onOpenNote={openNote(w.fullName)}
                                  />
                                  {renderMedical(w)}
                                  {canManageAllocation && (
                                    <AddCell
                                      enabled={selectable}
                                      busy={addingShortlist}
                                      reason={addBlockedReason(
                                        w,
                                        exceptions[w.id],
                                      )}
                                      onAdd={() => handleAddToShortlist([w.id])}
                                    />
                                  )}
                                </tr>
                              );
                            })
                          )}
                        </WorkerTable>
                      </div>
                    </div>
                  </>
                )}
              </section>
            </div>
          )
        )}
      </div>

      {/* ════════ CV Summary ════════ */}
      {cvModal &&
        (() => {
          const proposedGroups = cvModal.groups
            .map((g) => ({
              ...g,
              candidates: g.candidates.filter((c) => c.status !== "approved"),
            }))
            .filter((g) => g.candidates.length > 0);
          return (
            <PrintModal
              kind="cv"
              printId="cv-print"
              maxW="max-w-[900px]"
              title="📄 CV Summary — Resume"
              onClose={() => setCvModal(null)}
            >
              <div className="overflow-x-auto bg-[#e9ecef] p-3 sm:p-5">
                {proposedGroups.length === 0 ? (
                  <div className="bg-white p-10 text-center text-[13px] text-gray-500">
                    ไม่มี candidate สถานะ Proposed ใน shortlist
                    <div className="mt-1.5 text-[11px] text-gray-400">
                      (candidate ที่ Approved แล้วจะไม่แสดงในนี้)
                    </div>
                  </div>
                ) : (
                  proposedGroups.map((g) =>
                    g.candidates.map((c, ci) => (
                      <ResumePage
                        key={`${g.position}-${ci}`}
                        cvData={c}
                        backendUrl={backendUrl}
                        className="mb-5"
                        top={
                          <div className="cv-no-print mb-2 flex justify-end">
                            <Pill tone="yellow">Proposed</Pill>
                          </div>
                        }
                        bottom={
                          <div className="cv-no-print mt-4 border-t border-dashed border-gray-200 pt-3 text-[11px] text-gray-500">
                            <strong>Medical:</strong>{" "}
                            {c.medical
                              ? `${c.medical.status || "—"} (exp ${fmtShort(c.medical.expiryDate)})`
                              : "—"}
                            {"  ·  "}
                            <strong>Passport:</strong>{" "}
                            {c.passport?.passportNo
                              ? `${c.passport.passportNo} (exp ${fmtShort(c.passport.expiryDate)})`
                              : "—"}
                          </div>
                        }
                      />
                    )),
                  )
                )}
              </div>
            </PrintModal>
          );
        })()}

      {/* ════════ Roster ════════ */}
      {rosterModal && (
        <PrintModal
          kind="roster"
          printId="roster-print"
          maxW="max-w-[1100px]"
          title="🛫 Roster (MOB/D-MOB)"
          onClose={() => setRosterModal(null)}
        >
          <div className="roster-scroll overflow-x-auto p-4 sm:p-6">
            <div className="mb-1 text-lg font-bold">
              {rosterModal.project?.name}
              {rosterModal.project?.workingDay
                ? ` (${fmtShort(rosterModal.project.workingDay)})`
                : rosterModal.project?.startDate
                  ? ` (${fmtShort(rosterModal.project.startDate)})`
                  : ""}
            </div>
            <div className="mb-4 text-[13px] text-gray-500">
              {rosterModal.project?.client}
              {rosterModal.project?.location
                ? ` · ${rosterModal.project.location}`
                : ""}
            </div>

            <table className="w-full min-w-[960px] border-collapse text-xs">
              <thead>
                <tr className="bg-[#f1f3f5]">
                  {[
                    "Item",
                    "Name (Eng)",
                    "Position",
                    "Company",
                    "From",
                    "To",
                    "MOB",
                    "D-MOB",
                    "Working Day",
                    "Day Off",
                    "Previous Location",
                    "Remark",
                  ].map((h) => (
                    <th
                      key={h}
                      className="border border-gray-200 px-1.5 py-2 text-left font-bold"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rosterModal.rows.map((r, i) => {
                  const cell = "border border-gray-200 p-1.5";
                  const inputCell = "border border-gray-200 p-0.5";
                  const input =
                    "border border-gray-200 p-1 text-xs outline-none focus:border-blue-400";
                  return (
                    <tr key={r.employeeId}>
                      <td className={cell}>{i + 1}</td>
                      <td className={cell}>{r.fullName}</td>
                      <td className={cell}>{r.position}</td>
                      <td className={cell}>{r.company}</td>
                      <td className={inputCell}>
                        <input
                          value={r.from}
                          onChange={(e) =>
                            updateRosterField(
                              r.employeeId,
                              "from",
                              e.target.value,
                            )
                          }
                          placeholder="—"
                          className={`${input} w-[60px]`}
                        />
                      </td>
                      <td className={cell}>{r.to ?? "—"}</td>
                      <td className={cell}>{fmtShort(r.mobDate)}</td>
                      <td className={cell}>{fmtShort(r.demobDate)}</td>
                      <td className={cell}>{fmtShort(r.workingDay)}</td>
                      <td className={cell}>{r.dayOff ?? "—"}</td>
                      <td className={cell}>{r.previousLocation ?? "—"}</td>
                      <td className={inputCell}>
                        <input
                          value={r.remark}
                          onChange={(e) =>
                            updateRosterField(
                              r.employeeId,
                              "remark",
                              e.target.value,
                            )
                          }
                          placeholder="—"
                          className={`${input} w-[120px]`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </PrintModal>
      )}

      {/* ════════ Skill Matrix ════════ */}
      {skillMatrixModal && (
        <PrintModal
          kind="matrix"
          printId="matrix-print"
          maxW="max-w-[95vw]"
          title="📋 Skill Matrix"
          onClose={() => setSkillMatrixModal(null)}
          actions={
            <button
              type="button"
              onClick={handleExportSkillMatrixExcel}
              className={EXCEL_BTN}
            >
              📊 Export to Excel
            </button>
          }
        >
          <div className="overflow-x-auto p-4 sm:p-6">
            <div className="mb-4 text-lg font-bold">
              {skillMatrixModal.project?.name} —{" "}
              {skillMatrixModal.project?.client}
            </div>
            {skillMatrixModal.trainings.length === 0 ? (
              <div className="text-[13px] text-gray-500">
                ไม่พบ training requirement สำหรับตำแหน่งในกลุ่มนี้ (เช็คว่า
                Training Matrix ของตำแหน่งเหล่านี้ตั้งไว้แล้วหรือยัง)
              </div>
            ) : (
              <SkillMatrixTable
                trainings={skillMatrixModal.trainings}
                rows={skillMatrixModal.rows}
              />
            )}
          </div>
        </PrintModal>
      )}

      {/* ════════ ขออนุมัติ PE ════════ */}
      {exceptionModal && (
        <Modal
          onClose={() => !sendingException && setExceptionModal(null)}
          maxW="max-w-[480px]"
          z="z-[1000001]"
        >
          <ModalHeader
            title="📝 ขออนุมัติ PE — % Match ไม่ครบ"
            onClose={() => !sendingException && setExceptionModal(null)}
            bg="bg-[#8a5a00]"
          />
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            <div className="text-[15px] font-bold">
              {exceptionModal.fullName}
            </div>
            <div className="text-xs text-gray-500">
              {exceptionModal.empId} · ขอใช้ในตำแหน่ง{" "}
              {selectedRequest?.position?.name}
            </div>
            <div
              className={`mt-2 text-sm font-bold ${matchColor(exceptionModal.matchPct)}`}
            >
              {exceptionModal.matchPct}% Match
            </div>
            {exceptionModal.missingTrainings?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {exceptionModal.missingTrainings.map((m) => (
                  <span
                    key={m}
                    className="rounded-md border border-[#f5c6cb] bg-[#fff5f5] px-2 py-0.5 text-xs text-[#842029]"
                  >
                    ✕ {m}
                  </span>
                ))}
              </div>
            )}
            <div className="mb-1.5 mt-4 text-xs font-semibold text-gray-700">
              เหตุผลที่ขอใช้คนนี้ *
            </div>
            <div className="flex flex-col gap-1.5" role="radiogroup">
              {EXCEPTION_REASONS.map(([key, label]) => {
                const active = exceptionReasonType === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setExceptionReasonType(key)}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] ${
                      active
                        ? "border-[#8a5a00] bg-[#fff8e1] font-semibold text-[#5c3d00]"
                        : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                        active ? "border-[#8a5a00]" : "border-gray-300"
                      }`}
                    >
                      {active && (
                        <span className="h-2 w-2 rounded-full bg-[#8a5a00]" />
                      )}
                    </span>
                    {label}
                  </button>
                );
              })}
            </div>

            {exceptionReasonType && (
              <>
                <label className="mb-1 mt-3 block text-xs font-semibold text-gray-700">
                  {exceptionReasonType === "other"
                    ? "ระบุเหตุผล *"
                    : "รายละเอียดเพิ่มเติม (ถ้ามี)"}
                </label>
                <textarea
                  rows={2}
                  value={exceptionReason}
                  onChange={(e) => setExceptionReason(e.target.value)}
                  autoFocus={exceptionReasonType === "other"}
                  placeholder={
                    exceptionReasonType === "training_booked"
                      ? "เช่น อบรมวันที่ 15 ต.ค. 2569"
                      : exceptionReasonType === "other"
                        ? "พิมพ์เหตุผล..."
                        : "เช่น เคยทำงานตำแหน่งนี้ที่แท่น BELQ 2 ปี"
                  }
                  className="box-border w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-[13px] outline-none focus:border-blue-400"
                />
              </>
            )}
            <div className="mt-1.5 text-[11px] text-gray-500">
              ระบบแจ้งเตือนไปที่ PE ทุกคน เมื่อ PE อนุมัติ คนนี้จะไปที่หน้า
              Mobilization ทันที
            </div>
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 px-4 py-3.5 sm:px-6">
            <button
              type="button"
              onClick={() => setExceptionModal(null)}
              disabled={sendingException}
              className={BTN_OUTLINE}
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={submitException}
              disabled={sendingException || !exceptionReasonReady}
              className={`${BTN_GREEN} px-5 py-2 text-[13px]`}
            >
              {sendingException ? "กำลังส่ง..." : "ส่งให้ PE"}
            </button>
          </div>
        </Modal>
      )}

      {/* ════════ Health Note ════════ */}
      {healthNoteModal && (
        <Modal onClose={() => setHealthNoteModal(null)} maxW="max-w-[420px]">
          <ModalHeader
            title={`📄 Health Note — ${healthNoteModal.name}`}
            onClose={() => setHealthNoteModal(null)}
          />
          <div className="overflow-y-auto whitespace-pre-wrap p-5 text-sm leading-relaxed text-gray-900">
            {healthNoteModal.note}
          </div>
        </Modal>
      )}

      {/* ════════ Eligibility (Client Requirement Check) ════════ */}
      {eligibilityModal && (
        <Modal
          onClose={() => setEligibilityModal(null)}
          maxW="max-w-[min(920px,92vw)]"
        >
          <ModalHeader
            title="☑️ Client Requirement Check"
            onClose={() => setEligibilityModal(null)}
          />

          <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-2.5 sm:px-6">
            <div className="min-w-0">
              <div className="text-base font-bold">
                {eligibilityModal.fullName}
              </div>
              <div className="text-[13px] text-gray-500">
                {eligibilityModal.position} · {eligibilityModal.empId}
              </div>
            </div>
            <Pill
              tone={
                eligibilityModal.mobilizationStatus === "ready"
                  ? "green"
                  : "yellow"
              }
              className="ml-auto px-3 py-1 text-xs"
            >
              {eligibilityModal.mobilizationStatus === "ready"
                ? "Ready"
                : eligibilityModal.mobilizationStatus}
            </Pill>
          </div>

          {eligibilityModal.clients.length > 1 && (
            <div className="flex shrink-0 overflow-x-auto overflow-y-hidden border-b border-gray-200 px-4 sm:px-6">
              {eligibilityModal.clients.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveClientTab(i)}
                  className={`-mb-px shrink-0 cursor-pointer whitespace-nowrap border-x-0 border-b-2 border-t-0 border-solid bg-transparent px-4 py-2 text-[13px] ${
                    activeClientTab === i
                      ? "border-blue-600 font-bold text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {c.clientName}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 py-3.5 sm:px-6">
            {eligibilityModal.clients.length === 0 ? (
              <div className="p-5 text-center text-gray-500">
                No training matrix found for this position
              </div>
            ) : (
              (() => {
                const client = eligibilityModal.clients[activeClientTab];
                if (!client) return null;
                const empty = { required: [], completed: [], missing: [] };
                const mandatory = client.mandatory ?? empty;
                const assigned = client.assigned ?? empty;
                const others = client.others ?? { completed: [] };

                // หัวกลุ่ม: ● ชื่อ [มีแล้ว/ทั้งหมด] — แบบเดียวกับ Gap Analysis ในหน้า Compliance
                const groupHead = (dot, title, g) => {
                  const total = g.required.length;
                  const done = g.missing.length === 0;
                  return (
                    <div className="mb-1.5 flex items-center gap-2 text-[13px]">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
                      <span className="font-bold">{title}</span>
                      {total > 0 && (
                        <span
                          className={`rounded-full px-2 py-px text-[11px] font-bold ${
                            done
                              ? "bg-[#d1e7dd] text-[#0f5132]"
                              : "bg-[#f8d7da] text-[#842029]"
                          }`}
                        >
                          {g.completed.length}/{total}
                        </span>
                      )}
                    </div>
                  );
                };

                const renderTags = (missing, completed, groupLabel) => {
                  const allInCart =
                    missing.length > 0 &&
                    missing.every((item) =>
                      isInTrainingCart(
                        eligibilityModal.employeeId,
                        item.trainingId,
                      ),
                    );
                  return (
                    <>
                      {missing.length > 0 ? (
                        <div className="mb-1.5">
                          <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5">
                            <span className="text-xs font-semibold text-[#dc3545]">
                              ✗ Missing ({missing.length}):
                            </span>
                            {canManageAllocation &&
                              (allInCart ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    removeAllMissingFromCart(missing)
                                  }
                                  title={`เอา ${groupLabel} ทั้งหมดของ ${eligibilityModal.fullName} ออกจากคำขอ Training ที่จะแจ้ง HR`}
                                  className="cursor-pointer rounded-md border border-[#f5c6cb] bg-[#fff5f5] px-2.5 py-0.5 text-[11px] font-semibold text-[#dc3545]"
                                >
                                  ✕ ล้าง {groupLabel} ที่เพิ่มไว้
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    addAllMissingToCart(
                                      missing,
                                      client.clientName,
                                    )
                                  }
                                  title={`เพิ่ม ${groupLabel} ที่ขาดทั้งหมดของ ${eligibilityModal.fullName} (${client.clientName}) เข้าคำขอ Training ที่จะแจ้ง HR`}
                                  className="cursor-pointer rounded-md border border-blue-600 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-blue-600 hover:bg-blue-50"
                                >
                                  + เพิ่ม {groupLabel} ทั้งหมดเข้าคำขอ Training
                                </button>
                              ))}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {missing.map((item, i) => {
                              const inCart = isInTrainingCart(
                                eligibilityModal.employeeId,
                                item.trainingId,
                              );
                              return (
                                <button
                                  key={i}
                                  type="button"
                                  disabled={!canManageAllocation}
                                  onClick={() =>
                                    toggleTrainingCartItem(
                                      item,
                                      client.clientName,
                                    )
                                  }
                                  title={
                                    canManageAllocation
                                      ? "คลิกเพื่อเลือก/ยกเลิกขอ training นี้"
                                      : ""
                                  }
                                  className={`cursor-pointer rounded-md border px-2.5 py-[3px] text-xs disabled:cursor-default ${
                                    inCart
                                      ? "border-[#ffe69c] bg-[#fff3cd] text-[#664d03]"
                                      : "border-[#f5c6cb] bg-[#fff5f5] text-[#dc3545]"
                                  }`}
                                >
                                  {inCart ? "☑" : "✕"} {item.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="mb-1.5 text-xs font-semibold text-[#198754]">
                          ✅ ครบทุกตัว
                        </div>
                      )}
                      {completed.length > 0 && (
                        <div>
                          <div className="mb-1 text-xs font-semibold text-[#198754]">
                            ✓ Completed ({completed.length}):
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {completed.map((item, i) => (
                              <span
                                key={i}
                                className="rounded-md border border-[#b2dfdb] bg-[#f0fff4] px-2.5 py-[3px] text-xs text-[#198754]"
                              >
                                ✓ {item.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                };

                return (
                  <div>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-sm font-bold">
                          {client.clientName}
                        </span>
                        <span className="ml-2 text-[13px] text-gray-500">
                          — Matched: "{client.positionMatched}"
                        </span>
                      </div>
                      <span
                        className={`rounded-md px-3 py-1 text-xs font-bold ${
                          client.eligible
                            ? "bg-[#d1e7dd] text-[#0f5132]"
                            : "bg-[#dc3545] text-white"
                        }`}
                      >
                        {client.eligible ? "✓ ELIGIBLE" : "✗ NOT ELIGIBLE"}
                      </span>
                    </div>

                    <div className="mb-1.5 h-1.5 rounded bg-gray-200">
                      <div
                        className={`h-1.5 rounded transition-[width] duration-300 ${
                          client.eligible ? "bg-[#198754]" : "bg-[#dc3545]"
                        }`}
                        style={{ width: `${client.matchPct}%` }}
                      />
                    </div>
                    <div className="mb-3 text-[13px] text-gray-500">
                      {mandatory.completed.length} of{" "}
                      {mandatory.required.length} mandatory trainings completed
                      ({client.matchPct}%)
                    </div>

                    <div className="mb-3.5">
                      {groupHead("bg-red-500", "Mandatory", mandatory)}
                      {renderTags(
                        mandatory.missing,
                        mandatory.completed,
                        "Mandatory",
                      )}
                    </div>

                    <div className="mb-3.5">
                      {groupHead("bg-orange-400", "Assigned", assigned)}
                      {assigned.required.length === 0 ? (
                        <div className="text-xs text-gray-500">
                          — ไม่มี Assigned training สำหรับตำแหน่งนี้
                        </div>
                      ) : (
                        renderTags(
                          assigned.missing,
                          assigned.completed,
                          "Assigned",
                        )
                      )}
                    </div>

                    <div>
                      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 text-[13px] font-bold">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-gray-300" />
                        Others ({others.completed.length}){" "}
                        <span className="text-[11px] font-normal text-gray-500">
                          (training ที่มีนอกเหนือจาก matrix ตำแหน่งนี้)
                        </span>
                      </div>
                      {others.completed.length === 0 ? (
                        <div className="text-xs text-gray-500">— ไม่มี</div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {others.completed.map((name, i) => (
                            <span
                              key={i}
                              className="rounded-md border border-gray-200 bg-[#f1f3f5] px-2.5 py-[3px] text-xs text-gray-700"
                            >
                              ✓ {name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()
            )}
          </div>

          <div className="flex shrink-0 justify-end border-t border-gray-200 px-4 py-3.5 sm:px-6">
            <button
              type="button"
              onClick={() => setEligibilityModal(null)}
              className={BTN_OUTLINE}
            >
              Close
            </button>
          </div>
        </Modal>
      )}

      {/* ════════ ตะกร้า Training ════════ */}
      {cartReviewOpen && (
        <Modal
          onClose={() => setCartReviewOpen(false)}
          maxW="max-w-[560px]"
          z="z-[1000001]"
        >
          <ModalHeader
            title={`📦 รายการในตะกร้า (${trainingCart.length})`}
            onClose={() => setCartReviewOpen(false)}
          />
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            {trainingCart.length === 0 ? (
              <div className="p-5 text-center text-gray-500">
                ตะกร้าว่างเปล่า
              </div>
            ) : (
              Object.values(
                trainingCart.reduce((acc, c) => {
                  (acc[c.employeeId] ||= {
                    employeeId: c.employeeId,
                    employeeName: c.employeeName,
                    items: [],
                  }).items.push(c);
                  return acc;
                }, {}),
              ).map((group) => (
                <div key={group.employeeId} className="mb-4">
                  <div className="mb-2 border-b border-gray-100 pb-1.5 text-[13px] font-bold text-[#1e3a5f]">
                    👤 {group.employeeName}
                  </div>
                  {group.items.map((item) => (
                    <div
                      key={`${item.employeeId}-${item.trainingId}`}
                      className="mb-1.5 flex items-center justify-between gap-2 rounded-md bg-gray-50 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold">
                          {item.trainingName}
                        </div>
                        <div className="text-[11px] text-gray-500">
                          Client: {item.clientName || "—"}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          removeFromTrainingCart(
                            item.employeeId,
                            item.trainingId,
                          )
                        }
                        title="เอาออกจากตะกร้า"
                        className="shrink-0 cursor-pointer border-none bg-transparent px-1 text-sm text-[#dc3545]"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
          <div className={MODAL_FOOT}>
            <button
              type="button"
              onClick={() => setTrainingCart([])}
              disabled={trainingCart.length === 0}
              className="cursor-pointer border-none bg-transparent text-[13px] text-[#dc3545] disabled:cursor-default disabled:text-gray-400"
            >
              ล้างตะกร้าทั้งหมด
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCartReviewOpen(false)}
                className={BTN_OUTLINE}
              >
                ปิด
              </button>
              <button
                type="button"
                onClick={handleSendCart}
                disabled={trainingCart.length === 0 || sendingCart}
                className={`${BTN_GREEN} px-5 py-2 text-[13px]`}
              >
                {sendingCart ? "กำลังส่ง..." : "แจ้ง HR →"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ════════ ตะกร้า Medical ════════ */}
      {medicalCartReviewOpen && (
        <Modal
          onClose={() => setMedicalCartReviewOpen(false)}
          maxW="max-w-[480px]"
          z="z-[1000001]"
        >
          <ModalHeader
            title={`📦 คำขอ Medical Check-up (${medicalCart.length})`}
            onClose={() => setMedicalCartReviewOpen(false)}
            bg="bg-[#7c2d12]"
          />
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            {medicalCart.length === 0 ? (
              <div className="p-5 text-center text-gray-500">
                ตะกร้าว่างเปล่า
              </div>
            ) : (
              medicalCart.map((item) => {
                const reasonLabel =
                  item.reason === "overdue"
                    ? "❌ หมดอายุ"
                    : item.reason === "no_record"
                      ? "⚪ ไม่มีข้อมูล"
                      : "⏰ ใกล้หมดอายุ";
                return (
                  <div
                    key={item.employeeId}
                    className="mb-1.5 flex items-center justify-between gap-2 rounded-md bg-gray-50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold">
                        {item.employeeName}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {reasonLabel} · Client: {item.clientName || "—"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setMedicalCart((prev) =>
                          prev.filter((c) => c.employeeId !== item.employeeId),
                        )
                      }
                      title="เอาออกจากคำขอ"
                      className="shrink-0 cursor-pointer border-none bg-transparent px-1 text-sm text-[#dc3545]"
                    >
                      ✕
                    </button>
                  </div>
                );
              })
            )}
          </div>
          <div className={MODAL_FOOT}>
            <button
              type="button"
              onClick={() => setMedicalCart([])}
              disabled={medicalCart.length === 0}
              className="cursor-pointer border-none bg-transparent text-[13px] text-[#dc3545] disabled:cursor-default disabled:text-gray-400"
            >
              ล้างทั้งหมด
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMedicalCartReviewOpen(false)}
                className={BTN_OUTLINE}
              >
                ปิด
              </button>
              <button
                type="button"
                onClick={handleSendMedicalCart}
                disabled={medicalCart.length === 0 || sendingMedicalCart}
                className="cursor-pointer rounded-lg border-none bg-[#7c2d12] px-5 py-2 text-[13px] font-semibold text-white hover:bg-[#6a260f] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sendingMedicalCart ? "กำลังส่ง..." : "แจ้ง HR →"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── กำลังโหลด Eligibility ── */}
      {eligibilityLoading && (
        <div className="fixed left-1/2 top-5 z-[1000002] -translate-x-1/2 rounded-lg bg-gray-900/85 px-4 py-2 text-[13px] text-white shadow-lg">
          กำลังโหลดข้อมูล Eligibility...
        </div>
      )}

      {/* ── Floating bars: Medical อยู่บน, Training อยู่ล่าง — ซ้อนกันเองไม่ทับ ── */}
      {hasCart && (
        <div className="fixed bottom-3 left-1/2 z-[1000000] flex w-[calc(100vw-24px)] -translate-x-1/2 flex-col items-center gap-2 sm:bottom-5 sm:w-auto">
          {medicalCart.length > 0 && (
            <div className="flex w-full flex-wrap items-center justify-center gap-x-3.5 gap-y-2 rounded-xl bg-[#7c2d12] px-4 py-3 text-white shadow-[0_8px_24px_rgba(0,0,0,0.25)] sm:w-auto sm:px-5">
              <button
                type="button"
                onClick={() => setMedicalCartReviewOpen(true)}
                className="cursor-pointer border-none bg-transparent p-0 text-[13px] text-white underline"
                title="ดูรายการทั้งหมด"
              >
                🏥 {medicalCart.length} คนในคำขอ Medical
              </button>
              <button
                type="button"
                onClick={() => setMedicalCartReviewOpen(true)}
                className="cursor-pointer rounded-lg border border-[#d4a373] bg-transparent px-3.5 py-1.5 text-[13px] font-semibold text-white"
              >
                👁 ดูรายละเอียด
              </button>
              <button
                type="button"
                onClick={handleSendMedicalCart}
                disabled={sendingMedicalCart}
                className="cursor-pointer rounded-lg border-none bg-white px-4 py-1.5 text-[13px] font-semibold text-[#7c2d12] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {sendingMedicalCart
                  ? "กำลังส่ง..."
                  : "แจ้ง HR ให้จัด Medical →"}
              </button>
              <button
                type="button"
                onClick={() => setMedicalCart([])}
                className="cursor-pointer border-none bg-transparent text-[13px] text-[#f5deb3]"
              >
                ล้าง
              </button>
            </div>
          )}

          {trainingCart.length > 0 && (
            <div className="flex w-full flex-wrap items-center justify-center gap-x-3.5 gap-y-2 rounded-xl bg-[#1e3a5f] px-4 py-3 text-white shadow-[0_8px_24px_rgba(0,0,0,0.25)] sm:w-auto sm:px-5">
              <button
                type="button"
                onClick={() => setCartReviewOpen(true)}
                className="cursor-pointer border-none bg-transparent p-0 text-[13px] text-white underline"
                title="ดูรายการทั้งหมดในตะกร้า"
              >
                📦 {trainingCart.length} รายการในตะกร้า
              </button>
              <button
                type="button"
                onClick={() => setCartReviewOpen(true)}
                className="cursor-pointer rounded-lg border border-[#6c8fb0] bg-transparent px-3.5 py-1.5 text-[13px] font-semibold text-white"
              >
                👁 ดูรายละเอียด
              </button>
              <button
                type="button"
                onClick={handleSendCart}
                disabled={sendingCart}
                className="cursor-pointer rounded-lg border-none bg-[#198754] px-4 py-1.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
              >
                {sendingCart ? "กำลังส่ง..." : "แจ้ง HR ให้จัด Training →"}
              </button>
              <button
                type="button"
                onClick={() => setTrainingCart([])}
                className="cursor-pointer border-none bg-transparent text-[13px] text-gray-400"
              >
                ล้างตะกร้า
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
