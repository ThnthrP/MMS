import { useContext, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { WorkerAppContent } from "../../context/WorkerAppContext";
import ChangePinForm from "./ChangePinForm";

const BUCKET_STYLE = {
  expired: { label: "หมดอายุ", bg: "bg-red-100", text: "text-red-700" },
  critical: { label: "ใกล้หมดอายุมาก", bg: "bg-red-100", text: "text-red-700" },
  warning: {
    label: "ใกล้หมดอายุ",
    bg: "bg-yellow-100",
    text: "text-yellow-700",
  },
  upcoming: { label: "ใกล้ถึงกำหนด", bg: "bg-blue-100", text: "text-blue-700" },
  valid: { label: "ปกติ", bg: "bg-green-100", text: "text-green-700" },
};

function BucketBadge({ bucket }) {
  const s = BUCKET_STYLE[bucket] || {
    label: bucket,
    bg: "bg-gray-100",
    text: "text-gray-600",
  };
  return (
    <span
      className={`inline-block ${s.bg} ${s.text} text-xs font-semibold px-2.5 py-1 rounded-full`}
    >
      {s.label}
    </span>
  );
}

// ── รายการ training: รองรับทั้งแบบชื่อ (string) และแบบ object { name, expiryDate, bucket } ──
const itemName = (it) => (typeof it === "string" ? it : it?.name || "—");
const itemExpiry = (it) => (typeof it === "string" ? null : it?.expiryDate || null);
const itemBucket = (it) => (typeof it === "string" ? null : it?.bucket || null);

// กลุ่ม training ตาม matrix — ชื่อกลุ่มใช้ภาษาอังกฤษเหมือนฝั่ง HR (Mandatory / Assigned)
// พร้อมคำอธิบายภาษาไทยตัวเล็ก ให้พนักงานกับ HR พูดคำเดียวกัน
function TrainingGroup({ title, subtitle, dot, group, fmtDate }) {
  const [showDone, setShowDone] = useState(false);
  const required = group?.required?.length ?? 0;
  const completed = group?.completed ?? [];
  const missing = group?.missing ?? [];
  if (required === 0) return null;
  const pct = Math.round((completed.length / required) * 100);
  const done = missing.length === 0;

  return (
    <div className="rounded-lg border border-gray-100 p-3">
      {/* หัวกลุ่ม: ชื่อ + จำนวน + แถบความคืบหน้า */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} />
            {title}
          </div>
          <div className="text-[11px] text-gray-400">{subtitle}</div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${
            done ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
          }`}
        >
          {completed.length}/{required}
        </span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-gray-100">
        <div
          className={`h-1.5 rounded-full ${done ? "bg-green-500" : "bg-red-400"}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* ที่ยังขาด — แสดงเสมอ */}
      {missing.length > 0 ? (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-semibold text-red-600">
            ยังไม่มี ({missing.length}) — ติดต่อ HR เพื่อนัดอบรม
          </div>
          <ul className="divide-y divide-red-50 rounded-md border border-red-100 bg-red-50/40">
            {missing.map((it, i) => (
              <li key={i} className="flex items-start gap-2 px-2.5 py-1.5 text-xs text-red-700">
                <span className="mt-px">✕</span>
                <span className="min-w-0 break-words">{itemName(it)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-3 text-xs font-medium text-green-600">✓ ครบทุกตัว</div>
      )}

      {/* ที่มีแล้ว — พับไว้ กดดูได้ */}
      {completed.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="flex w-full items-center justify-between rounded-md px-1 py-1 text-xs font-semibold text-green-700 hover:bg-green-50"
          >
            <span>ที่มีแล้ว ({completed.length})</span>
            <span>{showDone ? "ซ่อน ▴" : "ดูรายการ ▾"}</span>
          </button>
          {showDone && (
            <ul className="mt-1 divide-y divide-gray-100 rounded-md border border-gray-100">
              {completed.map((it, i) => (
                <li key={i} className="flex items-start justify-between gap-2 px-2.5 py-1.5 text-xs">
                  <span className="flex min-w-0 items-start gap-2 text-gray-700">
                    <span className="mt-px text-green-600">✓</span>
                    <span className="break-words">{itemName(it)}</span>
                  </span>
                  {(itemBucket(it) || itemExpiry(it)) && (
                    <span className="shrink-0 text-right">
                      {itemBucket(it) && itemBucket(it) !== "valid" && (
                        <BucketBadge bucket={itemBucket(it)} />
                      )}
                      {itemExpiry(it) && (
                        <div className="text-[10px] text-gray-400">
                          หมดอายุ {fmtDate(itemExpiry(it))}
                        </div>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function OtherGroup({ items }) {
  const [open, setOpen] = useState(false);
  if (!items?.length) return null;
  return (
    <div className="rounded-lg border border-gray-100 p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-300" />
            Others ({items.length})
          </span>
          <span className="block text-[11px] text-gray-400">
            ใบรับรองอื่นที่มี นอกเหนือจาก matrix ตำแหน่งนี้
          </span>
        </span>
        <span className="text-xs font-semibold text-gray-500">{open ? "ซ่อน ▴" : "ดูรายการ ▾"}</span>
      </button>
      {open && (
        <ul className="mt-2 divide-y divide-gray-100 rounded-md border border-gray-100">
          {items.map((it, i) => (
            <li key={i} className="px-2.5 py-1.5 text-xs text-gray-700">
              ✓ {itemName(it)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function WorkerReadiness() {
  const { backendUrl, employee } = useContext(WorkerAppContent);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeClient, setActiveClient] = useState(null);
  const [showExamHistory, setShowExamHistory] = useState(false);
  const [showChangePin, setShowChangePin] = useState(false);

  const fetchReadiness = async () => {
    try {
      setLoading(true);
      const { data: res } = await axios.get(
        `${backendUrl}/api/worker/readiness`,
        { withCredentials: true },
      );
      if (res.success) {
        setData(res);
        const clientNames = Object.keys(res.gap || {});
        if (clientNames.length > 0) setActiveClient(clientNames[0]);
      } else {
        toast.error(res.message || "โหลดข้อมูลไม่สำเร็จ");
      }
    } catch (error) {
      console.error(error);
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReadiness();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmtDate = (d) =>
    d
      ? new Date(d).toLocaleDateString("th-TH", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "—";

  if (loading) {
    return (
      <div className="max-w-md mx-auto px-4 pt-10 text-center text-gray-400 text-sm">
        กำลังโหลด...
      </div>
    );
  }

  if (!data) return null;

  const clientNames = Object.keys(data.gap || {});
  const activeGap = activeClient ? data.gap[activeClient] : null;

  return (
    <div className="max-w-md mx-auto px-4 pt-6 pb-4">
      <div className="mb-4">
        <div className="text-xl font-bold text-gray-800">
          {employee?.fullName || "—"}
        </div>
        <div className="text-xs text-gray-400">
          {employee?.empId || "—"} — ความพร้อมการลงงาน
        </div>
      </div>

      {/* รายการที่ควรติดตาม */}
      {data.followUpItems?.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-4">
          <div className="text-sm font-semibold text-orange-800 mb-2">
            ⚠ มีรายการที่ควรติดตาม
          </div>
          {data.followUpItems.map((item, i) => (
            <div key={i} className="text-xs text-orange-700 mb-1">
              • {item.note}{" "}
              {item.examDate && (
                <span className="text-orange-500">
                  ({fmtDate(item.examDate)})
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Medical checks */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-4">
        <div className="text-sm font-semibold text-gray-700 mb-3">
          ผลสุขภาพ / EMOB
        </div>
        {data.medicalChecks?.length === 0 ? (
          <div className="text-xs text-gray-400">ไม่มีข้อมูล</div>
        ) : (
          <div className="space-y-3">
            {data.medicalChecks.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between pb-3 border-b border-gray-100 last:border-0 last:pb-0"
              >
                <div>
                  <div className="text-sm font-medium text-gray-700">
                    {m.checkType}
                  </div>
                  <div className="text-xs text-gray-400">
                    หมดอายุ: {fmtDate(m.expiryDate)}
                  </div>
                </div>
                <BucketBadge bucket={m.bucket} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Training gap — tab ต่อ client */}
      {clientNames.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-4">
          <div className="text-sm font-semibold text-gray-700 mb-3">
            ใบรับรอง (Training Matrix)
          </div>

          {clientNames.length > 1 && (
            <div className="flex gap-2 mb-4 overflow-x-auto">
              {clientNames.map((name) => (
                <button
                  key={name}
                  onClick={() => setActiveClient(name)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${
                    activeClient === name
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          )}

          {activeGap && (
            <div className="space-y-3">
              <TrainingGroup
                title="Mandatory"
                subtitle="บังคับตามตำแหน่ง — ต้องครบก่อนลงงาน"
                dot="bg-red-500"
                group={activeGap.mandatory}
                fmtDate={fmtDate}
              />
              <TrainingGroup
                title="Assigned"
                subtitle="ตามที่บริษัทมอบหมายเพิ่ม"
                dot="bg-orange-400"
                group={activeGap.assigned}
                fmtDate={fmtDate}
              />
              <OtherGroup items={activeGap.others?.completed} />
            </div>
          )}
        </div>
      )}

      {/* ประวัติผลตรวจย้อนหลัง */}
      {data.examHistory?.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <button
            onClick={() => setShowExamHistory((p) => !p)}
            className="w-full flex items-center justify-between text-sm font-semibold text-gray-700"
          >
            <span>ประวัติผลตรวจสุขภาพ ({data.examHistory.length} ครั้ง)</span>
            <span>{showExamHistory ? "▲" : "▼"}</span>
          </button>

          {showExamHistory && (
            <div className="mt-3 space-y-2">
              {data.examHistory.map((exam) => (
                <div
                  key={exam.id}
                  className="flex items-center justify-between text-xs pb-2 border-b border-gray-100 last:border-0"
                >
                  <span className="text-gray-600">
                    {fmtDate(exam.examDate)}
                  </span>
                  {exam.flaggedAbnormal && (
                    <span className="text-orange-600 font-medium">
                      ⚠ พบความผิดปกติ
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* เปลี่ยน PIN */}
      <div className="mt-4 bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <button
          type="button"
          onClick={() => setShowChangePin((p) => !p)}
          className="w-full flex items-center justify-between text-sm font-semibold text-gray-700"
        >
          <span>🔑 เปลี่ยน PIN</span>
          <span>{showChangePin ? "▲" : "▼"}</span>
        </button>

        {showChangePin && (
          <div className="mt-4">
            <ChangePinForm
              mode="optional"
              onDone={() => setShowChangePin(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
