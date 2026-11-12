import { useState, useEffect, useContext, useRef } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { AppContent } from "../../context/AppContext";

// ══════════════════════════════════════════════════════════
// Dashboard — หน้าแรกของทุก role (เดิมชื่อ AdminDashboard.jsx)
//   1. ตัวเลขหลัก (กดแล้วไปหน้าที่เกี่ยวข้อง)
//   2. งานที่รอดำเนินการ — ขาดคน / PE / เริ่มงาน 30 วัน (API เดิม) + Booking รอ HR / D-MOB 7 วัน (/api/dashboard)
//      role ไหนเรียก API ไหนไม่ได้ → ช่องนั้นซ่อนเอง
//      แถว 2 ช่องที่ 3 = สถานะพนักงาน (Mobilization / Availability) — เดิมเป็น section แยกครึ่งจอ
//   3. Certification — section เดียว สลับ "ตาราง (กดแถว → รายชื่อ)" / "กราฟตามประเภท"
//      (เดิมกราฟกับตารางแสดงข้อมูลชุดเดียวกันซ้อนกัน หน้ายาวเกือบ 4 จอ)
// ══════════════════════════════════════════════════════════

// recharts ต้องใช้ค่าสีจริง ไม่ใช่ class
const CERT = { valid: "#1d4ed8", expiring: "#eab308", expired: "#dc3545" };
const MOB = { pending: "#f5c518", ready: "#198754", on_site: "#0d6efd" };

const tooltipStyle = {
  background: "#fff",
  border: "1px solid #dee2e6",
  borderRadius: "8px",
  fontSize: "12px",
  padding: "6px 10px",
};

// หัว section ใหญ่ — แถบซ้ายสีน้ำเงินเข้ม ให้เห็นขอบเขตแต่ละส่วนชัด
const SECTION_HEAD =
  "mb-3 border-l-[3px] border-[#2B2F78] pl-2.5 text-[15px] font-bold leading-tight";
const SECTION_TITLE =
  "text-xs font-semibold uppercase tracking-[0.4px] text-gray-500";
const DAY_MS = 86400000;
// 3 คอลัมน์ + เส้นคั่นแนวตั้ง (มือถือ: เรียงลงเส้นคั่นแนวนอน)
const TODO_ROW =
  "grid grid-cols-1 gap-y-5 lg:grid-cols-3 lg:gap-y-0 lg:divide-x lg:divide-gray-200 [&>*]:min-w-0 lg:[&>*]:px-6 lg:[&>*:first-child]:pl-0 lg:[&>*:last-child]:pr-0";
const UPCOMING_DAYS = 30;
const CHART_MAX = 12; // กราฟแสดงเฉพาะ N ประเภทที่มีปัญหามากที่สุด (มุมมองตารางแสดงครบ)
const CERT_VIEW_KEY = "dashboardCertView"; // "table" | "chart" — จำมุมมองล่าสุด (ต่อเครื่อง)
const readCertView = () => {
  try {
    return localStorage.getItem(CERT_VIEW_KEY) === "chart" ? "chart" : "table";
  } catch {
    return "table";
  }
};

// ══════════════════════════════════════════════════════════
// helpers
// ══════════════════════════════════════════════════════════
const truncate = (str, max) =>
  !str ? "" : str.length > max ? `${str.slice(0, max - 1)}…` : str;

// YYYY-MM-DD ตามเวลาเครื่อง (เดิมใช้ toISOString = UTC วันอาจเลื่อน 1 วัน)
const ymd = (d) => {
  if (!d) return "—";
  const date = new Date(d);
  return isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-CA");
};
const fmtShort = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : "—";
const dayStart = (d) => {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate());
};
const daysFromToday = (d) =>
  d ? Math.round((dayStart(d) - dayStart(new Date())) / DAY_MS) : null;

// "เหลือ 12 วัน" / "หมดแล้ว 5 วัน"
const daysLeftText = (d) => {
  const n = daysFromToday(d);
  if (n == null) return "—";
  if (n < 0) return `หมดแล้ว ${-n} วัน`;
  if (n === 0) return "หมดวันนี้";
  return `เหลือ ${n} วัน`;
};

// จอแคบ → ลดความกว้างแกนชื่อ cert ในกราฟ
function useIsNarrow(query = "(max-width: 639px)") {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e) => setNarrow(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return narrow;
}

// ══════════════════════════════════════════════════════════
// small components
// ══════════════════════════════════════════════════════════
// ตัวเลขหลัก: พื้นขาว + แถบสีบน 3px + ตัวเลขสีตามหมวด — สบายตาแต่แยกหมวดได้ทันที
function Kpi({ value, label, sub, color, tint, to, onClick }) {
  const body = (
    <>
      <div className="text-xs font-semibold text-gray-500">{label}</div>
      <div
        className="mt-1 text-[28px] font-extrabold leading-tight"
        style={{ color }}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-gray-400">{sub}</div>}
    </>
  );
  const cls =
    "group block min-w-0 border-t-[3px] px-4 py-3 text-left no-underline transition-colors";
  const style = { borderTopColor: color, "--kpi-tint": tint };
  if (to)
    return (
      <Link to={to} className={`${cls} hover:bg-[var(--kpi-tint)]`} style={style}>
        {body}
      </Link>
    );
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${cls} cursor-pointer border-x-0 border-b-0 border-solid bg-transparent hover:bg-[var(--kpi-tint)]`}
      style={style}
    >
      {body}
    </button>
  );
}

function BucketChip({ expired, children }) {
  return (
    <span
      className={`whitespace-nowrap rounded px-2 py-px text-[10px] font-bold ${
        expired ? "bg-[#dc3545] text-white" : "bg-[#eab308] text-[#664d03]"
      }`}
    >
      {children}
    </span>
  );
}

// หัวกล่อง "งานที่รอดำเนินการ"
function TodoHead({ title, count, unit, tone, to, linkText }) {
  return (
    <div className="mb-2 flex items-start justify-between gap-2">
      <div>
        <div className={`${SECTION_TITLE} text-gray-700`}>{title}</div>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className={`text-2xl font-extrabold ${tone}`}>{count}</span>
          <span className="text-xs text-gray-500">{unit}</span>
        </div>
      </div>
      {to && (
        <Link
          to={to}
          className="shrink-0 whitespace-nowrap text-xs font-semibold text-blue-600 no-underline hover:underline"
        >
          {linkText} →
        </Link>
      )}
    </div>
  );
}

function TodoRow({ to, left, sub, right }) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between gap-3 border-t border-gray-100 py-2 text-[13px] text-gray-900 no-underline hover:bg-gray-50"
    >
      <div className="min-w-0">
        <div className="truncate font-semibold">{left}</div>
        {sub && <div className="truncate text-[11px] text-gray-500">{sub}</div>}
      </div>
      <div className="shrink-0 text-right text-xs">{right}</div>
    </Link>
  );
}

// ══════════════════════════════════════════════════════════
// main
// ══════════════════════════════════════════════════════════
export default function Dashboard() {
  const { backendUrl } = useContext(AppContent);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // งานที่รอดำเนินการ — null = role นี้เรียกไม่ได้ / โหลดไม่สำเร็จ (ซ่อนช่องนั้น)
  const [requirements, setRequirements] = useState(null);
  const [peItems, setPeItems] = useState(null);
  const [overview, setOverview] = useState(null);

  const [selectedAlertGroup, setSelectedAlertGroup] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const alertReqRef = useRef(0);
  const alertsRef = useRef(null);

  const isNarrow = useIsNarrow();
  const [certView, setCertViewState] = useState(readCertView);
  const setCertView = (v) => {
    setCertViewState(v);
    try {
      localStorage.setItem(CERT_VIEW_KEY, v);
    } catch {
      /* ไม่ critical */
    }
  };

  // initial = โหลดครั้งแรก (แสดง Loading ทั้งหน้า) / refresh = ข้อมูลเดิมค้างไว้
  const load = async ({ initial = false } = {}) => {
    const opt = { withCredentials: true };
    const soft = (p) => p.then((r) => r.data).catch(() => null);
    try {
      if (initial) setLoading(true);
      else setRefreshing(true);
      const [main, reqs, pe, ov] = await Promise.all([
        axios.get(`${backendUrl}/api/dashboard`, opt).then((r) => r.data),
        soft(axios.get(`${backendUrl}/api/supervisor/requirements`, opt)),
        soft(
          axios.get(`${backendUrl}/api/match-exceptions`, {
            ...opt,
            params: { status: "pending" },
          }),
        ),
        soft(axios.get(`${backendUrl}/api/supervisor/projects-overview`, opt)),
      ]);
      setData(main);
      setRequirements(Array.isArray(reqs) ? reqs : null);
      setPeItems(
        Array.isArray(pe) ? pe.filter((x) => !x.status || x.status === "pending") : null,
      );
      setOverview(ov && typeof ov === "object" ? ov : null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load({ initial: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl]);

  // ── modal: ล็อก scroll + กด Esc ปิด ──
  useEffect(() => {
    if (!selectedAlertGroup) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && closeAlertGroup();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!selectedAlertGroup]);

  // เปิด modal + โหลดรายชื่อเต็ม (data.alerts ถูก cap โดย backend)
  const openAlertGroup = async (g) => {
    const reqId = ++alertReqRef.current;
    setSelectedAlertGroup(g);
    setModalLoading(true);
    try {
      const res = await axios.get(
        `${backendUrl}/api/dashboard/alerts/${encodeURIComponent(g.training)}`,
        { withCredentials: true },
      );
      if (reqId !== alertReqRef.current) return;
      setSelectedAlertGroup((prev) =>
        prev && prev.training === g.training
          ? { ...prev, items: res.data }
          : prev,
      );
    } catch (err) {
      console.error(err);
    } finally {
      if (reqId === alertReqRef.current) setModalLoading(false);
    }
  };

  const closeAlertGroup = () => {
    alertReqRef.current++;
    setSelectedAlertGroup(null);
    setModalLoading(false);
  };

  if (loading || !data) {
    return (
      <div className="p-10 text-center text-gray-500">
        {loading ? "Loading…" : "No data."}
      </div>
    );
  }

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // ── สถานะพนักงาน ──
  const mobData = [
    { key: "pending", name: "Pending", value: data.mobilization.pending || 0, color: MOB.pending },
    { key: "ready", name: "Ready", value: data.mobilization.ready || 0, color: MOB.ready },
    { key: "on_site", name: "On-Site", value: data.mobilization.on_site || 0, color: MOB.on_site },
  ];
  const mobTotal = mobData.reduce((n, s) => n + s.value, 0) || 1;

  // ── งานที่รอดำเนินการ ──
  // 1) ตำแหน่งที่ยังขาดคน (requirement ที่ยังไม่จบ)
  const openPositions = (requirements || [])
    .filter((r) => !(r.endDate && daysFromToday(r.endDate) < 0))
    .filter((r) => (r.assigned || 0) < (r.quantity || 0))
    .sort(
      (a, b) =>
        new Date(a.startDate || 8.64e15) - new Date(b.startDate || 8.64e15),
    );
  const missingPeople = openPositions.reduce(
    (n, r) => n + (r.quantity - (r.assigned || 0)),
    0,
  );
  // 2) PE รออนุมัติ — นับต่อโปรเจกต์
  const peByProject = (() => {
    const m = new Map();
    for (const it of peItems || []) {
      const p = it.manpowerRequest?.project;
      const key = p?.id || "unknown";
      if (!m.has(key)) m.set(key, { project: p, count: 0 });
      m.get(key).count += 1;
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  })();
  // 3) requirement ที่จะเริ่มงานใน 30 วัน
  const startingSoon = overview
    ? [...(overview.upcoming || []), ...(overview.inProgress || [])]
        .filter((p) => {
          const n = daysFromToday(p.startDate);
          return n != null && n >= 0 && n <= UPCOMING_DAYS;
        })
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
    : [];
  const bookings = data.pendingBookings || null; // null = backend เก่า / โหลดไม่ได้
  const demobSoon = Array.isArray(data.demobSoon) ? data.demobSoon : null;
  const showTodo = true; // แถว 2 มีสถานะพนักงานเสมอ

  // ── cert: เรียงตัวที่มีปัญหาไว้บนสุด ──
  const certSorted = [...data.certByType]
    .sort(
      (a, b) =>
        (b.expired || 0) + (b.expiring || 0) - ((a.expired || 0) + (a.expiring || 0)),
    )
    .slice(0, CHART_MAX);

  // ── group alerts ตาม training → { training, expiredCount, expiringCount, total, items[] } ──
  const alertGroups = (() => {
    const certTypeMap = new Map(data.certByType.map((c) => [c.name, c]));
    const itemMap = new Map();
    for (const a of data.alerts) {
      const key = a.training || "Unknown";
      if (!itemMap.has(key)) itemMap.set(key, []);
      itemMap.get(key).push(a);
    }
    return [...new Set([...certTypeMap.keys(), ...itemMap.keys()])]
      .map((key) => {
        const certType = certTypeMap.get(key);
        const items = itemMap.get(key) || [];
        const expiredCount =
          certType?.expired ?? items.filter((a) => a.bucket === "expired").length;
        const expiringCount =
          certType?.expiring ?? items.filter((a) => a.bucket !== "expired").length;
        const totalHolders =
          certType?.total ?? (certType?.valid ?? 0) + expiredCount + expiringCount;
        return {
          training: key,
          expiredCount,
          expiringCount,
          totalHolders,
          items,
        };
      })
      .filter((g) => g.expiredCount > 0 || g.expiringCount > 0)
      .sort(
        (a, b) =>
          b.expiredCount + b.expiringCount - (a.expiredCount + a.expiringCount),
      );
  })();
  const maxAlert = Math.max(
    1,
    ...alertGroups.map((g) => g.expiredCount + g.expiringCount),
  );

  // รายชื่อใน modal — Expired ก่อน แล้วเรียงตามวันหมดอายุที่ใกล้สุด
  const modalItems = [...(selectedAlertGroup?.items || [])].sort((a, b) => {
    const ea = a.bucket === "expired" ? 0 : 1;
    const eb = b.bucket === "expired" ? 0 : 1;
    if (ea !== eb) return ea - eb;
    return new Date(a.expiryDate || 0) - new Date(b.expiryDate || 0);
  });

  const yAxisWidth = isNarrow ? 120 : 240;
  const tickMax = isNarrow ? 16 : 32;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1800px] flex-col">
      {/* ════════ Header ════════ */}
      <div className="flex items-center justify-between gap-3 pb-3">
        <div className="min-w-0">
          <h1 className="m-0 text-lg font-bold">My Dashboard</h1>
          <div className="text-xs text-gray-500">{today}</div>
        </div>
        <button
          onClick={() => load()}
          disabled={refreshing}
          className="shrink-0 cursor-pointer rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60"
        >
          <span className={`inline-block ${refreshing ? "animate-spin" : ""}`}>
            ↻
          </span>{" "}
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* ════════ KPI — กดแล้วไปหน้าที่เกี่ยวข้อง ════════ */}
      <div className="grid grid-cols-2 gap-px border-b border-gray-200 bg-gray-200 lg:grid-cols-4 [&>*]:bg-white">
        <Kpi
          value={data.totalWorkers}
          label="Total Workers"
          sub={`Available ${data.availability.available} · Unavailable ${data.availability.unavailable}`}
          color="#1e3a5f"
          tint="#f1f5fb"
          to="/workers"
        />
        <Kpi
          value={data.counts.ready}
          label="Ready for Deployment"
          sub="พร้อมลงงาน → หน้า Mobilization"
          color="#198754"
          tint="#f0faf4"
          to="/mobilization"
        />
        <Kpi
          value={data.counts.onSite}
          label="Currently On-Site"
          sub="อยู่หน้างาน → Manpower Calendar"
          color="#0d6efd"
          tint="#f0f6ff"
          to="/projects-overview"
        />
        <Kpi
          value={data.counts.certAlerts}
          label="Cert Alerts (<60 days)"
          sub={`${alertGroups.length} cert types · กดเพื่อดูรายการ`}
          color="#dc5b2c"
          tint="#fff5f0"
          onClick={() => {
            setCertView("table");
            alertsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      </div>

      {/* ════════ งานที่รอดำเนินการ ════════ */}
      {showTodo && (
        <section className="border-b border-gray-200 py-4">
          <div className={SECTION_HEAD}>งานที่รอดำเนินการ</div>
          {/* แถว 1: งานจัดคน · แถว 2: งานเอกสาร/หน้างาน — คั่นด้วยเส้นทั้งแนวตั้งและแนวนอน */}
          <div className={TODO_ROW}>
            {requirements && (
              <div className="min-w-0">
                <TodoHead
                  title="ตำแหน่งที่ยังขาดคน"
                  count={openPositions.length}
                  unit={`ตำแหน่ง · ขาด ${missingPeople} คน`}
                  tone={openPositions.length ? "text-[#dc3545]" : "text-[#198754]"}
                  to="/requirements"
                  linkText="ดูทั้งหมด"
                />
                {openPositions.length === 0 ? (
                  <div className="border-t border-gray-100 py-2 text-xs text-[#198754]">
                    ✓ ทุกตำแหน่งจัดคนครบแล้ว
                  </div>
                ) : (
                  openPositions.slice(0, 5).map((r) => {
                    const n = daysFromToday(r.startDate);
                    return (
                      <TodoRow
                        key={r.id}
                        to={`/allocation?projectId=${r.projectId}`}
                        left={r.position || "—"}
                        sub={`${r.projectCode || ""} ${r.jobTitle || r.projectName || ""}`.trim()}
                        right={
                          <>
                            <div className="font-bold text-[#dc3545]">
                              ขาด {r.quantity - (r.assigned || 0)}
                            </div>
                            <div
                              className={
                                n != null && n <= 7 ? "text-[#dc3545]" : "text-gray-400"
                              }
                            >
                              {n == null
                                ? "—"
                                : n < 0
                                  ? `เริ่มแล้ว ${fmtShort(r.startDate)}`
                                  : `เริ่ม ${fmtShort(r.startDate)} (${n} วัน)`}
                            </div>
                          </>
                        }
                      />
                    );
                  })
                )}
              </div>
            )}

            {peItems && (
              <div className="min-w-0">
                <TodoHead
                  title="PE รออนุมัติ"
                  count={peItems.length}
                  unit="คำขอ"
                  tone={peItems.length ? "text-[#b08900]" : "text-[#198754]"}
                  to="/pe-approvals"
                  linkText="ไปอนุมัติ"
                />
                {peItems.length === 0 ? (
                  <div className="border-t border-gray-100 py-2 text-xs text-[#198754]">
                    ✓ ไม่มีคำขอค้าง
                  </div>
                ) : (
                  peByProject.slice(0, 5).map((g, i) => (
                    <TodoRow
                      key={g.project?.id || i}
                      to="/pe-approvals"
                      left={
                        g.project?.masterProjectRecord?.projectCode
                          ? `[${g.project.masterProjectRecord.projectCode}] ${g.project.name}`
                          : g.project?.name || "—"
                      }
                      right={
                        <span className="font-bold text-[#b08900]">
                          {g.count} คน
                        </span>
                      }
                    />
                  ))
                )}
              </div>
            )}

            {overview && (
              <div className="min-w-0">
                <TodoHead
                  title={`เริ่มงานใน ${UPCOMING_DAYS} วัน`}
                  count={startingSoon.length}
                  unit="requirement"
                  tone="text-[#0d6efd]"
                  to="/projects-overview"
                  linkText="Manpower Calendar"
                />
                {startingSoon.length === 0 ? (
                  <div className="border-t border-gray-100 py-2 text-xs text-gray-500">
                    ไม่มี requirement ที่จะเริ่มใน {UPCOMING_DAYS} วัน
                  </div>
                ) : (
                  startingSoon.slice(0, 5).map((p) => {
                    const need = (p.requests || []).reduce(
                      (n, r) => n + (r.quantity || 0),
                      0,
                    );
                    const have = (p.employees || []).length;
                    return (
                      <TodoRow
                        key={p.id}
                        to={`/projects-overview/${p.id}`}
                        left={p.name}
                        sub={[
                          p.masterProjectRecord?.projectCode,
                          p.client,
                          p.currentStage?.label && `ขั้นตอน: ${p.currentStage.label}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        right={
                          <>
                            <div className="font-semibold text-gray-900">
                              {fmtShort(p.startDate)}
                            </div>
                            <div
                              className={
                                have >= need && need > 0
                                  ? "text-[#198754]"
                                  : "text-gray-400"
                              }
                            >
                              ลงงาน {have}/{need}
                            </div>
                          </>
                        }
                      />
                    );
                  })
                )}
              </div>
            )}

          </div>
          <div className={`${TODO_ROW} mt-4 border-t border-gray-200 pt-4`}>
            {bookings && (
              <div className="min-w-0">
                <TodoHead
                  title="Booking รอ HR ยืนยัน"
                  count={bookings.training.items + bookings.medical.items}
                  unit="คน"
                  tone={
                    bookings.training.items + bookings.medical.items
                      ? "text-[#b08900]"
                      : "text-[#198754]"
                  }
                />
                {[
                  ["Training Bookings", bookings.training, "/requests-history"],
                  ["Medical Bookings", bookings.medical, "/medical-bookings"],
                ].map(([label, b, to]) => (
                  <TodoRow
                    key={label}
                    to={to}
                    left={label}
                    sub={b.batches ? `${b.batches} คำขอที่ยังค้าง` : "ไม่มีคำขอค้าง"}
                    right={
                      b.items ? (
                        <span className="font-bold text-[#b08900]">{b.items} คน</span>
                      ) : (
                        <span className="text-[#198754]">✓</span>
                      )
                    }
                  />
                ))}
              </div>
            )}

            {demobSoon && (
              <div className="min-w-0">
                <TodoHead
                  title="D-MOB ใน 7 วัน"
                  count={demobSoon.length}
                  unit="คน · เตรียมคนผลัดต่อ"
                  tone="text-[#0d6efd]"
                />
                {demobSoon.length === 0 ? (
                  <div className="border-t border-gray-100 py-2 text-xs text-gray-500">
                    ไม่มีคน D-MOB ใน 7 วันนี้
                  </div>
                ) : (
                  <>
                    {demobSoon.slice(0, 5).map((a, i) => {
                      const n = daysFromToday(a.demobDate);
                      return (
                        <TodoRow
                          key={`${a.employeeId}-${i}`}
                          to={`/workers/${a.employeeId}`}
                          left={
                            <>
                              {a.fullName}
                              {a.fullNameTH && (
                                <span className="ml-1.5 font-normal text-gray-500">
                                  {a.fullNameTH}
                                </span>
                              )}
                            </>
                          }
                          sub={[
                            a.position,
                            a.projectCode || a.projectName,
                            a.platform,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                          right={
                            <>
                              <div className="font-semibold text-gray-900">
                                {fmtShort(a.demobDate)}
                              </div>
                              <div className={n <= 2 ? "text-[#dc3545]" : "text-gray-400"}>
                                {n === 0 ? "วันนี้" : `อีก ${n} วัน`}
                              </div>
                            </>
                          }
                        />
                      );
                    })}
                    {demobSoon.length > 5 && (
                      <div className="border-t border-gray-100 py-1.5 text-[11px] text-gray-400">
                        + อีก {demobSoon.length - 5} คน
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* สถานะพนักงาน — แท่งเดียวแบ่งสัดส่วน (แทนวงกลมที่ชิ้นเล็กมองไม่เห็น) */}
            <div className="min-w-0">
              <TodoHead
                title="สถานะพนักงาน (Mobilization)"
                count={data.totalWorkers}
                unit={`คน · Available ${data.availability.available} · Unavailable ${data.availability.unavailable}`}
                tone="text-[#1e3a5f]"
                to="/workers"
                linkText="Worker Pool"
              />
              <div className="flex h-2.5 overflow-hidden rounded-full bg-gray-100">
                {mobData.map((s) =>
                  s.value > 0 ? (
                    <div
                      key={s.key}
                      title={`${s.name} ${s.value}`}
                      style={{
                        width: `${Math.max(1.5, (s.value / mobTotal) * 100)}%`,
                        background: s.color,
                      }}
                    />
                  ) : null,
                )}
              </div>
              <div className="mt-2">
                {mobData.map((s) => (
                  <div
                    key={s.key}
                    className="flex items-center justify-between border-t border-gray-100 py-2 text-[13px]"
                  >
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                      {s.name}
                    </span>
                    <span>
                      <b>{s.value}</b>
                      <span className="ml-2 text-xs text-gray-400">
                        {Math.round((s.value / mobTotal) * 100)}%
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ════════ Certification — ตาราง / กราฟ ในที่เดียว ════════ */}
      <section ref={alertsRef} className="scroll-mt-16 border-b border-gray-200 py-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`${SECTION_HEAD} mb-0`}>Certification Compliance</span>
            {/* segmented control — แบบเดียวกับหน้า Bookings */}
            <div className="inline-flex gap-0.5 rounded-lg bg-gray-100 p-0.5" role="group" aria-label="มุมมอง">
              <button
                key="table"
                type="button"
                onClick={() => setCertView("table")}
                aria-pressed={certView === "table"}
                className={`cursor-pointer whitespace-nowrap rounded-md border-none px-2.5 py-1 text-xs font-semibold transition ${
                  certView === "table"
                    ? "bg-white text-[#2B2F78] shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
                    : "bg-transparent text-gray-500 hover:text-gray-800"
                }`}
              >
                🔔 ใกล้หมด / หมดอายุ
              </button>
              <button
                key="chart"
                type="button"
                onClick={() => setCertView("chart")}
                aria-pressed={certView === "chart"}
                className={`cursor-pointer whitespace-nowrap rounded-md border-none px-2.5 py-1 text-xs font-semibold transition ${
                  certView === "chart"
                    ? "bg-white text-[#2B2F78] shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
                    : "bg-transparent text-gray-500 hover:text-gray-800"
                }`}
              >
                📊 กราฟตามประเภท
              </button>
            </div>
          </div>
          <span className="text-xs text-gray-500">
            {certView === "table"
              ? `${alertGroups.length} cert types · กดแถวเพื่อดูรายชื่อ`
              : data.certByType.length > CHART_MAX
                ? `แสดง ${CHART_MAX} ประเภทที่มีปัญหามากที่สุด · ครบทุกประเภทในมุมมองตาราง`
                : "เรียงตัวที่มีปัญหา (Expired + Expiring) ไว้บนสุด"}
          </span>
        </div>
        {certView === "table" ? (
          <>
        {alertGroups.length === 0 ? (
          <div className="text-[13px] font-semibold text-[#198754]">
            ✅ No expiring or expired certifications
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead>
                <tr className="bg-gray-50 text-left text-[11px] font-semibold tracking-[0.4px] text-gray-500">
                  <th className="px-3 py-2">CERTIFICATION</th>
                  <th className="w-[90px] px-3 py-2 text-center">EXPIRED</th>
                  <th className="w-[90px] px-3 py-2 text-center">EXPIRING</th>
                  <th className="w-[80px] px-3 py-2 text-center">รวม</th>
                  <th className="w-[28%] px-3 py-2">สัดส่วน</th>
                </tr>
              </thead>
              <tbody>
                {alertGroups.map((g) => {
                  const total = g.expiredCount + g.expiringCount;
                  return (
                    <tr
                      key={g.training}
                      onClick={() => openAlertGroup(g)}
                      className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="px-3 py-2 font-semibold" title={g.training}>
                        {g.training}
                        {g.totalHolders > 0 && (
                          <span className="ml-2 text-[11px] font-normal text-gray-400">
                            จากผู้ถือ {g.totalHolders} คน
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {g.expiredCount > 0 ? (
                          <b className="text-[#dc3545]">{g.expiredCount}</b>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {g.expiringCount > 0 ? (
                          <b className="text-[#8a6d00]">{g.expiringCount}</b>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center font-bold">{total}</td>
                      <td className="px-3 py-2">
                        <div className="flex h-2 overflow-hidden rounded-full bg-gray-100">
                          <div
                            className="bg-[#dc3545]"
                            style={{ width: `${(g.expiredCount / maxAlert) * 100}%` }}
                          />
                          <div
                            className="bg-[#eab308]"
                            style={{ width: `${(g.expiringCount / maxAlert) * 100}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
          </>
        ) : (
          <>
          {certSorted.length ? (
            <ResponsiveContainer
              width="100%"
              height={Math.max(260, certSorted.length * 30)}
            >
              <BarChart
                data={certSorted}
                layout="vertical"
                margin={{ top: 8, right: isNarrow ? 8 : 24, left: 0, bottom: 8 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#eef0f2"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "#adb5bd" }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={yAxisWidth}
                  interval={0}
                  tick={({ x, y, payload }) => (
                    <text
                      x={x}
                      y={y}
                      dy={4}
                      textAnchor="end"
                      fontSize={11}
                      fill="#495057"
                    >
                      <title>{payload.value}</title>
                      {truncate(payload.value, tickMax)}
                    </text>
                  )}
                />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#f1f3f5" }} />
                <Legend
                  iconType="circle"
                  verticalAlign="top"
                  wrapperStyle={{ fontSize: "12px", paddingBottom: "8px" }}
                />
                <Bar dataKey="valid" stackId="a" name="Valid" fill={CERT.valid} />
                <Bar dataKey="expiring" stackId="a" name="Expiring" fill={CERT.expiring} />
                <Bar
                  dataKey="expired"
                  stackId="a"
                  name="Expired"
                  fill={CERT.expired}
                  radius={[0, 3, 3, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-[13px] text-gray-500">No certification data</div>
          )}
          </>
        )}
      </section>

      {/* ════════ Alert modal ════════ */}
      {selectedAlertGroup && (
        <div
          className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/50 p-3 sm:p-5"
          onClick={closeAlertGroup}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-[680px] flex-col overflow-hidden rounded-[10px] bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 bg-[#1e3a5f] px-5 py-3.5 text-white">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold">
                  🔔 {selectedAlertGroup.training}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {selectedAlertGroup.expiredCount > 0 && (
                    <BucketChip expired>
                      {selectedAlertGroup.expiredCount} Expired
                    </BucketChip>
                  )}
                  {selectedAlertGroup.expiringCount > 0 && (
                    <BucketChip>
                      {selectedAlertGroup.expiringCount} Expiring
                    </BucketChip>
                  )}
                </div>
              </div>
              <button
                onClick={closeAlertGroup}
                className="shrink-0 cursor-pointer border-none bg-transparent text-xl leading-none text-white"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-2 sm:px-5">
              {modalLoading ? (
                <div className="p-5 text-center text-[13px] text-gray-500">
                  กำลังโหลดรายชื่อ...
                </div>
              ) : modalItems.length === 0 ? (
                <div className="p-5 text-center text-[13px] text-gray-500">
                  ไม่พบรายชื่อ
                </div>
              ) : (
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="text-left text-[11px] font-semibold tracking-[0.4px] text-gray-500">
                      <th className="py-2 pr-3">NAME</th>
                      <th className="py-2 pr-3">EXPIRES</th>
                      <th className="py-2 text-right">STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalItems.map((a, i) => {
                      const isExpired = a.bucket === "expired";
                      const nameCell = (
                        <>
                          <div className="font-semibold">
                            {a.fullName}
                            {a.fullNameTH && (
                              <span className="ml-1.5 font-normal text-gray-500">
                                {a.fullNameTH}
                              </span>
                            )}
                          </div>
                          {(a.empId || a.position) && (
                            <div className="text-[11px] text-gray-500">
                              {[a.empId, a.position].filter(Boolean).join(" · ")}
                            </div>
                          )}
                        </>
                      );
                      return (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="py-2 pr-3">
                            {a.employeeId ? (
                              <Link
                                to={`/workers/${a.employeeId}`}
                                onClick={closeAlertGroup}
                                className="text-gray-900 no-underline hover:text-blue-600"
                              >
                                {nameCell}
                              </Link>
                            ) : (
                              nameCell
                            )}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-3">
                            {ymd(a.expiryDate)}
                            <div
                              className={`text-[11px] ${
                                isExpired ? "text-[#dc3545]" : "text-[#8a6d00]"
                              }`}
                            >
                              {daysLeftText(a.expiryDate)}
                            </div>
                          </td>
                          <td className="py-2 text-right uppercase">
                            <BucketChip expired={isExpired}>
                              {isExpired ? "Expired" : "Expiring"}
                            </BucketChip>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-200 px-5 py-3">
              <span className="text-xs text-gray-500">
                {!modalLoading && `${modalItems.length} คน`}
              </span>
              <button
                onClick={closeAlertGroup}
                className="cursor-pointer rounded-lg border border-gray-200 bg-white px-5 py-2 text-[13px] hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
