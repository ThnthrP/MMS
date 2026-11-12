import { useState, useEffect, useContext, useCallback, useRef } from "react";
import axios from "axios";
import Select from "react-select";
import { AppContent } from "../../context/AppContext";

// ══════════════════════════════════════════════════════════
// helpers
// ══════════════════════════════════════════════════════════
// รวม GlobalTraining + TrainingStandard (1 training = 1 standard) เป็นฟอร์มเดียว
const emptyForm = {
  id: null,
  name: "",
  fullName: "",
  description: "",
  standardId: null, // มีค่า = มี standard ใน DB แล้ว (update) / null = create ตอน save
  sourceId: "",
  clientId: "",
  trainingHours: "",
  validityYears: "", // เก็บเป็น "ปี" ในฟอร์ม แปลงเป็น/จาก validityDays ตอนโหลด-บันทึก
  isNoExpiry: false,
};

const daysToYears = (days) => {
  if (days == null) return "";
  const y = days / 365;
  return Number.isInteger(y) ? String(y) : String(Math.round(y * 10) / 10);
};
const yearsToDays = (years) => {
  if (years === "" || years == null) return null;
  return Math.round(Number(years) * 365);
};

// ══════════════════════════════════════════════════════════
// constants
// ══════════════════════════════════════════════════════════
const LABEL = "mb-1.5 block text-xs font-semibold text-gray-500";
const INPUT =
  "box-border w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] outline-none focus:border-blue-400 disabled:cursor-default disabled:bg-gray-50 disabled:text-gray-700";
const BTN_PRIMARY =
  "cursor-pointer rounded-lg border-none bg-[#2B2F78] px-[18px] py-[9px] text-[13px] font-semibold text-white hover:bg-[#22265f] disabled:cursor-not-allowed disabled:opacity-60";
const BTN_DANGER =
  "cursor-pointer rounded-lg border border-[#f5c6cb] bg-white px-3 py-1.5 text-xs font-semibold text-[#dc3545] hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60";
const ICON_BTN =
  "inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-none text-[13px] transition-all hover:-translate-y-px disabled:cursor-wait disabled:hover:translate-y-0";
const ICON_VIEW = `${ICON_BTN} bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15),0_1px_2px_rgba(0,0,0,0.08)] hover:shadow-[0_3px_6px_rgba(0,0,0,0.2),0_2px_3px_rgba(0,0,0,0.1)]`;
const ICON_EDIT = `${ICON_BTN} bg-[#e7f1ff] text-blue-600 shadow-[0_1px_3px_rgba(13,110,253,0.2),0_1px_2px_rgba(0,0,0,0.06)] hover:shadow-[0_3px_6px_rgba(13,110,253,0.3),0_2px_3px_rgba(0,0,0,0.08)]`;
const ICON_DELETE = `${ICON_BTN} bg-[#fff5f5] text-[#842029] shadow-[0_1px_3px_rgba(220,53,69,0.2),0_1px_2px_rgba(0,0,0,0.06)] hover:shadow-[0_3px_6px_rgba(220,53,69,0.3),0_2px_3px_rgba(0,0,0,0.08)]`;
const TH =
  "sticky top-0 z-[1] bg-white px-4 py-2.5 text-[11px] font-semibold text-gray-500 shadow-[inset_0_-1px_0_#f1f3f5]";
const DASH = <span className="text-gray-400">—</span>;

// ── แถบตัวกรอง — หน้าตาเดียวกับหน้า Workers (label ด้านบน · placeholder สีจาง · ไม่เลือก = ทั้งหมด) ──
const FILTER_LABEL =
  "mb-1 block text-xs font-semibold uppercase tracking-[0.4px] text-gray-500";
const FILTER_SELECT_STYLES = {
  control: (p) => ({
    ...p,
    borderColor: "#dee2e6",
    borderRadius: "8px",
    minHeight: "36px",
    fontSize: "13px",
    boxShadow: "none",
    "&:hover": { borderColor: "#86b7fe" },
  }),
  option: (p) => ({ ...p, fontSize: "13px" }),
  placeholder: (p) => ({ ...p, fontSize: "13px", color: "#6c757d" }),
  menuPortal: (p) => ({ ...p, zIndex: 50 }), // ลอยเหนือหัวตาราง sticky
};
const FILTER_MENU_PORTAL = {
  menuPortalTarget: typeof document !== "undefined" ? document.body : null,
  menuPosition: "fixed",
};
const SETUP_OPTIONS = [
  { value: "set", label: "Set" },
  { value: "unset", label: "⚠ Not set" },
];
const CERT_OPTIONS = [
  { value: "has", label: "มีพนักงานถือ cert" },
  { value: "none", label: "ไม่มีใครถือ (0 คน)" },
];
const CHEVRON_OPTIONS = [
  { value: "used", label: "ใช้ใน Chevron" },
  { value: "unused", label: "ไม่ได้ใช้" },
];

// ตัวเลือก training: "ชื่อกลาง : ชื่อในไฟล์ HR" (ชื่อในไฟล์แสดงเฉพาะเมื่อต่างจากชื่อกลาง)
//   ค้นได้ทั้งสองชื่อ ไม่สนตัวพิมพ์เล็ก/ใหญ่ และช่องว่าง
const hrName = (t) => (t.fullName && t.fullName !== t.name ? t.fullName : "");
const normSearch = (v) => String(v || "").toLowerCase().replace(/\s+/g, " ").trim();
const filterTrainingOption = (option, input) => {
  const q = normSearch(input);
  if (!q) return true;
  return normSearch(`${option.data.name} ${option.data.hrName}`).includes(q);
};
// เมนู: ชื่อกลางตัวหนา + ชื่อในไฟล์ HR บรรทัดล่าง · ในช่องที่เลือกแล้ว: บรรทัดเดียว
const formatTrainingOption = (o, { context }) =>
  context === "value" ? (
    o.label
  ) : (
    <div className="leading-snug">
      <div className="font-semibold">{o.name}</div>
      {o.hrName && <div className="text-[11px] text-gray-500">ชื่อในไฟล์ HR: {o.hrName}</div>}
    </div>
  );

// ══════════════════════════════════════════════════════════
// small components (อยู่นอก component หลัก)
// ══════════════════════════════════════════════════════════
function MessageBanner({ msg }) {
  if (!msg) return null;
  const ok = msg.type === "ok";
  return (
    <div
      className={`mb-4 rounded-lg border px-3.5 py-2.5 text-[13px] ${
        ok
          ? "border-[#badbcc] bg-[#d1e7dd] text-[#0f5132]"
          : "border-[#f5c6cb] bg-[#f8d7da] text-[#842029]"
      }`}
    >
      {ok ? "✅ " : "⚠ "}
      {msg.text}
    </div>
  );
}

function ValidityCell({ standard }) {
  if (!standard) return DASH;
  if (standard.isNoExpiry) {
    return (
      <span className="whitespace-nowrap rounded bg-[#e7f1ff] px-2 py-px text-[11px] font-semibold text-blue-600">
        No expiry
      </span>
    );
  }
  const years = daysToYears(standard.validityDays);
  return years ? <span>{years}</span> : DASH;
}

function SetBadge({ isSet }) {
  return isSet ? (
    <span className="whitespace-nowrap rounded-md bg-[#d1e7dd] px-2.5 py-0.5 text-[11px] font-semibold text-[#0f5132]">
      Set
    </span>
  ) : (
    <span
      className="whitespace-nowrap rounded-md bg-[#fff3cd] px-2.5 py-0.5 text-[11px] font-semibold text-[#664d03]"
      title="ยังไม่ตั้งค่า standard"
    >
      Not set
    </span>
  );
}

function EmpCount({ count, onClick, inline = false }) {
  if (!(count > 0)) return <span className="text-gray-400">0</span>;
  // ตัวเลขแสดงเฉยๆ + ลิงก์ "ดูรายชื่อ" แยก — เปิดหน้าต่างตรวจชื่อ cert (ไม่ใช่เปลี่ยนหน้า จึงไม่ใส่ลูกศร)
  const link = (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer whitespace-nowrap border-none bg-transparent p-0 text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:underline"
      title="ดูรายชื่อพนักงาน + ตรวจชื่อ cert เทียบกับชื่อในไฟล์ HR"
    >
      ดูรายชื่อ
    </button>
  );
  return inline ? (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-bold text-gray-900">{count}</span>
      <span className="text-gray-300">·</span>
      {link}
    </span>
  ) : (
    <div className="flex flex-col items-center leading-tight">
      <span className="font-bold text-gray-900">{count}</span>
      {link}
    </div>
  );
}

function ClientUsageCell({ usage }) {
  if (!usage) return <span className="text-gray-300">—</span>;
  return (
    <span className="whitespace-nowrap font-semibold text-[#198754]">
      ✓{usage.positionCount > 0 ? ` (${usage.positionCount})` : ""}
    </span>
  );
}

// ══════════════════════════════════════════════════════════
// ตรวจชื่อ cert — ใบ cert ของ training นี้ แยกตาม "ชื่อในไฟล์" (rawTrainingName)
//   HR เทียบชื่อในไฟล์ Excel กับชื่อในระบบ · ชื่อผิด → ✏️ แก้ชื่อ training
//   ใบผูกผิดตัว → ติ๊กแล้ว "ย้ายไป training อื่น"
// ══════════════════════════════════════════════════════════
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");
const empName = (e) => e.fullNameEN || e.fullName || e.fullNameTH || "—";

function GroupBadge({ matches }) {
  if (matches === true)
    return (
      <span className="whitespace-nowrap rounded bg-[#d1e7dd] px-1.5 py-px text-[10px] font-semibold text-[#0f5132]">
        ✓ ตรงกับชื่อในระบบ
      </span>
    );
  if (matches === false)
    return (
      <span className="whitespace-nowrap rounded bg-[#fff3cd] px-1.5 py-px text-[10px] font-semibold text-[#664d03]">
        ⚠ ชื่อต่างจากระบบ — ตรวจ
      </span>
    );
  return (
    <span className="whitespace-nowrap rounded bg-gray-100 px-1.5 py-px text-[10px] font-semibold text-gray-600">
      เพิ่มในระบบ (ไม่มีชื่อจากไฟล์)
    </span>
  );
}

function CertsModal({ backendUrl, training, onClose, onEditTraining, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState({}); // groupKey -> bool
  const [selected, setSelected] = useState([]); // certIds
  const [target, setTarget] = useState(null);
  const [moving, setMoving] = useState(false);
  const [trainings, setTrainings] = useState([]); // ตัวเลือกปลายทาง — โหลดครบทุกตัว (ไม่ขึ้นกับช่องค้นหาของหน้าหลัก)

  useEffect(() => {
    axios
      .get(`${backendUrl}/api/global-trainings`, { withCredentials: true })
      .then((res) => setTrainings(res.data || []))
      .catch((err) => console.error(err));
  }, [backendUrl]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get(
        `${backendUrl}/api/global-trainings/${training.id}/certs`,
        { withCredentials: true },
      );
      setData(res.data);
      // เปิดกลุ่มที่ชื่อไม่ตรงไว้ก่อน
      const o = {};
      (res.data.groups || []).forEach((g, i) => {
        if (g.matchesSystemName === false) o[i] = true;
      });
      setOpen(o);
    } catch (err) {
      console.error(err);
      setMsg({ type: "err", text: "โหลดรายการ cert ไม่สำเร็จ" });
    } finally {
      setLoading(false);
    }
  }, [backendUrl, training.id]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (ids, on) =>
    setSelected((prev) =>
      on ? [...new Set([...prev, ...ids])] : prev.filter((x) => !ids.includes(x)),
    );

  const targetOptions = trainings
    .filter((t) => t.id !== training.id)
    .map((t) => ({
      value: t.id,
      label: `${t.name}${t.fullName && t.fullName !== t.name ? ` — ${t.fullName}` : ""}`,
    }));

  const handleMove = async () => {
    if (!target || selected.length === 0) return;
    if (
      !window.confirm(
        `ย้าย cert ${selected.length} ใบ\nจาก "${training.name}"\nไป "${target.label}" ?\n\n` +
          "(ประวัติเก่าของพนักงานคนนั้นใน training นี้จะย้ายไปด้วย)",
      )
    )
      return;
    try {
      setMoving(true);
      setMsg(null);
      const res = await axios.post(
        `${backendUrl}/api/global-trainings/${training.id}/reassign-certs`,
        { certIds: selected, targetTrainingId: target.value },
        { withCredentials: true },
      );
      setSelected([]);
      setTarget(null);
      await load();
      onChanged?.();
      setMsg({
        type: "ok",
        text: `ย้าย cert ${res.data.employeeCount} คนไป "${res.data.target.name}" แล้ว`,
      });
    } catch (err) {
      setMsg({ type: "err", text: err.response?.data?.message || "ย้ายไม่สำเร็จ" });
    } finally {
      setMoving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/50 p-3 sm:p-5"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-[920px] flex-col overflow-hidden rounded-[10px] bg-white"
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 bg-[#1e3a5f] px-4 py-4 text-white sm:px-6">
          <div className="min-w-0">
            <div className="text-[11px] text-white/70">ตรวจชื่อ cert</div>
            <div className="break-words text-base font-semibold">{training.name}</div>
            {training.fullName && training.fullName !== training.name && (
              <div className="break-words text-[11px] text-white/70">
                ชื่อที่ HR ใช้ในไฟล์: {training.fullName}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3.5">
            <button
              onClick={onEditTraining}
              className="cursor-pointer whitespace-nowrap rounded-md border border-white/30 bg-white/15 px-3 py-[5px] text-xs font-semibold text-white hover:bg-white/25"
              title="แก้ชื่อกลาง / ชื่อที่ HR ใช้ในไฟล์ — มีผลกับทุกคนที่มี cert นี้"
            >
              ✏️ แก้ชื่อ training
            </button>
            <button
              onClick={onClose}
              className="cursor-pointer border-none bg-transparent text-xl leading-none text-white"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-4 sm:p-6">
          <MessageBanner msg={msg} />
          <div className="mb-3 text-xs text-gray-500">
            เทียบ <strong>ชื่อในไฟล์ Excel</strong> กับชื่อ training ในระบบ —
            ชื่อในระบบผิด กด <strong>✏️ แก้ชื่อ training</strong> (มีผลทุกคน) ·
            ใบผูกผิด training ติ๊ก ☑ <strong>เลือกทั้งกลุ่ม</strong> หรือกด{" "}
            <strong>แสดงรายชื่อ</strong> แล้วติ๊กรายคน จากนั้นกด{" "}
            <strong>ย้ายไป training อื่น</strong> ด้านล่าง
          </div>

          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : !data || data.total === 0 ? (
            <div className="p-8 text-center text-[13px] text-gray-500">
              ไม่มีพนักงานถือ cert นี้
            </div>
          ) : (
            <div className="divide-y divide-gray-100 border-y border-gray-200">
              {data.groups.map((g, gi) => {
                const ids = g.certs.map((c) => c.id);
                const allOn = ids.every((id) => selected.includes(id));
                const someOn = !allOn && ids.some((id) => selected.includes(id));
                return (
                  <div key={gi} className="py-2.5">
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[11px] text-gray-500">ชื่อในไฟล์:</span>
                        <span className="break-words text-[13px] font-semibold text-gray-900">
                          {g.rawName ? `"${g.rawName}"` : "—"}
                        </span>
                        <GroupBadge matches={g.matchesSystemName} />
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="whitespace-nowrap text-xs font-semibold text-gray-700">
                          {g.count} ใบ
                        </span>
                        <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs text-gray-700">
                          <input
                            type="checkbox"
                            checked={allOn}
                            ref={(el) => el && (el.indeterminate = someOn)}
                            onChange={(e) => toggle(ids, e.target.checked)}
                            className="h-[15px] w-[15px] cursor-pointer"
                          />
                          เลือกทั้งกลุ่ม
                        </label>
                        <button
                          type="button"
                          onClick={() => setOpen((o) => ({ ...o, [gi]: !o[gi] }))}
                          className="cursor-pointer whitespace-nowrap border-none bg-transparent p-0 text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {open[gi] ? "ซ่อนรายชื่อ ▴" : "แสดงรายชื่อ ▾"}
                        </button>
                      </div>
                    </div>

                    {open[gi] && (
                      <div className="mt-2 overflow-x-auto rounded-md bg-gray-50 px-3 py-1">
                        <table className="w-full border-collapse text-[12px]">
                          <thead>
                            <tr className="text-left text-[10px] font-semibold uppercase text-gray-500">
                              <th className="w-12 whitespace-nowrap py-1 pr-2">เลือก</th>
                              <th className="py-1 pr-3">Worker</th>
                              <th className="py-1 pr-3">Position</th>
                              <th className="whitespace-nowrap py-1 pr-3">Issued</th>
                              <th className="whitespace-nowrap py-1">Expiry</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.certs.map((c) => (
                              <tr key={c.id} className="border-t border-gray-100">
                                <td className="py-1.5">
                                  <input
                                    type="checkbox"
                                    checked={selected.includes(c.id)}
                                    onChange={(e) => toggle([c.id], e.target.checked)}
                                    className="h-[14px] w-[14px] cursor-pointer"
                                  />
                                </td>
                                <td className="py-1.5 pr-3">
                                  <a
                                    href={`/workers/${c.employee.id}/edit`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-semibold text-gray-900 hover:text-blue-600 hover:underline"
                                    title="เปิดหน้า Edit Worker (แท็บใหม่)"
                                  >
                                    {empName(c.employee)}
                                  </a>
                                  <div className="text-[10px] text-gray-500">
                                    {c.employee.empId || c.employee.empCode}
                                    {c.employee.status !== "active" && ` · ${c.employee.status}`}
                                  </div>
                                </td>
                                <td className="py-1.5 pr-3 text-gray-600">
                                  {c.employee.position || "—"}
                                </td>
                                <td className="whitespace-nowrap py-1.5 pr-3 text-gray-600">
                                  {fmtDate(c.completedDate)}
                                </td>
                                <td className="whitespace-nowrap py-1.5 text-gray-600">
                                  {c.expiryDate ? fmtDate(c.expiryDate) : "ไม่มีวันหมดอายุ"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer — ย้ายใบที่เลือก */}
        {data?.total > 0 && (
          <div className="flex shrink-0 flex-col gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:px-6">
            <span className="whitespace-nowrap text-[13px] text-gray-700">
              {selected.length === 0 ? (
                <span className="text-gray-500">ติ๊ก ☑ ใบที่ต้องการย้ายก่อน →</span>
              ) : (
                <>
                  เลือก <strong>{selected.length}</strong> ใบ → ย้ายไป
                </>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <Select
                options={targetOptions}
                value={target}
                onChange={setTarget}
                placeholder="ค้นหา training ปลายทาง..."
                isClearable
                menuPlacement="top"
                maxMenuHeight={260}
                noOptionsMessage={() => "ไม่พบ training"}
                styles={{
                  control: (b) => ({ ...b, minHeight: 36, fontSize: 13 }),
                  option: (b) => ({ ...b, fontSize: 13 }),
                  menuPortal: (b) => ({ ...b, zIndex: 9999999 }),
                }}
                menuPortalTarget={document.body}
              />
            </div>
            <button
              onClick={handleMove}
              disabled={moving || !target || selected.length === 0}
              className={`${BTN_PRIMARY} whitespace-nowrap`}
            >
              {moving ? "กำลังย้าย…" : "ย้ายไป training อื่น"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// main
// ══════════════════════════════════════════════════════════
export default function ManageTrainings() {
  const { backendUrl } = useContext(AppContent);

  // ----- list -----
  const [trainings, setTrainings] = useState([]);
  const [trainingFilter, setTrainingFilter] = useState(""); // GlobalTraining.id — เลือกจาก dropdown
  const [loadingList, setLoadingList] = useState(true);
  const [listMsg, setListMsg] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const firstLoadRef = useRef(true);
  // filter ฝั่ง frontend (รายการโหลดมาครบแล้ว)
  const [sourceFilter, setSourceFilter] = useState("");
  const [setupFilter, setSetupFilter] = useState(""); // "" | "set" | "unset"
  const [certFilter, setCertFilter] = useState(""); // "" | "has" | "none"
  const [chevronFilter, setChevronFilter] = useState(""); // "" | "used" | "unused"

  // ----- clients -----
  const [clients, setClients] = useState([]);
  // ตารางแสดงเฉพาะคอลัมน์ Chevron (client อื่นยังไม่ได้ใช้งานจริง)
  const visibleClients = clients.filter(
    (c) => c.name.toUpperCase() === "CHEVRON",
  );

  // ----- training sources -----
  const [sources, setSources] = useState([]);
  const [showSourceManager, setShowSourceManager] = useState(false);
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceRequiresClient, setNewSourceRequiresClient] = useState(false);
  const [sourceMsg, setSourceMsg] = useState(null);
  const [savingSource, setSavingSource] = useState(false);

  // ----- panel -----
  const [selectedId, setSelectedId] = useState(null); // null = ปิด, "new" = สร้างใหม่
  const [mode, setMode] = useState("view"); // "view" | "edit"
  const [form, setForm] = useState(emptyForm);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detailMsg, setDetailMsg] = useState(null);

  // clientId -> clientTrainingId ของ training ที่เปิดอยู่
  const [clientLinks, setClientLinks] = useState({});
  const [linkingClientId, setLinkingClientId] = useState(null);

  // ----- ตรวจชื่อ cert (กดตัวเลขพนักงานที่มี cert) -----
  const [certsTraining, setCertsTraining] = useState(null);

  // ข้อความสำเร็จหายเองใน 3 วินาที
  useEffect(() => {
    if (listMsg?.type !== "ok") return;
    const t = setTimeout(() => setListMsg(null), 3000);
    return () => clearTimeout(t);
  }, [listMsg]);

  const loadTrainings = useCallback(async () => {
    try {
      // แสดง "Loading..." เฉพาะครั้งแรก — ตอนรีเฟรช ตารางเดิมค้างไว้ ไม่กะพริบ
      // โหลดครบทุกตัวครั้งเดียว — ค้นหา/กรองฝั่ง frontend (dropdown training ต้องมีตัวเลือกครบ)
      if (firstLoadRef.current) setLoadingList(true);
      const res = await axios.get(`${backendUrl}/api/global-trainings`, {
        withCredentials: true,
      });
      setTrainings(res.data || []);
    } catch (err) {
      console.error(err);
      setListMsg({ type: "err", text: "โหลดรายการ training ไม่สำเร็จ" });
    } finally {
      setLoadingList(false);
      firstLoadRef.current = false;
    }
  }, [backendUrl]);

  useEffect(() => {
    loadTrainings();
  }, [loadTrainings]);

  const loadSources = useCallback(async () => {
    try {
      const res = await axios.get(
        `${backendUrl}/api/global-trainings/sources`,
        {
          withCredentials: true,
        },
      );
      setSources(res.data || []);
    } catch (err) {
      console.error(err);
    }
  }, [backendUrl]);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  useEffect(() => {
    axios
      .get(`${backendUrl}/api/clients`, { withCredentials: true })
      .then((res) => setClients(res.data || []))
      .catch((err) => console.error(err)); // ไม่ critical — แค่ dropdown client ว่าง
  }, [backendUrl]);

  // ── Sources ──
  const handleAddSource = async () => {
    if (!newSourceName.trim()) return;
    try {
      setSavingSource(true);
      setSourceMsg(null);
      await axios.post(
        `${backendUrl}/api/global-trainings/sources`,
        { name: newSourceName.trim(), requiresClient: newSourceRequiresClient },
        { withCredentials: true },
      );
      setNewSourceName("");
      setNewSourceRequiresClient(false);
      await loadSources();
      setSourceMsg({ type: "ok", text: "เพิ่ม source แล้ว" });
    } catch (err) {
      setSourceMsg({
        type: "err",
        text: err.response?.data?.message || "เพิ่ม source ไม่สำเร็จ",
      });
    } finally {
      setSavingSource(false);
    }
  };

  const handleDeleteSource = async (id, name) => {
    if (!window.confirm(`ยืนยันลบ source "${name}" ?`)) return;
    try {
      setSourceMsg(null);
      await axios.delete(`${backendUrl}/api/global-trainings/sources/${id}`, {
        withCredentials: true,
      });
      setForm((f) => (f.sourceId === id ? { ...f, sourceId: "" } : f));
      await loadSources();
      setSourceMsg({ type: "ok", text: `ลบ "${name}" แล้ว` });
    } catch (err) {
      setSourceMsg({
        type: "err",
        text: err.response?.data?.message || "ลบไม่สำเร็จ",
      });
    }
  };

  // ── Panel open/close ──
  const openTraining = async (id, targetMode = "view") => {
    setSelectedId(id);
    setMode(targetMode);
    setDetailMsg(null);
    try {
      setLoadingDetail(true);
      const res = await axios.get(`${backendUrl}/api/global-trainings/${id}`, {
        withCredentials: true,
      });
      const std = (res.data.trainingStandards || [])[0] || null;
      setForm({
        id: res.data.id,
        name: res.data.name || "",
        fullName: res.data.fullName || "",
        description: res.data.description || "",
        standardId: std?.id ?? null,
        sourceId: std?.sourceId ?? "",
        clientId: std?.clientId ?? "",
        trainingHours: std?.trainingHours ?? "",
        validityYears: std?.isNoExpiry ? "" : daysToYears(std?.validityDays),
        isNoExpiry: !!std?.isNoExpiry,
      });
      const map = {};
      (res.data.clientTrainings || []).forEach((ct) => {
        map[ct.contract.client.id] = ct.id;
      });
      setClientLinks(map);
    } catch (err) {
      console.error(err);
      setDetailMsg({ type: "err", text: "โหลดข้อมูล training ไม่สำเร็จ" });
    } finally {
      setLoadingDetail(false);
    }
  };

  const openNewTraining = () => {
    setSelectedId("new");
    setMode("edit");
    setForm(emptyForm);
    setClientLinks({});
    setDetailMsg(null);
  };

  const closePanel = () => {
    setSelectedId(null);
    setMode("view");
    setForm(emptyForm);
    setClientLinks({});
    setDetailMsg(null);
    setShowSourceManager(false);
  };

  // ── Client links ──
  const toggleClientLink = async (client) => {
    const contract = client.contracts?.[0];
    if (!contract) {
      setDetailMsg({
        type: "err",
        text: `${client.name} ยังไม่มี active contract — สร้าง contract ก่อน`,
      });
      return;
    }
    if (!form.standardId) {
      setDetailMsg({
        type: "err",
        text: "กรุณาบันทึก Training Standard ก่อน ถึงจะผูกกับ client ได้",
      });
      return;
    }

    const existingClientTrainingId = clientLinks[client.id];
    setLinkingClientId(client.id);
    setDetailMsg(null);

    try {
      if (existingClientTrainingId) {
        await axios.delete(
          `${backendUrl}/api/client-trainings/${existingClientTrainingId}`,
          { withCredentials: true },
        );
        setClientLinks((m) => {
          const next = { ...m };
          delete next[client.id];
          return next;
        });
      } else {
        const res = await axios.post(
          `${backendUrl}/api/contracts/${contract.id}/client-trainings`,
          { globalTrainingId: form.id, trainingStandardId: form.standardId },
          { withCredentials: true },
        );
        setClientLinks((m) => ({ ...m, [client.id]: res.data.id }));
      }
      loadTrainings();
    } catch (err) {
      setDetailMsg({
        type: "err",
        text: err.response?.data?.message || "อัปเดตการผูก client ไม่สำเร็จ",
      });
    } finally {
      setLinkingClientId(null);
    }
  };

  const selectedSource = sources.find((s) => s.id === form.sourceId) || null;

  // ── Save (GlobalTraining + Standard ในปุ่มเดียว) ──
  const handleSave = async () => {
    if (!form.name.trim()) {
      setDetailMsg({ type: "err", text: "กรุณากรอกชื่อ training (name)" });
      return;
    }
    if (!form.sourceId) {
      setDetailMsg({ type: "err", text: "กรุณาเลือก source" });
      return;
    }
    if (selectedSource?.requiresClient && !form.clientId) {
      setDetailMsg({
        type: "err",
        text: `source "${selectedSource.name}" ต้องเลือก client ด้วย`,
      });
      return;
    }

    try {
      setSaving(true);
      setDetailMsg(null);

      const trainingPayload = {
        name: form.name.trim(),
        fullName: form.fullName.trim() || null,
        description: form.description.trim() || null,
      };

      let trainingId = form.id;
      if (selectedId === "new") {
        const res = await axios.post(
          `${backendUrl}/api/global-trainings`,
          trainingPayload,
          { withCredentials: true },
        );
        trainingId = res.data.id;
      } else {
        await axios.put(
          `${backendUrl}/api/global-trainings/${trainingId}`,
          trainingPayload,
          { withCredentials: true },
        );
      }

      const standardPayload = {
        sourceId: form.sourceId,
        clientId: selectedSource?.requiresClient ? form.clientId : null,
        trainingHours:
          form.trainingHours === "" ? null : Number(form.trainingHours),
        validityDays: form.isNoExpiry ? null : yearsToDays(form.validityYears),
        isNoExpiry: form.isNoExpiry,
      };

      if (form.standardId) {
        await axios.put(
          `${backendUrl}/api/global-trainings/${trainingId}/standards/${form.standardId}`,
          standardPayload,
          { withCredentials: true },
        );
      } else {
        await axios.post(
          `${backendUrl}/api/global-trainings/${trainingId}/standards`,
          standardPayload,
          { withCredentials: true },
        );
      }

      loadTrainings();
      // กลับไป view mode กันแก้พลาดซ้ำ — openTraining ล้างข้อความก่อน
      // จึงต้องตั้งข้อความ "บันทึกสำเร็จ" หลังจากนั้น (เดิมตั้งก่อน เลยไม่เคยโชว์)
      await openTraining(trainingId, "view");
      setDetailMsg({ type: "ok", text: "บันทึกสำเร็จ" });
    } catch (err) {
      setDetailMsg({
        type: "err",
        text: err.response?.data?.message || "บันทึกไม่สำเร็จ",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteStandard = async () => {
    if (!form.standardId) return;
    if (!window.confirm("ยืนยันลบ training standard นี้?")) return;
    try {
      await axios.delete(
        `${backendUrl}/api/global-trainings/${form.id}/standards/${form.standardId}`,
        { withCredentials: true },
      );
      setForm((f) => ({
        ...f,
        standardId: null,
        sourceId: "",
        clientId: "",
        trainingHours: "",
        validityYears: "",
        isNoExpiry: false,
      }));
      loadTrainings();
      setDetailMsg({ type: "ok", text: "ลบ standard แล้ว" });
    } catch (err) {
      setDetailMsg({
        type: "err",
        text:
          err.response?.data?.message ||
          "ลบไม่สำเร็จ — standard นี้อาจถูกใช้งานอยู่ในบาง contract",
      });
    }
  };

  // ── ลบ training (ใช้ร่วมกันทั้งปุ่มในตารางและใน panel) ──
  // ถ้ามี standard ผูกอยู่ ลบ standard ให้ก่อน แล้วค่อยลบ training
  const deleteTraining = async ({ id, name, standardId, empCount = 0 }) => {
    const confirmMsg =
      (empCount > 0
        ? `⚠ มีพนักงาน ${empCount} คนที่ถือ cert "${name}" อยู่ในระบบ\n\n`
        : "") +
      (standardId !== false
        ? `ยืนยันลบ "${name}" ?\n(จะลบ training standard ที่ผูกอยู่ด้วย)`
        : `ยืนยันลบ "${name}" ?`);
    if (!window.confirm(confirmMsg)) return;

    try {
      setDeletingId(id);
      setListMsg(null);

      // standardId: string = รู้ id แล้ว / null|undefined = ไม่รู้ ต้องถาม backend / false = ไม่มีแน่ๆ
      let stdId = standardId;
      if (stdId === undefined) {
        const detail = await axios.get(
          `${backendUrl}/api/global-trainings/${id}`,
          {
            withCredentials: true,
          },
        );
        stdId = (detail.data.trainingStandards || [])[0]?.id ?? null;
      }
      if (stdId) {
        await axios.delete(
          `${backendUrl}/api/global-trainings/${id}/standards/${stdId}`,
          { withCredentials: true },
        );
      }

      await axios.delete(`${backendUrl}/api/global-trainings/${id}`, {
        withCredentials: true,
      });

      if (selectedId === id) closePanel();
      loadTrainings();
      setListMsg({ type: "ok", text: `ลบ "${name}" แล้ว` });
    } catch (err) {
      const text =
        err.response?.data?.message ||
        `ลบ "${name}" ไม่สำเร็จ — อาจถูกใช้งานอยู่ในระบบ (employee training / candidate gap / training matrix)`;
      if (selectedId === id) setDetailMsg({ type: "err", text });
      else setListMsg({ type: "err", text });
    } finally {
      setDeletingId(null);
    }
  };

  const quickDeleteTraining = (t) =>
    deleteTraining({
      id: t.id,
      name: t.name,
      standardId: (t._count?.trainingStandards ?? 0) > 0 ? undefined : false,
      empCount: t._count?.employeeTrainings ?? 0,
    });

  const panelDeleteTraining = () => {
    const listItem = trainings.find((t) => t.id === form.id);
    deleteTraining({
      id: form.id,
      name: form.name,
      standardId: form.standardId || false,
      empCount: listItem?._count?.employeeTrainings ?? 0,
    });
  };

  const shownTrainings = trainings.filter((t) => {
    const isSet = (t._count?.trainingStandards ?? 0) > 0;
    const certs = t._count?.employeeTrainings ?? 0;
    const chevron = !!t.clientUsage?.find(
      (u) => (u.name || "").toUpperCase() === "CHEVRON",
    );
    if (trainingFilter && t.id !== trainingFilter) return false;
    if (sourceFilter && t.standard?.sourceName !== sourceFilter) return false;
    if (setupFilter === "set" && !isSet) return false;
    if (setupFilter === "unset" && isSet) return false;
    if (certFilter === "has" && certs === 0) return false;
    if (certFilter === "none" && certs > 0) return false;
    if (chevronFilter === "used" && !chevron) return false;
    if (chevronFilter === "unused" && chevron) return false;
    return true;
  });
  const hasFilter =
    trainingFilter || sourceFilter || setupFilter || certFilter || chevronFilter;
  const resetFilters = () => {
    setTrainingFilter("");
    setSourceFilter("");
    setSetupFilter("");
    setCertFilter("");
    setChevronFilter("");
  };

  const trainingOptions = trainings
    .map((t) => ({
      value: t.id,
      name: t.name,
      hrName: hrName(t),
      label: hrName(t) ? `${t.name} : ${hrName(t)}` : t.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const sourceOptions = sources.map((s) => ({ value: s.name, label: s.name }));
  const pick = (opts, v) => opts.find((o) => o.value === v) || null;

  const panelOpen = selectedId !== null;
  const isEditing = mode === "edit";

  const renderActions = (t) => (
    <div className="inline-flex gap-1.5">
      <button
        title="View"
        className={ICON_VIEW}
        onClick={() => openTraining(t.id, "view")}
      >
        👁
      </button>
      <button
        title="Edit"
        className={ICON_EDIT}
        onClick={() => openTraining(t.id, "edit")}
      >
        ✏️
      </button>
      <button
        title="Delete"
        className={ICON_DELETE}
        onClick={() => quickDeleteTraining(t)}
        disabled={deletingId === t.id}
      >
        {deletingId === t.id ? "…" : "🗑"}
      </button>
    </div>
  );

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1800px]">
      {/* ════════ Header ════════ */}
      <div className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
          <span>
            จัดการ training กลาง (ชั่วโมงอบรม/อายุ cert/source) — 1 training ต่อ
            1 standard
          </span>
          {!loadingList && (
            <span>
              ทั้งหมด <b className="text-gray-900">{trainings.length}</b> รายการ
              {hasFilter && (
                <>
                  {" "}
                  · พบ <b className="text-blue-700">{shownTrainings.length}</b>
                </>
              )}
            </span>
          )}
        </div>
        <button
          className={`${BTN_PRIMARY} w-full shrink-0 sm:w-auto`}
          onClick={openNewTraining}
        >
          + Add Training
        </button>
      </div>

      {/* ════════ Search & Filter — label กำกับทุกช่อง คั่นด้วยเส้น ════════
          มือถือ 1 / sm 2 / lg+ 5 ช่องในแถวเดียว (ช่อง Training กว้างสุด) */}
      <div className="grid grid-cols-1 gap-3 border-y border-gray-200 py-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))]">
        <div className="min-w-0 sm:col-span-2 lg:col-span-1">
          <label className={FILTER_LABEL}>
            Training{" "}
            <span className="normal-case tracking-normal text-gray-400">
              (ชื่อกลาง / ชื่อในไฟล์ HR)
            </span>
          </label>
          <Select
            options={trainingOptions}
            value={pick(trainingOptions, trainingFilter)}
            onChange={(o) => setTrainingFilter(o ? o.value : "")}
            filterOption={filterTrainingOption}
            formatOptionLabel={formatTrainingOption}
            placeholder="🔍 ค้นหาด้วยชื่อกลาง หรือชื่อในไฟล์ HR เช่น Rigging, H2S..."
            isClearable
            styles={FILTER_SELECT_STYLES}
            {...FILTER_MENU_PORTAL}
            noOptionsMessage={() => "ไม่พบ training"}
          />
        </div>
        <div className="min-w-0">
          <label className={FILTER_LABEL}>Source</label>
          <Select
            options={sourceOptions}
            value={pick(sourceOptions, sourceFilter)}
            onChange={(o) => setSourceFilter(o ? o.value : "")}
            placeholder="All Sources"
            isClearable
            styles={FILTER_SELECT_STYLES}
            {...FILTER_MENU_PORTAL}
            noOptionsMessage={() => "ไม่พบ source"}
          />
        </div>
        <div className="min-w-0">
          <label className={FILTER_LABEL}>Set up</label>
          <Select
            options={SETUP_OPTIONS}
            value={pick(SETUP_OPTIONS, setupFilter)}
            onChange={(o) => setSetupFilter(o ? o.value : "")}
            placeholder="All"
            isClearable
            isSearchable={false}
            styles={FILTER_SELECT_STYLES}
            {...FILTER_MENU_PORTAL}
          />
        </div>
        <div className="min-w-0">
          <label className={FILTER_LABEL}>พนักงานที่มี cert</label>
          <Select
            options={CERT_OPTIONS}
            value={pick(CERT_OPTIONS, certFilter)}
            onChange={(o) => setCertFilter(o ? o.value : "")}
            placeholder="All"
            isClearable
            isSearchable={false}
            styles={FILTER_SELECT_STYLES}
            {...FILTER_MENU_PORTAL}
          />
        </div>
        <div className="min-w-0">
          <label className={`${FILTER_LABEL} flex items-center justify-between`}>
            <span>Chevron</span>
            {hasFilter && (
              <button
                onClick={resetFilters}
                className="cursor-pointer border-none bg-transparent p-0 text-[11px] font-semibold normal-case tracking-normal text-[#dc3545] underline"
              >
                ✕ ล้างทั้งหมด
              </button>
            )}
          </label>
          <Select
            options={CHEVRON_OPTIONS}
            value={pick(CHEVRON_OPTIONS, chevronFilter)}
            onChange={(o) => setChevronFilter(o ? o.value : "")}
            placeholder="All"
            isClearable
            isSearchable={false}
            styles={FILTER_SELECT_STYLES}
            {...FILTER_MENU_PORTAL}
          />
        </div>
      </div>

      {listMsg && (
        <div className="pt-3">
          <MessageBanner msg={listMsg} />
        </div>
      )}

      {/* ════════ List ════════ */}
      <div className="border-b border-gray-200">
        {loadingList ? (
          <div className="p-10 text-center text-gray-500">Loading...</div>
        ) : shownTrainings.length === 0 ? (
          <div className="p-10 text-center text-[13px] text-gray-500">
            {hasFilter ? "ไม่พบ training ตามเงื่อนไขที่เลือก" : "ไม่พบ training"}
          </div>
        ) : (
          <>
            {/* ── ต่ำกว่า lg: รายการคั่นเส้น ── */}
            <div className="divide-y divide-gray-100 lg:hidden">
              {shownTrainings.map((t) => (
                <div key={t.id} className="py-3 text-[13px]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="break-words font-semibold">{t.name}</div>
                      {t.fullName && t.fullName !== t.name && (
                        <div className="text-[11px] text-gray-500">
                          {t.fullName}
                        </div>
                      )}
                    </div>
                    {renderActions(t)}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                    <SetBadge isSet={(t._count?.trainingStandards ?? 0) > 0} />
                    <span>{t.standard?.sourceName || "—"}</span>
                    <span>
                      Validity: <ValidityCell standard={t.standard} />
                    </span>
                    {t.standard?.trainingHours != null && (
                      <span>{t.standard.trainingHours} ชม.</span>
                    )}
                    <span>
                      Cert:{" "}
                      <EmpCount
                        count={t._count?.employeeTrainings ?? 0}
                        onClick={() => setCertsTraining(t)}
                        inline
                      />
                    </span>
                    {visibleClients.map((c) => (
                      <span key={c.id}>
                        {c.name}:{" "}
                        <ClientUsageCell
                          usage={t.clientUsage?.find((u) => u.name === c.name)}
                        />
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* ── lg+: ตาราง ── */}
            <div className="hidden max-h-[calc(100vh-290px)] overflow-auto lg:block">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className={`${TH} min-w-[280px] text-left`}>
                      GLOBAL TRAINING (ชื่อกลาง)
                    </th>
                    <th className={`${TH} whitespace-nowrap text-left`}>
                      SOURCE
                    </th>
                    <th className={`${TH} whitespace-nowrap text-center`}>
                      TRAINING HOURS
                    </th>
                    <th className={`${TH} whitespace-nowrap text-center`}>
                      VALIDITY (ปี)
                    </th>
                    <th
                      className={`${TH} w-[90px] whitespace-nowrap text-center`}
                    >
                      SET UP?
                    </th>
                    <th
                      className={`${TH} max-w-[90px] text-center leading-snug`}
                      title="จำนวนพนักงานที่มี certificate/training นี้อยู่ในระบบ (isLatest เท่านั้น) — เช็คก่อนลบหรือย้าย training"
                    >
                      พนักงานที่มี CERT
                      <br />
                      (คน)
                    </th>
                    {visibleClients.map((c) => (
                      <th
                        key={c.id}
                        className={`${TH} whitespace-nowrap px-2 text-center text-[10px] leading-snug`}
                      >
                        {c.name.toUpperCase()}
                        <br />
                        <span className="text-[9px] font-bold">(ตำแหน่ง)</span>
                      </th>
                    ))}
                    <th
                      className={`${TH} w-[140px] whitespace-nowrap text-right`}
                    >
                      ACTIONS
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shownTrainings.map((t) => (
                    <tr
                      key={t.id}
                      className={`border-b border-gray-100 hover:bg-gray-50 ${
                        selectedId === t.id ? "bg-[#fcfdff]" : ""
                      }`}
                    >
                      <td className="px-4 py-2">
                        <div className="font-semibold">{t.name}</div>
                        {t.fullName && t.fullName !== t.name && (
                          <div className="text-[11px] text-gray-500">
                            {t.fullName}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2">
                        {t.standard ? t.standard.sourceName : DASH}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {t.standard?.trainingHours ?? DASH}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <ValidityCell standard={t.standard} />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <SetBadge
                          isSet={(t._count?.trainingStandards ?? 0) > 0}
                        />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <EmpCount
                        count={t._count?.employeeTrainings ?? 0}
                        onClick={() => setCertsTraining(t)}
                      />
                      </td>
                      {visibleClients.map((c) => (
                        <td key={c.id} className="px-2 py-2 text-center">
                          <ClientUsageCell
                            usage={t.clientUsage?.find(
                              (u) => u.name === c.name,
                            )}
                          />
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right">
                        {renderActions(t)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ════════ Edit / View Panel ════════ */}
      {panelOpen && (
        <div
          // view mode: คลิกพื้นหลังปิดได้ / edit mode: ไม่ปิด กันข้อมูลที่พิมพ์หาย
          onClick={() => !isEditing && closePanel()}
          className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/50 p-3 sm:p-5"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[90vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[10px] bg-white"
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between gap-3 bg-[#1e3a5f] px-4 py-4 text-white sm:px-6">
              <span className="text-base font-semibold">
                🎓{" "}
                {selectedId === "new"
                  ? "Add Training"
                  : isEditing
                    ? "Edit Training"
                    : "View Training"}
              </span>
              <div className="flex items-center gap-3.5">
                {!isEditing && selectedId !== "new" && (
                  <button
                    onClick={() => {
                      setMode("edit");
                      setDetailMsg(null);
                    }}
                    className="cursor-pointer rounded-md border border-white/30 bg-white/15 px-3 py-[5px] text-xs font-semibold text-white hover:bg-white/25"
                  >
                    ✏️ Edit
                  </button>
                )}
                <button
                  onClick={closePanel}
                  className="cursor-pointer border-none bg-transparent text-xl leading-none text-white"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="overflow-y-auto p-4 sm:p-6">
              <MessageBanner msg={detailMsg} />

              {loadingDetail ? (
                <div className="p-5 text-center text-gray-500">Loading...</div>
              ) : (
                <>
                  {/* --- GlobalTraining --- */}
                  <div className="mb-3.5">
                    <label className={LABEL}>
                      GLOBAL TRAINING (ชื่อกลาง) *
                    </label>
                    <input
                      className={INPUT}
                      value={form.name}
                      disabled={!isEditing}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, name: e.target.value }))
                      }
                      placeholder="เช่น Basic Rigging"
                    />
                  </div>
                  <div className="mb-3.5">
                    <label className={LABEL}>
                      ชื่อที่ HR ใช้ในไฟล์ (ถ้าต่างจากชื่อกลาง)
                    </label>
                    <input
                      className={INPUT}
                      value={form.fullName}
                      disabled={!isEditing}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, fullName: e.target.value }))
                      }
                      placeholder="เช่น ชื่อที่เขียนใน Excel ของ Chevron/Erawan"
                    />
                  </div>
                  <div className="mb-[18px]">
                    <label className={LABEL}>DESCRIPTION</label>
                    <textarea
                      className={`${INPUT} min-h-[60px] resize-y`}
                      value={form.description}
                      disabled={!isEditing}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, description: e.target.value }))
                      }
                    />
                  </div>

                  {/* --- Standard --- */}
                  <div className="mb-5 border-t border-gray-100 pt-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <span className="text-[13px] font-bold">
                        Training Standard
                      </span>
                      {isEditing && form.standardId && (
                        <button
                          className={`${BTN_DANGER} px-2.5 py-1`}
                          onClick={handleDeleteStandard}
                        >
                          Remove Standard
                        </button>
                      )}
                    </div>

                    <div className="mb-2">
                      <div className="mb-1.5 flex items-center justify-between">
                        <label className={`${LABEL} mb-0`}>SOURCE</label>
                        {isEditing && (
                          <button
                            type="button"
                            onClick={() => setShowSourceManager((v) => !v)}
                            className="cursor-pointer border-none bg-transparent p-0 text-[11px] font-semibold text-blue-600 hover:underline"
                          >
                            {showSourceManager ? "✕ ปิด" : "⚙ Manage sources"}
                          </button>
                        )}
                      </div>
                      <select
                        className={INPUT}
                        value={form.sourceId}
                        disabled={!isEditing}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            sourceId: e.target.value,
                            clientId: "",
                          }))
                        }
                      >
                        <option value="">— เลือก source —</option>
                        {sources.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Source manager — เพิ่ม/ลบ source ได้เอง */}
                    {isEditing && showSourceManager && (
                      <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <MessageBanner msg={sourceMsg} />

                        {sources.length > 0 && (
                          <div className="mb-2.5 max-h-[140px] overflow-y-auto">
                            {sources.map((s) => (
                              <div
                                key={s.id}
                                className="flex items-center justify-between gap-2 border-b border-gray-100 px-2 py-[5px] text-xs"
                              >
                                <span className="min-w-0">
                                  {s.name}
                                  {s.requiresClient && (
                                    <span className="ml-1.5 text-[10px] text-gray-500">
                                      (ต้องเลือก client)
                                    </span>
                                  )}
                                  {s._count?.trainingStandards > 0 && (
                                    <span className="ml-1.5 text-[10px] text-gray-400">
                                      — ใช้อยู่ {s._count.trainingStandards}{" "}
                                      training
                                    </span>
                                  )}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDeleteSource(s.id, s.name)
                                  }
                                  title="ลบ source นี้"
                                  className="shrink-0 cursor-pointer border-none bg-transparent px-1.5 py-0.5 text-xs text-[#dc3545]"
                                >
                                  🗑
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            placeholder="ชื่อ source ใหม่ เช่น Safety"
                            value={newSourceName}
                            onChange={(e) => setNewSourceName(e.target.value)}
                            onKeyDown={(e) =>
                              e.key === "Enter" && handleAddSource()
                            }
                            className={`${INPUT} min-w-[160px] flex-1`}
                          />
                          <label
                            className="flex cursor-pointer items-center gap-1 whitespace-nowrap text-[11px] text-gray-700"
                            title="ติ๊กถ้า source นี้ต้องผูกกับ client เฉพาะเจาะจง (เช่น standard ภายในของ client ใดๆ)"
                          >
                            <input
                              type="checkbox"
                              checked={newSourceRequiresClient}
                              onChange={(e) =>
                                setNewSourceRequiresClient(e.target.checked)
                              }
                            />
                            ผูก client
                          </label>
                          <button
                            type="button"
                            onClick={handleAddSource}
                            disabled={savingSource || !newSourceName.trim()}
                            className={`${BTN_PRIMARY} px-3.5 py-2`}
                          >
                            + Add
                          </button>
                        </div>
                      </div>
                    )}

                    {selectedSource?.requiresClient && (
                      <div className="mb-3">
                        <label className={LABEL}>CLIENT *</label>
                        <select
                          className={INPUT}
                          value={form.clientId}
                          disabled={!isEditing}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, clientId: e.target.value }))
                          }
                        >
                          <option value="">— เลือก client —</option>
                          {clients.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className={LABEL}>TRAINING HOURS</label>
                        <input
                          type="number"
                          min="0"
                          className={INPUT}
                          value={form.trainingHours}
                          disabled={!isEditing}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              trainingHours: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div>
                        <label className={LABEL}>VALIDITY (YEARS)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          disabled={!isEditing || form.isNoExpiry}
                          className={INPUT}
                          value={form.validityYears}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              validityYears: e.target.value,
                            }))
                          }
                          placeholder="เช่น 3 หรือ 0.5 (=6 เดือน)"
                        />
                      </div>
                    </div>

                    <label
                      className={`flex items-center gap-2 text-xs text-gray-700 ${
                        isEditing ? "cursor-pointer" : "cursor-default"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={form.isNoExpiry}
                        disabled={!isEditing}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            isNoExpiry: e.target.checked,
                            validityYears: e.target.checked
                              ? ""
                              : f.validityYears,
                          }))
                        }
                      />
                      No expiry (cert ไม่มีวันหมดอายุ)
                    </label>
                  </div>

                  {/* --- Client usage --- */}
                  <div className="mb-5 border-t border-gray-100 pt-4">
                    <span className="mb-1.5 block text-[13px] font-bold">
                      ใช้กับ Client ไหนบ้าง
                    </span>
                    {!form.standardId && (
                      <div className="mb-2.5 text-[11px] text-[#dc3545]">
                        บันทึก Training Standard ก่อน ถึงจะเลือก client ได้
                      </div>
                    )}
                    <div className="flex flex-wrap gap-3.5">
                      {clients.map((c) => {
                        const hasContract = !!c.contracts?.[0];
                        const disabled =
                          !isEditing ||
                          !form.standardId ||
                          !hasContract ||
                          linkingClientId === c.id;
                        return (
                          <label
                            key={c.id}
                            title={
                              !hasContract
                                ? `${c.name} ยังไม่มี active contract`
                                : undefined
                            }
                            className={`flex items-center gap-1.5 text-[13px] ${
                              hasContract ? "text-gray-900" : "text-gray-400"
                            } ${disabled ? "cursor-default" : "cursor-pointer"}`}
                          >
                            <input
                              type="checkbox"
                              checked={!!clientLinks[c.id]}
                              disabled={disabled}
                              onChange={() => toggleClientLink(c)}
                            />
                            {c.name}
                            {linkingClientId === c.id && " …"}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* --- Actions (edit mode) --- */}
                  {isEditing && (
                    <div className="flex flex-wrap justify-between gap-2">
                      <div className="flex gap-2">
                        <button
                          className={BTN_PRIMARY}
                          onClick={handleSave}
                          disabled={saving}
                        >
                          {saving ? "Saving..." : "Save"}
                        </button>
                        <button
                          onClick={() =>
                            selectedId === "new"
                              ? closePanel()
                              : openTraining(form.id, "view")
                          }
                          disabled={saving}
                          className="cursor-pointer rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                      </div>
                      {selectedId !== "new" && (
                        <button
                          className={BTN_DANGER}
                          onClick={panelDeleteTraining}
                          disabled={deletingId === form.id}
                        >
                          {deletingId === form.id
                            ? "Deleting…"
                            : "Delete Training"}
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ════════ ตรวจชื่อ cert ════════ */}
      {certsTraining && (
        <CertsModal
          backendUrl={backendUrl}
          training={certsTraining}
          onClose={() => setCertsTraining(null)}
          onEditTraining={() => {
            const id = certsTraining.id;
            setCertsTraining(null);
            openTraining(id, "edit");
          }}
          onChanged={loadTrainings}
        />
      )}
    </div>
  );
}
