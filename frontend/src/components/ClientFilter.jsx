import { useContext, useEffect, useState } from "react";
import axios from "axios";
import { AppContent } from "../context/AppContext";

// ══════════════════════════════════════════════════════════
// ตัวกรองลูกค้า (โหมด multi เท่านั้น — โหมด single ไม่แสดงอะไรเลย)
//   ค่าเดียวกับตัวเลือกบน Navbar: เปลี่ยนที่หน้าไหนก็เปลี่ยนทุกหน้า และจำไว้ในเบราว์เซอร์
// ══════════════════════════════════════════════════════════

const LABEL =
  "mb-1 block text-xs font-semibold uppercase tracking-[0.4px] text-gray-500";
const FIELD =
  "box-border h-9 w-full cursor-pointer rounded-lg border bg-white px-3 text-[13px] text-gray-900 outline-none focus:border-blue-500";

export default function ClientFilter({ className = "", label = "Client" }) {
  const { isMultiClient, clients, clientFilter, setClientFilter } =
    useContext(AppContent);
  if (!isMultiClient) return null;

  const active = clientFilter !== "all";
  return (
    <div className={`min-w-0 ${className}`}>
      <label className={LABEL}>{label}</label>
      <select
        value={clientFilter}
        onChange={(e) => setClientFilter(e.target.value)}
        title="ค่าเดียวกับตัวเลือกลูกค้าบนแถบด้านบน — เปลี่ยนที่นี่จะเปลี่ยนทุกหน้า"
        className={`${FIELD} ${
          active
            ? "border-[#F16726] font-semibold text-[#c2410c]"
            : "border-gray-200"
        }`}
      >
        <option value="all">ทุกลูกค้า</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── project id → ชื่อลูกค้า (Project → Contract → Client) ──
//   ใช้กับหน้าที่ข้อมูลไม่ได้แนบชื่อลูกค้ามาด้วย (PE Approvals / Projects)
//   โหลดเฉพาะโหมด multi
export function useProjectClientMap() {
  const { backendUrl, isMultiClient } = useContext(AppContent);
  const [map, setMap] = useState(() => new Map());

  useEffect(() => {
    if (!isMultiClient) return;
    let ignore = false;
    axios
      .get(`${backendUrl}/api/allocation/projects`, { withCredentials: true })
      .then((res) => {
        if (ignore) return;
        setMap(
          new Map(
            (res.data || [])
              .filter((p) => p.contract?.client?.name)
              .map((p) => [p.id, p.contract.client.name]),
          ),
        );
      })
      .catch((err) => console.error(err));
    return () => {
      ignore = true;
    };
  }, [backendUrl, isMultiClient]);

  return map;
}
