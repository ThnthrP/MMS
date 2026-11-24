import { useState, useContext, useRef, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { AppContent } from "../../context/AppContext";

// ══════════════════════════════════════════════════════════
// Data Import — นำเข้า Training / Medical / Passport จาก Excel ของ HR (admin only)
// ขั้นตอน: เลือกไฟล์ → ตรวจสอบ (preview, ยังไม่บันทึก) → ยืนยันนำเข้า
// ══════════════════════════════════════════════════════════

const TH =
  "whitespace-nowrap border-b border-gray-200 bg-gray-50 px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.3px] text-gray-500";
const TD = "border-b border-gray-100 px-3 py-2 align-top text-[13px]";
const LABEL =
  "mb-1 block text-xs font-semibold uppercase tracking-[0.4px] text-gray-500";
const BTN =
  "cursor-pointer whitespace-nowrap rounded-lg px-4 py-2 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50";

function Stat({ label, value, tone = "text-gray-800" }) {
  return (
    <div className="bg-white px-3 py-2.5">
      <div className="text-[11px] font-semibold text-gray-500">{label}</div>
      <div className={`text-[18px] font-bold ${tone}`}>{value}</div>
    </div>
  );
}

function Section({ title, count, tone = "text-gray-700", children }) {
  const [open, setOpen] = useState(false);
  if (!count) return null;
  return (
    <div className="border-b border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center justify-between border-none bg-transparent px-1 py-2.5 text-left hover:bg-gray-50"
      >
        <span className={`text-[13px] font-bold ${tone}`}>
          {title} <span className="font-semibold text-gray-400">({count})</span>
        </span>
        <span className="text-[12px] text-gray-400">{open ? "▲ ซ่อน" : "▼ ดู"}</span>
      </button>
      {open && <div className="mb-3 max-h-[420px] overflow-auto border-y border-gray-100">{children}</div>}
    </div>
  );
}

// ── ชนิดไฟล์ที่นำเข้าได้ ──
const KINDS = {
  training: {
    label: "🎓 Training Record",
    fileLabel: "ไฟล์ Employee Training (.xlsx) — sheet \"Record\"",
    endpoint: "employee-trainings",
    hints: [
      "จับคู่พนักงานด้วย Employee ID ก่อน ไม่เจอจึงใช้ชื่อไทย/อังกฤษ · ไฟล์ที่ไม่มีคอลัมน์ ID Employee (เช่น Assistant Floor Operators) ใช้ชื่ออย่างเดียว",
      "วันที่เหมือนเดิม → ข้าม, ช่องว่าง / N/A / Pending → ไม่ลบข้อมูลเดิม, ในระบบมีวันที่ใหม่กว่าไฟล์ → ไม่ทับ",
      "ชื่อ training ในไฟล์สะกดต่างจากในระบบ → ใส่ใน “ชื่อที่ HR ใช้ในไฟล์” ได้หลายชื่อ คั่นด้วย |",
    ],
  },
  pe: {
    label: "🏥 PE Tracking (ผลตรวจสุขภาพ)",
    fileLabel: "ไฟล์ PE tracking (.xlsx) — sheet แรกที่มีหัว \"วันที่ตรวจร่างกาย\"",
    endpoint: "pe-tracking",
    hints: [
      "จับคู่พนักงานด้วยชื่อไทย ไม่เจอจึงใช้ชื่อ+นามสกุลอังกฤษ (ไฟล์นี้ไม่มี Employee ID)",
      "วันตรวจเดียวกันมีอยู่แล้ว → อัปเดตเฉพาะช่องที่ไฟล์มีค่า, ช่องว่างไม่ลบข้อมูลเดิม",
      "ก่อนแถว \"New SSE\" → ติ๊ก Permanent Worker · หลังแถว → SSE Level = NEW SSE (ไม่ลดระดับ SSE1/SSE2)",
      "ชื่อไทย / ชื่ออังกฤษ / วันเกิด / สถานที่ทำงาน / แผนก → เติมเฉพาะคนที่ในระบบยังว่าง",
    ],
  },
};

// ── เก็บไฟล์ + รายงานล่าสุดไว้ใน memory ของแอป ──
// สลับไปเมนูอื่นแล้วกลับมา ยังอยู่ครบ / refresh หน้า หรือ logout → หายเอง
// (ตั้งใจไม่เก็บใน localStorage เพราะรายงานมีชื่อ/รหัสพนักงาน)
const cache = { kind: "training", file: null, report: null, createMissing: false, at: null, client: null };

const fmtTime = (d) =>
  d ? new Date(d).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "";

export default function DataImport() {
  const { backendUrl, isMultiClient, clients, selectedClient } = useContext(AppContent);
  const inputRef = useRef(null);
  const [file, setFile] = useState(cache.file);
  const [report, setReport] = useState(cache.report);
  const [reportAt, setReportAt] = useState(cache.at);
  const [busy, setBusy] = useState(""); // "preview" | "import" | ""
  const [createMissing, setCreateMissing] = useState(cache.createMissing);
  const [kind, setKind] = useState(cache.kind);
  // โหมด multi: Training Record เป็นของลูกค้าไหน (ใช้ contract ของลูกค้านั้นจับคู่ชื่อ training)
  // ค่าเริ่มต้น = ลูกค้าที่เลือกบน Navbar · โหมด single ไม่ส่ง → backend ใช้ Chevron
  const [importClient, setImportClient] = useState(cache.client || selectedClient?.name || "");
  const K = KINDS[kind];
  const askClient = isMultiClient && kind === "training";
  useEffect(() => {
    if (isMultiClient && !importClient && clients?.length) setImportClient(clients[0].name);
  }, [isMultiClient, clients, importClient]);

  useEffect(() => {
    Object.assign(cache, { kind, file, report, createMissing, at: reportAt, client: importClient });
  }, [kind, file, report, createMissing, reportAt, importClient]);

  const pickFile = (f) => {
    setFile(f || null);
    setReport(null);
    setReportAt(null);
    if (inputRef.current) inputRef.current.value = ""; // เลือกไฟล์ชื่อเดิมซ้ำได้
  };

  const switchKind = (k) => {
    if (k === kind || busy) return;
    setKind(k);
    pickFile(null);
    setCreateMissing(false);
  };

  const clearAll = () => {
    pickFile(null);
    setCreateMissing(false);
  };

  const send = async (dryRun) => {
    if (!file) return toast.warn("กรุณาเลือกไฟล์ก่อน");
    if (askClient && !importClient) return toast.warn("กรุณาเลือกลูกค้าของไฟล์ก่อน");
    setBusy(dryRun ? "preview" : "import");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await axios.post(
        `${backendUrl}/api/admin/import/${K.endpoint}?dryRun=${dryRun ? 1 : 0}&createMissing=${createMissing ? 1 : 0}` +
          (askClient ? `&clientName=${encodeURIComponent(importClient)}` : ""),
        fd,
        { withCredentials: true },
      );
      if (!data.success) throw new Error(data.message);
      setReport(data.data);
      setReportAt(Date.now());
      if (dryRun) toast.info("ตรวจสอบเสร็จ — ยังไม่ได้บันทึก กรุณาตรวจรายงานก่อนกดนำเข้า");
      else if (data.data.counts.errors) toast.warn(`นำเข้าแล้ว แต่มี error ${data.data.counts.errors} คน`);
      else toast.success("นำเข้าข้อมูลเรียบร้อย");
    } catch (err) {
      // ไฟล์ถูกแก้/ย้ายหลังจากเลือกไว้ → browser อ่านไม่ได้ ต้องเลือกใหม่
      if (err?.name === "NotReadableError" || /could not be read|ERR_UPLOAD_FILE_CHANGED/i.test(err?.message || "")) {
        toast.error("ไฟล์ถูกแก้ไขหลังจากเลือกไว้ — กรุณากด “เลือกไฟล์” ใหม่");
        pickFile(null);
        return;
      }
      toast.error(err.response?.data?.message || err.message || "ไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  };

  const confirmImport = () => {
    if (!report?.dryRun) return;
    const c = report.counts;
    if (report.kind === "pe") {
      const totalPe = c.examCreate + c.examUpdate + c.medicalSync + c.employeeInfo + c.employeeCreate;
      if (!totalPe) return toast.info("ไม่มีข้อมูลที่เปลี่ยนแปลง");
      if (!window.confirm(`ยืนยันนำเข้า PE Tracking "${report.fileName}"?\nPE ใหม่ ${c.examCreate} · อัปเดต ${c.examUpdate} · ข้อมูลพนักงาน ${c.employeeInfo} คน${c.employeeCreate ? `\nและสร้างพนักงานใหม่ ${c.employeeCreate} คน` : ""}`)) return;
      return send(false);
    }
    const total = c.employeeCreate + c.trainingCreate + c.trainingUpdate + c.medicalCreate + c.medicalUpdate + c.passportUpsert + c.employeeInfoUpdate;
    if (!total) return toast.info("ไม่มีข้อมูลที่เปลี่ยนแปลง");
    const extra = c.employeeCreate ? `\nและสร้างพนักงานใหม่ ${c.employeeCreate} คน` : "";
    if (!window.confirm(`ยืนยันนำเข้า "${report.fileName}"${isMultiClient ? ` (ลูกค้า ${report.client})` : ""}?\nจะบันทึกการเปลี่ยนแปลง ${total} รายการลงระบบ${extra}`)) return;
    send(false);
  };

  const c = report?.counts;

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1800px] space-y-4">
      {/* ════════ Header ════════ */}
      <div className="min-w-0">
        <h1 className="m-0 text-lg font-bold">Data Import</h1>
        <div className="text-xs text-gray-500">
          นำเข้าข้อมูลจากไฟล์ Excel ของ HR — admin เท่านั้น · ขั้นตอน: เลือกไฟล์ → ตรวจสอบ (Preview) → ยืนยันนำเข้า
        </div>
      </div>

      {/* ════════ เลือกไฟล์ — คั่นด้วยเส้น ════════ */}
      <div className="border-y border-gray-200 py-3">
        {/* ชนิดไฟล์ */}
        <div className="mb-3">
          <div className={LABEL}>ชนิดไฟล์</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(KINDS).map(([k, v]) => (
              <button
                key={k}
                type="button"
                disabled={!!busy}
                onClick={() => switchKind(k)}
                className={`${BTN} border ${
                  kind === k
                    ? "border-[#2B2F78] bg-[#2B2F78] text-white"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {askClient && (
          <div className="mb-3 max-w-[260px]">
            <label className={LABEL}>ลูกค้าของไฟล์</label>
            <select
              value={importClient}
              disabled={!!busy}
              onChange={(e) => {
                setImportClient(e.target.value);
                setReport(null); // เปลี่ยนลูกค้า → ต้อง Preview ใหม่
                setReportAt(null);
              }}
              className="box-border h-9 w-full cursor-pointer rounded-lg border border-gray-300 bg-white px-3 text-[13px] outline-none focus:border-blue-400 disabled:cursor-not-allowed"
            >
              {(clients || []).map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
            <div className="mt-1 text-[11px] text-gray-400">
              ใช้ชื่อ training ของลูกค้านี้จับคู่คอลัมน์ในไฟล์ · ใบเซอร์ใช้ได้กับทุกลูกค้าเหมือนเดิม
            </div>
          </div>
        )}

        <div className={LABEL}>
          ไฟล์{" "}
          <span className="normal-case tracking-normal text-gray-400">{K.fileLabel.replace(/^ไฟล์\s*/, "")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={`${BTN} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}
          >
            📂 เลือกไฟล์
          </button>
          <span className="min-w-0 max-w-[420px] truncate text-[13px] text-gray-700">
            {file ? file.name : <span className="text-gray-400">ยังไม่ได้เลือกไฟล์</span>}
          </span>
          {file && (
            <button
              type="button"
              disabled={!!busy}
              onClick={clearAll}
              className="cursor-pointer border-none bg-transparent text-[12px] font-semibold text-gray-400 hover:text-red-500 disabled:opacity-50"
            >
              ✕ ล้าง
            </button>
          )}
          <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
            <button
              type="button"
              disabled={!file || !!busy}
              onClick={() => send(true)}
              className={`${BTN} flex-1 border border-[#2B2F78] bg-white text-[#2B2F78] hover:bg-[#2B2F78]/5 sm:flex-none`}
            >
              {busy === "preview" ? "กำลังตรวจสอบ…" : "1. ตรวจสอบ (Preview)"}
            </button>
            <button
              type="button"
              disabled={!report?.dryRun || !!busy}
              onClick={confirmImport}
              className={`${BTN} flex-1 border-none bg-green-600 text-white hover:bg-green-700 sm:flex-none`}
            >
              {busy === "import" ? "กำลังนำเข้า…" : "2. ยืนยันนำเข้า"}
            </button>
          </div>
        </div>
        <label className="mt-3 flex w-fit cursor-pointer items-center gap-2 text-[13px] text-gray-700">
          <input
            type="checkbox"
            checked={createMissing}
            onChange={(e) => {
              setCreateMissing(e.target.checked);
              setReport(null); // เปลี่ยนตัวเลือก → ต้อง Preview ใหม่
              setReportAt(null);
            }}
            className="h-4 w-4 cursor-pointer accent-[#2B2F78]"
          />
          สร้างพนักงานใหม่ให้คนที่ไม่พบในระบบ
          <span className="text-[12px] text-gray-400">
            (รหัส EXPT-xxx ถัดไป, Offshore, ตำแหน่งตามชื่อในไฟล์
            {kind === "pe" ? ", ไม่มี Employee ID — เติมทีหลังในหน้า Edit Worker" : ""})
          </span>
        </label>
        <ul className="mb-0 mt-3 list-disc space-y-0.5 pl-5 text-[12px] text-gray-500">
          {K.hints.map((h) => (
            <li key={h}>{h}</li>
          ))}
          <li>ไฟล์ไม่ถูกเก็บไว้บน server (ประมวลผลแล้วทิ้ง)</li>
        </ul>
      </div>

      {report?.kind === "pe" && <PeReport report={report} reportAt={reportAt} />}

      {report && report.kind !== "pe" && (
        <>
          <div
            className={`border-l-[3px] px-4 py-2.5 text-[13px] font-semibold ${
              report.dryRun
                ? "border-amber-400 bg-amber-50 text-amber-800"
                : "border-green-500 bg-green-50 text-green-800"
            }`}
          >
            {report.dryRun
              ? "🔍 Preview — ยังไม่ได้บันทึกลงระบบ ตรวจรายงานด้านล่างแล้วกด “ยืนยันนำเข้า”"
              : "✅ นำเข้าเรียบร้อยแล้ว"}
            {report.dryRun && (
              <span className="block text-[12px] font-normal text-amber-700">
                ถ้าเพิ่งแก้ข้อมูลพนักงาน (เช่น ใส่ Employee ID) ให้กด “ตรวจสอบ (Preview)” อีกครั้งเพื่อดูผลล่าสุด
              </span>
            )}
            <span className="ml-2 font-normal">
              {report.fileName} · sheet “{report.sheetName}” · หัวตารางแถว {report.headerRow} ·{" "}
              {isMultiClient && report.client ? `${report.client} — ` : ""}{report.contract}
              {reportAt && ` · เมื่อ ${fmtTime(reportAt)} น.`}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-px border-y border-gray-200 bg-gray-200 sm:grid-cols-4 lg:grid-cols-6">
            <Stat label="แถวในไฟล์" value={report.rowsInFile} />
            <Stat label="จับคู่พนักงานได้" value={report.employeesMatched} tone="text-blue-700" />
            {report.createMissing ? (
              <Stat label={report.dryRun ? "จะสร้างพนักงานใหม่" : "สร้างพนักงานใหม่"} value={c.employeeCreate} tone={c.employeeCreate ? "text-green-700" : "text-gray-800"} />
            ) : (
              <Stat label="ไม่พบในระบบ" value={report.notFound.length} tone={report.notFound.length ? "text-red-600" : "text-gray-800"} />
            )}
            <Stat label="Training (map ได้)" value={`${report.mappedTrainings}/${report.trainingColumns}`} />
            <Stat label="Training ใหม่" value={c.trainingCreate} tone="text-green-700" />
            <Stat label="Training อัปเดต" value={c.trainingUpdate} tone="text-amber-700" />
            <Stat label="Training ไม่เปลี่ยน" value={c.trainingUnchanged} tone="text-gray-400" />
            <Stat label="Medical ใหม่/อัปเดต" value={c.medicalCreate + c.medicalUpdate} />
            <Stat label="Passport" value={c.passportUpsert} />
            <Stat label="ข้อมูลพนักงาน" value={c.employeeInfoUpdate} />
            <Stat label="จับคู่ด้วยชื่อ" value={report.matchedByName} tone={report.matchedByName ? "text-amber-700" : "text-gray-800"} />
            <Stat label="ข้าม (ระบบใหม่กว่า)" value={c.olderSkipped ?? 0} tone={c.olderSkipped ? "text-amber-700" : "text-gray-400"} />
            <Stat label="Error" value={c.errors} tone={c.errors ? "text-red-600" : "text-gray-800"} />
          </div>

          {report.warnings?.map((w) => (
            <div key={w} className="border-l-[3px] border-amber-400 bg-amber-50 px-4 py-2 text-[13px] text-amber-800">
              ⚠ {w}
            </div>
          ))}

          <div className="border-t border-gray-200">
            <Section title="❌ Error ตอนบันทึก" count={report.errors.length} tone="text-red-700">
              <table className="w-full">
                <thead><tr><th className={TH}>แถว</th><th className={TH}>พนักงาน</th><th className={TH}>ข้อความ</th></tr></thead>
                <tbody>
                  {report.errors.map((e) => (
                    <tr key={e.row}><td className={TD}>{e.row}</td><td className={TD}>{e.employee}</td><td className={`${TD} text-red-600`}>{e.message}</td></tr>
                  ))}
                </tbody>
              </table>
            </Section>

            <Section title={`➕ พนักงานใหม่${report.dryRun ? " (จะสร้าง)" : " (สร้างแล้ว)"}`} count={report.created.length} tone="text-green-700">
              <table className="w-full">
                <thead><tr><th className={TH}>แถว</th><th className={TH}>EMP CODE</th><th className={TH}>Employee ID</th><th className={TH}>Name</th><th className={TH}>ชื่อไทย</th><th className={TH}>ตำแหน่ง</th></tr></thead>
                <tbody>
                  {report.created.map((r) => (
                    <tr key={r.row}>
                      <td className={TD}>{r.row}</td>
                      <td className={TD}>{r.empCode}</td>
                      <td className={TD}>{r.empId}</td>
                      <td className={TD}>{r.nameEN}</td>
                      <td className={TD}>{r.nameTH || "-"}</td>
                      <td className={TD}>
                        {r.positionMatched || (
                          <span className="text-amber-600">{r.position ? `“${r.position}” ไม่ตรงกับตำแหน่งในระบบ — เว้นว่าง` : "-"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            <Section title="⚠ ไม่พบพนักงานในระบบ (จะถูกข้าม)" count={report.createMissing ? 0 : report.notFound.length} tone="text-red-700">
              <table className="w-full">
                <thead><tr><th className={TH}>แถว</th><th className={TH}>Employee ID</th><th className={TH}>Name</th><th className={TH}>ชื่อไทย</th></tr></thead>
                <tbody>
                  {report.notFound.map((r) => (
                    <tr key={r.row}><td className={TD}>{r.row}</td><td className={TD}>{r.empId}</td><td className={TD}>{r.nameEN}</td><td className={TD}>{r.nameTH || "-"}</td></tr>
                  ))}
                </tbody>
              </table>
            </Section>

            <Section title="⏭ ข้าม — ในระบบมีข้อมูลใหม่กว่าไฟล์ (ไม่ทับ)" count={report.olderInFile?.length || 0} tone="text-amber-700">
              <table className="w-full">
                <thead><tr><th className={TH}>พนักงาน</th><th className={TH}>รายการ</th><th className={TH}>ในระบบ</th><th className={TH}>ในไฟล์</th></tr></thead>
                <tbody>
                  {(report.olderInFile || []).map((o, i) => (
                    <tr key={i}><td className={TD}>{o.employee}</td><td className={TD}>{o.item}</td><td className={TD}>{o.inSystem}</td><td className={`${TD} text-gray-400`}>{o.inFile}</td></tr>
                  ))}
                </tbody>
              </table>
            </Section>

            <Section title="⚠ Training ในไฟล์ที่ map ไม่ได้ (จะถูกข้าม)" count={report.unmappedTrainings.length} tone="text-amber-700">
              <div className="px-4 py-2 text-[12px] text-gray-500">
                แก้ได้โดยใส่ชื่อในไฟล์ลงช่อง “ชื่อที่ HR ใช้ในไฟล์” ของ training (หน้า Trainings) — ใส่ได้หลายชื่อ คั่นด้วย | — แล้วตรวจสอบใหม่
              </div>
              <table className="w-full">
                <thead><tr><th className={TH}>ชื่อในไฟล์</th><th className={TH}>จำนวนคนที่มีข้อมูล</th></tr></thead>
                <tbody>
                  {report.unmappedTrainings.map((t) => (
                    <tr key={t.name}><td className={TD}>{t.name}</td><td className={TD}>{t.filledRows}</td></tr>
                  ))}
                </tbody>
              </table>
            </Section>

            <Section title="Training ที่ยังไม่ได้ผูกกับ contract นี้ (นำเข้าได้ — ผูกใน Matrix ทีหลัง)" count={report.mappedOutsideContract?.length || 0}>
              <div className="px-4 py-2 text-[12px] text-gray-700">{(report.mappedOutsideContract || []).join(" · ")}</div>
            </Section>

            <Section title="พนักงานซ้ำในไฟล์ (ใช้แถวแรก)" count={report.duplicatesInFile.length} tone="text-amber-700">
              <table className="w-full">
                <thead><tr><th className={TH}>แถว</th><th className={TH}>ซ้ำกับแถว</th><th className={TH}>พนักงาน</th></tr></thead>
                <tbody>
                  {report.duplicatesInFile.map((d) => (
                    <tr key={d.row}><td className={TD}>{d.row}</td><td className={TD}>{d.firstRow}</td><td className={TD}>{d.empId} {d.nameEN}</td></tr>
                  ))}
                </tbody>
              </table>
            </Section>

            <Section title="เติม Employee ID / ชื่อ ที่ยังว่างในระบบ" count={report.backfills.length}>
              <table className="w-full">
                <thead><tr><th className={TH}>พนักงาน</th><th className={TH}>EMP CODE</th><th className={TH}>เติม</th></tr></thead>
                <tbody>
                  {report.backfills.map((b, i) => (
                    <tr key={i}>
                      <td className={TD}>{b.employee}</td>
                      <td className={TD}>{b.empCode}</td>
                      <td className={TD}>{Object.entries(b.fields).map(([k, v]) => `${k}: ${v}`).join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            <Section
              title={`รายการเปลี่ยนแปลง${report.changesTruncated ? " (แสดง 500 รายการแรก)" : ""}`}
              count={report.changes.length}
              tone="text-blue-700"
            >
              <table className="w-full">
                <thead><tr><th className={TH}>พนักงาน</th><th className={TH}>รายการ</th><th className={TH}>ประเภท</th><th className={TH}>เดิม</th><th className={TH}>ใหม่</th></tr></thead>
                <tbody>
                  {report.changes.map((ch, i) => (
                    <tr key={i}>
                      <td className={TD}>{ch.employee}</td>
                      <td className={TD}>{ch.item}</td>
                      <td className={TD}>
                        <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${ch.kind === "create" ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                          {ch.kind === "create" ? "ใหม่" : "อัปเดต"}
                        </span>
                      </td>
                      <td className={`${TD} text-gray-400`}>{ch.from || "-"}</td>
                      <td className={TD}>{ch.to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          </div>
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// รายงาน PE Tracking
// ══════════════════════════════════════════════════════════
const SSE_LABEL = { new_sse: "NEW SSE", sse1: "SSE1", sse2: "SSE2" };
const BACKFILL_LABEL = {
  workplace: "สถานที่ทำงาน",
  division: "แผนก",
  birthDate: "วันเกิด",
  fullNameTH: "ชื่อไทย",
  fullNameEN: "ชื่ออังกฤษ",
};

function PeReport({ report, reportAt }) {
  const c = report.counts;
  return (
    <>
      <div
        className={`border-l-[3px] px-4 py-2.5 text-[13px] font-semibold ${
          report.dryRun ? "border-amber-400 bg-amber-50 text-amber-800" : "border-green-500 bg-green-50 text-green-800"
        }`}
      >
        {report.dryRun
          ? "🔍 Preview — ยังไม่ได้บันทึกลงระบบ ตรวจรายงานด้านล่างแล้วกด “ยืนยันนำเข้า”"
          : "✅ นำเข้าเรียบร้อยแล้ว"}
        <span className="ml-2 font-normal">
          {report.fileName} · sheet “{report.sheetName}” · หัวตารางแถว {report.headerRow} · อ่านได้ {report.columnsFound} คอลัมน์
          {report.newSseRow ? ` · แถว New SSE = ${report.newSseRow}` : ""}
          {reportAt && ` · เมื่อ ${fmtTime(reportAt)} น.`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-px border-y border-gray-200 bg-gray-200 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="แถวในไฟล์" value={report.rowsInFile} />
        <Stat label="จับคู่พนักงานได้" value={report.employeesMatched} tone="text-blue-700" />
        {report.createMissing ? (
          <Stat label={report.dryRun ? "จะสร้างพนักงานใหม่" : "สร้างพนักงานใหม่"} value={c.employeeCreate} tone={c.employeeCreate ? "text-green-700" : "text-gray-800"} />
        ) : (
          <Stat label="ไม่พบในระบบ" value={report.notFound.length} tone={report.notFound.length ? "text-red-600" : "text-gray-800"} />
        )}
        <Stat label="PE record ใหม่" value={c.examCreate} tone="text-green-700" />
        <Stat label="PE record อัปเดต" value={c.examUpdate} tone="text-amber-700" />
        <Stat label="PE ไม่เปลี่ยน" value={c.examUnchanged} tone="text-gray-400" />
        <Stat label="Medical Check-up" value={c.medicalSync} />
        <Stat label="ติ๊ก Permanent" value={c.permanentSet} tone={c.permanentSet ? "text-green-700" : "text-gray-800"} />
        <Stat label="ตั้ง NEW SSE" value={c.newSseSet} tone={c.newSseSet ? "text-green-700" : "text-gray-800"} />
        <Stat label="ข้อมูลพนักงาน" value={c.employeeInfo} />
        <Stat label="จับคู่ด้วยชื่ออังกฤษ" value={report.matchedByEnglish} tone={report.matchedByEnglish ? "text-amber-700" : "text-gray-800"} />
        <Stat label="Error" value={c.errors} tone={c.errors ? "text-red-600" : "text-gray-800"} />
      </div>

      {report.warnings?.map((w) => (
        <div key={w} className="border-l-[3px] border-amber-400 bg-amber-50 px-4 py-2 text-[13px] text-amber-800">
          ⚠ {w}
        </div>
      ))}
      {report.unknownHeaders?.length > 0 && (
        <div className="border-l-[3px] border-gray-300 bg-gray-50 px-4 py-2 text-[12px] text-gray-600">
          คอลัมน์ที่ระบบไม่รู้จัก (ข้าม): {report.unknownHeaders.join(" · ")}
        </div>
      )}

      <div className="border-t border-gray-200">
        <Section title="❌ Error ตอนบันทึก" count={report.errors.length} tone="text-red-700">
          <table className="w-full">
            <thead><tr><th className={TH}>แถว</th><th className={TH}>พนักงาน</th><th className={TH}>ข้อความ</th></tr></thead>
            <tbody>
              {report.errors.map((e) => (
                <tr key={e.row}><td className={TD}>{e.row}</td><td className={TD}>{e.employee}</td><td className={`${TD} text-red-600`}>{e.message}</td></tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title={`➕ พนักงานใหม่${report.dryRun ? " (จะสร้าง)" : " (สร้างแล้ว)"}`} count={report.created?.length || 0} tone="text-green-700">
          <table className="w-full">
            <thead><tr><th className={TH}>แถว</th><th className={TH}>EMP CODE</th><th className={TH}>ชื่อไทย</th><th className={TH}>ชื่ออังกฤษ</th><th className={TH}>ตำแหน่ง</th><th className={TH}>ส่วน</th></tr></thead>
            <tbody>
              {(report.created || []).map((r) => (
                <tr key={r.row}>
                  <td className={TD}>{r.row}</td>
                  <td className={TD}>{r.empCode}</td>
                  <td className={TD}>{r.nameTH || "-"}</td>
                  <td className={TD}>{r.nameEN || "-"}</td>
                  <td className={TD}>
                    {r.positionMatched || (
                      <span className="text-amber-600">{r.position ? `“${r.position}” ไม่ตรงกับตำแหน่งในระบบ — เว้นว่าง` : "-"}</span>
                    )}
                  </td>
                  <td className={TD}>{r.section === "new_sse" ? "NEW SSE" : "Permanent"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="⚠ ไม่พบพนักงานในระบบ (จะถูกข้าม)" count={report.createMissing ? 0 : report.notFound.length} tone="text-red-700">
          <div className="px-4 py-2 text-[12px] text-gray-500">
            ไฟล์นี้ไม่มี Employee ID — ตรวจว่าชื่อไทยในหน้า Edit Worker ตรงกับไฟล์ แล้วกด Preview ใหม่
          </div>
          <table className="w-full">
            <thead><tr><th className={TH}>แถว</th><th className={TH}>ชื่อไทย</th><th className={TH}>ชื่ออังกฤษ</th><th className={TH}>ส่วน</th></tr></thead>
            <tbody>
              {report.notFound.map((r) => (
                <tr key={r.row}>
                  <td className={TD}>{r.row}</td><td className={TD}>{r.nameTH || "-"}</td><td className={TD}>{r.nameEN || "-"}</td>
                  <td className={TD}>{r.section === "new_sse" ? "New SSE" : "Permanent"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="⚠ จับคู่ด้วยชื่ออังกฤษ (ชื่อไทยไม่ตรง — ตรวจว่าเป็นคนเดียวกัน · ถ้าในระบบยังไม่มีชื่อไทย จะเติมให้)" count={report.matchedByEnglishList?.length || 0} tone="text-amber-700">
          <table className="w-full">
            <thead><tr><th className={TH}>แถว</th><th className={TH}>ชื่อไทยในไฟล์</th><th className={TH}>ชื่อไทยในระบบ</th><th className={TH}>พนักงาน</th></tr></thead>
            <tbody>
              {report.matchedByEnglishList.map((r) => (
                <tr key={r.row}><td className={TD}>{r.row}</td><td className={TD}>{r.fileTH || "-"}</td><td className={TD}>{r.systemTH}</td><td className={TD}>{r.employee}</td></tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="⚠ อยู่ในส่วน New SSE แต่ในระบบเป็น SSE อื่นอยู่แล้ว (ไม่เปลี่ยน)" count={report.roster.sseConflicts.length} tone="text-amber-700">
          <table className="w-full">
            <thead><tr><th className={TH}>แถว</th><th className={TH}>พนักงาน</th><th className={TH}>SSE ในระบบ</th></tr></thead>
            <tbody>
              {report.roster.sseConflicts.map((r) => (
                <tr key={r.row}><td className={TD}>{r.row}</td><td className={TD}>{r.employee}</td><td className={TD}>{SSE_LABEL[r.current] || r.current}</td></tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="พนักงานซ้ำในไฟล์ (ใช้แถวแรก)" count={report.duplicatesInFile.length} tone="text-amber-700">
          <table className="w-full">
            <thead><tr><th className={TH}>แถว</th><th className={TH}>ซ้ำกับแถว</th><th className={TH}>ชื่อ</th></tr></thead>
            <tbody>
              {report.duplicatesInFile.map((d) => (
                <tr key={d.row}><td className={TD}>{d.row}</td><td className={TD}>{d.firstRow}</td><td className={TD}>{d.name}</td></tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="ไม่มีวันที่ตรวจร่างกาย (ข้าม PE record — ข้อมูลพนักงานยังอัปเดต)" count={report.noExamDate.length} tone="text-amber-700">
          <table className="w-full">
            <thead><tr><th className={TH}>แถว</th><th className={TH}>พนักงาน</th></tr></thead>
            <tbody>
              {report.noExamDate.map((r) => (
                <tr key={r.row}><td className={TD}>{r.row}</td><td className={TD}>{r.employee}</td></tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="🟩 จะติ๊ก Permanent Worker" count={report.roster.permanent.length} tone="text-green-700">
          <table className="w-full">
            <thead><tr><th className={TH}>แถว</th><th className={TH}>พนักงาน</th></tr></thead>
            <tbody>
              {report.roster.permanent.map((r) => (
                <tr key={r.row}><td className={TD}>{r.row}</td><td className={TD}>{r.employee}</td></tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="🆕 จะตั้ง SSE Level = NEW SSE" count={report.roster.newSse.length} tone="text-green-700">
          <table className="w-full">
            <thead><tr><th className={TH}>แถว</th><th className={TH}>พนักงาน</th></tr></thead>
            <tbody>
              {report.roster.newSse.map((r) => (
                <tr key={r.row}><td className={TD}>{r.row}</td><td className={TD}>{r.employee}</td></tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="เติมข้อมูลพนักงานที่ยังว่าง (ชื่อไทย / วันเกิด / สถานที่ทำงาน / แผนก)" count={report.backfills.length}>
          <table className="w-full">
            <thead><tr><th className={TH}>พนักงาน</th><th className={TH}>เติม</th></tr></thead>
            <tbody>
              {report.backfills.map((b, i) => (
                <tr key={i}>
                  <td className={TD}>{b.employee}</td>
                  <td className={TD}>{Object.entries(b.fields).map(([k, v]) => `${BACKFILL_LABEL[k] || k}: ${v}`).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section
          title={`รายการเปลี่ยนแปลง${report.changesTruncated ? " (แสดง 500 รายการแรก)" : ""}`}
          count={report.changes.length}
          tone="text-blue-700"
        >
          <table className="w-full">
            <thead><tr><th className={TH}>พนักงาน</th><th className={TH}>วันตรวจ</th><th className={TH}>ประเภท</th><th className={TH}>รายละเอียด</th></tr></thead>
            <tbody>
              {report.changes.map((ch, i) => (
                <tr key={i}>
                  <td className={`${TD} whitespace-nowrap`}>{ch.employee}</td>
                  <td className={`${TD} whitespace-nowrap`}>{ch.examDate}</td>
                  <td className={TD}>
                    <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${ch.kind === "create" ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                      {ch.kind === "create" ? "ใหม่" : "อัปเดต"}
                    </span>
                  </td>
                  <td className={`${TD} text-[12px] text-gray-700`}>{ch.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </>
  );
}
