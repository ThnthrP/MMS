import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Search,
  X,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronsDownUp,
  ChevronsUpDown,
} from "lucide-react";

import { AppContent } from "../../context/AppContext";
import { APP_MENU, findMenuEntry, visibleTabs } from "./sidebarMenu";

// ══════════════════════════════════════════════════════════
// Sidebar — พื้นเทาอ่อน ตัดกับเนื้อหาพื้นขาว · อยู่ใต้ Navbar (โลโก้ + MMS System ย้ายไปอยู่ที่ Navbar แล้ว)
//   • ช่องค้นหาเมนู (ค้นทั้งชื่อเมนูและชื่อแท็บ เช่น "PE Approvals")
//   • ใต้ช่องค้นหา: ปุ่ม Collapse (ย่อเหลือแต่ icon · จำค่าไว้ในเบราว์เซอร์) + Collapse all / Expand all (พับ/กางทุก section)
//     — วางบนสุดคู่กับช่องค้นหา (แบบ CES) ไม่กินพื้นที่ล่างของรายการเมนู
//   • กดชื่อ section เพื่อพับ/กาง · section ที่พับอยู่แต่มีหน้าปัจจุบัน → จุดส้มที่หัว section
//   • โหมด icon: ปุ่ม » (ขยาย) อยู่บนสุด · กดไอคอนค้นหา = ขยาย + โฟกัสช่องค้นหาให้พิมพ์ได้ทันที
//   • มือถือ: เลื่อนออกมาทับหน้า (open / onClose จาก Layout)
//
// ใช้ <Link> (แท็ก <a href>) → คลิกขวา "เปิดในแท็บใหม่", Ctrl/Cmd+คลิก ใช้ได้ปกติ
// ══════════════════════════════════════════════════════════

const ITEM_BASE =
  "group flex items-center gap-2.5 rounded-md py-1.5 text-[13px] no-underline transition";
const ITEM_ACTIVE = "bg-white font-semibold text-[#c2410c] shadow-[inset_3px_0_0_#F16726]";
const ITEM_IDLE = "text-gray-700 hover:bg-gray-200/70 hover:text-gray-900";

// ปุ่มใต้ช่องค้นหา (Collapse / Collapse all) และปุ่มในโหมด icon
const CTRL_BTN =
  "flex-1 cursor-pointer items-center justify-center gap-1 rounded-md border border-gray-200 bg-white py-1 text-[11px] text-gray-600 hover:bg-gray-50 hover:text-gray-900 disabled:cursor-default disabled:opacity-50";
const RAIL_BTN =
  "flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-800";

const SECTIONS_KEY ="sidebar_collapsed_sections";

const readSet = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(SECTIONS_KEY) || "[]"));
  } catch {
    return new Set();
  }
};
const writeSet = (s) => {
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
};

const Sidebar = ({
  open = false,
  onClose = () => {},
  collapsed = false,
  onToggleCollapsed = () => {},
}) => {
  const location = useLocation();
  const { userData } = useContext(AppContent);
  const [q, setQ] = useState("");
  const [closedSections, setClosedSections] = useState(readSet);

  // มือถือแสดงเต็มเสมอ — ย่อเหลือ icon เฉพาะจอ md ขึ้นไป
  const rail = collapsed && !open;

  // กดไอคอนค้นหาในโหมด icon → ขยายเมนูแล้วโฟกัสช่องค้นหา
  const searchRef = useRef(null);
  const [focusSearch, setFocusSearch] = useState(false);
  useEffect(() => {
    if (!rail && focusSearch) {
      searchRef.current?.focus();
      setFocusSearch(false);
    }
  }, [rail, focusSearch]);
  const openSearch = () => {
    setFocusSearch(true);
    onToggleCollapsed();
  };

  // กด Esc ปิดเมนู (มือถือ)
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // เมนูที่หน้าปัจจุบันอยู่ใต้ (รวมหน้าลูก เช่น /workers/:id → Worker Pool)
  const currentItem = findMenuEntry(location.pathname)?.item;

  const handleNav = (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    setQ("");
    onClose();
  };

  // เมนูที่ role เข้าได้ + กรองตามคำค้น
  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    return APP_MENU.map((group) => {
      const items = group.items
        .map((item) => ({ item, tabs: visibleTabs(item, userData) }))
        .filter(({ tabs }) => tabs.length > 0)
        .map(({ item, tabs }) => {
          if (!term) return { item, tabs, hit: null };
          if (item.name.toLowerCase().includes(term)) return { item, tabs, hit: null };
          // ค้นเจอที่ชื่อแท็บ → ลิงก์ไปแท็บนั้นตรงๆ
          const tab = tabs.find((t) => t.name.toLowerCase().includes(term));
          return tab ? { item, tabs, hit: tab } : null;
        })
        .filter(Boolean);
      return { section: group.section, items };
    }).filter((g) => g.items.length > 0);
  }, [q, userData]);

  const searching = q.trim() !== "";
  const allClosed = groups.length > 0 && groups.every((g) => closedSections.has(g.section));

  const toggleSection = (name) => {
    const next = new Set(closedSections);
    next.has(name) ? next.delete(name) : next.add(name);
    setClosedSections(next);
    writeSet(next);
  };
  const toggleAll = () => {
    const next = allClosed ? new Set() : new Set(groups.map((g) => g.section));
    setClosedSections(next);
    writeSet(next);
  };

  return (
    <>
      {/* ฉากหลังมืด — มือถือเท่านั้น */}
      {open && (
        <div className="fixed inset-0 top-12 z-[45] bg-black/40 md:hidden" onClick={onClose} />
      )}

      <aside
        className={`fixed bottom-0 left-0 top-12 z-50 flex shrink-0 flex-col border-r border-gray-200 bg-[#f6f7f9]
          transition-[transform,width] duration-200
          ${open ? "translate-x-0" : "-translate-x-full"}
          ${rail ? "w-14" : "w-60"}
          md:sticky md:top-12 md:z-30 md:self-start md:h-[calc(100vh-3rem)] md:translate-x-0`}
      >
        {/* ── ค้นหาเมนู + ปุ่มควบคุมเมนู (บนสุด) ── */}
        {rail ? (
          <div className="flex shrink-0 flex-col items-center gap-1.5 border-b border-gray-200 pb-2 pt-3">
            <button
              type="button"
              onClick={onToggleCollapsed}
              title="ขยายเมนู"
              className={RAIL_BTN}
            >
              <ChevronsRight size={15} />
            </button>
            <button type="button" onClick={openSearch} title="ค้นหาเมนู" className={RAIL_BTN}>
              <Search size={15} />
            </button>
          </div>
        ) : (
          <div className="shrink-0 border-b border-gray-200 px-3 pb-2 pt-3">
            <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 focus-within:border-[#F16726]">
              <Search size={14} className="shrink-0 text-gray-400" />
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setQ("")}
                placeholder="ค้นหาเมนู…"
                className="min-w-0 flex-1 border-none bg-transparent text-[13px] outline-none"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  title="ล้าง"
                  className="flex cursor-pointer border-none bg-transparent p-0 text-gray-400 hover:text-gray-700"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="mt-1.5 flex gap-1.5">
              {/* มือถือไม่มีโหมด icon → ซ่อนปุ่ม Collapse */}
              <button
                type="button"
                onClick={onToggleCollapsed}
                title="ย่อเมนูเหลือแต่ไอคอน"
                className={`${CTRL_BTN} hidden md:flex`}
              >
                <ChevronsLeft size={13} /> Collapse
              </button>
              <button
                type="button"
                onClick={toggleAll}
                disabled={searching}
                title={searching ? "ล้างคำค้นก่อน" : allClosed ? "กางทุก section" : "พับทุก section"}
                className={`${CTRL_BTN} flex`}
              >
                {allClosed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
                {allClosed ? "Expand all" : "Collapse all"}
              </button>
            </div>
          </div>
        )}

        {/* ── รายการเมนู (scroll เฉพาะส่วนนี้) ── */}
        <nav
          className={`min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3 pt-2 [scrollbar-width:thin] ${
            rail ? "px-2" : "px-3"
          }`}
        >
          {groups.length === 0 && (
            <div className="px-2 py-6 text-center text-xs text-gray-400">ไม่พบเมนู “{q}”</div>
          )}
          {groups.map((group, idx) => {
            const closed = !searching && !rail && closedSections.has(group.section);
            const hasCurrent = closed && group.items.some(({ item }) => item === currentItem);
            return (
              <div key={group.section || idx} className={idx > 0 ? "mt-2" : ""}>
                {rail ? (
                  idx > 0 && <div className="mx-1 mb-2 border-t border-gray-200" />
                ) : (
                  group.section && (
                    <button
                      type="button"
                      onClick={() => toggleSection(group.section)}
                      className="flex w-full cursor-pointer items-center justify-between border-none bg-transparent px-1 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-600"
                    >
                      <span className="flex items-center gap-1.5">
                        {group.section}
                        {hasCurrent && (
                          <span
                            title={`หน้าปัจจุบันอยู่ในหมวดนี้ (${currentItem.name})`}
                            className="h-1.5 w-1.5 rounded-full bg-[#F16726]"
                          />
                        )}
                      </span>
                      <ChevronDown
                        size={13}
                        className={`transition-transform ${closed ? "-rotate-90" : ""}`}
                      />
                    </button>
                  )
                )}
                {!closed && (
                  <div className="flex flex-col gap-0.5">
                    {group.items.map(({ item, tabs, hit }) => {
                      const active = currentItem === item;
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.name}
                          to={(hit || tabs[0]).path}
                          onClick={handleNav}
                          title={rail ? item.name : undefined}
                          aria-current={active ? "page" : undefined}
                          className={`${ITEM_BASE} ${rail ? "justify-center px-0" : "px-2.5"} ${
                            active ? ITEM_ACTIVE : ITEM_IDLE
                          }`}
                        >
                          {Icon && (
                            <Icon
                              size={17}
                              strokeWidth={1.9}
                              className={`shrink-0 ${active ? "text-[#F16726]" : "text-gray-500 group-hover:text-gray-700"}`}
                            />
                          )}
                          {!rail && (
                            <span className="min-w-0 truncate">
                              {item.name}
                              {hit && (
                                <span className="ml-1 text-[11px] font-normal text-gray-400">› {hit.name}</span>
                              )}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
};

export default Sidebar;
