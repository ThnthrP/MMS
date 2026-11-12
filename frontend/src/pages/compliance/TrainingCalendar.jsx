import { useState, useEffect, useContext, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import Select from "react-select";
import { AppContent } from "../../context/AppContext";
import { buildWorkerOptions, filterWorkerOption, nameEN, nameTH } from "../../utils/workerSearch";
import { invalidateTrainingPlanCache } from "../../components/TrainingPlanNotice";

// ══════════════════════════════════════════════════════════
// Training Calendar (เมนู Training Plan › แท็บแรก)
// อบรมที่กำลังดำเนินอยู่ / กำลังจะเริ่ม — แต่ละรอบมีใครบ้าง
// ข้อมูล = คำขออบรมที่ HR ยืนยันแล้ว (หน้า Bookings) + แผนที่เพิ่มจากหน้า "เพิ่มแผนอบรม"
// เรียง: กำลังอบรม (เพิ่งเริ่มก่อน) → กำลังจะเริ่ม (ใกล้เริ่มก่อน) → จบแล้ว (ถ้าเปิดดู)
// ══════════════════════════════════════════════════════════

const DAY = 86400000;
const ENDED_DAYS = 30;

const PERIODS = [
  ["inProgress", "🟢 กำลังอบรม", "border-l-[#198754]", "bg-emerald-50 text-emerald-800"],
  ["upcoming", "🔵 กำลังจะเริ่ม", "border-l-blue-600", "bg-blue-50 text-blue-800"],
  ["ended", `⚪ จบแล้ว (${ENDED_DAYS} วัน)`, "border-l-gray-300", "bg-gray-100 text-gray-600"],
];
const PERIOD = Object.fromEntries(PERIODS.map(([k, ...rest]) => [k, rest]));

const LABEL = "mb-1 block text-[11px] font-semibold text-gray-500";
const FIELD =
  "box-border h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-[13px] outline-none focus:border-blue-400";
// react-select — โทนเดียวกับหน้า Workers · dropdown ลอยเหนือทุกอย่าง (render ที่ <body>)
const SELECT_STYLES = {
  control: (p) => ({
    ...p,
    borderColor: "#e5e7eb",
    borderRadius: "8px",
    minHeight: "36px",
    fontSize: "13px",
    boxShadow: "none",
    "&:hover": { borderColor: "#86b7fe" },
  }),
  option: (p) => ({ ...p, fontSize: "13px" }),
  menuPortal: (p) => ({ ...p, zIndex: 50 }),
};
const MENU_PORTAL = {
  menuPortalTarget: typeof document !== "undefined" ? document.body : null,
  menuPosition: "fixed",
};
const NO_PROVIDER = "__none__"; // ตัวเลือก "ยังไม่ระบุสถานที่"

const BTN_SOFT =
  "inline-flex cursor-pointer items-center whitespace-nowrap rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 no-underline hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";

const daysBetween = (a, b) =>
  Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / DAY);
const fmt = (s, withYear = true) =>
  new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
const periodText = (s, e) =>
  s === e
    ? fmt(s)
    : `${fmt(s, s.slice(0, 4) !== e.slice(0, 4))} – ${fmt(e)}`;

// ป้ายบอกความคืบหน้าของรอบ
const progressText = (s, today) => {
  const total = daysBetween(s.start, s.end) + 1;
  if (s.status === "upcoming") {
    const d = daysBetween(today, s.start);
    return d === 1 ? "เริ่มพรุ่งนี้" : `เริ่มในอีก ${d} วัน`;
  }
  if (s.status === "inProgress")
    return `วันที่ ${daysBetween(s.start, today) + 1}/${total}`;
  return `จบเมื่อ ${fmt(s.end)}`;
};

const ymdLocal = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

export default function TrainingCalendar() {
  const { backendUrl } = useContext(AppContent);
  const [data, setData] = useState({ today: ymdLocal(new Date()), sessions: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ตัวกรองแยก 3 ช่อง (เดิมเป็นช่องค้นหาเดียว) — ทุกช่องพิมพ์ค้นหาใน dropdown ได้
  const [trainingFilter, setTrainingFilter] = useState(""); // training.id
  const [providerFilter, setProviderFilter] = useState(""); // ชื่อสถานที่ / NO_PROVIDER
  const [workerFilter, setWorkerFilter] = useState(""); // employee.id
  const [shown, setShown] = useState({ inProgress: true, upcoming: true, ended: false });

  const [editing, setEditing] = useState(null); // { session, start, end, provider }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${backendUrl}/api/training-plan`, {
        params: { endedDays: ENDED_DAYS },
        withCredentials: true,
      });
      setData(res.data);
      setError("");
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [backendUrl]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c = { inProgress: 0, upcoming: 0, ended: 0 };
    data.sessions.forEach((s) => c[s.status]++);
    return c;
  }, [data.sessions]);

  // ตัวเลือกมาจากรอบอบรมที่โหลดมาทั้งหมด (รวมรอบที่จบแล้ว) · วงเล็บ = จำนวนรอบ
  const trainingOptions = useMemo(() => {
    const m = new Map();
    data.sessions.forEach((s) => {
      if (!s.training) return;
      const cur = m.get(s.training.id) || { name: s.training.name, n: 0 };
      cur.n++;
      m.set(s.training.id, cur);
    });
    return [...m.entries()]
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([id, { name, n }]) => ({ value: id, label: `${name} (${n} รอบ)` }));
  }, [data.sessions]);

  const providerOptions = useMemo(() => {
    const m = new Map();
    let blank = 0;
    data.sessions.forEach((s) => {
      const p = (s.provider || "").trim();
      if (!p) blank++;
      else m.set(p, (m.get(p) || 0) + 1);
    });
    const opts = [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([p, n]) => ({ value: p, label: `${p} (${n} รอบ)` }));
    if (blank) opts.push({ value: NO_PROVIDER, label: `— ยังไม่ระบุสถานที่ (${blank} รอบ)` });
    return opts;
  }, [data.sessions]);

  // พนักงานทุกคนที่อยู่ในรอบอบรม (ไม่ซ้ำ) — ค้นหาแบบเดียวกับหน้า Workers (ID / ชื่อไทย / อังกฤษ)
  const workerOptions = useMemo(() => {
    const m = new Map();
    data.sessions.forEach((s) => s.attendees.forEach((a) => a.employee?.id && m.set(a.employee.id, a.employee)));
    return buildWorkerOptions([...m.values()]);
  }, [data.sessions]);

  const matchPerson = (a) => !!workerFilter && a.employee?.id === workerFilter;

  const visible = data.sessions.filter((s) => {
    if (!shown[s.status]) return false;
    if (trainingFilter && s.training?.id !== trainingFilter) return false;
    if (providerFilter) {
      const p = (s.provider || "").trim();
      if (providerFilter === NO_PROVIDER ? p : p !== providerFilter) return false;
    }
    if (workerFilter && !s.attendees.some(matchPerson)) return false;
    return true;
  });
  const peopleShown = new Set(
    visible.flatMap((s) => s.attendees.map((a) => a.employee?.id)),
  ).size;

  const hasFilter =
    trainingFilter || providerFilter || workerFilter || !shown.inProgress || !shown.upcoming || shown.ended;
  const clearFilters = () => {
    setTrainingFilter("");
    setProviderFilter("");
    setWorkerFilter("");
    setShown({ inProgress: true, upcoming: true, ended: false });
  };

  // ── actions ──
  const cancelAttendee = async (session, a) => {
    if (
      !window.confirm(
        `เอา ${nameEN(a.employee)} ออกจากรอบ "${session.training?.name}" (${periodText(session.start, session.end)})?\nรายการจะถูกยกเลิก (ยังดูประวัติได้ที่หน้า Training Bookings)`,
      )
    )
      return;
    try {
      await axios.put(
        `${backendUrl}/api/training-plan/items/${a.itemId}/cancel`,
        {},
        { withCredentials: true },
      );
      invalidateTrainingPlanCache();
      load();
    } catch (err) {
      alert(err.response?.data?.message || "ยกเลิกไม่สำเร็จ");
    }
  };

  const saveEdit = async () => {
    if (!editing.start) return alert("กรุณาระบุวันเริ่ม");
    if (editing.end && editing.end < editing.start) return alert("วันจบต้องไม่ก่อนวันเริ่ม");
    try {
      setBusy(true);
      await axios.put(
        `${backendUrl}/api/training-plan/session`,
        {
          itemIds: editing.session.attendees.map((a) => a.itemId),
          start: editing.start,
          end: editing.end || editing.start,
          provider: editing.provider,
        },
        { withCredentials: true },
      );
      setEditing(null);
      invalidateTrainingPlanCache();
      load();
    } catch (err) {
      alert(err.response?.data?.message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const addPeopleLink = (s) =>
    `/training-plan/new?${new URLSearchParams({
      trainingId: s.training?.id || "",
      start: s.start,
      end: s.end,
      provider: s.provider || "",
    })}`;
  const recordResultLink = (s) =>
    `/certifications/bulk-add?${new URLSearchParams({
      trainingId: s.training?.id || "",
      empIds: s.attendees.map((a) => a.employee?.id).filter(Boolean).join(","),
      issued: s.end,
    })}`;

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1800px]">
      {/* ════════ Header ════════ */}
      <div className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="m-0 text-lg font-bold">Training Calendar</h1>
          <div className="text-xs text-gray-500">
            อบรมที่กำลังดำเนินอยู่และกำลังจะเริ่ม — แต่ละรอบมีใครบ้าง · มาจากคำขอที่ HR
            ยืนยันแล้ว (ถ้ายังไม่ระบุวัน ใช้วันที่ผู้ขอระบุ) และแผนที่เพิ่มเอง
          </div>
        </div>
        <Link
          to="/training-plan/new"
          className="inline-block shrink-0 rounded-md bg-[#2B2F78] px-3.5 py-2 text-center text-xs font-semibold text-white no-underline hover:bg-[#22265f]"
        >
          + เพิ่มแผนอบรม
        </Link>
      </div>

      {/* ════════ Filters ════════ */}
      <div className="space-y-3 border-y border-gray-200 py-3">
        {/* Training — เต็มแถว (ชื่อหลักสูตรยาว) */}
        <div className="min-w-0">
          <label className={`${LABEL} flex items-center justify-between`}>
            <span>Training</span>
            {hasFilter && (
              <button
                type="button"
                onClick={clearFilters}
                className="cursor-pointer border-none bg-transparent p-0 text-[11px] font-semibold text-[#dc3545] underline"
              >
                ✕ ล้างทั้งหมด
              </button>
            )}
          </label>
          <Select
            options={trainingOptions}
            value={trainingOptions.find((o) => o.value === trainingFilter) || null}
            onChange={(o) => setTrainingFilter(o ? o.value : "")}
            placeholder="ทุก training — พิมพ์เพื่อค้นหา..."
            isClearable
            styles={SELECT_STYLES}
            {...MENU_PORTAL}
            noOptionsMessage={() => "ไม่พบ training"}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="min-w-0">
            <label className={LABEL}>ศูนย์อบรม / สถานที่</label>
            <Select
              options={providerOptions}
              value={providerOptions.find((o) => o.value === providerFilter) || null}
              onChange={(o) => setProviderFilter(o ? o.value : "")}
              placeholder="ทุกสถานที่ — พิมพ์เพื่อค้นหา..."
              isClearable
              styles={SELECT_STYLES}
              {...MENU_PORTAL}
              noOptionsMessage={() => "ไม่พบสถานที่"}
            />
          </div>
          <div className="min-w-0">
            <label className={LABEL}>
              Worker <span className="font-normal text-gray-400">(ID / ชื่อไทย / อังกฤษ)</span>
            </label>
            <Select
              options={workerOptions}
              value={workerOptions.find((o) => o.value === workerFilter) || null}
              onChange={(o) => setWorkerFilter(o ? o.value : "")}
              filterOption={filterWorkerOption}
              placeholder="🔍 ค้นหาด้วย ID หรือชื่อ (ไทย/อังกฤษ)..."
              isClearable
              styles={SELECT_STYLES}
              {...MENU_PORTAL}
              noOptionsMessage={() => "ไม่พบพนักงานในรอบอบรม"}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {PERIODS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setShown((p) => ({ ...p, [key]: !p[key] }))}
              className={`cursor-pointer rounded-full border px-3 py-1 font-semibold ${
                shown[key]
                  ? "border-[#2B2F78] bg-[#2B2F78] text-white"
                  : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {label} {counts[key]}
            </button>
          ))}
          <span className="ml-auto text-gray-500">
            แสดง {visible.length} รอบ · {peopleShown} คน
          </span>
        </div>
      </div>

      {/* ════════ Sessions ════════ */}
      {loading ? (
        <div className="p-10 text-center text-[13px] text-gray-500">Loading...</div>
      ) : error ? (
        <div className="p-10 text-center text-[13px] text-red-600">{error}</div>
      ) : visible.length === 0 ? (
        <div className="p-10 text-center text-[13px] text-gray-500">
          {data.sessions.length === 0 ? (
            <>
              ยังไม่มีอบรมที่กำลังดำเนินอยู่หรือกำลังจะเริ่ม —{" "}
              <Link to="/training-plan/new" className="text-blue-600">
                + เพิ่มแผนอบรม
              </Link>{" "}
              หรือยืนยันคำขอที่หน้า{" "}
              <Link to="/requests-history" className="text-blue-600">
                Training Bookings
              </Link>
            </>
          ) : (
            "ไม่พบรอบอบรมตามเงื่อนไขที่เลือก"
          )}
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {visible.map((s) => {
            const [periodLabel, accent, tagCls] = PERIOD[s.status];
            return (
              <div key={s.key} className={`border-l-4 py-3 pl-3 pr-1 sm:pl-4 ${accent}`}>
                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-words text-[15px] font-bold text-gray-900">
                        {s.training?.name || "—"}
                      </span>
                      <span
                        className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${tagCls}`}
                      >
                        {periodLabel.split(" (")[0]} · {progressText(s, data.today)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[13px] text-gray-700">
                      📅 {periodText(s.start, s.end)}
                      <span className="text-gray-400">
                        {" "}
                        · {daysBetween(s.start, s.end) + 1} วัน
                      </span>
                      {s.provider && <span className="text-gray-600"> · 📍 {s.provider}</span>}
                      <span className="text-gray-600"> · 👥 {s.attendees.length} คน</span>
                    </div>
                    {s.datesFromRequest && (
                      <div className="mt-1 inline-block rounded bg-[#fff3cd] px-1.5 py-0.5 text-[11px] text-[#664d03]">
                        📝 วันที่ตามคำขอ — HR ยังไม่ได้ระบุวันยืนยัน · กด "แก้วันที่ / สถานที่" เพื่อยืนยันวัน
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    {s.status !== "ended" && (
                      <Link to={addPeopleLink(s)} className={BTN_SOFT}>
                        + เพิ่มคน
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setEditing({ session: s, start: s.start, end: s.end, provider: s.provider || "" })
                      }
                      className={BTN_SOFT}
                    >
                      แก้วันที่ / สถานที่
                    </button>
                    {s.status !== "upcoming" && (
                      <Link
                        to={recordResultLink(s)}
                        title="อบรมเสร็จแล้ว → บันทึก certification ให้ทุกคนในรอบนี้"
                        className="inline-flex items-center whitespace-nowrap rounded-md border border-[#a3cfbb] bg-[#e8f5ee] px-2.5 py-1 text-xs font-semibold text-[#146c43] no-underline hover:bg-[#198754] hover:text-white"
                      >
                        ✓ บันทึกผลอบรม →
                      </Link>
                    )}
                  </div>
                </div>

                {/* รายชื่อในรอบนี้ */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {s.attendees.map((a) => {
                    const hit = matchPerson(a);
                    return (
                      <span
                        key={a.itemId}
                        title={[
                          nameTH(a.employee),
                          a.employee?.position?.name,
                          a.requestedBy && `ขอโดย ${a.requestedBy}`,
                          a.hrNote,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        className={`inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${
                          hit
                            ? "border-blue-400 bg-blue-50 font-semibold text-blue-800"
                            : "border-gray-200 bg-white text-gray-700"
                        }`}
                      >
                        <Link
                          to={`/workers/${a.employee?.id}`}
                          className="truncate text-inherit no-underline hover:underline"
                        >
                          {nameEN(a.employee)}
                        </Link>
                        <span className="shrink-0 text-[10px] text-gray-400">
                          {a.employee?.empId || a.employee?.empCode}
                        </span>
                        {s.status !== "ended" && (
                          <button
                            type="button"
                            title="เอาออกจากรอบนี้"
                            onClick={() => cancelAttendee(s, a)}
                            className="shrink-0 cursor-pointer border-none bg-transparent p-0 text-[11px] leading-none text-gray-400 hover:text-[#dc3545]"
                          >
                            ✕
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ════════ แก้วันที่ / สถานที่ ของทั้งรอบ ════════ */}
      {editing && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-3"
          onClick={() => !busy && setEditing(null)}
        >
          <div
            className="w-full max-w-[460px] overflow-hidden rounded-[10px] bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-[#1e3a5f] px-5 py-3.5 text-white">
              <div className="font-semibold">แก้วันที่ / สถานที่</div>
              <div className="mt-0.5 text-xs opacity-80">
                {editing.session.training?.name} · {editing.session.attendees.length} คน
              </div>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>วันเริ่ม *</label>
                  <input
                    type="date"
                    value={editing.start}
                    onChange={(e) => setEditing((p) => ({ ...p, start: e.target.value }))}
                    className={FIELD}
                  />
                </div>
                <div>
                  <label className={LABEL}>วันจบ</label>
                  <input
                    type="date"
                    value={editing.end}
                    min={editing.start || undefined}
                    onChange={(e) => setEditing((p) => ({ ...p, end: e.target.value }))}
                    className={FIELD}
                  />
                </div>
              </div>
              <div>
                <label className={LABEL}>ศูนย์อบรม / สถานที่</label>
                <input
                  type="text"
                  value={editing.provider}
                  onChange={(e) => setEditing((p) => ({ ...p, provider: e.target.value }))}
                  placeholder="e.g. TPTI Songkhla"
                  className={FIELD}
                />
              </div>
              <div className="text-[11px] text-gray-500">
                ใช้กับทุกคนในรอบนี้ ({editing.session.attendees.length} คน)
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={busy}
                className="cursor-pointer rounded-lg border border-gray-200 bg-white px-4 py-2 text-[13px] hover:bg-gray-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={busy}
                className="cursor-pointer rounded-lg border-none bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? "กำลังบันทึก..." : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
