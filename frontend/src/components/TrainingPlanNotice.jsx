import { useState, useEffect, useContext } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { AppContent } from "../context/AppContext";

// ══════════════════════════════════════════════════════════
// แผนอบรมของพนักงาน 1 คน (จาก Training Plan / Training Calendar)
//   ใช้ใน modal: Assign Names › Client Requirement Check · Compliance › Gap Analysis / Training Alerts
//   ข้อมูล = GET /api/training-plan (รอบที่กำลังอบรม + กำลังจะเริ่ม — ไม่รวมรอบที่จบแล้ว)
//   = คำขออบรมที่ HR ยืนยันแล้ว + แผนที่เพิ่มจากหน้า "เพิ่มแผนอบรม"
//   โหลดครั้งเดียวแล้วแชร์ทุก modal (cache 60 วินาที) — เปิดหลายคนติดกันไม่ยิง API ซ้ำ
// ══════════════════════════════════════════════════════════

const CACHE_MS = 60 * 1000;
let cache = { at: 0, promise: null };

const loadSessions = (backendUrl) => {
  if (cache.promise && Date.now() - cache.at < CACHE_MS) return cache.promise;
  cache = {
    at: Date.now(),
    promise: axios
      .get(`${backendUrl}/api/training-plan`, { withCredentials: true })
      .then((res) => res.data?.sessions || [])
      .catch(() => {
        cache = { at: 0, promise: null }; // โหลดไม่ได้ (เช่นไม่มีสิทธิ์) → ไม่แสดง ไม่ cache ค่าว่าง
        return [];
      }),
  };
  return cache.promise;
};

// เรียกหลังเพิ่ม / แก้แผน ถ้าต้องการให้ modal เห็นข้อมูลใหม่ทันที
export const invalidateTrainingPlanCache = () => {
  cache = { at: 0, promise: null };
};

const DAY = 86400000;
const daysBetween = (a, b) =>
  Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / DAY);
const todayYMD = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmt = (s) =>
  new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
export const planPeriod = (p) => (p.start === p.end ? fmt(p.start) : `${fmt(p.start)} – ${fmt(p.end)}`);

// ป้ายสถานะสั้น ๆ ของรอบ
export const planStatusText = (p) => {
  const today = todayYMD();
  if (p.status === "inProgress") return `กำลังอบรม · วันที่ ${daysBetween(p.start, today) + 1}/${daysBetween(p.start, p.end) + 1}`;
  const d = daysBetween(today, p.start);
  return d <= 0 ? "เริ่มวันนี้" : d === 1 ? "เริ่มพรุ่งนี้" : `เริ่มในอีก ${d} วัน`;
};

/** รอบอบรมที่พนักงานคนนี้อยู่ (กำลังอบรมก่อน แล้วเรียงตามวันเริ่ม) */
export function useEmployeeTrainingPlan(employeeId) {
  const { backendUrl } = useContext(AppContent);
  const [state, setState] = useState({ plans: [], loading: false });

  useEffect(() => {
    if (!employeeId) {
      setState({ plans: [], loading: false });
      return;
    }
    let ignore = false;
    setState((s) => ({ ...s, loading: true }));
    loadSessions(backendUrl).then((sessions) => {
      if (ignore) return;
      const plans = sessions
        .filter((s) => s.attendees?.some((a) => a.employee?.id === employeeId))
        .map((s) => ({
          key: s.key,
          trainingId: s.training?.id,
          trainingName: s.training?.name || "—",
          start: s.start,
          end: s.end,
          provider: s.provider,
          status: s.status,
          datesFromRequest: !!s.datesFromRequest,
        }))
        .sort((a, b) => (a.status === b.status ? a.start.localeCompare(b.start) : a.status === "inProgress" ? -1 : 1));
      setState({ plans, loading: false });
    });
    return () => {
      ignore = true;
    };
  }, [backendUrl, employeeId]);

  return state;
}

// หา plan ของ training ตัวนั้น — เทียบ id ก่อน แล้วค่อยเทียบชื่อ (บาง modal มีแค่ชื่อ)
const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
export const findPlan = (plans, { trainingId, name } = {}) =>
  (plans || []).find((p) => (trainingId && p.trainingId === trainingId) || (name && norm(p.trainingName) === norm(name))) ||
  null;

/** ป้ายเล็กต่อท้ายชื่อ training ที่มีแผนแล้ว เช่น "🗓 เริ่ม 14 Nov 2026" */
export function PlanTag({ plan, className = "" }) {
  if (!plan) return null;
  const live = plan.status === "inProgress";
  return (
    <span
      title={`${plan.trainingName} · ${planPeriod(plan)}${plan.provider ? ` · ${plan.provider}` : ""} — ${planStatusText(plan)}`}
      className={`ml-1 inline-flex items-center whitespace-nowrap rounded px-1.5 py-px text-[10px] font-bold ${
        live ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"
      } ${className}`}
    >
      🗓 {live ? "กำลังอบรม" : `เริ่ม ${fmt(plan.start)}`}
    </span>
  );
}

/**
 * กล่องสรุปแผนอบรมของพนักงานคนนี้ — วางบนสุดของ modal
 *   plans / loading ส่งมาจาก useEmployeeTrainingPlan (ใช้ข้อมูลชุดเดียวกับป้ายในรายการ)
 */
export default function TrainingPlanNotice({ plans, loading, className = "" }) {
  if (loading) {
    return <div className={`text-[11px] text-gray-400 ${className}`}>กำลังโหลดแผนอบรม…</div>;
  }
  if (!plans || plans.length === 0) {
    return (
      <div className={`text-[11px] text-gray-500 ${className}`}>
        🗓 ยังไม่มีรอบอบรมที่กำลังอบรมหรือกำลังจะเริ่มใน{" "}
        <Link to="/training-plan" className="text-blue-600 no-underline hover:underline">
          Training Plan
        </Link>
      </div>
    );
  }
  return (
    <div className={`rounded-lg border border-[#b6d4fe] bg-[#f3f8ff] px-3 py-2 ${className}`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold text-[#084298]">
          🗓 แผนอบรมของพนักงานคนนี้ ({plans.length} รอบ)
        </span>
        <Link to="/training-plan" className="text-[11px] font-semibold text-blue-600 no-underline hover:underline">
          ดูใน Training Calendar →
        </Link>
      </div>
      <ul className="m-0 list-none space-y-1 p-0">
        {plans.map((p) => {
          const live = p.status === "inProgress";
          return (
            <li key={p.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-800">
              <span
                className={`whitespace-nowrap rounded px-1.5 py-px text-[10px] font-bold ${
                  live ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"
                }`}
              >
                {live ? "🟢" : "🔵"} {planStatusText(p)}
              </span>
              <b className="font-semibold">{p.trainingName}</b>
              <span className="text-gray-600">
                · {planPeriod(p)}
                {p.provider && ` · 📍 ${p.provider}`}
              </span>
              {p.datesFromRequest && (
                <span className="whitespace-nowrap rounded bg-[#fff3cd] px-1.5 py-px text-[10px] text-[#664d03]">
                  📝 วันที่ตามคำขอ
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
