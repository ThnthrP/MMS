import { useState, useEffect, useContext, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import Select from "react-select";
import { AppContent } from "../../context/AppContext";
import SelectedPeoplePanel from "../../components/SelectedPeoplePanel";
import { invalidateTrainingPlanCache } from "../../components/TrainingPlanNotice";
import { nameEN, nameTH } from "../../utils/workerSearch";

// ══════════════════════════════════════════════════════════
// เพิ่มแผนอบรม (เมนู Training Plan › แท็บที่ 3)
// อบรมที่กำลังดำเนินอยู่ / กำลังจะเริ่ม: เลือก training + วันที่ + สถานที่ → เลือกพนักงาน
// บันทึกเป็นคำขออบรมที่ "ยืนยันแล้ว" → ขึ้นใน Training Calendar และหน้า Training Bookings
// เปิดจากปุ่ม "+ เพิ่มคน" ใน Training Calendar → ?trainingId=&start=&end=&provider= กรอกไว้ให้
// อบรมเสร็จแล้ว → บันทึก certification ที่แท็บ "บันทึกผลอบรม"
// ══════════════════════════════════════════════════════════

const SECTION = "border-t border-gray-200 py-4";
const SECTION_HEADER =
  "mb-3 flex flex-wrap items-center justify-between gap-2 text-sm font-bold";
const LABEL =
  "mb-1.5 block text-xs font-semibold uppercase tracking-[0.4px] text-gray-500";
const INPUT_BASE =
  "box-border w-full rounded-lg border bg-white px-3 py-2 text-[13px] outline-none focus:border-blue-400 disabled:cursor-not-allowed disabled:bg-gray-50";
const INPUT = `${INPUT_BASE} border-gray-200`;
const TH =
  "sticky top-0 z-[1] bg-white px-3.5 py-2.5 text-left text-[11px] font-semibold text-gray-500 shadow-[inset_0_-1px_0_#dee2e6]";
const HIDE_MOBILE = "hidden md:table-cell";
const CHECKBOX = "h-[15px] w-[15px] cursor-pointer";

const selectStyles = {
  control: (b) => ({ ...b, fontSize: "13px", minHeight: "38px", borderColor: "#dee2e6" }),
  option: (b) => ({ ...b, fontSize: "13px" }),
  menuPortal: (b) => ({ ...b, zIndex: 9999 }),
};

function StepBadge({ n }) {
  return (
    <span className="mr-2.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs text-white">
      {n}
    </span>
  );
}

function PlannedBadge({ when }) {
  return (
    <span
      title={`มีแผนอบรม training นี้อยู่แล้ว (${when}) — ถ้าช่วงวันซ้อนกัน ระบบจะข้ามให้`}
      className="cursor-help whitespace-nowrap rounded bg-[#e7f1ff] px-1.5 py-px text-[10px] font-bold text-blue-700"
    >
      มีแผนแล้ว
    </span>
  );
}

const fmt = (s) =>
  new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export default function TrainingPlanForm() {
  const { backendUrl } = useContext(AppContent);
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // ── Step 1 ──
  const [trainingOptions, setTrainingOptions] = useState([]);
  const [training, setTraining] = useState(null);
  const [start, setStart] = useState(params.get("start") || "");
  const [end, setEnd] = useState(params.get("end") || "");
  const [provider, setProvider] = useState(params.get("provider") || "");
  const [note, setNote] = useState("");

  // ── Employees ──
  const [employees, setEmployees] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [sessions, setSessions] = useState([]); // รอบอบรมที่ยังไม่จบ — ใช้เตือน "มีแผนแล้ว"

  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [positionFilter, setPositionFilter] = useState("");
  const [hidePlanned, setHidePlanned] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null); // { type, text }

  useEffect(() => {
    axios
      .get(`${backendUrl}/api/trainings/global`, { withCredentials: true })
      .then((res) => {
        const opts = (res.data || []).map((t) => ({
          value: t.id,
          label: `${t.name}${t.fullName ? ` - ${t.fullName}` : ""}`,
        }));
        setTrainingOptions(opts);
        const pre = params.get("trainingId");
        if (pre) setTraining(opts.find((o) => o.value === pre) || null);
      })
      .catch((err) => console.error(err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl]);

  useEffect(() => {
    (async () => {
      try {
        setLoadingEmployees(true);
        const [w, plan] = await Promise.all([
          axios.get(`${backendUrl}/api/workers`, { withCredentials: true }),
          axios
            .get(`${backendUrl}/api/training-plan`, { withCredentials: true })
            .catch(() => ({ data: { sessions: [] } })),
        ]);
        setEmployees((w.data || []).filter((e) => e.status === "active"));
        setSessions(plan.data?.sessions || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingEmployees(false);
      }
    })();
  }, [backendUrl]);

  // คนที่มีแผน training นี้อยู่แล้ว (รอบที่ยังไม่จบ) → employeeId → ช่วงวัน
  const plannedById = useMemo(() => {
    const m = new Map();
    if (!training) return m;
    sessions
      .filter((s) => s.training?.id === training.value)
      .forEach((s) =>
        s.attendees.forEach((a) =>
          m.set(a.employee?.id, s.start === s.end ? fmt(s.start) : `${fmt(s.start)} – ${fmt(s.end)}`),
        ),
      );
    return m;
  }, [sessions, training]);

  const departments = [...new Set(employees.map((w) => w.division).filter(Boolean))].sort();
  const positions = [...new Set(employees.map((w) => w.position?.name).filter(Boolean))].sort();

  const q = search.trim().toLowerCase().replace(/\s+/g, "");
  const filtered = employees.filter((w) => {
    const matchSearch =
      !q ||
      [nameEN(w), nameTH(w), w.fullName, w.empId, w.empCode].some((v) =>
        String(v || "").toLowerCase().replace(/\s+/g, "").includes(q),
      );
    return (
      matchSearch &&
      (!departmentFilter || w.division === departmentFilter) &&
      (!positionFilter || w.position?.name === positionFilter) &&
      (!hidePlanned || !plannedById.has(w.id))
    );
  });

  const toggle = (id) =>
    setSelectedIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((w) => selectedIds.includes(w.id));
  const toggleAllFiltered = () => {
    const ids = filtered.map((w) => w.id);
    if (allFilteredSelected) {
      const s = new Set(ids);
      setSelectedIds((p) => p.filter((id) => !s.has(id)));
    } else setSelectedIds((p) => [...new Set([...p, ...ids])]);
  };

  const filteredIdSet = new Set(filtered.map((w) => w.id));
  const byId = new Map(employees.map((w) => [w.id, w]));
  const selectedItems = selectedIds.map((id) => {
    const w = byId.get(id);
    return {
      id,
      name: w ? nameEN(w) : id,
      sub: [w?.empId || w?.empCode, w?.position?.name].filter(Boolean).join(" · "),
      badge: plannedById.has(id) ? <PlannedBadge when={plannedById.get(id)} /> : null,
      hidden: !filteredIdSet.has(id),
    };
  });

  const hasFilter = search || departmentFilter || positionFilter || hidePlanned;
  const dateError = start && end && end < start ? "วันจบต้องไม่ก่อนวันเริ่ม" : null;
  const canSave = training && start && !dateError && selectedIds.length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    const planned = selectedIds.filter((id) => plannedById.has(id)).length;
    if (
      !window.confirm(
        `เพิ่มแผนอบรม "${training.label}"\n${start === (end || start) ? fmt(start) : `${fmt(start)} – ${fmt(end)}`}${provider ? ` · ${provider}` : ""}\nให้พนักงาน ${selectedIds.length} คน?${
          planned ? `\n\n⚠ มี ${planned} คนที่มีแผน training นี้อยู่แล้ว — ถ้าช่วงวันซ้อนกันจะถูกข้าม` : ""
        }`,
      )
    )
      return;
    try {
      setSaving(true);
      setResult(null);
      const res = await axios.post(
        `${backendUrl}/api/training-plan`,
        {
          globalTrainingId: training.value,
          start,
          end: end || start,
          provider,
          note,
          employeeIds: selectedIds,
        },
        { withCredentials: true },
      );
      const { created, skippedEmployeeIds = [] } = res.data;
      invalidateTrainingPlanCache(); // ป้าย 🗓 ใน Assign Names / Compliance เห็นแผนใหม่ทันที
      if (skippedEmployeeIds.length === 0) {
        navigate("/training-plan");
        return;
      }
      setResult({
        type: "warn",
        text: `เพิ่มแล้ว ${created} คน · ข้าม ${skippedEmployeeIds.length} คนที่มีแผน training นี้ช่วงวันซ้อนกันอยู่แล้ว: ${skippedEmployeeIds
          .map((id) => nameEN(byId.get(id) || {}) || id)
          .join(", ")}`,
      });
      setSelectedIds([]);
    } catch (err) {
      setResult({ type: "err", text: err.response?.data?.message || "บันทึกไม่สำเร็จ" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1800px]">
      {/* ════════ Header ════════ */}
      <div className="pb-3">
        <Link
          to="/training-plan"
          className="mb-1 inline-block text-[13px] text-gray-500 no-underline hover:text-gray-800"
        >
          ← Training Calendar
        </Link>
        <h1 className="m-0 text-lg font-bold">เพิ่มแผนอบรม</h1>
        <div className="text-xs text-gray-500">
          อบรมที่กำลังดำเนินอยู่ / กำลังจะเริ่ม → เลือก training วันที่ และพนักงาน · ขึ้นใน
          Training Calendar และ Training Bookings (ยืนยันแล้ว) · อบรมเสร็จแล้วบันทึก cert ที่แท็บ
          บันทึกผลอบรม
        </div>
      </div>

      {result && (
        <div
          className={`mb-4 rounded-lg border px-4 py-2.5 text-[13px] ${
            result.type === "err"
              ? "border-[#f5c6cb] bg-[#f8d7da] text-[#842029]"
              : "border-[#ffe69c] bg-[#fff3cd] text-[#664d03]"
          }`}
        >
          {result.text}{" "}
          {result.type !== "err" && (
            <Link to="/training-plan" className="font-semibold text-inherit">
              ดู Training Calendar →
            </Link>
          )}
        </div>
      )}

      {/* ════════ Step 1 ════════ */}
      <div className={SECTION}>
        <div className={SECTION_HEADER}>
          <span className="flex items-center">
            <StepBadge n={1} />
            Training และวันที่อบรม
          </span>
        </div>
        <div className="mb-4">
          <label className={LABEL}>Training / Certification *</label>
          <Select
            options={trainingOptions}
            value={training}
            onChange={setTraining}
            placeholder="ค้นหา / เลือก training..."
            isClearable
            isDisabled={saving}
            styles={selectStyles}
            noOptionsMessage={() => "ไม่มี training"}
            menuPortalTarget={document.body}
            menuPosition="fixed"
          />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div>
            <label className={LABEL}>วันเริ่ม *</label>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              disabled={saving}
              className={INPUT}
            />
          </div>
          <div>
            <label className={LABEL}>
              วันจบ <span className="font-normal normal-case">(เว้นว่าง = วันเดียว)</span>
            </label>
            <input
              type="date"
              value={end}
              min={start || undefined}
              onChange={(e) => setEnd(e.target.value)}
              disabled={saving}
              className={`${INPUT_BASE} ${dateError ? "border-[#dc3545]" : "border-gray-200"}`}
            />
            {dateError && <div className="mt-1 text-[11px] text-[#dc3545]">{dateError}</div>}
          </div>
          <div>
            <label className={LABEL}>ศูนย์อบรม / สถานที่</label>
            <input
              type="text"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              disabled={saving}
              placeholder="e.g. TPTI Songkhla"
              className={INPUT}
            />
          </div>
          <div>
            <label className={LABEL}>หมายเหตุ</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={saving}
              placeholder="e.g. Report 07:30"
              className={INPUT}
            />
          </div>
        </div>
        {!training && (
          <div className="mt-4 rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3.5 text-center text-xs text-gray-500">
            เลือก training ก่อน เพื่อเริ่มเลือกพนักงาน
          </div>
        )}
      </div>

      {/* ════════ Step 2 ════════ */}
      {training && (
        <div className={SECTION}>
          <div className={SECTION_HEADER}>
            <span className="flex items-center">
              <StepBadge n={2} />
              เลือกพนักงานที่อบรมรอบนี้
            </span>
            {selectedIds.length > 0 && (
              <span className="rounded-md bg-[#fff3cd] px-2.5 py-[3px] text-xs font-semibold text-[#664d03]">
                เลือกไว้ {selectedIds.length} คน
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0">
              <div className="mb-3 grid grid-cols-2 gap-2.5 md:grid-cols-[minmax(200px,1fr)_180px_220px]">
                <div className="col-span-2 md:col-span-1">
                  <label className={LABEL}>ค้นหาพนักงาน</label>
                  <input
                    type="text"
                    placeholder="🔍 ชื่อไทย / อังกฤษ หรือ Employee ID"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={LABEL}>แผนก</label>
                  <select
                    value={departmentFilter}
                    onChange={(e) => setDepartmentFilter(e.target.value)}
                    className={INPUT}
                  >
                    <option value="">ทุกแผนก</option>
                    {departments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>ตำแหน่ง</label>
                  <select
                    value={positionFilter}
                    onChange={(e) => setPositionFilter(e.target.value)}
                    className={INPUT}
                  >
                    <option value="">ทุกตำแหน่ง</option>
                    {positions.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={hidePlanned}
                    onChange={(e) => setHidePlanned(e.target.checked)}
                    className={CHECKBOX}
                  />
                  ซ่อนคนที่มีแผน training นี้แล้ว ({plannedById.size})
                </label>
                <div className="flex items-center gap-3">
                  <span className="text-gray-500">แสดง {filtered.length} คน</span>
                  {hasFilter && (
                    <button
                      onClick={() => {
                        setSearch("");
                        setDepartmentFilter("");
                        setPositionFilter("");
                        setHidePlanned(false);
                      }}
                      className="cursor-pointer rounded-lg border border-[#f5c6cb] bg-white px-3 py-1 text-xs text-[#dc3545] hover:bg-red-50"
                    >
                      ✕ Clear
                    </button>
                  )}
                </div>
              </div>

              <SelectedPeoplePanel
                variant="bar"
                items={selectedItems}
                onRemove={toggle}
                onClear={() => setSelectedIds([])}
                disabled={saving}
              />

              {loadingEmployees ? (
                <div className="p-10 text-center text-[13px] text-gray-500">Loading employees...</div>
              ) : (
                <div className="max-h-[480px] overflow-y-auto border-y border-gray-200">
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr>
                        <th className={`${TH} w-[120px]`}>
                          <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-gray-600">
                            <input
                              type="checkbox"
                              checked={allFilteredSelected}
                              onChange={toggleAllFiltered}
                              disabled={saving}
                              className={CHECKBOX}
                            />
                            เลือกทั้งหมด
                          </label>
                        </th>
                        <th className={TH}>EMPLOYEE</th>
                        <th className={`${TH} ${HIDE_MOBILE}`}>POSITION</th>
                        <th className={`${TH} ${HIDE_MOBILE}`}>DEPARTMENT</th>
                        <th className={`${TH} ${HIDE_MOBILE} w-[180px]`}>แผน TRAINING นี้</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-gray-500">
                            ไม่พบพนักงานที่ตรงกับตัวกรอง
                          </td>
                        </tr>
                      ) : (
                        filtered.map((w) => {
                          const checked = selectedIds.includes(w.id);
                          const planned = plannedById.get(w.id);
                          return (
                            <tr
                              key={w.id}
                              onClick={() => !saving && toggle(w.id)}
                              className={`cursor-pointer border-b border-gray-100 ${
                                checked ? "bg-[#fffbe6]" : "bg-white hover:bg-gray-50"
                              }`}
                            >
                              <td className="px-3.5 py-2.5 text-center">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggle(w.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  disabled={saving}
                                  className={CHECKBOX}
                                />
                              </td>
                              <td className="px-3.5 py-2.5">
                                <div className="font-semibold">{nameEN(w)}</div>
                                {nameTH(w) && <div className="text-xs text-gray-600">{nameTH(w)}</div>}
                                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
                                  {w.empId || w.empCode}
                                  <span className="md:hidden">· {w.position?.name || "—"}</span>
                                  {planned && (
                                    <span className="md:hidden">
                                      <PlannedBadge when={planned} />
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className={`${HIDE_MOBILE} px-3.5 py-2.5 text-gray-500`}>
                                {w.position?.name || "—"}
                              </td>
                              <td className={`${HIDE_MOBILE} px-3.5 py-2.5 text-gray-500`}>
                                {w.division || "—"}
                              </td>
                              <td className={`${HIDE_MOBILE} px-3.5 py-2.5 text-xs`}>
                                {planned ? (
                                  <span className="text-blue-700">
                                    <PlannedBadge when={planned} /> {planned}
                                  </span>
                                ) : (
                                  <span className="text-gray-300">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <SelectedPeoplePanel
              items={selectedItems}
              onRemove={toggle}
              onClear={() => setSelectedIds([])}
              disabled={saving}
              listMaxHeight="max-h-[520px]"
            />
          </div>
        </div>
      )}

      {/* ════════ Sticky save bar ════════ */}
      {training && (
        <div className="sticky bottom-0 z-20 -mx-3 mt-2 border-t border-gray-200 bg-white/95 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur sm:-mx-5">
          <div className="flex flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <span className="min-w-0 truncate text-[13px] text-gray-700">
              เลือกไว้ <strong>{selectedIds.length}</strong> คน · "{training.label}"
              {start && ` · ${end && end !== start ? `${fmt(start)} – ${fmt(end)}` : fmt(start)}`}
            </span>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className={`shrink-0 rounded-lg border-none px-6 py-2.5 text-[13px] font-bold ${
                canSave
                  ? "cursor-pointer bg-blue-600 text-white hover:bg-blue-700"
                  : "cursor-not-allowed bg-gray-100 text-gray-400"
              }`}
            >
              {saving ? "กำลังบันทึก..." : `เพิ่มแผนอบรมให้ ${selectedIds.length} คน`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
