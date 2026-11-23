import { useState, useEffect, useContext } from "react";
import axios from "axios";
import { AppContent } from "../../context/AppContext";
import useStickyState from "../../hooks/useStickyState";
import { Link, useSearchParams } from "react-router-dom";
import Select from "react-select";
import ClientFilter from "../../components/ClientFilter";

// ══════════════════════════════════════════════════════════
// constants
// ══════════════════════════════════════════════════════════
const TONE = {
  ok: {
    active: "border-[#0f5132] bg-[#d1e7dd] text-[#0f5132]",
    hover: "hover:border-[#0f5132] hover:bg-[#d1e7dd]",
  },
  warn: {
    active: "border-[#664d03] bg-[#fff3cd] text-[#664d03]",
    hover: "hover:border-[#664d03] hover:bg-[#fff3cd]",
  },
  danger: {
    active: "border-[#842029] bg-[#f8d7da] text-[#842029]",
    hover: "hover:border-[#842029] hover:bg-[#f8d7da]",
  },
};

const REHIRE = [
  ["yes", "Yes", "ok"],
  ["maybe", "Maybe", "warn"],
  ["no", "No", "danger"],
];

const FILTER_LABEL =
  "mb-1 block text-xs font-semibold uppercase tracking-[0.4px] text-gray-500";
const ROW_FILTERS = [
  ["all", "ทั้งหมด"],
  ["todo", "ยังไม่ประเมิน"],
  ["done", "ประเมินแล้ว"],
];
const DAY_MS = 86400000;
const STATUS_FILTERS = [
  ["all", "ทั้งหมด"],
  ["active", "Active"],
  ["completed", "Completed"],
];
const TH =
  "whitespace-nowrap border-b border-gray-200 bg-gray-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.4px] text-gray-500";
const TD = "border-b border-gray-100 px-3 py-2.5 align-middle text-[13px]";

// react-select ใช้ styles API ของไลบรารี
const projectSelectStyles = {
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
  placeholder: (p) => ({ ...p, fontSize: "13px", color: "#6c757d" }),
  menuPortal: (p) => ({ ...p, zIndex: 9999 }),
  // มือถือ: ไม่ให้เมนูกว้างเกินจอ
  menu: (p) => ({ ...p, minWidth: "min(560px, calc(100vw - 24px))" }),
  menuList: (p) => ({ ...p, maxHeight: "360px" }),
  // ข้อความที่เลือกแล้วขึ้นบรรทัดใหม่ได้ ไม่ตัด ...
  singleValue: (p) => ({
    ...p,
    whiteSpace: "normal",
    wordBreak: "break-word",
    overflow: "visible",
    lineHeight: "1.3",
  }),
  valueContainer: (p) => ({ ...p, padding: "2px 8px" }),
};

// ══════════════════════════════════════════════════════════
// helpers
// ══════════════════════════════════════════════════════════
// YYYY-MM-DD ตามเวลาเครื่อง (เดิมใช้ toISOString() ซึ่งเป็นเวลา UTC
// วันที่อาจเลื่อนไป 1 วันถ้า backend เก็บเป็นเวลาไทย)
const ymd = (d) => {
  if (!d) return "—";
  const date = new Date(d);
  return isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-CA");
};

const dayStart = (d) => {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate());
};
// สถานะหน้างานของแต่ละคน — ประเมินได้ดีที่สุดหลัง D-MOB
const workState = (r) => {
  if (!r.demobDate) return { text: "ยังไม่กำหนด D-MOB", cls: "text-gray-400" };
  const n = Math.round((dayStart(r.demobDate) - dayStart(new Date())) / DAY_MS);
  if (n > 0) return { text: `ยังอยู่หน้างาน · D-MOB อีก ${n} วัน`, cls: "text-[#0d6efd]" };
  if (n === 0) return { text: "D-MOB วันนี้", cls: "text-[#b08900]" };
  return { text: `ลงจากงานแล้ว ${-n} วัน`, cls: "text-gray-500" };
};
const fmtDateTime = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "";

const fmtProjectDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : null;

// ══════════════════════════════════════════════════════════
// small components
// ══════════════════════════════════════════════════════════
function StatusBadge({ completed }) {
  return (
    <span
      className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold ${
        completed
          ? "bg-[#d1e7dd] text-[#0f5132]"
          : "bg-[#cfe2ff] text-[#084298]"
      }`}
    >
      {completed ? "Completed" : "Active"}
    </span>
  );
}

function Stars({ value, onChange, disabled }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => !disabled && onChange(n)}
          disabled={disabled}
          aria-label={`${n} star`}
          className={`select-none border-none bg-transparent p-0 text-lg leading-none ${
            disabled ? "cursor-default" : "cursor-pointer hover:scale-110"
          } ${n <= value ? "text-[#f5a623]" : "text-gray-300"}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function RehirePicker({ value, touched, onChange, disabled }) {
  return (
    <div className="flex gap-1">
      {REHIRE.map(([key, label, tone]) => {
        const active = value === key;
        // "Maybe" ที่เป็นค่า default ยังไม่ได้ตั้งใจเลือก → กรอบประ สีจาง
        const unconfirmed = active && key === "maybe" && !touched;
        const cls = active
          ? unconfirmed
            ? "border-dashed border-[#664d03] bg-white text-gray-400"
            : TONE[tone].active
          : `border-gray-200 bg-white text-gray-400 ${disabled ? "" : TONE[tone].hover}`;
        return (
          <button
            key={key}
            type="button"
            onClick={() => !disabled && onChange(key)}
            disabled={disabled}
            className={`rounded-md border px-2.5 py-[3px] text-[11px] font-semibold transition-colors ${cls} ${
              disabled ? "cursor-default" : "cursor-pointer"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// main
// ══════════════════════════════════════════════════════════
export default function PostProjectReview() {
  // Client = ค่าเดียวกับ Navbar (โหมด multi) — รายการโปรเจกต์ + ตัวเลขบนปุ่มสถานะ เฉพาะลูกค้าที่เลือก
  const { backendUrl, userData, selectedClient, clientMatches } =
    useContext(AppContent);

  // ทุกคนที่เข้าหน้านี้ได้ จัดการ review ได้เต็มสิทธิ์ (คุมสิทธิ์ที่ AppRouter)
  const canManageReview = true;

  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useStickyState(
    "review_projectId",
    "",
  );
  // เปิดจากลิงก์ ?projectId=... (เช่น Manpower Calendar › ผู้ประเมิน) → เลือกโปรเจกต์นั้นให้เลย
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const qp = searchParams.get("projectId");
    if (qp) {
      setSelectedProjectId(qp);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [project, setProject] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [completing, setCompleting] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all"); // กรองรายการโปรเจกต์ใน dropdown
  const [rowFilter, setRowFilter] = useState("all"); // ทั้งหมด / ยังไม่ประเมิน / ประเมินแล้ว
  const [savingAll, setSavingAll] = useState(false);

  const fetchProjects = () =>
    axios
      .get(`${backendUrl}/api/review/projects`, { withCredentials: true })
      .then((res) => setProjects(res.data))
      .catch((err) => console.error(err));

  useEffect(() => {
    fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl]);

  const buildRows = (workers) =>
    workers.map((w) => ({
      ...w,
      rating: w.review?.rating ?? 0,
      rehire: w.review?.rehire ?? "maybe", // ค่าที่จะส่งจริงถ้ากด save — ตรงกับ DB default
      rehireTouched: !!w.review, // ผู้ใช้เคยเลือกจริงแล้วหรือยัง
      comment: w.review?.comment ?? "",
      reviewer: w.review?.reviewer ?? null,
      reviewedAt: w.review?.reviewedAt ?? null,
      saved: !!w.review,
      dirty: false,
    }));

  const fetchDetail = async (projectId) => {
    try {
      setLoading(true);
      const res = await axios.get(`${backendUrl}/api/review/${projectId}`, {
        withCredentials: true,
      });
      setProject(res.data.project);
      setRows(buildRows(res.data.workers));
    } catch (err) {
      console.error(err);
      setProject(null);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedProjectId) {
      setProject(null);
      setRows([]);
      return;
    }
    fetchDetail(selectedProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  const updateRow = (employeeId, patch) =>
    setRows((prev) =>
      prev.map((r) =>
        r.employeeId === employeeId ? { ...r, ...patch, dirty: true } : r,
      ),
    );

  const saveRow = async (row, { quiet = false } = {}) => {
    if (!row.rating) {
      if (!quiet) alert("ใส่คะแนน (rating) ก่อนบันทึก");
      return false;
    }
    try {
      setSavingId(row.employeeId);
      await axios.post(
        `${backendUrl}/api/review`,
        {
          projectId: project.id,
          employeeId: row.employeeId,
          rating: row.rating,
          rehire: row.rehire,
          comment: row.comment,
          reviewedById: userData?.id ?? null,
        },
        { withCredentials: true },
      );
      setRows((prev) =>
        prev.map((r) =>
          r.employeeId === row.employeeId
            ? {
                ...r,
                saved: true,
                dirty: false,
                rehireTouched: true,
                reviewer: userData?.name ?? r.reviewer,
                reviewedAt: new Date().toISOString(),
              }
            : r,
        ),
      );
      return true;
    } catch (err) {
      console.error(err);
      if (!quiet) alert(err.response?.data?.message || "Save failed — ดู console");
      return false;
    } finally {
      setSavingId(null);
    }
  };

  // บันทึกทุกแถวที่แก้ไว้และให้คะแนนแล้ว
  const saveAll = async () => {
    const targets = rows.filter((r) => r.dirty && r.rating);
    if (targets.length === 0) return;
    setSavingAll(true);
    let failed = 0;
    for (const r of targets) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await saveRow(r, { quiet: true }))) failed += 1;
    }
    setSavingAll(false);
    if (failed) alert(`บันทึกไม่สำเร็จ ${failed} คน — ลองกด Save รายคนอีกครั้ง`);
  };

  const markCompleted = async () => {
    if (!project || project.status === "completed") return;

    const unsaved = rows.filter((r) => r.dirty || !r.saved).length;
    const warn =
      unsaved > 0 ? `\n\n⚠ ยังมี ${unsaved} คนที่ยังไม่ได้บันทึก review` : "";
    if (
      !window.confirm(
        `ปิดโปรเจกต์ "${project.name}"? (assignment ทั้งหมดจะถูก mark completed)${warn}`,
      )
    )
      return;

    try {
      setCompleting(true);
      await axios.put(
        `${backendUrl}/api/review/complete`,
        { projectId: project.id },
        { withCredentials: true },
      );
      await Promise.all([fetchDetail(project.id), fetchProjects()]);
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || "Complete failed — ดู console");
    } finally {
      setCompleting(false);
    }
  };

  const isProjectCompleted = (p) => p.status === "completed";
  // โปรเจกต์ของลูกค้าที่เลือก · โปรเจกต์ที่เปิดค้างไว้ยังอยู่ในรายการเสมอ
  const clientProjects = selectedClient
    ? projects.filter((p) => p.id === selectedProjectId || clientMatches(p.client))
    : projects;
  const countBy = (key) =>
    key === "all"
      ? clientProjects.length
      : clientProjects.filter((p) =>
          key === "completed" ? isProjectCompleted(p) : !isProjectCompleted(p),
        ).length;

  const projectOptions = clientProjects
    .filter(
      (p) =>
        statusFilter === "all" ||
        (statusFilter === "completed"
          ? isProjectCompleted(p)
          : !isProjectCompleted(p)),
    )
    .map((p) => {
    const codePart = p.masterProjectRecord?.projectCode
      ? `[${p.masterProjectRecord.projectCode}] `
      : "";
    const parts = [];
    if (p.location) parts.push(p.location);
    const start = fmtProjectDate(p.startDate);
    if (start) parts.push(`Start ${start}`);
    const disambiguator =
      parts.length > 0 ? parts.join(" · ") : `#${p.id.slice(-6)}`;
    const clientPart = p.client ? ` — ${p.client}` : "";
    const statusPart = p.status === "completed" ? " (completed)" : "";
    return {
      value: p.id,
      label: `${codePart}${p.name}${clientPart} · ${disambiguator}${statusPart}`,
    };
    });

  // โปรเจกต์ที่เลือกไว้อาจถูกกรองออกจาก dropdown — ยังแสดงค่าเดิมไว้
  const selectedOption =
    projectOptions.find((o) => o.value === selectedProjectId) ||
    (project && project.id === selectedProjectId
      ? { value: project.id, label: project.name }
      : null);

  const isCompleted = project?.status === "completed";
  const canComplete = canManageReview && project && !isCompleted && !completing;
  const reviewedCount = rows.filter((r) => r.saved && !r.dirty).length;
  const dirtyRated = rows.filter((r) => r.dirty && r.rating).length;
  const shownRows = rows.filter((r) =>
    rowFilter === "todo" ? !r.saved || r.dirty : rowFilter === "done" ? r.saved && !r.dirty : true,
  );
  const reviewPct = rows.length ? Math.round((reviewedCount / rows.length) * 100) : 0;

  // ── ส่วนที่ใช้ทั้งตารางและการ์ด ──
  const renderSave = (r) => {
    if (!canManageReview)
      return <span className="text-[11px] text-gray-400">—</span>;
    const needsSave = r.dirty || !r.saved;
    const saving = savingId === r.employeeId;
    return (
      <button
        type="button"
        onClick={() => saveRow(r)}
        disabled={!needsSave || saving}
        className={`whitespace-nowrap rounded-md border-none px-3 py-[5px] text-xs font-semibold transition-all ${
          needsSave
            ? "cursor-pointer bg-blue-600 text-white shadow-[0_1px_3px_rgba(13,110,253,0.3),0_1px_2px_rgba(0,0,0,0.06)] hover:-translate-y-px hover:shadow-[0_3px_6px_rgba(13,110,253,0.4),0_2px_3px_rgba(0,0,0,0.08)] disabled:cursor-wait disabled:opacity-70"
            : "cursor-default bg-[#d1e7dd] text-[#0f5132]"
        }`}
      >
        {saving ? "Saving…" : needsSave ? "Save" : "✓ Saved"}
      </button>
    );
  };

  const renderComment = (r) => (
    <input
      type="text"
      placeholder="หมายเหตุ…"
      value={r.comment}
      disabled={!canManageReview}
      onChange={(e) => updateRow(r.employeeId, { comment: e.target.value })}
      className="box-border w-full min-w-[160px] rounded-md border border-gray-300 bg-white px-2 py-[5px] text-xs outline-none focus:border-blue-400 disabled:bg-gray-50"
    />
  );

  const renderRehire = (r) => (
    <RehirePicker
      value={r.rehire}
      touched={r.rehireTouched}
      disabled={!canManageReview}
      onChange={(key) =>
        updateRow(r.employeeId, { rehire: key, rehireTouched: true })
      }
    />
  );

  const renderStars = (r) => (
    <Stars
      value={r.rating}
      disabled={!canManageReview}
      onChange={(n) => updateRow(r.employeeId, { rating: n })}
    />
  );

  const emptyBox = (text) => (
    <div className="border-b border-gray-200 p-7 text-center text-[13px] text-gray-500">
      {text}
    </div>
  );

  const renderWorker = (r) => (
    <>
      <div className="font-semibold">
        {r.fullName}
        {r.fullNameTH && (
          <span className="ml-1.5 font-normal text-gray-500">{r.fullNameTH}</span>
        )}
      </div>
      <div className="text-[11px] text-gray-500">{r.empId || r.empCode}</div>
    </>
  );

  const renderReviewer = (r) =>
    r.saved && r.reviewer ? (
      <>
        <div className="text-xs font-semibold text-gray-800">{r.reviewer}</div>
        <div className="text-[11px] text-gray-400">{fmtDateTime(r.reviewedAt)}</div>
      </>
    ) : r.saved ? (
      <span className="text-[11px] text-gray-400">{fmtDateTime(r.reviewedAt)}</span>
    ) : (
      <span className="text-[11px] text-[#b08900]">ยังไม่ประเมิน</span>
    );

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1800px]">
      {/* ════════ Header — ชื่อหน้าอยู่ที่แท็บแล้ว ════════ */}
      <div className="flex flex-wrap items-center gap-2 pb-3 text-xs text-gray-500">
        <span className="rounded-md bg-gray-200 px-2 py-0.5 font-bold">Phase 4</span>
        Step 12: ประเมินพนักงานหลังจบงาน (คะแนน · จ้างซ้ำ · หมายเหตุ) → ปิดโปรเจกต์ = พนักงานกลับเป็น
        Available · ผลการประเมินแสดงที่ Manpower Calendar › ผู้ประเมิน
      </div>

      {/* ════════ เลือกโปรเจกต์ ════════ */}
      <div className="flex flex-col gap-3 border-y border-gray-200 py-3 lg:flex-row lg:items-end">
        {/* โหมด multi เท่านั้น — ค่าเดียวกับตัวเลือกบน Navbar */}
        <ClientFilter className="lg:w-[160px] lg:shrink-0" />
        <div className="shrink-0">
          <label className={FILTER_LABEL}>สถานะโปรเจกต์</label>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map(([key, label]) => {
              const active = statusFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(key)}
                  className={`h-9 cursor-pointer whitespace-nowrap rounded-md border px-3.5 text-xs ${
                    active
                      ? "border-[#2B2F78] bg-[#2B2F78] font-bold text-white"
                      : "border-gray-200 bg-white font-medium text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {label} ({countBy(key)})
                </button>
              );
            })}
          </div>
        </div>
        <div className="w-full min-w-0 lg:flex-1">
          <label className={FILTER_LABEL}>
            Project{" "}
            <span className="normal-case tracking-normal text-gray-400">
              (ON Number / ชื่องาน / Client / Location)
            </span>
          </label>
          <Select
            options={projectOptions}
            styles={projectSelectStyles}
            menuPortalTarget={typeof document !== "undefined" ? document.body : null}
            menuPosition="fixed"
            value={selectedOption}
            onChange={(o) => setSelectedProjectId(o ? o.value : "")}
            placeholder="🔍 พิมพ์ค้นหา หรือเลือกโปรเจกต์..."
            isClearable
            noOptionsMessage={() =>
              selectedClient ? `ไม่มีโปรเจกต์ของ ${selectedClient.name}` : "ไม่พบโปรเจกต์"
            }
          />
        </div>
      </div>

      {/* ════════ สรุปโปรเจกต์ที่เลือก ════════ */}
      {project && (
        <div className="flex flex-col gap-3 border-b border-gray-200 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              {project.projectCode && (
                <span className="font-mono text-[13px] font-semibold text-blue-700">
                  {project.projectCode}
                </span>
              )}
              <span className="min-w-0 break-words text-[15px] font-bold">{project.name}</span>
              <StatusBadge completed={isCompleted} />
            </div>
            <div className="mt-0.5 text-xs text-gray-500">
              {[
                project.client,
                project.location,
                project.startDate &&
                  `${fmtProjectDate(project.startDate)} – ${fmtProjectDate(project.endDate) || "—"}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
            {rows.length > 0 && (
              <div className="mt-2 flex items-center gap-2.5">
                <div className="h-1.5 w-[180px] overflow-hidden rounded-full bg-gray-200">
                  <div
                    className={reviewPct === 100 ? "h-full bg-[#198754]" : "h-full bg-[#f59e0b]"}
                    style={{ width: `${reviewPct}%` }}
                  />
                </div>
                <span className="text-xs text-gray-600">
                  ประเมินแล้ว{" "}
                  <b className={reviewPct === 100 ? "text-[#198754]" : "text-gray-900"}>
                    {reviewedCount}/{rows.length}
                  </b>{" "}
                  คน
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/projects-overview/${project.id}`}
              className="rounded-md border border-gray-300 bg-white px-3 py-[7px] text-xs font-semibold text-gray-700 no-underline hover:bg-gray-50"
              title="ดูผังผู้ประเมินและความคืบหน้าทั้งหมดของ requirement นี้"
            >
              Manpower Calendar →
            </Link>
            {canManageReview && dirtyRated > 0 && (
              <button
                type="button"
                onClick={saveAll}
                disabled={savingAll}
                className="cursor-pointer rounded-md border-none bg-[#2B2F78] px-3.5 py-[7px] text-xs font-semibold text-white hover:bg-[#22265f] disabled:cursor-wait disabled:opacity-70"
              >
                {savingAll ? "Saving…" : `Save all (${dirtyRated})`}
              </button>
            )}
            {canManageReview && !isCompleted && (
              <button
                type="button"
                onClick={markCompleted}
                disabled={!canComplete}
                className={`whitespace-nowrap rounded-md border px-3.5 py-[7px] text-xs font-bold ${
                  canComplete
                    ? "cursor-pointer border-[#198754] bg-[#198754] text-white hover:bg-[#157347]"
                    : "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400"
                }`}
              >
                {completing ? "กำลังปิดโปรเจกต์…" : "✔ Mark Project Completed"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ════════ Workers + Review ════════ */}
      {loading ? (
        emptyBox("Loading…")
      ) : !project ? (
        emptyBox("เลือกโปรเจกต์ด้านบน เพื่อประเมินพนักงานที่ลงงานในโปรเจกต์นั้น")
      ) : rows.length === 0 ? (
        emptyBox("ยังไม่มีพนักงานลงงานในโปรเจกต์นี้")
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 py-3">
            {ROW_FILTERS.map(([key, label]) => {
              const n =
                key === "all"
                  ? rows.length
                  : key === "todo"
                    ? rows.length - reviewedCount
                    : reviewedCount;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRowFilter(key)}
                  className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${
                    rowFilter === key
                      ? "border-[#2B2F78] bg-[#2B2F78] font-bold text-white"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {label} ({n})
                </button>
              );
            })}
          </div>

          {shownRows.length === 0 ? (
            emptyBox("ไม่มีรายการในหมวดนี้")
          ) : (
            <>
              {/* ── ต่ำกว่า lg: รายการคั่นเส้น ── */}
              <div className="divide-y divide-gray-100 border-y border-gray-200 lg:hidden">
                {shownRows.map((r) => {
                  const ws = workState(r);
                  return (
                    <div
                      key={r.employeeId}
                      className={`py-3 text-[13px] ${r.dirty ? "bg-blue-50/40" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">{renderWorker(r)}</div>
                        {renderSave(r)}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {r.position}
                        {r.platform && ` · ${r.platform}`} · {ymd(r.mobDate)} → {ymd(r.demobDate)}
                      </div>
                      <div className={`text-[11px] ${ws.cls}`}>{ws.text}</div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        {renderStars(r)}
                        {renderRehire(r)}
                      </div>
                      <div className="mt-2">{renderComment(r)}</div>
                      <div className="mt-1.5">{renderReviewer(r)}</div>
                    </div>
                  );
                })}
              </div>

              {/* ── lg+: ตาราง ── */}
              <div className="hidden overflow-x-auto border-b border-gray-200 lg:block">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={TH}>Worker</th>
                      <th className={TH}>Position · Platform</th>
                      <th className={TH}>MOB → D-MOB</th>
                      <th className={TH}>Rating</th>
                      <th className={TH}>Rehire?</th>
                      <th className={TH}>Comment</th>
                      <th className={TH}>ผู้ประเมิน</th>
                      <th className={`${TH} text-center`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.map((r) => {
                      const ws = workState(r);
                      return (
                        <tr key={r.employeeId} className={r.dirty ? "bg-blue-50/40" : ""}>
                          <td className={TD}>{renderWorker(r)}</td>
                          <td className={TD}>
                            <div>{r.position || "—"}</div>
                            <div className="text-[11px] text-gray-500">{r.platform || "—"}</div>
                          </td>
                          <td className={`${TD} whitespace-nowrap`}>
                            <div className="text-gray-700">
                              {ymd(r.mobDate)} → {ymd(r.demobDate)}
                            </div>
                            <div className={`text-[11px] ${ws.cls}`}>{ws.text}</div>
                          </td>
                          <td className={TD}>{renderStars(r)}</td>
                          <td className={TD}>{renderRehire(r)}</td>
                          <td className={TD}>{renderComment(r)}</td>
                          <td className={`${TD} whitespace-nowrap`}>{renderReviewer(r)}</td>
                          <td className={`${TD} text-center`}>{renderSave(r)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
