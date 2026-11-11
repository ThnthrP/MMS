import { useState, useEffect, useContext, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import axios from "axios";
import { AppContent } from "../../context/AppContext";
import DecisionModal, { fmtRange, toYMD } from "./BookingDecisionModal";

// ══════════════════════════════════════════════════════════
// รายละเอียดคำขอจอง — ใช้ทั้ง Training (/training-requests/:id) และ Medical (/medical-requests/:id)
// HR ยืนยัน / ปฏิเสธ รายคน ด้วยการ์ด "HR confirmation" (BookingDecisionModal.jsx — ใช้ร่วมกับหน้ารายการ)
//   ยืนยัน → ใส่วันที่ที่ศูนย์อบรม / โรงพยาบาลให้จริง + สถานที่ + หมายเหตุ
//   ปฏิเสธ → ใส่เหตุผล
// ผู้ขอได้รับแจ้งเตือนทุกครั้งที่ HR ตัดสิน · ไม่เหลือคนรอ → คำขอปิดอัตโนมัติ
// Training: ชื่อหลักสูตรอยู่ที่หัวหน้า (คำขอส่วนใหญ่มีหลักสูตรเดียว)
//   คำขอที่มีหลายหลักสูตร → แบ่งรายชื่อเป็นกลุ่มตามหลักสูตร พร้อม checkbox เลือกทั้งกลุ่ม
// ══════════════════════════════════════════════════════════

// หัวตารางตรึงไว้ตอนเลื่อน (ตารางเลื่อนในกรอบ max-h ของตัวเอง)
const TH =
  "sticky top-0 z-[1] whitespace-nowrap bg-gray-50 px-3 py-2 text-left text-[11px] font-semibold text-gray-500 shadow-[inset_0_-1px_0_#e5e7eb]";
const TD = "px-3 py-2.5 align-top text-[13px]";
const BTN =
  "inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50";

const STATUS = {
  pending: ["⏳ รอ HR", "bg-[#fff3cd] text-[#664d03]"],
  confirmed: ["✓ ยืนยันแล้ว", "bg-[#d1e7dd] text-[#0f5132]"],
  rejected: ["✕ ปฏิเสธ", "bg-[#f8d7da] text-[#842029]"],
};
const REASON = {
  overdue: "❌ หมดอายุ",
  no_record: "⚪ ไม่มีข้อมูล",
  due_soon: "⏰ ใกล้หมดอายุ",
  manual: "📝 ขอเอง",
};

// คลิกที่แถวเพื่อติ๊ก — ยกเว้นคลิกโดนลิงก์ / ปุ่ม / checkbox เอง
const isInteractive = (e) => !!e.target.closest("a,button,input,select,label");

const fmtDateTime = (d) =>
  new Date(d).toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export default function BookingDetail({ type = "training" }) {
  const isTraining = type === "training";
  const { id } = useParams();
  const { backendUrl } = useContext(AppContent);
  const apiBase = `${backendUrl}/api/${isTraining ? "training-requests" : "medical-requests"}`;
  const listPath = isTraining ? "/requests-history" : "/medical-bookings";

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState([]); // itemIds
  const [modal, setModal] = useState(null); // { rows, decision }
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    axios
      .get(`${apiBase}/${id}`, { withCredentials: true })
      .then((res) => setData(res.data))
      .catch((err) => {
        console.error(err);
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [apiBase, id]);

  // แถวรายคน (Training: แตกจากกลุ่มตามหลักสูตร)
  const rows = useMemo(() => {
    if (!data) return [];
    if (isTraining)
      return (data.groups || []).flatMap((g) =>
        g.employees.map((e) => ({ ...e, trainingId: g.trainingId, trainingName: g.trainingName })),
      );
    return data.employees || [];
  }, [data, isTraining]);

  // หลักสูตรในคำขอนี้ (Training) — เรียงตามลำดับที่ backend ส่งมา
  const courseGroups = useMemo(() => {
    if (!isTraining) return [];
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.trainingId)) map.set(r.trainingId, { trainingId: r.trainingId, trainingName: r.trainingName, rows: [] });
      map.get(r.trainingId).rows.push(r);
    }
    return [...map.values()];
  }, [rows, isTraining]);
  const multiCourse = courseGroups.length > 1;

  const hasItemIds = rows.some((r) => r.itemId); // backend ใหม่แล้วหรือยัง
  const pendingRows = rows.filter((r) => (r.status || "pending") === "pending");
  const allPendingSelected =
    pendingRows.length > 0 && pendingRows.every((r) => selected.includes(r.itemId));

  const toggle = (itemId) =>
    setSelected((prev) => (prev.includes(itemId) ? prev.filter((x) => x !== itemId) : [...prev, itemId]));
  const toggleAll = () =>
    setSelected(allPendingSelected ? [] : pendingRows.map((r) => r.itemId));
  // เลือก / ยกเลิก ทุกคนที่รอ HR ในหลักสูตรเดียว (คำขอหลายหลักสูตร)
  const toggleGroup = (groupRows) => {
    const ids = groupRows.filter((r) => (r.status || "pending") === "pending").map((r) => r.itemId);
    const allIn = ids.length > 0 && ids.every((x) => selected.includes(x));
    setSelected((prev) => (allIn ? prev.filter((x) => !ids.includes(x)) : [...new Set([...prev, ...ids])]));
  };

  const save = async (rowsToSave, body) => {
    try {
      setSaving(true);
      const res = await axios.patch(
        `${apiBase}/${id}/items`,
        { itemIds: rowsToSave.map((r) => r.itemId), ...body },
        { withCredentials: true },
      );
      setData(res.data);
      setSelected([]);
      setModal(null);
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const undo = (r) => {
    if (!window.confirm(`ย้อนสถานะของ ${r.fullName} กลับเป็น "รอ HR"?`)) return;
    save([r], { decision: "pending" });
  };

  const backLink = (
    <Link to={listPath} className="mb-1 inline-block text-[13px] text-gray-500 no-underline hover:text-gray-800">
      ← {isTraining ? "Training Bookings" : "Medical Bookings"}
    </Link>
  );

  if (loading || !data)
    return (
      <div className="mx-auto w-full max-w-[1800px]">
        {backLink}
        <div className="p-10 text-center text-sm text-gray-500">
          {loading ? "Loading..." : "ไม่พบคำขอนี้"}
        </div>
      </div>
    );

  const counts = data.counts || { pending: rows.length, confirmed: 0, rejected: 0 };
  const COLS = isTraining ? 5 : 6; // จำนวนคอลัมน์ (Training ไม่มีคอลัมน์หลักสูตร)
  const selectedRows = rows.filter((r) => selected.includes(r.itemId));

  // คนที่ยืนยันอบรมแล้ว → ไปบันทึก certification ทั้งกลุ่ม (แยกตามหลักสูตร)
  const confirmedByTraining = isTraining
    ? Object.values(
        rows
          .filter((r) => r.status === "confirmed")
          .reduce((acc, r) => {
            (acc[r.trainingId] ||= { trainingId: r.trainingId, trainingName: r.trainingName, rows: [] }).rows.push(r);
            return acc;
          }, {}),
      )
    : [];

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1800px]">
      {backLink}

      {/* ════════ หัว ════════ */}
      <div className="flex flex-col gap-2 border-b border-gray-200 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-gray-500">
            {isTraining ? "🎓 คำขอจัด Training" : "🏥 คำขอนัดตรวจสุขภาพ"}
          </div>
          <h1 className="m-0 text-lg font-bold">
            {isTraining
              ? multiCourse
                ? `${courseGroups.length} หลักสูตร · ${rows.length} คน`
                : `${courseGroups[0]?.trainingName || "—"} · ${rows.length} คน`
              : `${rows.length} คน`}
          </h1>
          {multiCourse && (
            <div className="mt-0.5 text-[13px] text-gray-600">
              {courseGroups.map((g) => `${g.trainingName} (${g.rows.length})`).join(" · ")}
            </div>
          )}
          <div className="text-[13px] text-gray-500">
            {data.requestedByName ? `ขอโดย ${data.requestedByName} · ` : ""}
            {fmtDateTime(data.createdAt)}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
            <span>
              <span className="text-gray-500">วันที่ต้องการ </span>
              <b>{fmtRange(data.requestedStart, data.requestedEnd) || "—"}</b>
            </span>
            <span>
              <span className="text-gray-500">{isTraining ? "ศูนย์อบรม " : "โรงพยาบาล "}</span>
              <b>{data.provider || "—"}</b>
            </span>
            {data.remarks && (
              <span>
                <span className="text-gray-500">หมายเหตุ </span>
                {data.remarks}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5 text-xs font-semibold">
          <span className="rounded-md bg-[#fff3cd] px-2 py-1 text-[#664d03]">⏳ รอ HR {counts.pending}</span>
          <span className="rounded-md bg-[#d1e7dd] px-2 py-1 text-[#0f5132]">✓ ยืนยัน {counts.confirmed}</span>
          <span className="rounded-md bg-[#f8d7da] px-2 py-1 text-[#842029]">✕ ปฏิเสธ {counts.rejected}</span>
        </div>
      </div>

      {!hasItemIds && (
        <div className="mt-3 rounded-md border border-[#ffe69c] bg-[#fff8e1] px-3 py-2 text-xs text-[#664d03]">
          ⚠ backend ยังเป็นเวอร์ชันเก่า — ยืนยัน / ปฏิเสธรายคนไม่ได้ (อัปเดต trainingRequestService / medicalRequestService ก่อน)
        </div>
      )}

      {/* ════════ แถบเลือก ════════ */}
      <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
        <span className="text-[13px] text-gray-600">
          {selectedRows.length > 0 ? (
            <>
              เลือกไว้ <strong className="text-gray-900">{selectedRows.length}</strong> คน
              <button
                type="button"
                onClick={() => setSelected([])}
                className="ml-2 cursor-pointer border-none bg-transparent p-0 text-xs text-gray-500 underline hover:text-gray-800"
              >
                ล้างที่เลือก
              </button>
            </>
          ) : pendingRows.length > 0 ? (
            <>
              ติ๊ก ☐ หน้าชื่อ (หรือคลิกที่แถว) เพื่อยืนยัน / ปฏิเสธหลายคนพร้อมกัน —
              เลือกได้เฉพาะคนที่ <b>⏳ รอ HR</b>
            </>
          ) : (
            "ทุกคนในคำขอนี้ HR ตัดสินแล้ว"
          )}
        </span>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={selectedRows.length === 0}
            onClick={() => setModal({ rows: selectedRows, decision: "confirmed" })}
            className={`${BTN} border-[#198754] bg-[#198754] text-white hover:bg-[#157347]`}
          >
            ✓ Confirm selected ({selectedRows.length})
          </button>
          <button
            type="button"
            disabled={selectedRows.length === 0}
            onClick={() => setModal({ rows: selectedRows, decision: "rejected" })}
            className={`${BTN} border-[#f5c6cb] bg-white text-[#dc3545] hover:bg-red-50`}
          >
            ✕ Reject selected
          </button>
        </div>
      </div>

      {/* ════════ ตารางรายคน ════════ */}
      <div className="max-h-[calc(100vh-300px)] min-h-[240px] overflow-auto border-t border-gray-200">
        <table className="w-full min-w-[760px] border-collapse">
          <thead>
            <tr>
              <th className={`${TH} w-[120px]`}>
                <label
                  className={`flex items-center gap-1.5 ${
                    hasItemIds && pendingRows.length > 0 ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                  }`}
                  title="เลือกทุกคนที่รอ HR"
                >
                  <input
                    type="checkbox"
                    checked={allPendingSelected}
                    onChange={toggleAll}
                    disabled={!hasItemIds || pendingRows.length === 0}
                    className="h-[15px] w-[15px] cursor-pointer"
                  />
                  ทั้งหมดที่รอ ({pendingRows.length})
                </label>
              </th>
              <th className={TH}>พนักงาน</th>
              {!isTraining && <th className={TH}>การตรวจ</th>}
              <th className={TH}>ผลจาก HR</th>
              <th className={`${TH} text-center`}>สถานะ</th>
              <th className={`${TH} w-[150px] text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(isTraining ? courseGroups : [{ trainingId: "all", rows }]).flatMap((g) => {
              const groupPending = g.rows.filter((r) => (r.status || "pending") === "pending");
              const groupAllSelected =
                groupPending.length > 0 && groupPending.every((r) => selected.includes(r.itemId));
              const header = multiCourse ? (
                <tr key={`g-${g.trainingId}`} className="bg-[#f5f6fb]">
                  <td colSpan={COLS} className="border-b border-gray-200 px-3 py-2 text-[13px]">
                    <label
                      className={`inline-flex items-center gap-2 ${
                        hasItemIds && groupPending.length > 0 ? "cursor-pointer" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={groupAllSelected}
                        onChange={() => toggleGroup(g.rows)}
                        disabled={!hasItemIds || groupPending.length === 0}
                        className="h-[15px] w-[15px] cursor-pointer disabled:cursor-not-allowed"
                        title="เลือกทุกคนที่รอ HR ในหลักสูตรนี้"
                      />
                      <b>🎓 {g.trainingName}</b>
                      <span className="text-xs text-gray-500">
                        {g.rows.length} คน{groupPending.length > 0 && ` · รอ HR ${groupPending.length}`}
                      </span>
                    </label>
                  </td>
                </tr>
              ) : null;
              return [header, ...g.rows.map((r, i) => {
              const st = r.status || "pending";
              const [label, cls] = STATUS[st] || STATUS.pending;
              return (
                <tr
                  key={r.itemId || `${g.trainingId}-${i}`}
                  onClick={(e) =>
                    st === "pending" && hasItemIds && !isInteractive(e) && toggle(r.itemId)
                  }
                  className={`border-b border-gray-100 ${selected.includes(r.itemId) ? "bg-[#f0f7ff]" : ""} ${
                    st === "pending" && hasItemIds ? "cursor-pointer hover:bg-gray-50" : ""
                  }`}
                >
                  <td className={`${TD} text-center`}>
                    {st === "pending" && hasItemIds ? (
                      <input
                        type="checkbox"
                        aria-label={`เลือก ${r.fullName}`}
                        checked={selected.includes(r.itemId)}
                        onChange={() => toggle(r.itemId)}
                        className="h-[15px] w-[15px] cursor-pointer"
                      />
                    ) : (
                      <span className="text-gray-300" title="ตัดสินแล้ว — แก้ไขได้ที่ Actions">
                        —
                      </span>
                    )}
                  </td>
                  <td className={TD}>
                    <Link
                      to={`/workers/${r.employeeId}`}
                      className="font-semibold text-gray-900 no-underline hover:text-blue-600"
                    >
                      {r.fullName}
                    </Link>
                    <div className="text-[11px] text-gray-500">
                      {r.empId || r.empCode} · {r.position || "—"}
                      {r.clientName && ` · ${r.clientName}`}
                    </div>
                  </td>
                  {!isTraining && (
                    <td className={TD}>
                      {r.checkType}
                      {r.reason && <div className="text-[11px] text-gray-500">{REASON[r.reason] || r.reason}</div>}
                    </td>
                  )}
                  <td className={TD}>
                    {st === "confirmed" ? (
                      <>
                        <div className="font-semibold">
                          {fmtRange(r.confirmedStart, r.confirmedEnd) || "—"}
                        </div>
                        <div className="text-[11px] text-gray-500">
                          {r.confirmedProvider || ""}
                        </div>
                      </>
                    ) : null}
                    {r.hrNote && <div className="text-[11px] text-gray-600">💬 {r.hrNote}</div>}
                    {r.decidedByName && (
                      <div className="text-[10px] text-gray-400">
                        โดย {r.decidedByName}
                        {r.decidedAt && ` · ${fmtDateTime(r.decidedAt)}`}
                      </div>
                    )}
                    {st === "pending" && <span className="text-gray-400">—</span>}
                  </td>
                  <td className={`${TD} text-center`}>
                    <span className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
                      {label}
                    </span>
                  </td>
                  <td className={`${TD} text-right`}>
                    {hasItemIds &&
                      (st === "pending" ? (
                        <button
                          type="button"
                          onClick={() => setModal({ rows: [r], decision: "confirmed" })}
                          className={`${BTN} border-[#198754] bg-[#198754] text-white hover:bg-[#157347]`}
                        >
                          Confirm / reject
                        </button>
                      ) : (
                        <span className="inline-flex gap-2">
                          <button
                            type="button"
                            onClick={() => setModal({ rows: [r], decision: st })}
                            className="cursor-pointer border-none bg-transparent p-0 text-xs font-semibold text-blue-600 hover:underline"
                          >
                            แก้ไข
                          </button>
                          <button
                            type="button"
                            onClick={() => undo(r)}
                            title="ย้อนกลับเป็นรอ HR"
                            className="cursor-pointer border-none bg-transparent p-0 text-xs text-gray-500 hover:text-gray-800"
                          >
                            ↩
                          </button>
                        </span>
                      ))}
                  </td>
                </tr>
              );
              })].filter(Boolean);
            })}
          </tbody>
        </table>
      </div>

      {/* ════════ อบรมเสร็จ → บันทึก certification ════════ */}
      {confirmedByTraining.length > 0 && (
        <div className="mt-4 border-t border-gray-200 pt-3">
          <div className="mb-2 text-[13px] font-bold">อบรมเสร็จแล้ว? บันทึกผลเข้าประวัติพนักงาน</div>
          <div className="flex flex-wrap gap-2">
            {confirmedByTraining.map((g) => {
              const end = g.rows.map((r) => r.confirmedEnd).filter(Boolean).sort().pop();
              const qs = new URLSearchParams({
                trainingId: g.trainingId,
                empIds: g.rows.map((r) => r.employeeId).join(","),
                ...(end ? { issued: toYMD(end) } : {}),
              });
              return (
                <Link
                  key={g.trainingId}
                  to={`/certifications/bulk-add?${qs}`}
                  className={`${BTN} border-gray-200 bg-white text-gray-700 no-underline hover:bg-gray-50`}
                >
                  ✓ บันทึกผลอบรม {g.trainingName} ({g.rows.length} คน) →
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {modal && (
        <DecisionModal
          isTraining={isTraining}
          rows={modal.rows}
          batch={data}
          initialDecision={modal.decision}
          saving={saving}
          onClose={() => setModal(null)}
          onSave={(body) => save(modal.rows, body)}
        />
      )}
    </div>
  );
}
