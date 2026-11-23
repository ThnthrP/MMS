import { useState, useEffect, useContext, useCallback, useMemo } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { AppContent } from "../../context/AppContext";
import { nameEN, nameTH } from "../../utils/workerSearch";
import { hasAnyRole } from "../../utils/roles";
import ClientFilter, { useProjectClientMap } from "../../components/ClientFilter";

// ══════════════════════════════════════════════════════════
// PE Approvals — คำขอใช้พนักงานที่ % Match ไม่ครบ 100% (ส่งมาจากหน้า Assign Names)
// ตาราง 1 แถว = 1 คำขอ (แบบเดียวกับ Manpower Requirements) — project อยู่ในแต่ละแถว
// อนุมัติ / ไม่อนุมัติ รายคน
// ══════════════════════════════════════════════════════════

// ปุ่มสถานะ — รูปแบบเดียวกับหน้า Requests for Training & Medical
const TABS = [
  ["pending", "⏳ รออนุมัติ"],
  ["approved", "✓ อนุมัติแล้ว"],
  ["rejected", "✕ ไม่อนุมัติ"],
  ["all", "ทั้งหมด"],
];

const STATUS = {
  pending: ["⏳ รออนุมัติ", "bg-[#fff3cd] text-[#664d03]"],
  approved: ["✓ อนุมัติแล้ว", "bg-[#d1e7dd] text-[#0f5132]"],
  rejected: ["✕ ไม่อนุมัติ", "bg-[#f8d7da] text-[#842029]"],
};

const DECIDER_ROLES = ["project_engineer", "admin"];

const LABEL = "text-[11px] font-semibold text-gray-500";
const INPUT =
  "box-border w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] outline-none focus:border-blue-400";
const BTN_OUTLINE =
  "cursor-pointer rounded-lg border border-gray-200 bg-white px-4 py-2 text-[13px] hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60";

const fmtDateTime = (d) =>
  d
    ? new Date(d).toLocaleString("th-TH", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

const personName = (u) => (u ? `${u.titlePrefix ?? ""}${u.name ?? ""}` : "—");

const projectLabel = (p) =>
  p?.masterProjectRecord?.projectCode
    ? `[${p.masterProjectRecord.projectCode}] ${p.name}`
    : (p?.name ?? "—");

// ── filter helpers (แบบเดียวกับหน้า Requests for Training & Medical) ──
const FILTER_LABEL =
  "mb-1 block text-xs font-semibold uppercase tracking-[0.4px] text-gray-500";
const FIELD_BASE =
  "box-border h-9 rounded-lg border border-gray-200 bg-white px-3 text-[13px] text-gray-900 outline-none focus:border-blue-500";
const FIELD = `${FIELD_BASE} w-full`;
const DATE_FIELD = `${FIELD_BASE} w-[150px]`;
const CHIP =
  "cursor-pointer whitespace-nowrap rounded-full border px-3 py-1 text-xs";

const DATE_PRESETS = [
  ["all", "ทั้งหมด", null],
  ["today", "วันนี้", 0],
  ["7d", "7 วัน", 6],
  ["30d", "30 วัน", 29],
  ["90d", "90 วัน", 89],
];

const toYMD = (d) => {
  const x = new Date(d);
  if (isNaN(x.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
const daysAgoYMD = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toYMD(d);
};
const uniqSorted = (arr) =>
  [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b));

const matchColor = (pct) => (pct >= 70 ? "text-[#cc8400]" : "text-[#dc3545]");

const TH =
  "sticky top-0 z-[1] whitespace-nowrap bg-gray-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.4px] text-gray-500 shadow-[inset_0_-1px_0_#e5e7eb]";
const TD = "px-3 py-3 align-top";

export default function PEApprovals() {
  const { backendUrl, userData, isMultiClient, clientMatches, selectedClient } =
    useContext(AppContent);
  // โหมด multi: ชื่อลูกค้าของแต่ละคำขอ (Project → Contract → Client)
  const projectClientMap = useProjectClientMap();
  const itemClient = useCallback(
    (it) => {
      const p = it.manpowerRequest?.project;
      return p?.contract?.client?.name || projectClientMap.get(p?.id) || null;
    },
    [projectClientMap],
  );
  // เช็กทุก role (หลัก + เสริม) — เช่น MP ที่มี role เสริม project_engineer อนุมัติได้
  const canDecide = hasAnyRole(userData, DECIDER_ROLES);

  const [tab, setTab] = useState("pending");
  const [items, setItems] = useState([]); // ทุกสถานะ — แยก tab ฝั่ง frontend
  const [loading, setLoading] = useState(true);

  // ── filters ──
  const [search, setSearch] = useState("");
  const [datePreset, setDatePreset] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [positionFilter, setPositionFilter] = useState("");
  const [requesterFilter, setRequesterFilter] = useState("");

  const [decision, setDecision] = useState(null); // { item, action }
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${backendUrl}/api/match-exceptions`, {
        withCredentials: true,
        params: { status: "all" },
      });
      setItems(res.data);
    } catch (err) {
      console.error(err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [backendUrl]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && decision && !saving) setDecision(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decision, saving]);

  // คำขอของลูกค้าที่เลือก (ตัวกรอง Client / Navbar) — ทุกลูกค้า / โหมด single = ทั้งหมด
  const clientItems = useMemo(
    () =>
      isMultiClient && selectedClient
        ? items.filter((it) => clientMatches(itemClient(it)))
        : items,
    [items, isMultiClient, selectedClient, clientMatches, itemClient],
  );

  // ตัวเลือก dropdown — จากข้อมูลจริง (Project: เฉพาะของลูกค้าที่เลือก)
  const projectOptions = useMemo(() => {
    const m = new Map();
    for (const it of clientItems) {
      const p = it.manpowerRequest?.project;
      if (p?.id && !m.has(p.id)) m.set(p.id, projectLabel(p));
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [clientItems]);

  // project ที่เลือกไว้ไม่ใช่ของลูกค้าที่เลือกแล้ว → ล้าง (ไม่งั้นรายการว่างโดยไม่รู้สาเหตุ)
  useEffect(() => {
    if (
      !loading &&
      projectFilter &&
      !projectOptions.some(([id]) => id === projectFilter)
    )
      setProjectFilter("");
  }, [loading, projectFilter, projectOptions]);
  const positionOptions = useMemo(
    () => uniqSorted(items.map((it) => it.manpowerRequest?.position?.name)),
    [items],
  );
  const requesterOptions = useMemo(
    () => uniqSorted(items.map((it) => personName(it.requestedBy))),
    [items],
  );

  // กรองทุกอย่าง "ยกเว้น tab สถานะ" — ใช้นับตัวเลขบน tab
  const baseFiltered = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/\s+/g, "");
    return clientItems.filter((it) => {
      const ymd = toYMD(it.createdAt);
      if (dateFrom && ymd < dateFrom) return false;
      if (dateTo && ymd > dateTo) return false;
      if (projectFilter && it.manpowerRequest?.project?.id !== projectFilter)
        return false;
      if (
        positionFilter &&
        it.manpowerRequest?.position?.name !== positionFilter
      )
        return false;
      if (requesterFilter && personName(it.requestedBy) !== requesterFilter)
        return false;
      if (!q) return true;
      const e = it.employee || {};
      return [
        e.empId,
        e.empCode,
        e.fullName,
        e.fullNameTH,
        e.fullNameEN,
        projectLabel(it.manpowerRequest?.project),
        it.manpowerRequest?.position?.name,
        it.reason,
      ].some((v) =>
        String(v || "")
          .toLowerCase()
          .replace(/\s+/g, "")
          .includes(q),
      );
    });
  }, [
    clientItems,
    search,
    dateFrom,
    dateTo,
    projectFilter,
    positionFilter,
    requesterFilter,
  ]);

  const tabCount = (key) =>
    key === "all"
      ? baseFiltered.length
      : baseFiltered.filter((it) => it.status === key).length;

  const visibleItems = useMemo(
    () =>
      tab === "all" ? baseFiltered : baseFiltered.filter((it) => it.status === tab),
    [baseFiltered, tab],
  );


  const hasFilter =
    search ||
    dateFrom ||
    dateTo ||
    projectFilter ||
    positionFilter ||
    requesterFilter;

  const resetFilters = () => {
    setSearch("");
    setDatePreset("all");
    setDateFrom("");
    setDateTo("");
    setProjectFilter("");
    setPositionFilter("");
    setRequesterFilter("");
  };

  const applyPreset = (key, days) => {
    setDatePreset(key);
    setDateFrom(days === null ? "" : daysAgoYMD(days));
    setDateTo(days === null ? "" : toYMD(new Date()));
  };

  const setDate = (setter) => (e) => {
    setter(e.target.value);
    setDatePreset("");
  };

  const openDecision = (item, action) => {
    setNote("");
    setDecision({ item, action });
  };

  const submitDecision = async () => {
    if (!decision || saving) return;
    if (decision.action === "rejected" && !note.trim()) {
      alert("กรุณาระบุเหตุผลที่ไม่อนุมัติ");
      return;
    }
    try {
      setSaving(true);
      await axios.put(
        `${backendUrl}/api/match-exceptions/${decision.item.id}/decision`,
        { decision: decision.action, note },
        { withCredentials: true },
      );
      setDecision(null);
      fetchItems();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || "บันทึกไม่สำเร็จ");
      fetchItems(); // อาจมี PE คนอื่นพิจารณาไปแล้ว
    } finally {
      setSaving(false);
    }
  };

  const approving = decision?.action === "approved";

  // ── ส่วนย่อยของแต่ละคำขอ (ใช้ทั้งตารางและรายการบนมือถือ) ──
  const statusPill = (it) => {
    const [label, cls] = STATUS[it.status] ?? [it.status, "bg-gray-100 text-gray-500"];
    return (
      <span className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
        {label}
      </span>
    );
  };

  const employeeCell = (it) => (
    <div className="min-w-0">
      <div className="break-words font-semibold">{nameEN(it.employee)}</div>
      {nameTH(it.employee) && (
        <div className="text-xs text-gray-600">{nameTH(it.employee)}</div>
      )}
      <div className="text-[11px] text-gray-500">
        {it.employee?.empId || "—"} · #{it.employee?.empCode}
      </div>
      {it.employee?.position?.name && (
        <div className="text-[11px] text-gray-400">
          ตำแหน่งปัจจุบัน {it.employee.position.name}
        </div>
      )}
    </div>
  );

  const projectCell = (it) => {
    const req = it.manpowerRequest;
    return (
      <div className="min-w-0">
        {isMultiClient && itemClient(it) && (
          <span className="mb-0.5 inline-block rounded bg-[#eef0fb] px-1.5 py-px text-[10px] font-semibold text-[#2B2F78]">
            {itemClient(it)}
          </span>
        )}
        <div className="font-semibold">{req?.position?.name ?? "—"}</div>
        <div className="text-[11px] text-gray-500">ต้องการ {req?.quantity ?? "—"} คน</div>
        {req?.project?.id ? (
          <Link
            to={`/allocation?projectId=${req.project.id}`}
            title="เปิดโปรเจกต์นี้ในหน้า Assign Names"
            className="mt-0.5 block break-words text-xs text-blue-600 no-underline hover:underline"
          >
            {req.project.masterProjectRecord?.projectCode && (
              <span className="block font-semibold">{req.project.masterProjectRecord.projectCode}</span>
            )}
            {req.project.name}
          </Link>
        ) : (
          <div className="text-xs text-gray-500">{projectLabel(req?.project)}</div>
        )}
      </div>
    );
  };

  const missingChips = (it) => {
    const missing = Array.isArray(it.missingTrainings) ? it.missingTrainings : [];
    if (!missing.length) return <span className="text-gray-400">—</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {missing.map((m) => (
          <span
            key={m}
            className="rounded-md border border-[#f5c6cb] bg-[#fff5f5] px-1.5 py-0.5 text-[11px] text-[#842029]"
          >
            {m}
          </span>
        ))}
      </div>
    );
  };

  const reasonCell = (it) => (
    <div className="min-w-0">
      <div className="whitespace-pre-wrap break-words">{it.reason}</div>
      <div className="mt-0.5 text-[11px] text-gray-400">
        ขอโดย {personName(it.requestedBy)} · {fmtDateTime(it.createdAt)}
      </div>
    </div>
  );

  const decisionCell = (it) => (
    <div className="min-w-0">
      {statusPill(it)}
      {it.status !== "pending" && (
        <div className="mt-1 text-[11px] text-gray-500">
          {personName(it.decidedBy)} · {fmtDateTime(it.decidedAt)}
          {it.decisionNote && (
            <div className="mt-0.5 whitespace-pre-wrap break-words text-xs text-gray-700">
              {it.decisionNote}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const actionButtons = (it) =>
    it.status === "pending" && canDecide ? (
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={() => openDecision(it, "rejected")}
          className="cursor-pointer whitespace-nowrap rounded-md border border-[#f5c6cb] bg-white px-3 py-1.5 text-xs font-semibold text-[#842029] hover:bg-[#fff5f5]"
        >
          ไม่อนุมัติ
        </button>
        <button
          type="button"
          onClick={() => openDecision(it, "approved")}
          className="cursor-pointer whitespace-nowrap rounded-md border-none bg-[#198754] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#157347]"
        >
          อนุมัติ
        </button>
      </div>
    ) : (
      <span className="text-gray-400">—</span>
    );

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1800px]">
      {/* ════════ Header ════════ */}
      {/* ชื่อหน้าอยู่ที่แท็บแล้ว — เหลือคำอธิบายบรรทัดเดียว */}
      <div className="pb-3">
        <div className="text-xs text-gray-500">
          คำขอใช้พนักงานที่ % Match ไม่ครบ 100% จากหน้า Assign Names · กดชื่อโปรเจกต์เพื่อเปิดในหน้า Assign Names
        </div>
        {!canDecide && (
          <div className="mt-2.5 rounded-lg border border-[#ffe69c] bg-[#fff8e1] px-3 py-2 text-xs text-[#664d03]">
            ดูสถานะได้อย่างเดียว — การอนุมัติทำได้เฉพาะ PE (Project Engineer)
          </div>
        )}
      </div>

      {/* ════════ Search & Filter ════════ */}
      <div className="border-y border-gray-200 py-3">
        <div>
          <label className={FILTER_LABEL}>ช่วงวันที่ (วันที่ส่งคำขอ)</label>
          <div className="flex flex-wrap items-center gap-2">
            {DATE_PRESETS.map(([key, label, days]) => (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key, days)}
                className={`${CHIP} ${
                  datePreset === key
                    ? "border-[#2B2F78] bg-[#2B2F78] font-bold text-white"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {label}
              </button>
            ))}
            <span className="hidden text-gray-300 sm:inline">|</span>
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={setDate(setDateFrom)}
              className={DATE_FIELD}
              title="ตั้งแต่วันที่"
            />
            <span className="text-xs text-gray-400">ถึง</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={setDate(setDateTo)}
              className={DATE_FIELD}
              title="ถึงวันที่"
            />
          </div>
        </div>

        <div
          className={`mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 ${
            isMultiClient
              ? "lg:grid-cols-[1fr_2fr_2fr_1.5fr_1fr]"
              : "lg:grid-cols-[2fr_2fr_1.5fr_1fr]"
          }`}
        >
          {/* โหมด multi เท่านั้น — ค่าเดียวกับตัวเลือกบน Navbar (ปุ่ม ล้าง filter ไม่ล้างค่านี้) */}
          <ClientFilter />
          <div className="min-w-0">
            <label className={FILTER_LABEL}>ค้นหา</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Employee ID / ชื่อไทย / ชื่ออังกฤษ / เหตุผล..."
              className={FIELD}
            />
          </div>
          <div className="min-w-0">
            <label className={FILTER_LABEL}>Project</label>
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className={FIELD}
            >
              <option value="">ทั้งหมด</option>
              {projectOptions.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label className={FILTER_LABEL}>ตำแหน่ง</label>
            <select
              value={positionFilter}
              onChange={(e) => setPositionFilter(e.target.value)}
              className={FIELD}
            >
              <option value="">ทั้งหมด</option>
              {positionOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label className={FILTER_LABEL}>ผู้ขอ</label>
            <select
              value={requesterFilter}
              onChange={(e) => setRequesterFilter(e.target.value)}
              className={FIELD}
            >
              <option value="">ทั้งหมด</option>
              {requesterOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        {hasFilter && (
          <div className="mt-2.5 text-right">
            <button
              type="button"
              onClick={resetFilters}
              className="cursor-pointer border-none bg-transparent p-0 text-xs font-semibold text-[#dc3545] underline hover:text-[#a71d2a]"
            >
              ✕ ล้าง filter
            </button>
          </div>
        )}
      </div>

      {/* ════════ แถบสถานะ (เหนือรายการ) ════════ */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 py-3">
        <div className="flex flex-wrap gap-2">
          {TABS.map(([key, label]) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`cursor-pointer whitespace-nowrap rounded-md border px-3.5 py-1.5 text-xs ${
                  active
                    ? "border-[#2B2F78] bg-[#2B2F78] font-bold text-white"
                    : "border-gray-200 bg-white font-medium text-gray-700 hover:bg-gray-50"
                }`}
              >
                {label}
                {!loading && ` (${tabCount(key)})`}
              </button>
            );
          })}
        </div>
        <span className="text-xs text-gray-500">
          พบ <strong className="text-gray-900">{visibleItems.length}</strong>{" "}
          คำขอ
        </span>
      </div>

      {/* ════════ รายการ: 1 แถว = 1 คำขอ ════════ */}
      {loading ? (
        <div className="p-10 text-center text-[13px] text-gray-500">
          Loading…
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="p-10 text-center text-[13px] text-gray-500">
          {hasFilter
            ? "ไม่พบคำขอตามเงื่อนไขที่เลือก"
            : selectedClient && items.length > 0 && clientItems.length === 0
              ? `ไม่มีคำขอของ ${selectedClient.name}`
            : tab === "pending"
              ? "ไม่มีคำขอที่รออนุมัติ"
              : "ไม่มีรายการในหมวดนี้"}
        </div>
      ) : (
        <div className="border-b border-gray-200">
          {/* ── มือถือ / แท็บเล็ต ── */}
          <div className="divide-y divide-gray-200 xl:hidden">
            {visibleItems.map((it) => (
              <div key={it.id} className="py-3 text-[13px]">
                <div className="flex items-start justify-between gap-2">
                  {employeeCell(it)}
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {statusPill(it)}
                    <span className={`text-[15px] font-bold ${matchColor(it.matchPct)}`}>
                      {it.matchPct}%
                    </span>
                  </div>
                </div>
                <div className="mt-2">{projectCell(it)}</div>
                <div className="mt-2">
                  <div className={`${LABEL} mb-1`}>Training ที่ขาด</div>
                  {missingChips(it)}
                </div>
                <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2">{reasonCell(it)}</div>
                {it.status !== "pending" && <div className="mt-2">{decisionCell(it)}</div>}
                {it.status === "pending" && canDecide && <div className="mt-2.5">{actionButtons(it)}</div>}
              </div>
            ))}
          </div>

          {/* ── xl+: ตาราง ── */}
          <div className="hidden overflow-x-auto xl:block">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={TH}>Employee</th>
                  <th className={TH}>Position / Project</th>
                  <th className={`${TH} text-center`}>% Match</th>
                  <th className={TH}>Training ที่ขาด</th>
                  <th className={`${TH} w-[28%]`}>เหตุผลที่ขอ</th>
                  <th className={TH}>สถานะ</th>
                  <th className={`${TH} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibleItems.map((it) => (
                  <tr key={it.id} className="hover:bg-gray-50">
                    <td className={`${TD} min-w-[180px]`}>{employeeCell(it)}</td>
                    <td className={`${TD} min-w-[200px]`}>{projectCell(it)}</td>
                    <td className={`${TD} whitespace-nowrap text-center text-[15px] font-bold ${matchColor(it.matchPct)}`}>
                      {it.matchPct}%
                    </td>
                    <td className={`${TD} max-w-[220px]`}>{missingChips(it)}</td>
                    <td className={TD}>{reasonCell(it)}</td>
                    <td className={`${TD} min-w-[150px]`}>{decisionCell(it)}</td>
                    <td className={`${TD} whitespace-nowrap`}>{actionButtons(it)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ════════ ยืนยันการพิจารณา ════════ */}
      {decision && (
        <div
          className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/50 p-3 sm:p-5"
          onClick={() => !saving && setDecision(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-[460px] flex-col overflow-hidden rounded-[10px] bg-white supports-[height:100dvh]:max-h-[90dvh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`px-4 py-3.5 text-white sm:px-6 ${
                approving ? "bg-[#198754]" : "bg-[#842029]"
              }`}
            >
              <div className="text-[15px] font-bold">
                {approving ? "อนุมัติคำขอ" : "ไม่อนุมัติคำขอ"}
              </div>
              <div className="mt-0.5 text-xs opacity-90">
                {decision.item.employee?.fullName} ·{" "}
                {decision.item.manpowerRequest?.position?.name} ·{" "}
                {decision.item.matchPct}%
              </div>
            </div>
            <div className="overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
              <label className="mb-1 block text-xs font-semibold text-gray-700">
                {approving ? "หมายเหตุ (ถ้ามี)" : "เหตุผลที่ไม่อนุมัติ *"}
              </label>
              <textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  approving
                    ? "เช่น ให้ HR จัดอบรมที่ขาดก่อนขึ้นงาน"
                    : "เช่น ขาด training ที่จำเป็นต่อความปลอดภัยของงานนี้"
                }
                className={`${INPUT} resize-y`}
              />
              {approving && (
                <div className="mt-2 text-[11px] text-gray-500">
                  อนุมัติแล้วพนักงานคนนี้จะเป็น Approved ในรายชื่อที่จัด
                  และไปที่หน้า Worker Schedule › Mobilization ทันที
                </div>
              )}
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 px-4 py-3.5 sm:px-6">
              <button
                type="button"
                onClick={() => setDecision(null)}
                disabled={saving}
                className={BTN_OUTLINE}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={submitDecision}
                disabled={saving || (!approving && !note.trim())}
                className={`cursor-pointer rounded-lg border-none px-5 py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${
                  approving
                    ? "bg-[#198754] hover:bg-[#157347]"
                    : "bg-[#842029] hover:bg-[#6a1a21]"
                }`}
              >
                {saving
                  ? "กำลังบันทึก..."
                  : approving
                    ? "ยืนยันอนุมัติ"
                    : "ยืนยันไม่อนุมัติ"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
