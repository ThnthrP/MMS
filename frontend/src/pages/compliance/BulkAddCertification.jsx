import { useState, useEffect, useContext, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import Select from "react-select";
import { AppContent } from "../../context/AppContext";
import SelectedPeoplePanel from "../../components/SelectedPeoplePanel";

// ══════════════════════════════════════════════════════════
// constants
// ══════════════════════════════════════════════════════════
// ไม่ห่อเป็น card แล้ว — แต่ละขั้นคั่นด้วยเส้น (พื้นเนื้อหาเป็นสีขาว)
const SECTION = "border-t border-gray-200 py-4";
const SECTION_HEADER =
  "mb-3 flex flex-wrap items-center justify-between gap-2 text-sm font-bold";
const LABEL =
  "mb-1.5 block text-xs font-semibold uppercase tracking-[0.4px] text-gray-500";
// ไม่ใส่สีกรอบไว้ในตัว — ใส่ตอนใช้ (กัน class ชนกันแบบหน้า AdminUsers)
const INPUT_BASE =
  "box-border w-full rounded-lg border bg-white px-3 py-2 text-[13px] outline-none focus:border-blue-400 disabled:cursor-not-allowed disabled:bg-gray-50";
const INPUT = `${INPUT_BASE} border-gray-200`;
const TH =
  "sticky top-0 z-[1] bg-white px-3.5 py-2.5 text-left text-[11px] font-semibold text-gray-500 shadow-[inset_0_-1px_0_#dee2e6]";
const HIDE_MOBILE = "hidden md:table-cell";
const CHECKBOX = "h-[15px] w-[15px] cursor-pointer";

// react-select ใช้ styles API ของไลบรารี
const selectStyles = {
  control: (b) => ({
    ...b,
    fontSize: "13px",
    minHeight: "38px",
    borderColor: "#dee2e6",
  }),
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

function ExistingBadge() {
  return (
    <span
      title="พนักงานคนนี้มี certification นี้บันทึกไว้แล้ว — เลือกต่อจะเพิ่มเป็นใบใหม่ ไม่ได้แทนที่ใบเดิม"
      className="cursor-help whitespace-nowrap rounded bg-[#fff3cd] px-1.5 py-px text-[10px] font-bold text-[#664d03]"
    >
      มีอยู่แล้ว
    </span>
  );
}

// ══════════════════════════════════════════════════════════
// main
// ══════════════════════════════════════════════════════════
export default function BulkAddCertification() {
  const { backendUrl } = useContext(AppContent);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // เปิดจากคำขอที่ HR ยืนยันแล้ว: ?trainingId=&empIds=a,b&issued=YYYY-MM-DD → เลือกไว้ให้เลย
  const prefillRef = useRef({
    trainingId: searchParams.get("trainingId"),
    empIds: (searchParams.get("empIds") || "").split(",").filter(Boolean),
    issued: searchParams.get("issued") || "",
  });

  // ── Step 1 ──
  const [trainingOptions, setTrainingOptions] = useState([]);
  const [selectedTraining, setSelectedTraining] = useState(null);
  const [issuedDate, setIssuedDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [certFile, setCertFile] = useState(null);
  const fileInputRef = useRef(null);

  // ── Employees ──
  const [employees, setEmployees] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [existingEmployeeIds, setExistingEmployeeIds] = useState(new Set());
  const [loadingExisting, setLoadingExisting] = useState(false);
  const existingReqRef = useRef(0);

  // ── Filters ──
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [positionFilter, setPositionFilter] = useState("");
  const [hideExisting, setHideExisting] = useState(false);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState([]);

  // ── Apply ──
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [resultMsg, setResultMsg] = useState(null); // { type, text }

  useEffect(() => {
    axios
      .get(`${backendUrl}/api/trainings/global`, { withCredentials: true })
      .then((res) => {
        const opts = (res.data || []).map((t) => ({
          value: t.id,
          label: `${t.name}${t.fullName ? ` - ${t.fullName}` : ""}`,
        }));
        setTrainingOptions(opts);
        const pre = prefillRef.current;
        if (pre.trainingId) {
          const match = opts.find((o) => o.value === pre.trainingId);
          if (match) setSelectedTraining(match);
          if (pre.issued) setIssuedDate(pre.issued);
        }
      })
      .catch((err) => console.error(err));
  }, [backendUrl]);

  useEffect(() => {
    (async () => {
      try {
        setLoadingEmployees(true);
        const res = await axios.get(`${backendUrl}/api/workers`, {
          withCredentials: true,
        });
        setEmployees((res.data || []).filter((w) => w.status === "active"));
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingEmployees(false);
      }
    })();
  }, [backendUrl]);

  // ใครมี cert นี้อยู่แล้ว — ใช้เตือน ไม่ block
  // requestId กันผลของ training เก่ามาทับตอนสลับ training เร็วๆ
  const loadExisting = useCallback(
    async (trainingId) => {
      const reqId = ++existingReqRef.current;
      if (!trainingId) {
        setExistingEmployeeIds(new Set());
        return;
      }
      try {
        setLoadingExisting(true);
        const res = await axios.get(
          `${backendUrl}/api/compliance/certification/${trainingId}`,
          { withCredentials: true },
        );
        if (reqId !== existingReqRef.current) return;
        const ids = (res.data?.workers || [])
          .filter((w) => w.hasRecord)
          .map((w) => w.employeeId);
        setExistingEmployeeIds(new Set(ids));
      } catch (err) {
        console.error(err);
        if (reqId === existingReqRef.current) setExistingEmployeeIds(new Set());
      } finally {
        if (reqId === existingReqRef.current) setLoadingExisting(false);
      }
    },
    [backendUrl],
  );

  useEffect(() => {
    loadExisting(selectedTraining?.value);
    const pre = prefillRef.current;
    if (pre.trainingId && pre.trainingId === selectedTraining?.value) {
      setSelectedEmployeeIds(pre.empIds); // เลือกคนจากคำขอไว้ให้ (ครั้งเดียว)
      prefillRef.current = { trainingId: null, empIds: [], issued: "" };
    } else {
      setSelectedEmployeeIds([]);
    }
    setResultMsg(null);
  }, [selectedTraining, loadExisting]);

  // กำลังบันทึก → เตือนก่อนปิด/รีเฟรช (จะเหลือบางคนที่ยังไม่ได้บันทึก)
  useEffect(() => {
    if (!applying) return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [applying]);

  // ── Filter options ──
  const departments = [
    ...new Set(employees.map((w) => w.division).filter(Boolean)),
  ].sort();
  const positions = [
    ...new Set(employees.map((w) => w.position?.name).filter(Boolean)),
  ].sort();

  const q = search.trim().toLowerCase();
  const filteredEmployees = employees.filter((w) => {
    // String() — empId/empCode บางคนอาจเป็นตัวเลข เรียก toLowerCase ตรงๆ จะพัง
    const matchSearch =
      !q ||
      String(w.fullName || "")
        .toLowerCase()
        .includes(q) ||
      String(w.empCode || "")
        .toLowerCase()
        .includes(q) ||
      String(w.empId || "")
        .toLowerCase()
        .includes(q);
    const matchDept = !departmentFilter || w.division === departmentFilter;
    const matchPos = !positionFilter || w.position?.name === positionFilter;
    const matchExisting = !hideExisting || !existingEmployeeIds.has(w.id);
    return matchSearch && matchDept && matchPos && matchExisting;
  });

  const hasFilter =
    search || departmentFilter || positionFilter || hideExisting;
  const clearFilters = () => {
    setSearch("");
    setDepartmentFilter("");
    setPositionFilter("");
    setHideExisting(false);
  };

  const toggleEmployee = (id) =>
    setSelectedEmployeeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const allFilteredSelected =
    filteredEmployees.length > 0 &&
    filteredEmployees.every((w) => selectedEmployeeIds.includes(w.id));

  const toggleAllFiltered = () => {
    const ids = filteredEmployees.map((w) => w.id);
    if (allFilteredSelected) {
      const idSet = new Set(ids);
      setSelectedEmployeeIds((prev) => prev.filter((id) => !idSet.has(id)));
    } else {
      setSelectedEmployeeIds((prev) => [...new Set([...prev, ...ids])]);
    }
  };

  // คนที่เลือกไว้แต่ถูกตัวกรองซ่อนอยู่ — บอกให้รู้ กันบันทึกให้คนที่ลืมไปแล้ว
  const filteredIdSet = new Set(filteredEmployees.map((w) => w.id));
  const hiddenSelectedCount = selectedEmployeeIds.filter(
    (id) => !filteredIdSet.has(id),
  ).length;
  const selectedExistingCount = selectedEmployeeIds.filter((id) =>
    existingEmployeeIds.has(id),
  ).length;

  // รายชื่อที่เลือกไว้ (แผงด้านขวา) — ไม่หายตอนค้นหา/กรอง
  const employeeById = new Map(employees.map((w) => [w.id, w]));
  const selectedItems = selectedEmployeeIds.map((id) => {
    const w = employeeById.get(id);
    return {
      id,
      name: w?.fullName || "(ไม่พบในรายชื่อพนักงาน active)",
      sub: [w?.empId || w?.empCode, w?.position?.name]
        .filter(Boolean)
        .join(" · "),
      badge: existingEmployeeIds.has(id) ? <ExistingBadge /> : null,
      hidden: !filteredIdSet.has(id),
    };
  });

  const dateError =
    issuedDate && expiryDate && expiryDate < issuedDate
      ? "Expiry Date ต้องไม่ก่อน Issued Date"
      : null;

  const handleApply = async () => {
    if (!selectedTraining || selectedEmployeeIds.length === 0 || dateError)
      return;
    const existingWarn =
      selectedExistingCount > 0
        ? `\n\n⚠ ในนี้มี ${selectedExistingCount} คนที่มี cert นี้อยู่แล้ว — จะได้ใบใหม่เพิ่ม`
        : "";
    const hiddenWarn =
      hiddenSelectedCount > 0
        ? `\n⚠ มี ${hiddenSelectedCount} คนที่เลือกไว้แต่ถูกตัวกรองซ่อนอยู่ — จะถูกบันทึกด้วย`
        : "";
    if (
      !window.confirm(
        `เพิ่ม certification "${selectedTraining.label}" ให้พนักงาน ${selectedEmployeeIds.length} คน?${existingWarn}${hiddenWarn}`,
      )
    )
      return;

    const targetIds = [...selectedEmployeeIds];
    setApplying(true);
    setResultMsg(null);
    setProgress({ done: 0, total: targetIds.length });

    let successCount = 0;
    const failedIds = [];

    for (const employeeId of targetIds) {
      try {
        const res = await axios.post(
          `${backendUrl}/api/workers/${employeeId}/trainings`,
          {
            globalTrainingId: selectedTraining.value,
            completedDate: issuedDate || null,
            expiryDate: expiryDate || null,
            source: "manual",
          },
          { withCredentials: true },
        );

        // ไฟล์ cert ร่วม (ใบเดียวกันทุกคนในชุดนี้)
        if (certFile && res.data?.id) {
          const fd = new FormData();
          fd.append("certFile", certFile);
          await axios.post(
            `${backendUrl}/api/workers/${employeeId}/trainings/${res.data.id}/cert-file`,
            fd,
            {
              withCredentials: true,
              headers: { "Content-Type": "multipart/form-data" },
            },
          );
        }
        successCount++;
      } catch (err) {
        console.error(`Failed for employee ${employeeId}:`, err);
        failedIds.push(employeeId);
      } finally {
        setProgress((prev) => ({ ...prev, done: prev.done + 1 }));
      }
    }

    setApplying(false);
    await loadExisting(selectedTraining.value); // refresh badge "มีอยู่แล้ว"

    if (failedIds.length === 0) {
      setResultMsg({
        type: "ok",
        text: `บันทึกสำเร็จทั้งหมด ${successCount} คน ✓`,
      });
      setSelectedEmployeeIds([]);
    } else {
      // เหลือเลือกไว้เฉพาะคนที่ล้มเหลว — เดิมคงรายชื่อทั้งชุดไว้
      // กดบันทึกซ้ำจะเพิ่ม cert ซ้ำให้คนที่สำเร็จไปแล้ว
      setSelectedEmployeeIds(failedIds);
      const failedNames = failedIds.map(
        (id) => employees.find((w) => w.id === id)?.fullName || id,
      );
      setResultMsg({
        type: "err",
        text: `สำเร็จ ${successCount} คน — ล้มเหลว ${failedIds.length} คน: ${failedNames.join(
          ", ",
        )} (เลือกค้างไว้เฉพาะคนที่ล้มเหลว กดบันทึกอีกครั้งเพื่อลองใหม่)`,
      });
    }
  };

  const canApply =
    selectedTraining &&
    selectedEmployeeIds.length > 0 &&
    !applying &&
    !dateError;
  const progressPct = progress.total
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1800px]">
      {/* ════════ Header ════════ */}
      <div className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() =>
              window.history.length > 1
                ? navigate(-1)
                : navigate("/requests-history")
            }
            disabled={applying}
            className="mb-1 cursor-pointer border-none bg-transparent p-0 text-[13px] text-gray-500 hover:text-gray-800 disabled:cursor-not-allowed"
          >
            ← ย้อนกลับ
          </button>
          <h1 className="m-0 text-lg font-bold">
            บันทึกผลอบรม (Bulk Add Certification)
          </h1>
          <div className="text-xs text-gray-500">
            อบรมรอบเดียวกันเสร็จแล้ว → เพิ่ม certification
            ให้พนักงานทั้งกลุ่มทีเดียว
          </div>
        </div>
      </div>

      {resultMsg && (
        <div
          className={`mb-4 rounded-lg border px-4 py-2.5 text-[13px] ${
            resultMsg.type === "ok"
              ? "border-[#badbcc] bg-[#d1e7dd] text-[#0f5132]"
              : "border-[#f5c6cb] bg-[#f8d7da] text-[#842029]"
          }`}
        >
          {resultMsg.text}
        </div>
      )}

      {/* ════════ Step 1 ════════ */}
      <div className={SECTION}>
        <div className={SECTION_HEADER}>
          <span className="flex items-center">
            <StepBadge n={1} />
            เลือก Training / Certification
          </span>
        </div>
        <div>
          <div className="mb-4">
            <label className={LABEL}>Training / Certification *</label>
            <Select
              options={trainingOptions}
              value={selectedTraining}
              onChange={setSelectedTraining}
              placeholder="ค้นหา / เลือก training..."
              isClearable
              isDisabled={applying}
              styles={selectStyles}
              noOptionsMessage={() => "ไม่มี training"}
              menuPortalTarget={document.body}
              menuPosition="fixed"
            />
          </div>

          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className={LABEL}>
                Issued Date{" "}
                <span className="font-normal normal-case">
                  (ใช้ร่วมกันทุกคน)
                </span>
              </label>
              <input
                type="date"
                value={issuedDate}
                onChange={(e) => setIssuedDate(e.target.value)}
                disabled={applying}
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL}>
                Expiry Date{" "}
                <span className="font-normal normal-case">
                  (ใช้ร่วมกันทุกคน)
                </span>
              </label>
              <input
                type="date"
                value={expiryDate}
                min={issuedDate || undefined}
                onChange={(e) => setExpiryDate(e.target.value)}
                disabled={applying}
                className={`${INPUT_BASE} ${dateError ? "border-[#dc3545]" : "border-gray-200"}`}
              />
              {dateError && (
                <div className="mt-1 text-[11px] text-[#dc3545]">
                  {dateError}
                </div>
              )}
            </div>
            <div>
              <label className={LABEL}>
                Certificate File{" "}
                <span className="font-normal normal-case">
                  (optional — ใบเดียวกันทุกคน)
                </span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf"
                  onChange={(e) => setCertFile(e.target.files?.[0] || null)}
                  disabled={applying}
                  className="min-w-0 flex-1 text-xs file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-solid file:border-gray-200 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-semibold hover:file:bg-gray-50"
                />
                {certFile && !applying && (
                  <button
                    type="button"
                    title="เอาไฟล์ออก"
                    onClick={() => {
                      setCertFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="shrink-0 cursor-pointer rounded-md border-none bg-[#fff5f5] px-2 py-1 text-xs text-[#dc3545]"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          </div>

          {!selectedTraining && (
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3.5 text-center text-xs text-gray-500">
              เลือก training ก่อน เพื่อเริ่มเลือกพนักงาน
            </div>
          )}
        </div>
      </div>

      {/* ════════ Step 2 ════════ */}
      {selectedTraining && (
        <div className={SECTION}>
          <div className={SECTION_HEADER}>
            <span className="flex items-center">
              <StepBadge n={2} />
              เลือกพนักงานที่ไปอบรมชุดนี้
            </span>
            {selectedEmployeeIds.length > 0 && (
              <span className="rounded-md bg-[#fff3cd] px-2.5 py-[3px] text-xs font-semibold text-[#664d03]">
                เลือกไว้ {selectedEmployeeIds.length} คน
                {hiddenSelectedCount > 0 &&
                  ` (ซ่อนจากตัวกรอง ${hiddenSelectedCount})`}
              </span>
            )}
          </div>
          {/* ซ้าย = ตัวกรอง + รายชื่อ · ขวา (xl+) = คนที่เลือกไว้ */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            {/* Filters */}
            <div className="mb-3 grid grid-cols-2 gap-2.5 md:grid-cols-[minmax(200px,1fr)_180px_220px]">
              <div className="col-span-2 md:col-span-1">
                <label className={LABEL}>ค้นหาพนักงาน</label>
                <input
                  type="text"
                  placeholder="🔍 ชื่อ หรือรหัสพนักงาน"
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
                  checked={hideExisting}
                  onChange={(e) => setHideExisting(e.target.checked)}
                  className={CHECKBOX}
                />
                ซ่อนคนที่มี cert นี้อยู่แล้ว ({existingEmployeeIds.size})
              </label>
              <div className="flex items-center gap-3">
                <span className="text-gray-500">
                  แสดง {filteredEmployees.length} คน
                </span>
                {hasFilter && (
                  <button
                    onClick={clearFilters}
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
              onRemove={toggleEmployee}
              onClear={() => setSelectedEmployeeIds([])}
              disabled={applying}
            />

            {loadingEmployees ? (
              <div className="p-10 text-center text-[13px] text-gray-500">
                Loading employees...
              </div>
            ) : (
              <div className="max-h-[480px] overflow-y-auto border-y border-gray-200">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th className={`${TH} w-[120px]`}>
                        <label
                          className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-gray-600"
                          title="เลือก/ยกเลิกทุกคนที่แสดงอยู่ตามตัวกรอง"
                        >
                          <input
                            type="checkbox"
                            checked={allFilteredSelected}
                            onChange={toggleAllFiltered}
                            disabled={applying}
                            className={CHECKBOX}
                          />
                          เลือกทั้งหมด
                        </label>
                      </th>
                      <th className={TH}>EMPLOYEE</th>
                      <th className={`${TH} ${HIDE_MOBILE}`}>POSITION</th>
                      <th className={`${TH} ${HIDE_MOBILE}`}>DEPARTMENT</th>
                      <th className={`${TH} ${HIDE_MOBILE}`}>CERT นี้</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="p-8 text-center text-gray-500"
                        >
                          ไม่พบพนักงานที่ตรงกับตัวกรอง
                        </td>
                      </tr>
                    ) : (
                      filteredEmployees.map((w) => {
                        const checked = selectedEmployeeIds.includes(w.id);
                        const hasExisting = existingEmployeeIds.has(w.id);
                        return (
                          <tr
                            key={w.id}
                            onClick={() => !applying && toggleEmployee(w.id)}
                            className={`cursor-pointer border-b border-gray-100 ${
                              checked
                                ? "bg-[#fffbe6]"
                                : "bg-white hover:bg-gray-50"
                            }`}
                          >
                            <td className="px-3.5 py-2.5">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleEmployee(w.id)}
                                onClick={(e) => e.stopPropagation()}
                                disabled={applying}
                                className={CHECKBOX}
                              />
                            </td>
                            <td className="px-3.5 py-2.5">
                              <div className="font-semibold">{w.fullName}</div>
                              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
                                {/* รหัสพนักงานฝั่ง client (empId) — ไม่มีค่อยใช้ empCode */}
                                {w.empId || w.empCode}
                                {/* มือถือ: ตำแหน่ง/แผนก + badge ต่อท้ายใต้ชื่อ */}
                                <span className="md:hidden">
                                  · {w.position?.name || "—"}
                                  {w.division && ` · ${w.division}`}
                                </span>
                                {hasExisting && (
                                  <span className="md:hidden">
                                    <ExistingBadge />
                                  </span>
                                )}
                              </div>
                            </td>
                            <td
                              className={`${HIDE_MOBILE} px-3.5 py-2.5 text-gray-500`}
                            >
                              {w.position?.name || "—"}
                            </td>
                            <td
                              className={`${HIDE_MOBILE} px-3.5 py-2.5 text-gray-500`}
                            >
                              {w.division || "—"}
                            </td>
                            <td className={`${HIDE_MOBILE} px-3.5 py-2.5`}>
                              {hasExisting ? (
                                <ExistingBadge />
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
            {loadingExisting && (
              <div className="mt-2 text-[11px] text-gray-500">
                กำลังเช็คพนักงานที่มี certification นี้อยู่แล้ว...
              </div>
            )}
          </div>

            <SelectedPeoplePanel
              items={selectedItems}
              onRemove={toggleEmployee}
              onClear={() => setSelectedEmployeeIds([])}
              disabled={applying}
              listMaxHeight="max-h-[520px]"
            />
          </div>
        </div>
      )}

      {/* ════════ Sticky Apply bar — ชิดขอบล่างจอ (แบบเดียวกับ AddWorker / EditWorker) ════════ */}
      {selectedTraining && (
        <div className="sticky bottom-0 z-20 -mx-3 mt-2 overflow-hidden border-t border-gray-200 bg-white/95 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur sm:-mx-5">
          {applying && (
            <div className="h-1 bg-gray-100">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}
          <div className="flex flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <span className="min-w-0 truncate text-[13px] text-gray-700">
              {applying ? (
                `กำลังบันทึก... (${progress.done}/${progress.total}) — อย่าปิดหน้านี้`
              ) : (
                <>
                  เลือกไว้ <strong>{selectedEmployeeIds.length}</strong> คน
                  สำหรับ "{selectedTraining.label}"
                </>
              )}
            </span>
            <button
              onClick={handleApply}
              disabled={!canApply}
              className={`shrink-0 rounded-lg border-none px-6 py-2.5 text-[13px] font-bold ${
                canApply
                  ? "cursor-pointer bg-blue-600 text-white hover:bg-blue-700"
                  : "cursor-not-allowed bg-gray-100 text-gray-400"
              }`}
            >
              {applying
                ? `${progressPct}%`
                : `บันทึกให้ ${selectedEmployeeIds.length} คน`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
