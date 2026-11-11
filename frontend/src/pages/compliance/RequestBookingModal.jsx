import { useState, useEffect, useContext, useMemo } from "react";
import axios from "axios";
import Select from "react-select";
import { AppContent } from "../../context/AppContext";
import {
  buildWorkerOptions,
  filterWorkerOption,
} from "../../utils/workerSearch";
import { MAIN_CHECK, CONFINED_SPACE, medKey } from "../../utils/medicalStatus";

// ══════════════════════════════════════════════════════════
// การ์ดเดียวสำหรับขอจอง — แบบโปรแกรมตัวอย่าง
//   type="training" : Request training  → POST /api/training-requests
//   type="medical"  : Request medical   → POST /api/medical-requests
// เลือกบริษัท (ไม่บังคับ) · หลักสูตร · ช่วงวันที่ · สถานที่ · หมายเหตุ · พนักงานหลายคน
// ส่งแล้วไปขึ้นที่หน้า Bookings ให้ HR ยืนยันกับศูนย์อบรม / โรงพยาบาล
// ══════════════════════════════════════════════════════════

const LABEL = "mb-1 block text-[11px] font-semibold text-gray-600";
const INPUT =
  "box-border h-9 w-full rounded-md border border-gray-200 bg-white px-2.5 text-[13px] outline-none focus:border-blue-500";

const selectStyles = {
  control: (b, s) => ({
    ...b,
    minHeight: "36px",
    fontSize: "13px",
    borderColor: s.isFocused ? "#3b82f6" : "#e5e7eb",
    boxShadow: "none",
    borderRadius: "6px",
  }),
  option: (b) => ({ ...b, fontSize: "13px" }),
  placeholder: (b) => ({ ...b, fontSize: "13px", color: "#9ca3af" }),
  menuPortal: (b) => ({ ...b, zIndex: 1000000 }),
};
const SELECT_PORTAL = {
  menuPortalTarget: typeof document !== "undefined" ? document.body : null,
  menuPosition: "fixed",
};

const todayYMD = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const fmtDM = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "?";

// initialCourseId / initialEmployeeIds = เปิดจากหน้าอื่นแบบกรอกไว้ให้แล้ว (เช่น Training Courses)
// Medical (จากหน้า Request Medical):
//   initialCheckType  = ประเภทการตรวจที่เลือกไว้ · checkTypeOptions = ตัวเลือกประเภทการตรวจ
//   initialReasons    = { employeeId: "overdue" | "due_soon" | "no_record" | "manual" } — ไม่ส่ง = "manual"
//   initialClients    = { employeeId: clientName } — ใช้เมื่อไม่ได้เลือกบริษัทในฟอร์ม
//   pendingKeys       = Set ของ "employeeId:checkType" ที่มีคำขอรอ HR อยู่แล้ว → แถวเทา
// onSent(จำนวนคน, checkType, employeeIds)
export default function RequestBookingModal({
  type = "training",
  onClose,
  onSent,
  initialCourseId,
  initialEmployeeIds,
  initialCheckType,
  checkTypeOptions,
  initialReasons,
  initialClients,
  pendingKeys,
}) {
  const { backendUrl } = useContext(AppContent);
  const isTraining = type === "training";

  const [clients, setClients] = useState([]);
  const [courses, setCourses] = useState([]);
  const [workers, setWorkers] = useState([]);

  const [clientName, setClientName] = useState("");
  const [course, setCourse] = useState(null);
  const [checkType, setCheckType] = useState(initialCheckType || MAIN_CHECK);
  const checkTypes = [
    ...new Set([MAIN_CHECK, CONFINED_SPACE, ...(checkTypeOptions || []), checkType].filter(Boolean)),
  ];
  const [start, setStart] = useState(todayYMD());
  const [end, setEnd] = useState(todayYMD());
  const [provider, setProvider] = useState("");
  const [remarks, setRemarks] = useState("");
  const [positionFilter, setPositionFilter] = useState("");
  const [picked, setPicked] = useState([]); // worker objects
  const [sending, setSending] = useState(false);
  // เตือน: ใครติดงานช่วงนี้ (jobs) / ใครมีคำขอหลักสูตรนี้ค้างอยู่แล้ว (requested)
  const [avail, setAvail] = useState({ jobs: {}, requested: [] });

  useEffect(() => {
    // บริษัท (ลูกค้า) — ดึงจากรายการโปรเจกต์ที่มีอยู่
    axios
      .get(`${backendUrl}/api/allocation/projects`, { withCredentials: true })
      .then((res) =>
        setClients(
          [
            ...new Set(
              (res.data || []).map((p) => p.contract?.client?.name).filter(Boolean),
            ),
          ].sort(),
        ),
      )
      .catch(() => setClients([]));
    if (isTraining)
      axios
        .get(`${backendUrl}/api/trainings/global`, { withCredentials: true })
        .then((res) => {
          const opts = (res.data || []).map((t) => ({
            value: t.id,
            label: `${t.name}${t.fullName ? ` - ${t.fullName}` : ""}`,
          }));
          setCourses(opts);
          if (initialCourseId)
            setCourse(opts.find((o) => o.value === initialCourseId) || null);
        })
        .catch((err) => console.error(err));
    axios
      .get(`${backendUrl}/api/workers`, { withCredentials: true })
      .then((res) => {
        const list = (res.data || []).filter((w) => !w.status || w.status === "active");
        setWorkers(list);
        if (initialEmployeeIds?.length) {
          const ids = new Set(initialEmployeeIds);
          setPicked(list.filter((w) => ids.has(w.id)));
        }
      })
      .catch((err) => console.error(err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl, isTraining]);

  // เช็คช่วงวันที่กับงานที่ลงไว้ (Assignment) + คำขอหลักสูตรเดียวกันที่ยังค้าง
  const pickedKey = picked.map((w) => w.id).join(",");
  useEffect(() => {
    if (!start || !pickedKey) {
      setAvail({ jobs: {}, requested: [] });
      return;
    }
    let ignore = false;
    const t = setTimeout(() => {
      axios
        .get(`${backendUrl}/api/training-requests/availability`, {
          withCredentials: true,
          params: {
            start,
            end: end || start,
            globalTrainingId: isTraining ? course?.value : undefined,
            employeeIds: pickedKey,
          },
        })
        .then((res) => !ignore && setAvail(res.data || { jobs: {}, requested: [] }))
        .catch(() => !ignore && setAvail({ jobs: {}, requested: [] }));
    }, 250);
    return () => {
      ignore = true;
      clearTimeout(t);
    };
  }, [backendUrl, start, end, course, pickedKey, isTraining]);
  // Training: คำขอหลักสูตรเดียวกันที่ค้าง (จาก availability) · Medical: pendingKeys ของประเภทการตรวจนี้
  const requestedSet = new Set(avail.requested || []);
  if (!isTraining && pendingKeys)
    picked.forEach((w) => pendingKeys.has(medKey(w.id, checkType)) && requestedSet.add(w.id));

  // Esc ปิด
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !sending && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, sending]);

  const positions = useMemo(
    () => [...new Set(workers.map((w) => w.position?.name).filter(Boolean))].sort(),
    [workers],
  );
  const pickedIds = new Set(picked.map((w) => w.id));
  const pool = workers.filter(
    (w) => !pickedIds.has(w.id) && (!positionFilter || w.position?.name === positionFilter),
  );
  const workerOptions = useMemo(() => {
    const byId = new Map(pool.map((w) => [w.id, w]));
    return buildWorkerOptions(pool).map((o) => ({ ...o, worker: byId.get(o.value) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workers, positionFilter, picked]);

  const addWorker = (w) => w && setPicked((prev) => [...prev, w]);
  const addAllInPosition = () => setPicked((prev) => [...prev, ...pool]);

  const dateError = start && end && end < start ? "วันสิ้นสุดต้องไม่ก่อนวันเริ่ม" : "";
  const ready =
    picked.length > 0 &&
    !dateError &&
    (!isTraining || (course && start && end)) &&
    !sending;

  const submit = async () => {
    if (!ready) return;
    try {
      setSending(true);
      if (isTraining) {
        await axios.post(
          `${backendUrl}/api/training-requests`,
          {
            items: picked.map((w) => ({
              employeeId: w.id,
              globalTrainingId: course.value,
              clientName: clientName || null,
            })),
            requestedStart: start || null,
            requestedEnd: end || null,
            provider: provider.trim() || null,
            remarks: remarks.trim() || null,
          },
          { withCredentials: true },
        );
      } else {
        await axios.post(
          `${backendUrl}/api/medical-requests`,
          {
            items: picked.map((w) => ({
              employeeId: w.id,
              checkType,
              clientName: clientName || initialClients?.[w.id] || null,
              reason: initialReasons?.[w.id] || "manual",
            })),
            requestedStart: start || null,
            requestedEnd: end || null,
            provider: provider.trim() || null,
            remarks: remarks.trim() || null,
          },
          { withCredentials: true },
        );
      }
      onSent?.(picked.length, isTraining ? undefined : checkType, picked.map((w) => w.id));
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || "ส่งคำขอไม่สำเร็จ");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:items-center sm:p-6"
      onClick={() => !sending && onClose()}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-[640px] flex-col overflow-hidden rounded-xl bg-white shadow-[0_10px_40px_rgba(0,0,0,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* หัว */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3.5">
          <span className="text-[15px] font-bold">
            {isTraining ? "🎓 Request training" : "🏥 Request medical check-up"}
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="cursor-pointer border-none bg-transparent text-lg leading-none text-gray-400 hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4 rounded-md bg-blue-50 px-3 py-2 text-[12px] text-blue-800">
            ℹ คำขอจะไปที่ HR เพื่อยืนยันวันกับ
            {isTraining ? "ศูนย์อบรม" : "โรงพยาบาล / คลินิก"} —
            ดูสถานะได้ที่หน้า {isTraining ? "Training" : "Medical"} Bookings
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1.6fr]">
            <div>
              <label className={LABEL}>บริษัท / ลูกค้า (ไม่บังคับ)</label>
              <select
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className={INPUT}
              >
                <option value="">— ไม่ระบุ —</option>
                {clients.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            {isTraining ? (
              <div>
                <label className={LABEL}>
                  หลักสูตร <span className="text-red-500">*</span>
                </label>
                <Select
                  {...SELECT_PORTAL}
                  options={courses}
                  value={course}
                  onChange={setCourse}
                  styles={selectStyles}
                  placeholder="ค้นหา / เลือก training..."
                  noOptionsMessage={() => "ไม่พบ training"}
                />
              </div>
            ) : (
              <div>
                <label className={LABEL}>ประเภทการตรวจ</label>
                <select
                  value={checkType}
                  onChange={(e) => setCheckType(e.target.value)}
                  className={INPUT}
                >
                  {checkTypes.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className={LABEL}>
                {isTraining ? "วันเริ่มที่ต้องการ" : "ช่วงวันที่สะดวก (จาก)"}
                {isTraining && <span className="text-red-500"> *</span>}
              </label>
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL}>
                {isTraining ? "วันสิ้นสุดที่ต้องการ" : "ถึง"}
                {isTraining && <span className="text-red-500"> *</span>}
              </label>
              <input
                type="date"
                value={end}
                min={start || undefined}
                onChange={(e) => setEnd(e.target.value)}
                className={`${INPUT} ${dateError ? "border-red-400" : ""}`}
              />
              {dateError && <div className="mt-1 text-[11px] text-red-600">{dateError}</div>}
            </div>

            <div className="sm:col-span-2">
              <label className={LABEL}>
                {isTraining ? "ศูนย์อบรม / สถานที่" : "โรงพยาบาล / คลินิก"}
              </label>
              <input
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder={isTraining ? "เช่น TPTI" : "เช่น รพ.สงขลา"}
                className={INPUT}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL}>หมายเหตุ</label>
              <input
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="เช่น ต้องผ่านก่อน MOB 15 พ.ย."
                className={INPUT}
              />
            </div>
          </div>

          {/* ── พนักงาน ── */}
          <div className="mt-4">
            <label className={LABEL}>
              พนักงาน <span className="text-red-500">*</span>
              {picked.length > 0 && (
                <span className="ml-1 font-normal text-blue-600">
                  (เพิ่มแล้ว {picked.length} คน)
                </span>
              )}
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
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
              <Select
                {...SELECT_PORTAL}
                options={workerOptions}
                filterOption={filterWorkerOption}
                value={null}
                onChange={(o) => addWorker(o?.worker)}
                styles={selectStyles}
                placeholder="พิมพ์ชื่อ / รหัส แล้วเลือก — เพิ่มได้หลายคน"
                noOptionsMessage={() => "ไม่พบพนักงาน"}
              />
            </div>
            {positionFilter && pool.length > 0 && (
              <button
                type="button"
                onClick={addAllInPosition}
                className="mt-1.5 cursor-pointer border-none bg-transparent p-0 text-xs font-semibold text-blue-600 hover:underline"
              >
                + เพิ่มทุกคนในตำแหน่ง {positionFilter} ({pool.length} คน)
              </button>
            )}

            <div className="mt-2 max-h-[240px] overflow-y-auto rounded-md border border-gray-200">
              {picked.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-gray-400">
                  ยังไม่ได้เลือกพนักงาน
                </div>
              ) : (
                picked.map((w) => {
                  const jobs = avail.jobs?.[w.id] || [];
                  const already = requestedSet.has(w.id);
                  return (
                  <div
                    key={w.id}
                    className={`flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-1.5 text-[13px] last:border-b-0 ${
                      already ? "bg-gray-50 text-gray-500" : ""
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">
                        <b>{w.fullName}</b>{" "}
                        <span className="text-[11px] text-gray-500">
                          {w.position?.name || "—"} · {w.empId || w.empCode}
                        </span>
                      </span>
                      {jobs.map((j, k) => (
                        <span key={k} className="block text-[11px] text-[#c2410c]">
                          ติดงาน: {j.project || j.platform || "—"}
                          {j.platform && j.project ? ` (${j.platform})` : ""} ·{" "}
                          {fmtDM(j.mobDate)}–{j.demobDate ? fmtDM(j.demobDate) : "ยังไม่กำหนดวันกลับ"}
                        </span>
                      ))}
                      {already && (
                        <span className="block text-[11px] text-gray-500">
                          {isTraining
                            ? "มีคำขอ / นัดอบรมหลักสูตรนี้อยู่แล้ว"
                            : `มีคำขอ ${checkType} รอ HR อยู่แล้ว`}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPicked((prev) => prev.filter((x) => x.id !== w.id))}
                      title="เอาออก"
                      className="shrink-0 cursor-pointer border-none bg-transparent text-sm text-gray-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                  );
                })
              )}
            </div>
            <div className="mt-1 text-[11px] text-gray-400">
              <span className="text-[#c2410c]">ส้ม</span> = มีงานช่วงวันที่นี้ (ยังส่งคำขอได้ แค่แจ้งให้รู้) ·{" "}
              <span className="text-gray-500">เทา</span> ={" "}
              {isTraining ? "มีคำขอ / นัดหลักสูตรนี้อยู่แล้ว" : "มีคำขอตรวจประเภทนี้รอ HR อยู่แล้ว"}
            </div>
            {picked.length > 1 && (
              <button
                type="button"
                onClick={() => setPicked([])}
                className="mt-1 cursor-pointer border-none bg-transparent p-0 text-[11px] text-red-600 underline"
              >
                ล้างทั้งหมด
              </button>
            )}
          </div>
        </div>

        {/* ท้าย */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="cursor-pointer rounded-md border border-gray-200 bg-white px-4 py-2 text-[13px] hover:bg-gray-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!ready}
            className="cursor-pointer rounded-md border-none bg-[#2B2F78] px-5 py-2 text-[13px] font-semibold text-white hover:bg-[#22265f] disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {sending ? "กำลังส่ง..." : `ส่งให้ HR${picked.length ? ` (${picked.length} คน)` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
