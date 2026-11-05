import { useState } from "react";

// ══════════════════════════════════════════════════════════
// รายชื่อพนักงานที่เลือกไว้ — ใช้ร่วม BulkAddCertification / Certifications
//   variant="side" : แผงด้านขวา (xl+) ตรึงไว้ตอนเลื่อน — ค้นหา/กรองแล้วคนที่เลือกไม่หายไปจากสายตา
//   variant="bar"  : จอเล็กกว่า xl — แถบเดียวพับได้เหนือรายการ (ไม่ดันรายการลงไปมาก)
// items: [{ id, name, sub?, badge?, hidden? }]  hidden = ถูกตัวกรองซ่อนอยู่
// แสดงคนที่เลือกล่าสุดไว้บนสุด
// ══════════════════════════════════════════════════════════
export default function SelectedPeoplePanel({
  variant = "side",
  items,
  onRemove,
  onClear,
  disabled = false,
  listMaxHeight = "max-h-[480px]",
  emptyText = "ยังไม่ได้เลือก — ติ๊ก ☐ หน้าชื่อพนักงานในรายการ",
}) {
  const [open, setOpen] = useState(false);
  const hiddenCount = items.filter((i) => i.hidden).length;
  const ordered = [...items].reverse();

  const clearAll = () => {
    if (items.length > 5 && !window.confirm(`ล้างรายชื่อที่เลือกไว้ทั้ง ${items.length} คน?`)) return;
    onClear();
  };

  const list = (
    <ul className="m-0 list-none divide-y divide-gray-100 p-0">
      {ordered.map((it) => (
        <li
          key={it.id}
          className={`flex items-start justify-between gap-2 px-3 py-2 text-xs ${it.hidden ? "bg-gray-50" : ""}`}
        >
          <div className="min-w-0">
            <div className="truncate font-semibold text-gray-900" title={it.name}>
              {it.name}
            </div>
            <div className="flex flex-wrap items-center gap-1 text-[10px] text-gray-500">
              {it.sub && <span className="min-w-0 truncate">{it.sub}</span>}
              {it.badge}
              {it.hidden && (
                <span
                  className="whitespace-nowrap rounded bg-gray-200 px-1 text-gray-600"
                  title="คนนี้ยังถูกเลือกอยู่ แต่ไม่ตรงกับคำค้น/ตัวกรองตอนนี้ จึงไม่แสดงในรายการ"
                >
                  ไม่อยู่ในผลค้นหา
                </span>
              )}
            </div>
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={() => onRemove(it.id)}
              title="เอาออกจากที่เลือก"
              aria-label={`เอา ${it.name} ออก`}
              className="shrink-0 cursor-pointer rounded border-none bg-transparent px-1.5 py-0.5 text-sm leading-none text-gray-400 hover:bg-red-50 hover:text-[#dc3545]"
            >
              ✕
            </button>
          )}
        </li>
      ))}
    </ul>
  );

  const clearBtn = !disabled && items.length > 0 && (
    <button
      type="button"
      onClick={clearAll}
      className="cursor-pointer whitespace-nowrap border-none bg-transparent p-0 text-[11px] font-semibold text-[#dc3545] hover:underline"
    >
      ล้างทั้งหมด
    </button>
  );

  // ── จอเล็ก: แถบพับได้ (ไม่มีคนเลือก = ไม่แสดง กินที่) ──
  if (variant === "bar") {
    if (items.length === 0) return null;
    return (
      <div className="mb-3 overflow-hidden rounded-lg border border-[#ffe69c] bg-[#fffbe6] xl:hidden">
        <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="cursor-pointer border-none bg-transparent p-0 text-left text-xs font-semibold text-[#664d03]"
          >
            เลือกไว้ {items.length} คน
            {hiddenCount > 0 && <span className="font-normal"> · ไม่อยู่ในผลค้นหา {hiddenCount}</span>}
            <span className="ml-1.5 text-blue-600">{open ? "ซ่อนรายชื่อ ▴" : "ดูรายชื่อ ▾"}</span>
          </button>
          {clearBtn}
        </div>
        {open && <div className="max-h-[260px] overflow-y-auto border-t border-[#ffe69c] bg-white">{list}</div>}
      </div>
    );
  }

  // ── xl+: แผงด้านขวา ──
  return (
    <aside className="sticky top-3 hidden self-start overflow-hidden rounded-lg border border-gray-200 bg-white xl:block">
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-gray-900">
            เลือกไว้ <span className="text-blue-600">{items.length}</span> คน
          </div>
          {hiddenCount > 0 && (
            <div className="text-[10px] text-gray-500">ไม่อยู่ในผลค้นหาตอนนี้ {hiddenCount} คน</div>
          )}
        </div>
        {clearBtn}
      </div>
      {items.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-gray-400">{emptyText}</div>
      ) : (
        <div className={`${listMaxHeight} overflow-y-auto`}>{list}</div>
      )}
    </aside>
  );
}
