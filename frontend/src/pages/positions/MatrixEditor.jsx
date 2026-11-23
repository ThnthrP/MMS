import { useState, useEffect, useContext, useCallback } from "react";
import axios from "axios";
import { AppContent } from "../../context/AppContext";
import ClientFilter from "../../components/ClientFilter";
import { contractClientName } from "../../utils/clientMode";

// ══════════════════════════════════════════════════════════
// constants
// ══════════════════════════════════════════════════════════
// ระดับ requirement ที่ Chevron ใช้จริง (ยืนยัน valid จาก import)
const REQ_LEVELS = [
  { value: "", label: "— not required", cls: "bg-gray-50 text-gray-400" },
  {
    value: "mandatory",
    label: "Mandatory (X)",
    cls: "bg-[#fff5f5] text-[#dc3545]",
  },
  {
    value: "assigned",
    label: "Assigned (O)",
    cls: "bg-[#fff8f0] text-[#fd7e14]",
  },
];

// รวม "required" เข้ากับ "mandatory" เฉพาะตอนแสดงผล —
// ค่าจริงยังเป็น "required" จนกว่าผู้ใช้จะแก้ dropdown เอง
const displayValue = (v) => (v === "required" ? "mandatory" : v || "");

const LS_CONTRACT = "matrixEditor.contractId";
const LS_POSITION = "matrixEditor.positionId";

const LABEL = "mb-1.5 block text-xs font-semibold text-gray-500";
const INPUT =
  "box-border w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] outline-none focus:border-blue-400 disabled:cursor-not-allowed disabled:bg-gray-50";
const BTN_PRIMARY =
  "cursor-pointer rounded-lg border-none bg-[#2B2F78] px-[18px] py-[9px] text-[13px] font-semibold text-white hover:bg-[#22265f] disabled:cursor-not-allowed disabled:opacity-60";
const BTN_GHOST =
  "cursor-pointer rounded-lg border border-gray-200 bg-white px-[18px] py-[9px] text-[13px] font-semibold text-gray-700 hover:bg-gray-50";

const readLS = (key) => {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
};
const writeLS = (key, value) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // localStorage อาจไม่พร้อมใช้งาน — ไม่ critical
  }
};

// ══════════════════════════════════════════════════════════
// small components
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

function Placeholder({ children }) {
  return (
    <div className="border-b border-gray-200 p-8 text-center text-sm text-gray-500 sm:p-12">
      {children}
    </div>
  );
}

function RequirementSelect({ value, onChange }) {
  const shown = displayValue(value);
  const level = REQ_LEVELS.find((l) => l.value === shown) || REQ_LEVELS[0];
  return (
    <select
      value={shown}
      onChange={(e) => onChange(e.target.value)}
      className={`cursor-pointer rounded-md border-none px-2.5 py-[5px] text-xs font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.06)] outline-none ${level.cls}`}
    >
      {REQ_LEVELS.map((l) => (
        <option key={l.value} value={l.value}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

// ══════════════════════════════════════════════════════════
// Link Training Modal — ค้นหา global training ที่ยังไม่ผูกกับ contract
// แล้วเลือก standard เพื่อสร้าง ClientTraining
// ══════════════════════════════════════════════════════════
function LinkTrainingModal({ backendUrl, contractId, onClose, onLinked }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [standardId, setStandardId] = useState("");
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState(null);

  // ค้นหาแบบ debounce — ครั้งแรกก็ผ่านทางนี้ (เดิมมี useEffect โหลดครั้งแรกแยกอีกตัว → ยิงซ้ำ 2 ครั้ง)
  useEffect(() => {
    let ignore = false;
    const t = setTimeout(async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await axios.get(
          `${backendUrl}/api/contracts/${contractId}/available-trainings`,
          {
            params: { search: search.trim() || undefined },
            withCredentials: true,
          },
        );
        if (!ignore) setResults(res.data || []);
      } catch (err) {
        console.error(err);
        if (!ignore) setError("โหลดรายการ training ไม่สำเร็จ");
      } finally {
        if (!ignore) setLoading(false);
      }
    }, 300);
    return () => {
      ignore = true;
      clearTimeout(t);
    };
  }, [backendUrl, contractId, search]);

  // Esc ปิด
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !linking && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [linking, onClose]);

  const selectTraining = (training) => {
    setSelected(training);
    setError(null);
    // มี standard เดียว เลือกให้อัตโนมัติ
    setStandardId(
      training.trainingStandards.length === 1
        ? training.trainingStandards[0].id
        : "",
    );
  };

  const handleLink = async () => {
    if (!selected || !standardId) {
      setError("กรุณาเลือก training และ standard ให้ครบ");
      return;
    }
    try {
      setLinking(true);
      setError(null);
      await axios.post(
        `${backendUrl}/api/contracts/${contractId}/client-trainings`,
        { globalTrainingId: selected.id, trainingStandardId: standardId },
        { withCredentials: true },
      );
      onLinked(selected.name);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || "Link ไม่สำเร็จ");
    } finally {
      setLinking(false);
    }
  };

  return (
    <div
      onClick={() => !linking && onClose()}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/35 p-3 sm:p-5"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl bg-white"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4">
          <span className="text-[15px] font-bold">
            Link Training เข้า Contract
          </span>
          <button
            onClick={onClose}
            className="cursor-pointer border-none bg-transparent text-base text-gray-500"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-3 rounded-lg border border-[#f5c6cb] bg-[#f8d7da] px-3 py-2 text-xs text-[#842029]">
              ⚠ {error}
            </div>
          )}

          <input
            type="text"
            autoFocus
            placeholder="ค้นหา global training ที่ยังไม่ผูกกับ contract นี้..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${INPUT} mb-3`}
          />

          <div className="mb-4 max-h-[240px] overflow-y-auto rounded-lg border border-gray-100">
            {loading ? (
              <div className="p-5 text-center text-[13px] text-gray-500">
                Loading...
              </div>
            ) : results.length === 0 ? (
              <div className="p-5 text-center text-[13px] text-gray-500">
                ไม่พบ training ที่ยังไม่ผูก (หรือ training นี้ยังไม่มี standard
                — ไปสร้างที่ Manage Trainings ก่อน)
              </div>
            ) : (
              results.map((t) => (
                <div
                  key={t.id}
                  onClick={() => selectTraining(t)}
                  className={`cursor-pointer border-b border-gray-50 px-3.5 py-2.5 ${
                    selected?.id === t.id
                      ? "bg-[#e7f1ff]"
                      : "bg-white hover:bg-gray-50"
                  }`}
                >
                  <div className="text-[13px] font-semibold">{t.name}</div>
                  {t.fullName && t.fullName !== t.name && (
                    <div className="text-[11px] text-gray-400">
                      {t.fullName}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {selected && (
            <div>
              <label className={LABEL}>STANDARD (SOURCE)</label>
              {selected.trainingStandards.length === 0 ? (
                <div className="py-2 text-xs text-[#dc3545]">
                  training นี้ยังไม่มี standard — ไปสร้างที่ Manage Trainings
                  ก่อน
                </div>
              ) : (
                <select
                  value={standardId}
                  onChange={(e) => setStandardId(e.target.value)}
                  className={INPUT}
                >
                  <option value="">— เลือก standard —</option>
                  {selected.trainingStandards.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.source?.name}
                      {s.client?.name ? ` · ${s.client.name}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 flex-col-reverse gap-2.5 border-t border-gray-100 px-5 py-3.5 sm:flex-row sm:justify-end">
          <button onClick={onClose} className={BTN_GHOST}>
            ยกเลิก
          </button>
          <button
            onClick={handleLink}
            disabled={!selected || !standardId || linking}
            className={BTN_PRIMARY}
          >
            {linking ? "Linking..." : "Link Training"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// main
// ══════════════════════════════════════════════════════════
// โหมด multi: ลูกค้า (ค่าเดียวกับ Navbar) อยู่หน้าสุด → CONTRACT แสดงเฉพาะของลูกค้านั้น
//   เปลี่ยนลูกค้าตอนยังไม่ Save → ไม่เปลี่ยน contract ให้ (กันงานหาย) แต่ขึ้นข้อความเตือน
export default function MatrixEditor() {
  const { backendUrl, clients, selectedClient, clientMatches } =
    useContext(AppContent);

  const [contracts, setContracts] = useState([]);
  const [positions, setPositions] = useState([]);
  const [contractId, setContractId] = useState(() => readLS(LS_CONTRACT));
  const [positionId, setPositionId] = useState(() => readLS(LS_POSITION));

  const [items, setItems] = useState([]); // [{ clientTrainingId, name, alias, requirementType }]
  const [meta, setMeta] = useState(null); // { contract, position }
  const [search, setSearch] = useState("");
  const [onlyRequired, setOnlyRequired] = useState(false);
  const [dirty, setDirty] = useState(false); // มีการแก้ที่ยังไม่ได้ Save

  const [loadingLists, setLoadingLists] = useState(true);
  const [loadingMatrix, setLoadingMatrix] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { type: "ok"|"err", text }

  const [showLinkModal, setShowLinkModal] = useState(false);
  const [positionCounts, setPositionCounts] = useState({}); // { [positionId]: count }

  const contractClient = (c) => contractClientName(c, clients);
  const shownContracts = contracts.filter(
    (c) => !selectedClient || clientMatches(contractClient(c)),
  );

  // contract ที่เปิดอยู่ไม่ใช่ของลูกค้าที่เลือก → เปลี่ยนเป็น contract แรกของลูกค้านั้น
  useEffect(() => {
    if (loadingLists || !contracts.length) return;
    if (shownContracts.some((c) => c.id === contractId)) return;
    if (dirty) {
      setMsg({
        type: "err",
        text: `กำลังแก้ matrix ของ contract อื่นอยู่ — กด Save Matrix ก่อน แล้วค่อยเลือก contract ของ ${selectedClient?.name ?? "ลูกค้าที่เลือก"}`,
      });
      return;
    }
    setContractId(shownContracts[0]?.id || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingLists, contracts, selectedClient, clients]);

  useEffect(() => writeLS(LS_CONTRACT, contractId), [contractId]);
  useEffect(() => writeLS(LS_POSITION, positionId), [positionId]);

  // เตือนก่อนปิดแท็บ/รีเฟรช ถ้ายังไม่ได้ Save
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // โหลด contracts + positions
  useEffect(() => {
    (async () => {
      try {
        setLoadingLists(true);
        const [cRes, pRes] = await Promise.all([
          axios.get(`${backendUrl}/api/training-matrix/contracts`, {
            withCredentials: true,
          }),
          axios.get(`${backendUrl}/api/positions`, { withCredentials: true }),
        ]);
        const contractList = cRes.data || [];
        const positionList = pRes.data || [];
        setContracts(contractList);
        setPositions(positionList);

        // contract เดียว → เลือกให้เลย (ไม่ทับค่าที่ restore มา)
        if (!contractId && contractList.length === 1) {
          setContractId(contractList[0].id);
        }
        // ค่าที่ restore มาแต่ไม่มีใน list แล้ว (ถูกลบ) → เคลียร์
        if (contractId && !contractList.some((c) => c.id === contractId)) {
          setContractId("");
        }
        if (positionId && !positionList.some((p) => p.id === positionId)) {
          setPositionId("");
        }
      } catch (err) {
        console.error(err);
        setMsg({ type: "err", text: "โหลด contract/position ไม่สำเร็จ" });
      } finally {
        setLoadingLists(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl]);

  const loadPositionCounts = useCallback(async () => {
    if (!contractId) {
      setPositionCounts({});
      return;
    }
    try {
      const res = await axios.get(
        `${backendUrl}/api/training-matrix/contracts/${contractId}/position-counts`,
        { withCredentials: true },
      );
      setPositionCounts(res.data || {});
    } catch (err) {
      console.error(err);
      setPositionCounts({});
    }
  }, [backendUrl, contractId]);

  useEffect(() => {
    loadPositionCounts();
  }, [loadPositionCounts]);

  const loadMatrix = useCallback(async () => {
    if (!contractId || !positionId) {
      setItems([]);
      setMeta(null);
      return;
    }
    try {
      setLoadingMatrix(true);
      setMsg(null);
      const res = await axios.get(
        `${backendUrl}/api/positions/${positionId}/matrix`,
        {
          params: { contractId },
          withCredentials: true,
        },
      );
      setItems(res.data.items || []);
      setMeta({ contract: res.data.contract, position: res.data.position });
      setDirty(false);
    } catch (err) {
      console.error(err);
      setMsg({ type: "err", text: "โหลด matrix ไม่สำเร็จ" });
      setItems([]);
    } finally {
      setLoadingMatrix(false);
    }
  }, [backendUrl, contractId, positionId]);

  useEffect(() => {
    loadMatrix();
  }, [loadMatrix]);

  // เปลี่ยน contract/position ตอนยังไม่ Save → ถามก่อน
  const confirmDiscard = () =>
    !dirty ||
    window.confirm(
      "มีการแก้ไข matrix ที่ยังไม่ได้ Save — ทิ้งการแก้ไขและเปลี่ยนหน้า?",
    );

  const changeContract = (id) => {
    if (!confirmDiscard()) return;
    setContractId(id);
  };
  const changePosition = (id) => {
    if (!confirmDiscard()) return;
    setPositionId(id);
  };

  const setLevel = (clientTrainingId, value) => {
    setItems((prev) =>
      prev.map((it) =>
        it.clientTrainingId === clientTrainingId
          ? { ...it, requirementType: value || null }
          : it,
      ),
    );
    setDirty(true);
    setMsg(null);
  };

  const requiredCount = items.filter((it) => it.requirementType).length;

  const handleSave = async () => {
    try {
      setSaving(true);
      setMsg(null);
      const res = await axios.put(
        `${backendUrl}/api/positions/${positionId}/matrix`,
        {
          contractId,
          items: items
            .filter((it) => it.requirementType)
            .map((it) => ({
              clientTrainingId: it.clientTrainingId,
              requirementType: it.requirementType,
            })),
        },
        { withCredentials: true },
      );
      setDirty(false);
      setMsg({
        type: "ok",
        text: `บันทึกแล้ว — ${res.data.count} training สำหรับตำแหน่งนี้`,
      });
      loadPositionCounts(); // อัปเดตตัวเลข (N) ใน dropdown Position
    } catch (err) {
      setMsg({
        type: "err",
        text: err.response?.data?.message || "บันทึก matrix ไม่สำเร็จ",
      });
    } finally {
      setSaving(false);
    }
  };

  // หลัง link สำเร็จ — reload matrix แล้วค่อยตั้งข้อความ
  // (loadMatrix ล้างข้อความก่อนโหลด — เดิมตั้งข้อความก่อน เลยไม่เคยโชว์)
  const handleLinked = async (trainingName) => {
    setShowLinkModal(false);
    if (dirty) {
      // มีของค้างยังไม่ Save — ไม่ reload ทับ แค่แจ้ง
      setMsg({
        type: "ok",
        text: `Link "${trainingName}" สำเร็จ — กด Save Matrix ก่อน แล้วเลือก position ใหม่เพื่อให้ training ที่เพิ่งผูกโผล่ในลิสต์`,
      });
      return;
    }
    await loadMatrix();
    setMsg({ type: "ok", text: `Link "${trainingName}" สำเร็จ` });
  };

  const q = search.trim().toLowerCase();
  const filtered = items.filter(
    (it) =>
      (!onlyRequired || it.requirementType) &&
      (!q ||
        it.name.toLowerCase().includes(q) ||
        (it.alias || "").toLowerCase().includes(q)),
  );

  const selectedContract = contracts.find((c) => c.id === contractId);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1800px]">
      {/* ════════ Header ════════ */}
      <div className="pb-3 text-xs text-gray-500">
        กำหนด training ที่ตำแหน่งต้องมี ต่อ contract (M/X/O) — มีผลกับ
        eligibility &amp; gap analysis
      </div>

      {/* ════════ Selectors + Link Training — แถวเดียว คั่นด้วยเส้น ════════
          การ link training เข้า contract ใช้แค่ contractId
          จึงโชว์ปุ่มทันทีที่เลือก contract (ไม่ต้องเลือก position ก่อน) */}
      <div className="mb-4 flex flex-col gap-3 border-y border-gray-200 py-3 md:flex-row md:items-end">
        {/* โหมด multi เท่านั้น — ค่าเดียวกับตัวเลือกบน Navbar */}
        <ClientFilter className="md:w-[160px] md:shrink-0" />
        <div className="min-w-0 md:flex-1">
          <label className={LABEL}>CONTRACT</label>
          <select
            value={contractId}
            onChange={(e) => changeContract(e.target.value)}
            disabled={loadingLists}
            className={INPUT}
          >
            <option value="">
              {selectedClient && shownContracts.length === 0
                ? `— ${selectedClient.name} ยังไม่มี contract —`
                : "— เลือก contract —"}
            </option>
            {shownContracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.contractNo})
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 md:flex-1">
          <label className={LABEL}>POSITION</label>
          <select
            value={positionId}
            onChange={(e) => changePosition(e.target.value)}
            disabled={loadingLists || !contractId}
            className={INPUT}
          >
            <option value="">— เลือก position —</option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({positionCounts[p.id] ?? 0})
              </option>
            ))}
          </select>
        </div>
        {contractId && (
          <button
            onClick={() => setShowLinkModal(true)}
            title={`Link training เข้า ${
              selectedContract?.clientName || selectedContract?.name || "contract"
            } — ไม่ต้องเลือก position ก่อน`}
            className="h-[38px] cursor-pointer whitespace-nowrap rounded-lg border-none bg-[#e7f1ff] px-3.5 text-[13px] font-semibold text-blue-600 hover:bg-[#d6e8ff]"
          >
            + Link Training
          </button>
        )}
      </div>

      <MessageBanner msg={msg} />

      {/* ════════ Body — matrix ต่อ position ════════ */}
      {!contractId ? (
        <Placeholder>
          เลือก <strong>Contract</strong> เพื่อเริ่มต้น
        </Placeholder>
      ) : !positionId ? (
        <Placeholder>
          เลือก <strong>Position</strong> เพิ่มเติม เพื่อดู/แก้ระดับ requirement
          (M/O) ของแต่ละตำแหน่ง
        </Placeholder>
      ) : loadingMatrix ? (
        <Placeholder>Loading matrix...</Placeholder>
      ) : (
        <div>
          {/* Toolbar */}
          <div className="flex flex-col gap-3 border-b border-gray-200 pb-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-gray-700">
              <strong className="text-[15px]">{meta?.position?.name}</strong>
              {meta?.contract && (
                <span className="text-gray-500">
                  · {meta.contract.clientName || meta.contract.name} (
                  {meta.contract.contractNo})
                </span>
              )}
              <span className="rounded-md bg-[#e7f1ff] px-2.5 py-0.5 text-xs font-semibold text-[#084298]">
                {requiredCount} required
              </span>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {/* สลับดูเฉพาะที่ required — มี 85 training ไล่หายาก */}
              <div className="flex shrink-0 overflow-hidden rounded-lg border border-gray-200 text-xs font-semibold">
                {[
                  [false, `ทั้งหมด (${items.length})`],
                  [true, `เฉพาะ required (${requiredCount})`],
                ].map(([val, label]) => (
                  <button
                    key={String(val)}
                    onClick={() => setOnlyRequired(val)}
                    className={`flex-1 cursor-pointer whitespace-nowrap border-none px-3 py-[7px] ${
                      onlyRequired === val
                        ? "bg-[#2B2F78] text-white"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                placeholder="🔍 ค้นหา training..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`${INPUT} sm:w-[220px]`}
              />
            </div>
          </div>

          {items.length === 0 ? (
            <div className="p-10 text-center text-[13px] text-gray-500">
              contract นี้ยังไม่มี training ที่ link ไว้ — กด{" "}
              <strong>+ Link Training</strong> ด้านบนเพื่อเพิ่ม
            </div>
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-2 py-2.5 text-left text-[11px] font-semibold text-gray-500">
                    TRAINING
                  </th>
                  <th className="w-[150px] px-2 py-2.5 text-right text-[11px] font-semibold text-gray-500 sm:w-[200px]">
                    REQUIREMENT
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="p-6 text-center text-gray-500">
                      {q
                        ? `ไม่พบ training ที่ตรงกับ "${search}"`
                        : "ยังไม่มี training ที่ตั้งเป็น required"}
                    </td>
                  </tr>
                ) : (
                  filtered.map((it) => {
                    const active = !!it.requirementType;
                    return (
                      <tr
                        key={it.clientTrainingId}
                        className={`border-b border-gray-100 ${
                          active ? "bg-[#fcfdff]" : "bg-white"
                        } hover:bg-gray-50`}
                      >
                        <td className="px-2 py-2">
                          <span className={active ? "font-semibold" : ""}>
                            {it.name}
                          </span>
                          {it.alias && it.alias !== it.name && (
                            <span className="block text-[11px] text-gray-400 sm:ml-2 sm:inline">
                              ({it.alias})
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <RequirementSelect
                            value={it.requirementType}
                            onChange={(v) => setLevel(it.clientTrainingId, v)}
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}

          {/* Footer — ติดขอบล่างจอ ไม่ต้องเลื่อนลงไปหาปุ่ม Save ท้าย 85 แถว */}
          <div
            className={`sticky bottom-0 z-[1] flex flex-col gap-2 border-t px-2 py-3 sm:flex-row sm:items-center sm:justify-end sm:gap-3 ${
              dirty
                ? "border-[#ffe69c] bg-[#fffbea]"
                : "border-gray-200 bg-white"
            }`}
          >
            <span className="text-xs text-gray-500">
              {dirty && (
                <strong className="mr-2 text-[#664d03]">
                  ● ยังไม่ได้บันทึก
                </strong>
              )}
              ติ๊ก {requiredCount} จาก {items.length} training
            </span>
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              className={BTN_PRIMARY}
            >
              {saving ? "Saving..." : dirty ? "Save Matrix" : "✓ Saved"}
            </button>
          </div>
        </div>
      )}

      {showLinkModal && contractId && (
        <LinkTrainingModal
          backendUrl={backendUrl}
          contractId={contractId}
          onClose={() => setShowLinkModal(false)}
          onLinked={handleLinked}
        />
      )}
    </div>
  );
}
