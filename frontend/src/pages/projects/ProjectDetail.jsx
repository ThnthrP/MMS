import { useState, useEffect, useContext, useRef } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import Select from "react-select";
import { AppContent } from "../../context/AppContext";
import {
  TravelModeField,
  splitTravel,
  joinTravel,
  DEFAULT_RESPONSE_DAYS,
} from "./NewRequirementModal";

// ── role badge (สีเดียวกับ AdminUsers.jsx) ──
const ROLE_CLASS = {
  admin: "bg-[#ede7f6] text-[#5e35b1]",
  manpower_supply: "bg-[#e3f2fd] text-[#1565c0]",
  project_engineer: "bg-[#fff3e0] text-[#e65100]",
  hr_officer: "bg-[#e0f2f1] text-[#00695c]",
};
const roleClass = (name) =>
  ROLE_CLASS[(name || "").toLowerCase()] || "bg-gray-100 text-gray-500";

// ── สถานะ position request ──
const requestStatusClass = (status) =>
  status === "deployed"
    ? "bg-emerald-100 text-emerald-800"
    : status === "approved" || status === "booked"
      ? "bg-cyan-100 text-cyan-800"
      : "bg-gray-200 text-gray-700";

const FILE_ICON = {
  pdf: "📄",
  xlsx: "📊",
  xls: "📊",
  doc: "📝",
  docx: "📝",
  png: "🖼",
  jpg: "🖼",
  jpeg: "🖼",
};

// ── Tailwind class ที่ใช้ซ้ำ ──
const CARD = "overflow-hidden rounded-[10px] border border-gray-200 bg-white";
const CARD_HEAD =
  "border-b border-gray-200 px-4 py-3 text-[13px] font-bold sm:px-[18px]";
const TH =
  "whitespace-nowrap px-4 py-2 text-left text-[10px] font-semibold tracking-[0.4px] text-gray-500";
const INPUT =
  "w-full box-border rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] outline-none focus:border-blue-400";
const LABEL = "mb-1.5 block text-[13px] font-semibold";
const MODAL_HEAD =
  "flex shrink-0 items-center justify-between gap-3 bg-[#1e3a5f] px-4 py-4 text-white sm:px-6";
const MODAL_FOOT =
  "flex shrink-0 flex-wrap justify-end gap-2 border-t border-gray-200 px-4 py-3.5 sm:px-6";
const BTN_CANCEL =
  "cursor-pointer rounded-lg border border-gray-200 bg-white px-5 py-2 text-[13px] hover:bg-gray-50";
const CLOSE_X =
  "shrink-0 cursor-pointer border-none bg-transparent text-xl leading-none text-white";
const EMPTY = "p-7 text-center text-xs text-gray-500";
// ปุ่ม "Go to …" เป็น <Link> → คลิกขวาเปิดแท็บใหม่ได้
const GO_BTN =
  "block w-full rounded-md border border-gray-200 bg-gray-50 p-1.5 text-center text-[11px] font-semibold text-gray-900 no-underline hover:bg-gray-100";

const fmtDateTime = (d) =>
  new Date(d).toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

// role ที่ส่งข้อความใน Discussion ได้ — ต้องตรงกับ POST_ROLES ใน backend/routes/projectMessageRoutes.js
const DISCUSSION_POST_ROLES = ["admin", "project_engineer", "manpower_supply"];

const fmtDate = (d) => (d ? new Date(d).toISOString().split("T")[0] : "—");

// ── กรอบ modal: onClose ไม่ส่ง = คลิกพื้นหลังแล้วไม่ปิด ──
function ModalShell({ onClose, zClass = "z-[999999]", maxW, children }) {
  return (
    <div
      className={`fixed inset-0 ${zClass} flex items-center justify-center bg-black/50 p-3 sm:p-5`}
      onClick={onClose}
    >
      <div
        className={`flex max-h-[90vh] w-full ${maxW} flex-col overflow-hidden rounded-[10px] bg-white`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { backendUrl, userData } = useContext(AppContent);
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);

  const canManageProjects = true;
  const canDiscuss = true;
  const canPostMessage = DISCUSSION_POST_ROLES.includes(userData?.role?.name);

  const [showAddPosition, setShowAddPosition] = useState(false);
  const [positions, setPositions] = useState([]);

  // ── Discussion state ──
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [newContent, setNewContent] = useState("");
  const [newFiles, setNewFiles] = useState([]);

  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0); // กัน flicker ตอนลากผ่าน child element

  const [sending, setSending] = useState(false);
  const discussionRef = useRef(null);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  const [selectedPositionIds, setSelectedPositionIds] = useState([]);
  const [savingPositions, setSavingPositions] = useState(false);

  // ── แก้ headcount แบบ inline ──
  const [quantityDraft, setQuantityDraft] = useState({});
  const [savingQuantityId, setSavingQuantityId] = useState(null);

  const [editingOpen, setEditingOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    location: "",
    startDate: "",
    endDate: "",
    isOffshore: false,
    travelMode: "",
    travelOther: "",
    responseDays: String(DEFAULT_RESPONSE_DAYS),
    notes: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // ลบ project ได้เฉพาะ admin ที่เป็นผู้สร้าง — backend ตัดสิน (GET /api/projects/deletable) และเช็คซ้ำตอนลบ
  const [canDelete, setCanDelete] = useState(false);

  const openEdit = () => {
    setEditForm({
      location: project.location || "",
      startDate: project.startDate ? project.startDate.slice(0, 10) : "",
      endDate: project.endDate ? project.endDate.slice(0, 10) : "",
      isOffshore: project.isOffshore ?? false,
      // วิธีเดินทาง / ระยะเวลาตอบรับ — เดิมแก้ได้แค่ใน modal ของหน้า Projects (ย้ายมาที่นี่ที่เดียว)
      ...splitTravel(project.travelMode),
      responseDays: String(project.responseDays ?? DEFAULT_RESPONSE_DAYS),
      notes: project.notes || "",
    });
    setEditingOpen(true);
  };

  const handleEditSubmit = async () => {
    try {
      setSavingEdit(true);
      await axios.put(
        `${backendUrl}/api/projects/${id}`,
        {
          name: project.name,
          contractId: project.contractId ?? project.contract?.id,
          location: editForm.location || null,
          startDate: editForm.startDate || null,
          endDate: editForm.endDate || null,
          isOffshore: editForm.isOffshore,
          travelMode: joinTravel(editForm),
          responseDays: Number(editForm.responseDays) || DEFAULT_RESPONSE_DAYS,
          notes: editForm.notes || null,
        },
        { withCredentials: true },
      );
      setEditingOpen(false);
      fetchProject();
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.message || "แก้ไข Project ไม่สำเร็จ");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    // ให้พิมพ์ ON Number ยืนยัน (เหมือนหน้า Manpower Calendar) กันกดพลาด
    const code = project.masterProjectRecord?.projectCode || project.name;
    const typed = window.prompt(
      `ลบ Project "${code} ${project.name}" ทิ้งถาวร?\n\n` +
        "⚠ การลบจะลบข้อมูลที่เกี่ยวข้องทั้งหมด (position request, shortlist, คำขอ PE, booking, assignment, mobilization checklist, ข้อความ) ไปด้วย กู้คืนไม่ได้\n\n" +
        `พิมพ์ ${code} เพื่อยืนยัน`,
    );
    if (typed === null) return;
    if (typed.trim() !== code) {
      alert("พิมพ์ไม่ตรง — ยกเลิกการลบ");
      return;
    }
    try {
      setDeleting(true);
      await axios.delete(`${backendUrl}/api/projects/${id}`, {
        withCredentials: true,
      });
      navigate("/requirements");
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.message || "ลบ Project ไม่สำเร็จ");
      setDeleting(false);
    }
  };

  const fetchProject = async () => {
    try {
      const res = await axios.get(`${backendUrl}/api/projects/${id}`, {
        withCredentials: true,
      });
      setProject(res.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPositions = async () => {
    try {
      const res = await axios.get(`${backendUrl}/api/positions/manage`, {
        withCredentials: true,
      });
      setPositions(res.data);
    } catch {
      try {
        const res2 = await axios.get(`${backendUrl}/api/positions`, {
          withCredentials: true,
        });
        setPositions(res2.data);
      } catch (e2) {
        console.error(e2);
      }
    }
  };

  const fetchMessages = async () => {
    try {
      setMessagesLoading(true);
      const res = await axios.get(`${backendUrl}/api/project-messages/${id}`, {
        withCredentials: true,
      });
      setMessages(res.data);
    } catch (error) {
      console.error(error);
    } finally {
      setMessagesLoading(false);
    }
  };

  useEffect(() => {
    fetchProject();
    fetchPositions();
    if (canDiscuss) fetchMessages();
    axios
      .get(`${backendUrl}/api/projects/deletable`, { withCredentials: true })
      .then((res) => setCanDelete((res.data?.ids || []).includes(id)))
      .catch(() => setCanDelete(false));
  }, [id]);

  // ── auto-scroll ไป discussion section ถ้ามี ?tab=discussion ──
  useEffect(() => {
    if (searchParams.get("tab") === "discussion" && discussionRef.current) {
      setTimeout(() => {
        discussionRef.current.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 300);
    }
  }, [searchParams, messagesLoading]);

  // ── auto-scroll ไปข้อความล่าสุดตอนโหลด/ส่งเสร็จ ──
  useEffect(() => {
    if (!messagesLoading) {
      messagesEndRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [messages, messagesLoading]);

  // ── กัน browser เปิดไฟล์เป็นแท็บใหม่เวลาลากไฟล์พลาดไม่ตรงกล่อง ──
  useEffect(() => {
    const preventDefaults = (e) => e.preventDefault();
    window.addEventListener("dragover", preventDefaults);
    window.addEventListener("drop", preventDefaults);
    return () => {
      window.removeEventListener("dragover", preventDefaults);
      window.removeEventListener("drop", preventDefaults);
    };
  }, []);

  useEffect(() => {
    if (project?.requests) {
      const draft = {};
      project.requests.forEach((r) => (draft[r.id] = r.quantity));
      setQuantityDraft(draft);
    }
  }, [project]);

  if (loading) return <div className="p-4 text-gray-500">Loading...</div>;
  if (!project)
    return <div className="p-4 text-gray-500">Project not found</div>;

  const totalHeadcount =
    project.requests?.reduce((sum, r) => sum + (r.quantity || 0), 0) ?? 0;
  const totalAssigned = project.assignments?.length ?? 0;
  const totalMobilized =
    project.assignments?.filter(
      (a) => a.status === "active" || a.status === "completed",
    ).length ?? 0;

  // ── กันเลือกตำแหน่งที่มี Position Request อยู่แล้วในโปรเจกต์นี้ซ้ำ ──
  //   แสดงทุกตำแหน่งรวมถึงตำแหน่งที่ยังไม่มีพนักงาน (0 คน)
  const existingPositionIds = new Set(
    (project.requests || []).map((r) => r.position?.id).filter(Boolean),
  );
  const selectablePositions = positions.filter(
    (p) => !existingPositionIds.has(p.id),
  );
  const positionOptions = selectablePositions.map((p) => ({
    value: p.id,
    label: `${p.name}${p._count ? ` (${p._count.employees})` : ""}`,
  }));

  // ── Employee Timeline: จัดกลุ่ม assignments ตาม requested position ──
  const requestedPositionByEmp = new Map();
  (project.requests || []).forEach((r) => {
    (r.bookings || []).forEach((b) => {
      if (b.employeeId) {
        requestedPositionByEmp.set(b.employeeId, r.position?.name || null);
      }
    });
  });
  const timelineGroups = new Map();
  const ungrouped = [];
  (project.assignments || []).forEach((a) => {
    const pos = requestedPositionByEmp.get(a.employeeId);
    if (pos) {
      if (!timelineGroups.has(pos)) timelineGroups.set(pos, []);
      timelineGroups.get(pos).push(a);
    } else {
      ungrouped.push(a);
    }
  });
  // เรียงกลุ่มตามลำดับ position ใน requests ก่อน ตามด้วยกลุ่มที่หา request ไม่เจอ
  const orderedPositionNames = (project.requests || [])
    .map((r) => r.position?.name)
    .filter((name) => name && timelineGroups.has(name));
  const remainingNames = [...timelineGroups.keys()].filter(
    (name) => !orderedPositionNames.includes(name),
  );
  const orderedGroups = [...orderedPositionNames, ...remainingNames].map(
    (name) => [name, timelineGroups.get(name)],
  );

  const handleAddPositions = async () => {
    if (selectedPositionIds.length === 0) return;
    try {
      setSavingPositions(true);
      await Promise.all(
        selectedPositionIds.map((positionId) =>
          axios.post(
            `${backendUrl}/api/projects/${id}/requests`,
            { positionId, quantity: 1 }, // default = 1 คน — ไปปรับต่อในตาราง
            { withCredentials: true },
          ),
        ),
      );
      setShowAddPosition(false);
      setSelectedPositionIds([]);
      fetchProject();
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.message || "เพิ่ม position ไม่สำเร็จ");
    } finally {
      setSavingPositions(false);
    }
  };

  const closeAddPosition = () => {
    setShowAddPosition(false);
    setSelectedPositionIds([]);
  };

  const handleSaveQuantity = async (reqId) => {
    const newQty = quantityDraft[reqId];
    if (!newQty || Number(newQty) < 1) return;
    try {
      setSavingQuantityId(reqId);
      await axios.put(
        `${backendUrl}/api/projects/${id}/requests/${reqId}`,
        { quantity: Number(newQty) },
        { withCredentials: true },
      );
      fetchProject();
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.message || "แก้ headcount ไม่สำเร็จ");
    } finally {
      setSavingQuantityId(null);
    }
  };

  const handleDeleteRequest = async (reqId, name) => {
    if (!confirm(`ลบ position request "${name}" ?`)) return;
    try {
      await axios.delete(`${backendUrl}/api/projects/${id}/requests/${reqId}`, {
        withCredentials: true,
      });
      fetchProject();
    } catch (error) {
      console.error(error);
      alert(
        error.response?.data?.message ||
          "ลบไม่ได้ — อาจมี shortlist/booking ผูกอยู่ หรือ backend ยังไม่มี route นี้",
      );
    }
  };

  const addFiles = (fileList) => {
    const files = Array.from(fileList || []);
    setNewFiles((prev) => [...prev, ...files].slice(0, 5));
  };

  const handleFileSelect = (e) => {
    addFiles(e.target.files);
    e.target.value = "";
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  };

  const handleDragOver = (e) => {
    e.preventDefault(); // จำเป็น — ไม่งั้น onDrop จะไม่ทำงาน
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const removeSelectedFile = (idx) => {
    setNewFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSendMessage = async () => {
    if (!newContent.trim() && newFiles.length === 0) return;
    try {
      setSending(true);
      const formData = new FormData();
      formData.append("content", newContent);
      newFiles.forEach((f) => formData.append("files", f));

      await axios.post(`${backendUrl}/api/project-messages/${id}`, formData, {
        withCredentials: true,
        headers: { "Content-Type": "multipart/form-data" },
      });

      setNewContent("");
      setNewFiles([]);
      fetchMessages();
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.message || "ส่งข้อความไม่สำเร็จ");
    } finally {
      setSending(false);
    }
  };

  const sendDisabled = sending || (!newContent.trim() && newFiles.length === 0);
  const addPosDisabled = selectedPositionIds.length === 0 || savingPositions;

  const renderTimelineTable = (rows) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-xs">
        <thead>
          <tr className="bg-gray-50">
            {["NAME", "MOB DATE", "D-MOB DATE", "PLATFORM"].map((h, hi) => (
              <th
                key={h}
                className={`${TH} py-1.5 ${
                  hi === 0
                    ? "sticky left-0 z-[1] bg-gray-50 shadow-[1px_0_0_#f1f3f5]"
                    : ""
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const employeePosition = a.employee?.position?.name || "";
            return (
              <tr key={a.id} className="border-t border-gray-100">
                <td className="sticky left-0 z-[1] bg-white px-4 py-1.5 shadow-[1px_0_0_#f1f3f5]">
                  <div className="font-semibold">
                    {a.employee?.fullName || "—"}
                  </div>
                  <div className="text-[10px] text-gray-500">
                    {a.employee?.empCode || ""}
                    {employeePosition ? ` · ${employeePosition}` : ""}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-1.5">
                  {fmtDate(a.mobDate)}
                </td>
                <td className="whitespace-nowrap px-4 py-1.5">
                  {fmtDate(a.demobDate)}
                </td>
                <td className="px-4 py-1.5">{a.platform || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1800px]">
      {/* Back + Header */}
      <div className="mb-5">
        <Link
          to="/requirements"
          className="mb-2 inline-block text-[13px] text-gray-500 no-underline hover:text-gray-700"
        >
          ← Manpower Requirements
        </Link>
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h4 className="mb-1 break-words text-xl font-bold">
              {project.name}
            </h4>
            <span className="text-[13px] text-gray-500">
              {project.masterProjectRecord?.projectCode && (
                <span className="mr-1.5 font-mono text-blue-700">
                  {project.masterProjectRecord.projectCode}
                </span>
              )}
              {project.contract?.client?.name} — {project.contract?.name}
            </span>
          </div>
          {canManageProjects && (
            <div className="flex shrink-0 gap-2">
              <button
                onClick={openEdit}
                className="flex-1 cursor-pointer rounded-lg border border-gray-200 bg-white px-3.5 py-[7px] text-xs font-semibold hover:bg-gray-50 sm:flex-none"
              >
                ✏️ Edit
              </button>
              {canDelete && (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  title="ลบ project นี้ (เฉพาะ project ที่คุณสร้าง)"
                  className="flex-1 cursor-pointer rounded-lg border border-red-200 bg-white px-3.5 py-[7px] text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed sm:flex-none"
                >
                  {deleting ? "กำลังลบ..." : "🗑 Delete"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ══════════════ Layout: 2 คอลัมน์ที่ xl, ต่ำกว่านั้นเรียงแนวตั้ง ══════════════ */}
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* ═══════════ คอลัมน์ขวา (ข้อมูลสรุป) ═══════════
            มือถือ/แท็บเล็ต: ขึ้นก่อน (order-first) ให้เห็นข้อมูลโปรเจกต์ก่อน
            xl: กลับไปอยู่ขวา + sticky ใต้ navbar */}
        <div className="order-first grid grid-cols-1 gap-5 md:grid-cols-2 xl:order-none xl:col-start-2 xl:row-start-1 xl:sticky xl:top-20 xl:grid-cols-1">
          {/* General Information */}
          <div className={CARD}>
            <div className={CARD_HEAD}>General Information</div>
            <div className="px-4 py-2.5 sm:px-[18px]">
              {[
                ["Client", project.contract?.client?.name],
                ["Contract", project.contract?.name],
                ["Location", project.location],
                ["Start", fmtDate(project.startDate)],
                ["End", fmtDate(project.endDate)],
                ["Offshore", project.isOffshore ? "Yes" : "No"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex justify-between gap-2 border-b border-gray-100 py-1.5 text-xs"
                >
                  <span className="shrink-0 text-gray-500">{label}</span>
                  <span className="truncate text-right font-semibold">
                    {value || "—"}
                  </span>
                </div>
              ))}
              {project.notes && (
                <div className="mt-2">
                  <div className="mb-1 text-[10px] font-semibold uppercase text-gray-500">
                    Notes
                  </div>
                  <div className="whitespace-pre-wrap break-words text-xs text-gray-700">
                    {project.notes}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Allocation + Mobilization */}
          <div className={CARD}>
            <div className="px-4 py-4 sm:px-[18px]">
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-xs text-gray-500">Allocation</span>
                <span className="text-xl font-bold text-blue-600">
                  {totalAssigned}/{totalHeadcount}
                </span>
              </div>
              <Link
                to={`/allocation?projectId=${project.id}`}
                className={`${GO_BTN} mb-3.5`}
              >
                Go to Allocation →
              </Link>

              <div className="mb-1 flex items-baseline justify-between border-t border-gray-100 pt-3">
                <span className="text-xs text-gray-500">Mobilization</span>
                <span className="text-xl font-bold text-[#198754]">
                  {totalMobilized}/{totalAssigned}
                </span>
              </div>
              <Link
                to={`/mobilization?projectId=${project.id}`}
                className={GO_BTN}
              >
                Go to Mobilization →
              </Link>
            </div>
          </div>
        </div>

        {/* ═══════════ คอลัมน์ซ้าย (กว้าง) ═══════════ */}
        <div className="flex min-w-0 flex-col gap-5 xl:col-start-1 xl:row-start-1">
          {/* Position Requests */}
          <div className={CARD}>
            <div className={`${CARD_HEAD} flex items-center justify-between`}>
              <span>Position Requests</span>
              {canManageProjects && (
                <button
                  onClick={() => setShowAddPosition(true)}
                  className="cursor-pointer rounded-md border-none bg-blue-600 px-3 py-[5px] text-[11px] font-semibold text-white hover:bg-blue-700"
                >
                  + Add Position
                </button>
              )}
            </div>
            {!project.requests || project.requests.length === 0 ? (
              <div className={EMPTY}>
                No position requests yet — click + Add Position to get started
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-xs">
                  <thead>
                    <tr className="bg-gray-50">
                      {[
                        "POSITION",
                        "HEADCOUNT",
                        "BOOKED", // จองงานแล้ว (หลัง approve) — ชื่อที่จัดแล้วดูที่ Manpower Requirements / Assign Names
                        "STATUS",
                        ...(canManageProjects ? [""] : []),
                      ].map((h, hi) => (
                        <th
                          key={hi}
                          className={`${TH} ${h === "" ? "text-center" : ""} ${
                            hi === 0
                              ? "sticky left-0 z-[1] bg-gray-50 shadow-[1px_0_0_#f1f3f5]"
                              : ""
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {project.requests.map((r) => (
                      <tr key={r.id} className="border-t border-gray-100">
                        <td className="sticky left-0 z-[1] bg-white px-4 py-2 font-semibold shadow-[1px_0_0_#f1f3f5]">
                          {r.position?.name || "—"}
                        </td>
                        <td className="px-4 py-2">
                          {canManageProjects ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min="1"
                                value={quantityDraft[r.id] ?? r.quantity}
                                onChange={(e) =>
                                  setQuantityDraft((prev) => ({
                                    ...prev,
                                    [r.id]: e.target.value,
                                  }))
                                }
                                className="w-[54px] rounded-md border border-gray-300 px-1.5 py-[3px] text-xs"
                              />
                              {Number(quantityDraft[r.id]) !== r.quantity && (
                                <button
                                  onClick={() => handleSaveQuantity(r.id)}
                                  disabled={savingQuantityId === r.id}
                                  title="บันทึก headcount"
                                  className="cursor-pointer rounded-md border-none bg-[#198754] px-2 py-[3px] text-[10px] font-semibold text-white"
                                >
                                  {savingQuantityId === r.id ? "..." : "✓"}
                                </button>
                              )}
                            </div>
                          ) : (
                            r.quantity
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2">
                          {r.bookings?.length ?? 0} / {r.quantity}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${requestStatusClass(r.status)}`}
                          >
                            {r.status || "draft"}
                          </span>
                        </td>
                        {canManageProjects && (
                          <td className="px-4 py-2 text-center">
                            <button
                              title="ลบ position request"
                              onClick={() =>
                                handleDeleteRequest(
                                  r.id,
                                  r.position?.name || "",
                                )
                              }
                              className="cursor-pointer rounded-md border border-red-200 bg-white px-[7px] py-[3px] text-xs leading-none hover:bg-red-50"
                            >
                              🗑
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ════════ Employee Timeline ════════ */}
          <div className={CARD}>
            <div className={CARD_HEAD}>
              Employee Timeline ({project.assignments?.length ?? 0} คน)
            </div>
            {!project.assignments || project.assignments.length === 0 ? (
              <div className={EMPTY}>
                ยังไม่มีพนักงานถูก mobilize เข้าโปรเจกต์นี้
              </div>
            ) : (
              <div>
                {orderedGroups.map(([posName, rows]) => (
                  <div key={posName} className="border-t border-gray-100">
                    <div className="flex justify-between gap-2 bg-[#fafbfc] px-4 py-2 text-[11px] font-bold text-gray-700">
                      <span>{posName}</span>
                      <span className="shrink-0 font-medium text-gray-500">
                        {rows.length} คน
                      </span>
                    </div>
                    {renderTimelineTable(rows)}
                  </div>
                ))}

                {ungrouped.length > 0 && (
                  <div className="border-t border-gray-100">
                    <div className="bg-[#fafbfc] px-4 py-2 text-[11px] font-bold text-gray-400">
                      ไม่พบ Position Request ที่ตรงกัน ({ungrouped.length} คน)
                    </div>
                    {renderTimelineTable(ungrouped)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ════════ Discussion — PE ↔ MP ════════ */}
          {canDiscuss && (
            <div
              ref={discussionRef}
              onDragEnter={canPostMessage ? handleDragEnter : undefined}
              onDragOver={canPostMessage ? handleDragOver : undefined}
              onDragLeave={canPostMessage ? handleDragLeave : undefined}
              onDrop={canPostMessage ? handleDrop : undefined}
              className={`relative scroll-mt-20 overflow-hidden rounded-[10px] bg-white transition-[border] duration-150 ${
                isDragging
                  ? "border-2 border-dashed border-blue-600"
                  : "border border-gray-200"
              }`}
            >
              {isDragging && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-blue-600/[0.08] text-[15px] font-bold text-blue-600">
                  📎 วางไฟล์ตรงนี้เพื่อแนบ
                </div>
              )}
              <div
                className={`${CARD_HEAD} flex flex-wrap items-center gap-x-2 gap-y-1`}
              >
                <span className="text-[15px]">💬</span>
                <span>Discussion — PE ↔ Manpower</span>
                <span className="basis-full text-[10px] font-normal text-gray-400 md:basis-auto">
                  (ส่งไฟล์ CV/Roster/Skill Matrix และคุยผลจากลูกค้าที่นี่ —
                  ลากไฟล์มาวางในกล่องนี้ หรือกด 📎 เพื่อแนบ)
                </span>
              </div>

              {/* Messages list */}
              <div className="flex max-h-[420px] flex-col gap-2.5 overflow-y-auto bg-[#fafbfc] px-3 py-3.5 sm:px-[18px]">
                {messagesLoading ? (
                  <div className="p-[18px] text-center text-xs text-gray-500">
                    Loading...
                  </div>
                ) : messages.length === 0 ? (
                  <div className="p-5 text-center text-xs text-gray-400">
                    ยังไม่มีข้อความ — เริ่มพิมพ์ด้านล่าง
                    หรือลากไฟล์มาวางในกล่องนี้ได้เลย 📎
                  </div>
                ) : (
                  messages.map((m) => {
                    const isMine = m.sender?.id === userData?.id;
                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}
                      >
                        <div
                          className={`mb-[3px] flex flex-wrap items-center gap-1.5 ${
                            isMine ? "flex-row-reverse" : "flex-row"
                          }`}
                        >
                          <span className="text-[11px] font-bold">
                            {m.sender?.name || "—"}
                          </span>
                          <span
                            className={`rounded-[5px] px-1.5 py-px text-[9px] font-bold capitalize ${roleClass(m.sender?.role?.name)}`}
                          >
                            {m.sender?.role?.name || "—"}
                          </span>
                          <span className="text-[9px] text-gray-400">
                            {fmtDateTime(m.createdAt)}
                          </span>
                        </div>

                        <div
                          className={`min-w-0 max-w-[88%] rounded-[10px] px-3 py-2 sm:max-w-[75%] ${
                            isMine
                              ? "bg-blue-600 text-white"
                              : "border border-gray-200 bg-white text-gray-900"
                          }`}
                        >
                          {m.content && (
                            <div
                              className={`whitespace-pre-wrap break-words text-xs ${
                                m.attachments?.length > 0 ? "mb-1.5" : ""
                              }`}
                            >
                              {m.content}
                            </div>
                          )}
                          {m.attachments?.length > 0 && (
                            <div className="flex flex-col gap-[5px]">
                              {m.attachments.map((att) => (
                                <a
                                  key={att.id}
                                  href={`${backendUrl}${att.filePath}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={`flex min-w-0 items-center gap-[5px] rounded-md px-2 py-[5px] text-[11px] font-semibold no-underline ${
                                    isMine
                                      ? "bg-white/15 text-white"
                                      : "bg-gray-100 text-blue-600"
                                  }`}
                                >
                                  <span className="shrink-0">
                                    {FILE_ICON[att.fileType] || "📎"}
                                  </span>
                                  <span className="truncate">
                                    {att.fileName}
                                  </span>
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input area — role อื่นดูได้อย่างเดียว */}
              {!canPostMessage ? (
                <div className="border-t border-gray-200 px-4 py-3 text-center text-[11px] text-gray-400 sm:px-[18px]">
                  ดูได้อย่างเดียว — ส่งข้อความได้เฉพาะ PE และ Manpower
                </div>
              ) : (
              <div className="border-t border-gray-200 px-3 py-3 sm:px-[18px]">
                {newFiles.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {newFiles.map((f, i) => (
                      <span
                        key={i}
                        className="flex max-w-full items-center gap-1.5 rounded-md bg-gray-200 px-2 py-1 text-[11px]"
                      >
                        <span className="truncate">📎 {f.name}</span>
                        <button
                          onClick={() => removeSelectedFile(i)}
                          className="shrink-0 cursor-pointer border-none bg-transparent p-0 text-[11px] text-red-600"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-end gap-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    multiple
                    accept=".pdf,.xlsx,.xls,.doc,.docx,.png,.jpg,.jpeg"
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={newFiles.length >= 5}
                    title="แนบไฟล์ (สูงสุด 5 ไฟล์)"
                    className="shrink-0 cursor-pointer rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-[15px] disabled:cursor-not-allowed"
                  >
                    📎
                  </button>
                  <textarea
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder="พิมพ์ข้อความ... (Enter เพื่อส่ง, Shift+Enter ขึ้นบรรทัดใหม่)"
                    rows={1}
                    className="min-w-0 flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 font-[inherit] text-xs outline-none focus:border-blue-400"
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={sendDisabled}
                    className={`shrink-0 rounded-lg border-none px-4 py-2 text-xs font-semibold text-white ${
                      sendDisabled
                        ? "cursor-not-allowed bg-gray-400"
                        : "cursor-pointer bg-blue-600 hover:bg-blue-700"
                    }`}
                  >
                    {sending ? "..." : "ส่ง"}
                  </button>
                </div>
              </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ════════ Add Position Modal (คลิกพื้นหลังไม่ปิด — เหมือนเดิม) ════════ */}
      {showAddPosition && canManageProjects && (
        <ModalShell maxW="max-w-[700px]">
          <div className={MODAL_HEAD}>
            <span className="text-[15px] font-semibold">
              Add Position Request
            </span>
            <button onClick={closeAddPosition} className={CLOSE_X}>
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            <label className={LABEL}>
              Position * (เลือกได้หลายตำแหน่ง —{" "}
              <span className="font-normal text-gray-500">
                เฉพาะตำแหน่งที่ยังไม่มีใน request ของโปรเจกต์นี้
              </span>
              )
            </label>

            <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-[1fr_260px] sm:gap-5">
              {/* ── ช่องค้นหา/dropdown ── */}
              <div className="min-w-0">
                <Select
                  isMulti
                  options={positionOptions}
                  value={positionOptions.filter((o) =>
                    selectedPositionIds.includes(o.value),
                  )}
                  onChange={(selected) =>
                    setSelectedPositionIds((selected || []).map((o) => o.value))
                  }
                  placeholder="ค้นหา / เลือกตำแหน่ง..."
                  menuPortalTarget={
                    typeof document !== "undefined" ? document.body : null
                  }
                  menuPosition="fixed"
                  hideSelectedOptions={false}
                  closeMenuOnSelect={false}
                  components={{ MultiValue: () => null }}
                  // ช่องติ๊กหน้าแต่ละรายการ — บอกว่าเลือกอยู่ และคลิกซ้ำเพื่อเอาออกได้
                  formatOptionLabel={(o, { context }) =>
                    context === "menu" ? (
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          readOnly
                          tabIndex={-1}
                          checked={selectedPositionIds.includes(o.value)}
                          className="pointer-events-none h-3.5 w-3.5 shrink-0"
                        />
                        <span>{o.label}</span>
                      </span>
                    ) : (
                      o.label
                    )
                  }
                  styles={{
                    menuPortal: (b) => ({ ...b, zIndex: 1000000 }),
                    control: (b) => ({
                      ...b,
                      fontSize: "13px",
                      minHeight: "38px",
                    }),
                    // รายการที่เลือกแล้ว = พื้นฟ้าอ่อน + ตัวหนา (แยกจากแถบ hover ชัดขึ้น)
                    option: (b, s) => ({
                      ...b,
                      fontSize: "13px",
                      cursor: "pointer",
                      backgroundColor: s.isSelected
                        ? s.isFocused
                          ? "#dbeafe"
                          : "#eff6ff"
                        : s.isFocused
                          ? "#f3f4f6"
                          : "white",
                      color: s.isSelected ? "#1d4ed8" : "#111827",
                      fontWeight: s.isSelected ? 600 : 400,
                    }),
                    valueContainer: (b) => ({ ...b, flexWrap: "nowrap" }),
                  }}
                  noOptionsMessage={() =>
                    positions.length === 0
                      ? "ไม่มีตำแหน่ง"
                      : "ทุกตำแหน่งถูกเพิ่มเข้า request ของโปรเจกต์นี้แล้ว"
                  }
                />
                <div className="mt-2.5 text-[11px] text-gray-400">
                  คลิกรายการที่ติ๊กไว้อีกครั้งเพื่อเอาออก · Headcount เริ่มต้น =
                  1 คนต่อตำแหน่ง ปรับได้ในตารางหลังเพิ่มแล้ว
                </div>
              </div>

              {/* ── รายการที่เลือกแล้ว ── */}
              <div className="max-h-[260px] overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2.5">
                <div className="mb-2 text-[11px] font-bold uppercase text-gray-500">
                  เลือกแล้ว ({selectedPositionIds.length})
                </div>
                {selectedPositionIds.length === 0 ? (
                  <div className="text-xs text-gray-400">ยังไม่ได้เลือก</div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {selectedPositionIds.map((posId) => {
                      const opt = positionOptions.find(
                        (o) => o.value === posId,
                      );
                      if (!opt) return null;
                      return (
                        <div
                          key={posId}
                          className="flex items-start justify-between gap-1.5 rounded-md bg-blue-50 px-2 py-[5px] text-xs font-semibold text-blue-600"
                        >
                          {/* ชื่อยาวขึ้นบรรทัดใหม่ — ไม่ตัดเป็น … */}
                          <span className="min-w-0 break-words leading-snug">
                            {opt.label}
                          </span>
                          <button
                            title="เอาออก"
                            onClick={() =>
                              setSelectedPositionIds((prev) =>
                                prev.filter((pid) => pid !== posId),
                              )
                            }
                            className="shrink-0 cursor-pointer border-none bg-transparent p-0 text-[13px] leading-none text-blue-600"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={MODAL_FOOT}>
            <button onClick={closeAddPosition} className={BTN_CANCEL}>
              Cancel
            </button>
            <button
              onClick={handleAddPositions}
              disabled={addPosDisabled}
              className={`rounded-lg border-none px-5 py-2 text-[13px] font-semibold text-white ${
                addPosDisabled
                  ? "cursor-not-allowed bg-gray-400"
                  : "cursor-pointer bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {savingPositions
                ? "Saving..."
                : `Save (${selectedPositionIds.length})`}
            </button>
          </div>
        </ModalShell>
      )}

      {/* ════════ Edit Project Modal ════════ */}
      {editingOpen && canManageProjects && (
        <ModalShell
          onClose={() => setEditingOpen(false)}
          zClass="z-[1000002]"
          maxW="max-w-[560px]"
        >
          <div className={MODAL_HEAD}>
            <div className="min-w-0">
              <div className="text-base font-semibold">✏️ Edit Project</div>
              <div className="mt-0.5 break-words text-xs opacity-80">
                {project.name}
              </div>
            </div>
            <button onClick={() => setEditingOpen(false)} className={CLOSE_X}>
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={LABEL}>Location / Site</label>
                <input
                  type="text"
                  value={editForm.location}
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      location: e.target.value,
                    }))
                  }
                  className={INPUT}
                />
              </div>
              <div>
                <label className={LABEL}>Onshore / Offshore</label>
                <select
                  value={editForm.isOffshore ? "offshore" : "onshore"}
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      isOffshore: e.target.value === "offshore",
                    }))
                  }
                  className={INPUT}
                >
                  <option value="onshore">Onshore</option>
                  <option value="offshore">Offshore (นอกชายฝั่ง)</option>
                </select>
              </div>
              <div>
                <label className={LABEL}>Start Date</label>
                <input
                  type="date"
                  value={editForm.startDate}
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      startDate: e.target.value,
                    }))
                  }
                  className={INPUT}
                />
              </div>
              <div>
                <label className={LABEL}>End Date</label>
                <input
                  type="date"
                  value={editForm.endDate}
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      endDate: e.target.value,
                    }))
                  }
                  className={INPUT}
                />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TravelModeField form={editForm} setForm={setEditForm} />
              <div>
                <label className={LABEL}>พนักงานต้องตอบรับภายใน (วัน)</label>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={editForm.responseDays}
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      responseDays: e.target.value,
                    }))
                  }
                  className={INPUT}
                />
                <div className="mt-1 text-[11px] text-gray-400">
                  นับจากวันที่ approve ที่หน้า Assign Names — แสดงให้พนักงานเห็นใน
                  Worker App
                </div>
              </div>
            </div>
            <div className="mt-4">
              <label className={LABEL}>Notes</label>
              <textarea
                rows={3}
                value={editForm.notes}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, notes: e.target.value }))
                }
                className={`${INPUT} resize-y`}
              />
            </div>
          </div>

          <div className={MODAL_FOOT}>
            <button
              onClick={() => setEditingOpen(false)}
              className={BTN_CANCEL}
            >
              Cancel
            </button>
            <button
              onClick={handleEditSubmit}
              disabled={savingEdit}
              className={`rounded-lg border-none px-5 py-2 text-[13px] font-semibold text-white ${
                savingEdit
                  ? "cursor-not-allowed bg-gray-400"
                  : "cursor-pointer bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {savingEdit ? "กำลังบันทึก..." : "บันทึก"}
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
