import { useState, useEffect, useContext, Fragment } from "react";
import axios from "axios";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  LabelList,
  PieChart,
  Pie,
  Legend,
} from "recharts";
import { AppContent } from "../../context/AppContext";
import ClientFilter from "../../components/ClientFilter";

// ══════════════════════════════════════════════════════════
// palette (recharts ต้องใช้ค่าสีจริง ไม่ใช่ class)
// ══════════════════════════════════════════════════════════
const NAVY = "#1e3a5f";
const ORANGE = "#e8833a";
const CERT = { valid: "#198754", expiring: "#f5c518", expired: "#dc3545" };

const QUARTERS = [
  [null, "All Year"],
  [1, "Q1"],
  [2, "Q2"],
  [3, "Q3"],
  [4, "Q4"],
];

// tooltip ของ recharts รับเป็น style object เท่านั้น
const tooltipStyle = {
  background: "#fff",
  border: "1px solid #dee2e6",
  borderRadius: "8px",
  fontSize: "12px",
  padding: "6px 10px",
};

// ══════════════════════════════════════════════════════════
// CSV export (summary + breakdown, ไฟล์เดียว)
// ══════════════════════════════════════════════════════════
function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCSV(d, clientName) {
  const rows = [["Section", "Item", "Value"]];
  if (clientName) rows.push(["Filter", "Client (Projects only)", clientName]);
  rows.push(["Summary", "Total Workers", d.totalWorkers]);
  rows.push(["Summary", "Total Projects", d.projects.total]);
  rows.push(["Summary", "Active Projects", d.projects.active]);
  rows.push(["Summary", "Completed Projects", d.projects.completed]);
  d.headcountByDivision.forEach((x) =>
    rows.push(["Headcount by Department", x.name, x.count]),
  );
  d.topPositions.forEach((x) => rows.push(["Top Positions", x.name, x.count]));
  Object.entries(d.workerMobilization).forEach(([k, v]) =>
    rows.push(["Mobilization Status", k, v]),
  );
  Object.entries(d.workerAvailability).forEach(([k, v]) =>
    rows.push(["Availability", k, v]),
  );
  rows.push(["Certification", "Valid", d.certCompliance.valid]);
  rows.push(["Certification", "Expiring <=60d", d.certCompliance.expiring]);
  rows.push(["Certification", "Expired", d.certCompliance.expired]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const today = () => new Date().toISOString().slice(0, 10);

// ══════════════════════════════════════════════════════════
// small components
// ══════════════════════════════════════════════════════════
// section คั่นด้วยเส้น (ไม่มีกรอบ card) — หัวข้อมีแถบซ้ายแบบหน้า Dashboard
function Card({ title, children, className = "" }) {
  return (
    <section className={`min-w-0 py-4 ${className}`}>
      <div className="mb-3 border-l-[3px] border-[#2B2F78] pl-2.5 text-[15px] font-bold leading-tight">
        {title}
      </div>
      {children}
    </section>
  );
}

function SummaryRow({ label, value, strong, divider, hint }) {
  return (
    <div
      className={`flex justify-between gap-3 border-b border-gray-100 py-2.5 text-[13px] ${
        divider ? "border-t-2 border-t-gray-200" : ""
      }`}
    >
      <span className={strong ? "font-bold" : ""}>{label}</span>
      <span className="font-bold">
        {value}
        {hint && (
          <span className="ml-1.5 font-normal text-gray-400">{hint}</span>
        )}
      </span>
    </div>
  );
}

function Muted({ children }) {
  return <div className="text-[13px] text-gray-500">{children}</div>;
}

// แกน X แบบเอียง — กันชื่อแผนกยาวๆ ชนกัน (เช่น "Unspecified" กับ "Maintenance & EQ")
function AngledTick({ x, y, payload }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={10}
        textAnchor="end"
        transform="rotate(-35)"
        fontSize={11}
        fill="#6c757d"
      >
        {payload.value}
      </text>
    </g>
  );
}

// ══════════════════════════════════════════════════════════
// main
// ══════════════════════════════════════════════════════════
export default function AnalyticsReports() {
  // โหมด multi: เลือกลูกค้า → กรองส่วนที่ผูกกับ project (การลงงาน / จำนวน Project)
  //   Headcount, Top Positions, Mobilization / Availability, Cert = พนักงานทั้งหมด (Worker Pool ใช้ร่วม)
  const { backendUrl, isMultiClient, selectedClient } = useContext(AppContent);
  const clientId = selectedClient?.id || undefined;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // ── Deployment report (Position / Onshore-Offshore / Project) ──
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedQuarter, setSelectedQuarter] = useState(null); // null = ทั้งปี
  const [deployment, setDeployment] = useState(null);
  const [loadingDeployment, setLoadingDeployment] = useState(true);
  const [expandedProject, setExpandedProject] = useState(null);

  const availableYears = Array.from({ length: 5 }, (_, i) => currentYear - i);

  useEffect(() => {
    let ignore = false;
    axios
      .get(`${backendUrl}/api/analytics`, {
        withCredentials: true,
        params: { clientId },
      })
      .then((res) => !ignore && setData(res.data))
      .catch((err) => console.error(err))
      .finally(() => !ignore && setLoading(false));
    return () => {
      ignore = true;
    };
  }, [backendUrl, clientId]);

  useEffect(() => {
    // กดสลับ Q เร็วๆ — ทิ้งผลลัพธ์ของ request เก่า
    let ignore = false;
    setLoadingDeployment(true);
    setExpandedProject(null);
    axios
      .get(`${backendUrl}/api/analytics/deployment`, {
        withCredentials: true,
        params: {
          year: selectedYear,
          quarter: selectedQuarter || undefined,
          clientId,
        },
      })
      .then((res) => {
        if (!ignore) setDeployment(res.data);
      })
      .catch((err) => console.error(err))
      .finally(() => {
        if (!ignore) setLoadingDeployment(false);
      });
    return () => {
      ignore = true;
    };
  }, [backendUrl, selectedYear, selectedQuarter, clientId]);

  const exportCSV = () => {
    if (!data) return;
    // \uFEFF (BOM) — ให้ Excel อ่านภาษาไทยในชื่อแผนก/ตำแหน่งถูกต้อง ไม่เป็นตัวอักษรเพี้ยน
    downloadBlob(
      new Blob(["\uFEFF" + buildCSV(data, selectedClient?.name)], {
        type: "text/csv;charset=utf-8;",
      }),
      `analytics-report-${selectedClient ? `${selectedClient.name}-` : ""}${today()}.csv`,
    );
  };

  // Export PE Tracking (.xlsx) ย้ายไปหน้า Compliance Center แล้ว (ข้อมูลผลตรวจสุขภาพรายคน)

  if (loading || !data) {
    return (
      <div className="p-10 text-center text-gray-500">
        {loading ? "Loading…" : "No data."}
      </div>
    );
  }

  // ── map สำหรับ recharts ──
  const deptData = data.headcountByDivision.map((d) => ({
    name: d.name,
    Workers: d.count,
  }));
  const posData = data.topPositions.map((d) => ({
    name: d.name,
    Workers: d.count,
  }));
  const certData = [
    { name: "Valid", value: data.certCompliance.valid, color: CERT.valid },
    {
      name: "Expiring ≤60d",
      value: data.certCompliance.expiring,
      color: CERT.expiring,
    },
    {
      name: "Expired",
      value: data.certCompliance.expired,
      color: CERT.expired,
    },
  ];
  const certTotal = certData.reduce((n, s) => n + s.value, 0);
  const pct = (v, total) =>
    total ? `${Math.round((v / total) * 100)}%` : "0%";

  const positionUsage = deployment?.positionUsage || [];
  const byProject = deployment?.byProject || [];
  const siteType = deployment?.siteType || {};
  const siteTotal =
    (siteType.offshore || 0) +
    (siteType.onshore || 0) +
    (siteType.unspecified || 0);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1800px]">
      {/* ════════ Header ════════ */}
      <div className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="m-0 text-lg font-bold">Analytics &amp; Reports</h1>
          <div className="text-xs text-gray-500">
            Workforce Intelligence — การลงงานรายตำแหน่ง/โปรเจกต์, กำลังคน, Cert
          </div>
        </div>
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <button
            onClick={exportCSV}
            className="cursor-pointer whitespace-nowrap rounded-md border-none bg-[#198754] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#157347]"
          >
            ⬇ Export CSV Report
          </button>
        </div>
      </div>

      {/* ════════ Filter: Client (โหมด multi) + Year + Quarter ════════ */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-y border-gray-200 py-3">
        {/* โหมด multi เท่านั้น — ค่าเดียวกับตัวเลือกบน Navbar */}
        <ClientFilter className="w-full sm:w-[170px]" />
        <div className="min-w-0">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.4px] text-gray-500">
          ช่วงเวลา (การลงงาน)
        </span>
        <div className="flex flex-wrap items-center gap-3">
        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
          className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-blue-400"
        >
          {availableYears.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1.5">
          {QUARTERS.map(([val, label]) => {
            const active = selectedQuarter === val;
            return (
              <button
                key={label}
                onClick={() => setSelectedQuarter(val)}
                className={`cursor-pointer rounded-md border px-3.5 py-1.5 text-xs font-semibold ${
                  active
                    ? "border-[#1e3a5f] bg-[#1e3a5f] text-white"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        </div>
        </div>
        {isMultiClient && selectedClient && (
          <div className="w-full text-[11px] text-gray-500 lg:ml-auto lg:w-auto lg:max-w-[560px] lg:pb-1.5 lg:text-right">
            Position Usage, Onshore / Offshore, Breakdown by Project และจำนวน Project = เฉพาะ{" "}
            <b className="text-[#c2410c]">{selectedClient.name}</b> · Headcount, Top Positions,
            สถานะพนักงาน และ Cert = พนักงานทั้งหมด (Worker Pool ใช้ร่วมทุกลูกค้า)
          </div>
        )}
      </div>

      {/* ════════ Position Usage + Onshore/Offshore ════════ */}
      <div className="grid grid-cols-1 border-b border-gray-200 lg:grid-cols-[1.4fr_1fr] lg:divide-x lg:divide-gray-200 lg:[&>*:last-child]:pl-6 lg:[&>*:first-child]:pr-6">
        <Card title="Position Usage — ตำแหน่งที่ถูกใช้จริง (Deployed)">
          {loadingDeployment ? (
            <Muted>Loading…</Muted>
          ) : positionUsage.length ? (
            <ResponsiveContainer
              width="100%"
              height={Math.max(160, positionUsage.length * 40 + 40)}
            >
              <BarChart
                data={positionUsage}
                layout="vertical"
                margin={{ top: 8, right: 32, left: 8, bottom: 8 }}
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
                  width={140}
                  tick={{ fontSize: 11, fill: "#495057" }}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={{ fill: "#f1f3f5" }}
                />
                {/* maxBarSize — กันแท่งหนาเต็มกรอบตอนมีแค่ 1–2 ตำแหน่ง */}
                <Bar
                  dataKey="count"
                  fill={ORANGE}
                  radius={[0, 3, 3, 0]}
                  maxBarSize={28}
                >
                  <LabelList
                    dataKey="count"
                    position="right"
                    fontSize={11}
                    fill="#495057"
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Muted>ไม่มีข้อมูลการ deploy ในช่วงที่เลือก</Muted>
          )}
        </Card>

        <Card title="Onshore vs Offshore">
          {loadingDeployment ? (
            <Muted>Loading…</Muted>
          ) : (
            <>
              <SummaryRow
                label="Offshore"
                value={siteType.offshore ?? 0}
                hint={pct(siteType.offshore || 0, siteTotal)}
                strong
              />
              <SummaryRow
                label="Onshore"
                value={siteType.onshore ?? 0}
                hint={pct(siteType.onshore || 0, siteTotal)}
              />
              {siteType.unspecified > 0 && (
                <SummaryRow
                  label="ไม่ระบุ"
                  value={siteType.unspecified}
                  hint={pct(siteType.unspecified, siteTotal)}
                />
              )}
            </>
          )}
        </Card>
      </div>

      {/* ════════ Breakdown by Project ════════ */}
      <Card title="Breakdown by Project (ON Number)" className="border-b border-gray-200">
        {loadingDeployment ? (
          <Muted>Loading…</Muted>
        ) : !byProject.length ? (
          <Muted>ไม่มีข้อมูล project ในช่วงที่เลือก</Muted>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-gray-200">
                  {["ON NUMBER", "PROJECT / JOB", "EMPLOYEES"].map((h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap px-2.5 py-2 text-left text-[11px] font-semibold text-gray-500"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byProject.map((p, i) => {
                  const key = p.projectCode || `unknown-${i}`;
                  const isOpen = expandedProject === key;
                  return (
                    <Fragment key={key}>
                      <tr
                        onClick={() => setExpandedProject(isOpen ? null : key)}
                        className={`cursor-pointer border-b border-gray-100 ${
                          isOpen ? "bg-gray-50" : "bg-white hover:bg-gray-50"
                        }`}
                      >
                        <td className="whitespace-nowrap px-2.5 py-2 font-semibold">
                          <span className="inline-block w-3 text-gray-400">
                            {isOpen ? "▾" : "▸"}
                          </span>{" "}
                          {p.projectCode || "—"}
                        </td>
                        <td className="px-2.5 py-2">{p.jobTitle}</td>
                        <td className="px-2.5 py-2 font-bold">
                          {p.employeeCount}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td
                            colSpan={3}
                            className="bg-[#fafbfc] px-2.5 pb-3.5 pl-7 pt-2"
                          >
                            <div className="flex flex-wrap gap-1.5">
                              {p.positions.map((pos) => (
                                <span
                                  key={pos.name}
                                  className="rounded-md bg-gray-200 px-2.5 py-[3px] text-xs text-gray-700"
                                >
                                  {pos.name} × {pos.count}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ════════ Department + Top Positions ════════ */}
      <div className="grid grid-cols-1 border-b border-gray-200 lg:grid-cols-2 lg:divide-x lg:divide-gray-200 lg:[&>*:last-child]:pl-6 lg:[&>*:first-child]:pr-6">
        <Card title="Headcount by Department">
          {deptData.length ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart
                data={deptData}
                margin={{ top: 20, right: 8, left: -16, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" />
                <XAxis
                  dataKey="name"
                  interval={0}
                  height={70}
                  tick={<AngledTick />}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "#adb5bd" }}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={{ fill: "#f1f3f5" }}
                />
                <Bar dataKey="Workers" fill={NAVY} radius={[3, 3, 0, 0]}>
                  <LabelList
                    dataKey="Workers"
                    position="top"
                    fontSize={11}
                    fill={NAVY}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Muted>No data</Muted>
          )}
        </Card>

        <Card title="Top Positions / Trades">
          {posData.length ? (
            <ResponsiveContainer
              width="100%"
              height={Math.max(280, posData.length * 38)}
            >
              <BarChart
                data={posData}
                layout="vertical"
                margin={{ top: 8, right: 32, left: 8, bottom: 8 }}
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
                  width={120}
                  tick={{ fontSize: 11, fill: "#495057" }}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={{ fill: "#f1f3f5" }}
                />
                <Bar dataKey="Workers" fill={ORANGE} radius={[0, 3, 3, 0]}>
                  <LabelList
                    dataKey="Workers"
                    position="right"
                    fontSize={11}
                    fill="#495057"
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Muted>No data</Muted>
          )}
        </Card>
      </div>

      {/* ════════ Summary + Cert ════════ */}
      <div className="grid grid-cols-1 border-b border-gray-200 lg:grid-cols-2 lg:divide-x lg:divide-gray-200 lg:[&>*:last-child]:pl-6 lg:[&>*:first-child]:pr-6">
        <Card title="Workforce Summary">
          <SummaryRow label="Total Workers" value={data.totalWorkers} strong />
          <SummaryRow label="Total Projects" value={data.projects.total} />
          <SummaryRow label="Active Projects" value={data.projects.active} />
          <SummaryRow
            label="Completed Projects"
            value={data.projects.completed}
          />
          <SummaryRow
            label="Mobilization: Pending"
            value={data.workerMobilization.pending}
            divider
          />
          <SummaryRow
            label="Mobilization: Ready"
            value={data.workerMobilization.ready}
          />
          <SummaryRow
            label="Mobilization: On-Site"
            value={data.workerMobilization.on_site}
          />
          <SummaryRow
            label="Availability: Available"
            value={data.workerAvailability.available}
            divider
          />
          <SummaryRow
            label="Availability: Unavailable"
            value={data.workerAvailability.unavailable}
          />
        </Card>

        <Card title="Certification Compliance Overview">
          <div className="relative">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={certData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="45%"
                  innerRadius={70}
                  outerRadius={100}
                  paddingAngle={1}
                  stroke="none"
                >
                  {certData.map((s) => (
                    <Cell key={s.name} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                {/* legend แสดงจำนวน + % — ชิ้นเล็กๆ (Expired/Expiring) ดูจากวงแทบไม่เห็น */}
                <Legend
                  verticalAlign="bottom"
                  iconType="circle"
                  wrapperStyle={{ fontSize: "12px" }}
                  formatter={(value, entry) =>
                    `${value}: ${entry.payload.value} (${pct(entry.payload.value, certTotal)})`
                  }
                />
              </PieChart>
            </ResponsiveContainer>
            {/* ตัวเลขรวมตรงกลางวง */}
            <div className="pointer-events-none absolute left-1/2 top-[45%] -translate-x-1/2 -translate-y-1/2 text-center">
              <div className="text-2xl font-extrabold text-gray-900">
                {certTotal}
              </div>
              <div className="text-[11px] text-gray-500">certificates</div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
