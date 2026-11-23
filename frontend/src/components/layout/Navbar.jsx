import React, { useContext, useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { AppContent } from "../../context/AppContext";
import { Bell, ChevronDown, Menu } from "lucide-react";
import { roleLabel } from "../../utils/roles";
import logo from "../../assets/experteam-logo.png";

// Navbar คลุมเต็มความกว้างด้านบน (สูง 48px) — โลโก้ + MMS System อยู่มุมซ้ายบน
// Sidebar อยู่ใต้ Navbar (ดู Layout.jsx)

const Navbar = ({ onMenuClick }) => {
  const navigate = useNavigate();
  const {
    userData,
    backendUrl,
    setIsLoggedin,
    setUserData,
    isMultiClient,
    clients,
    clientFilter,
    setClientFilter,
  } = useContext(AppContent);

  const [openNotif, setOpenNotif] = useState(false);
  const [openUser, setOpenUser] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const logout = async () => {
    try {
      axios.defaults.withCredentials = true;
      await axios.post(`${backendUrl}/api/auth/logout`);
      setIsLoggedin(false);
      setUserData(false);
      navigate("/", { replace: true });
    } catch (error) {
      console.log(error);
    }
  };

  const timeoutRef = useRef(null);
  const handleEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpenUser(true);
  };
  const handleLeave = () => {
    timeoutRef.current = setTimeout(() => setOpenUser(false), 150);
  };

  // ── Notifications: fetch + polling ทุก 30 วินาที ──
  const fetchNotifications = async () => {
    try {
      const { data } = await axios.get(`${backendUrl}/api/notifications`, {
        withCredentials: true,
      });
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (!userData) return; // ยังไม่ login ไม่ต้อง fetch
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000); // 30s
    return () => clearInterval(interval);
  }, [userData, backendUrl]);

  // กดแจ้งเตือน → mark read (ไม่ต้องรอ) — การเปลี่ยนหน้าทำโดย <Link> เอง
  // จึงคลิกขวา / Ctrl+คลิก / คลิกล้อกลาง เปิดในแท็บใหม่ได้
  const markNotifRead = async (n) => {
    if (n.isRead) return;
    try {
      await axios.put(
        `${backendUrl}/api/notifications/${n.id}/read`,
        {},
        { withCredentials: true },
      );
      fetchNotifications();
    } catch (err) {
      console.error(err);
    }
  };

  const handleNotifClick = (e, n) => {
    markNotifRead(n);
    // คลิกปกติ → ปิด dropdown / Ctrl+คลิก (เปิดแท็บใหม่) → เปิดค้างไว้
    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) setOpenNotif(false);
  };

  const handleMarkAllRead = async () => {
    try {
      await axios.put(
        `${backendUrl}/api/notifications/read-all`,
        {},
        {
          withCredentials: true,
        },
      );
      fetchNotifications();
    } catch (err) {
      console.error(err);
    }
  };

  const timeAgo = (dateStr) => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    return `${Math.floor(hrs / 24)} day ago`;
  };

  return (
    <div className="sticky top-0 z-[60] flex h-12 w-full items-center justify-between bg-[#22265f] px-2 text-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] sm:px-4">
      {/* LEFT */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          onClick={onMenuClick}
          className="rounded-lg p-1.5 text-white hover:bg-white/10 md:hidden"
          aria-label="เปิดเมนู"
        >
          <Menu size={20} />
        </button>
        <Link
          to="/"
          title="กลับหน้าแรก"
          className="flex min-w-0 items-center gap-2 text-white no-underline hover:opacity-90"
        >
          {/* โลโก้บนพื้นขาว — วงกลมขาวในโลโก้ยังเห็นชัด */}
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white p-0.5">
            <img src={logo} alt="Experteam" className="h-full w-full object-contain" />
          </span>
          <span className="truncate text-[15px] font-bold tracking-wide">
            MMS <span className="font-semibold text-[#F9A26C]">System</span>
          </span>
        </Link>
        <span className="hidden rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-indigo-100 sm:inline">
          Experteam
        </span>

        {/* ตัวเลือกลูกค้า — โหมด multi เท่านั้น (โหมด single = Chevron อย่างเดียว ไม่แสดง)
            ค่าเดียวกับช่อง Client ในหน้าต่างๆ · จำไว้ในเบราว์เซอร์ */}
        {isMultiClient && (
          <label
            className="flex min-w-0 shrink items-center gap-1.5"
            title="เลือกลูกค้า — ทุกหน้าที่มีตัวกรอง Client จะแสดงเฉพาะลูกค้านี้"
          >
            <span className="hidden text-xs text-indigo-200 md:inline">Client</span>
            <select
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              className={`h-7 min-w-0 max-w-[120px] cursor-pointer rounded-md border px-1.5 text-xs font-semibold text-white outline-none sm:max-w-[160px] [&>option]:text-gray-900 ${
                clientFilter !== "all"
                  ? "border-[#F9A26C] bg-[#F9A26C]/25"
                  : "border-white/25 bg-white/10 hover:bg-white/15"
              }`}
            >
              <option value="all">ทุกลูกค้า</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* RIGHT */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* 🔔 NOTIFICATION */}
        <div className="relative">
          <button
            onClick={() => setOpenNotif(!openNotif)}
            className="relative rounded-full p-1.5 text-white hover:bg-white/10"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute top-0 right-0 bg-red-500 text-white text-xs w-4 h-4 flex items-center justify-center rounded-full">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {openNotif && (
            <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-1.5rem)] bg-white text-gray-900 shadow-lg rounded-lg p-3 z-50 max-h-96 overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <p className="font-semibold">Notifications</p>
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Mark all read
                  </button>
                )}
              </div>
              {notifications.length === 0 ? (
                <p className="text-sm text-gray-500">No notifications</p>
              ) : (
                notifications.map((n) => {
                  const cls = `block text-sm text-inherit no-underline p-2 hover:bg-gray-100 rounded cursor-pointer ${
                    !n.isRead ? "bg-blue-50" : ""
                  }`;
                  const body = (
                    <>
                      <p className="font-medium">{n.title}</p>
                      {n.message && (
                        <p className="text-xs text-gray-600">{n.message}</p>
                      )}
                      <p className="text-xs text-gray-400">
                        {timeAgo(n.createdAt)}
                      </p>
                    </>
                  );
                  // มีลิงก์ → <Link> (เปิดแท็บใหม่ได้) / ไม่มีลิงก์ → แค่ mark read
                  return n.link ? (
                    <Link
                      key={n.id}
                      to={n.link}
                      onClick={(e) => handleNotifClick(e, n)}
                      onAuxClick={() => markNotifRead(n)}
                      className={cls}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div
                      key={n.id}
                      onClick={(e) => handleNotifClick(e, n)}
                      className={cls}
                    >
                      {body}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* 👤 USER */}
        <div
          className="relative"
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        >
          <div className="flex items-center gap-2 cursor-pointer">
            <div className="relative w-8 h-8">
              <div className="w-8 h-8 flex items-center justify-center rounded-full bg-[#F16726] text-sm font-semibold text-white overflow-hidden">
                {userData?.employee?.photoUrl ? (
                  <img
                    src={`${backendUrl}${userData.employee.photoUrl}`}
                    alt={userData.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  userData?.name?.[0]?.toUpperCase()
                )}
              </div>

              {/* ลูกศรลง — บอกว่ามี dropdown แบบ Facebook */}
              <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 flex items-center justify-center rounded-full bg-white border border-gray-200 shadow-sm">
                <ChevronDown size={10} className="text-gray-600" />
              </div>
            </div>

            <div className="hidden md:flex flex-col leading-tight">
              <span className="text-[13px] font-medium text-white">
                {userData?.titlePrefix
                  ? `${userData.titlePrefix}${userData.name}`
                  : userData?.name}
              </span>
              <span className="text-[11px] text-indigo-200">
                {roleLabel(userData)}
              </span>
            </div>
          </div>

          {openUser && (
            <div
              className="absolute right-0 top-full mt-1 bg-white text-gray-900 shadow-lg rounded-lg p-2 w-44 z-50"
              onMouseEnter={handleEnter}
              onMouseLeave={handleLeave}
            >
              <p className="px-3 py-2 text-sm font-medium">
                {userData.titlePrefix
                  ? `${userData.titlePrefix}${userData.name}`
                  : userData.name}
              </p>
              <p className="px-3 py-1 text-xs text-gray-500">
                {roleLabel(userData)}
              </p>
              <hr className="my-2" />
              <button
                onClick={() => navigate("/profile")}
                className="w-full text-left px-3 py-2 hover:bg-gray-100 rounded"
              >
                Profile
              </button>
              <button
                onClick={logout}
                className="w-full text-left px-3 py-2 hover:bg-gray-100 text-red-500 rounded"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Navbar;
