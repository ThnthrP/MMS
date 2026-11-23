import { createContext, useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { MULTI_CLIENT, sortClients, sameClient } from "../utils/clientMode";
// import { toast } from "react-toastify";

export const AppContent = createContext();

// ── ลูกค้าที่เลือกไว้ (โหมด multi) — จำไว้ในเบราว์เซอร์ ใช้ร่วมกันทุกหน้า ──
//   "all" = ทุกลูกค้า · หรือ id ของ Client
//   โหมด single: เป็น "all" เสมอ (ระบบนี้มีแต่ Chevron) และไม่แสดงตัวเลือก
const CLIENT_FILTER_KEY = "mms_client_filter";

const readClientFilter = () => {
  if (!MULTI_CLIENT) return "all";
  try {
    return localStorage.getItem(CLIENT_FILTER_KEY) || "all";
  } catch {
    return "all";
  }
};

export const AppContextProvider = (props) => {
  axios.defaults.withCredentials = true;

  const backendUrl = import.meta.env.VITE_BACKEND_URL;
  const [isLoggedin, setIsLoggedin] = useState(false);
  // const [userData, setUserData] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);

  const [clients, setClients] = useState([]);
  const [clientFilter, setClientFilterState] = useState(readClientFilter);

  const checkAuth = async () => {
    try {
      const { data } = await axios.get(backendUrl + "/api/auth/is-auth", {
        withCredentials: true,
      });

      if (data.success) {
        const user = await getUserData();

        if (user) {
          setIsLoggedin(true);
        } else {
          setIsLoggedin(false);
        }
      } else {
        setIsLoggedin(false);
      }
    } catch {
      setIsLoggedin(false);
      setUserData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getUserData = async () => {
    try {
      const { data } = await axios.get(
        backendUrl + "/api/user/data",
        { withCredentials: true }, // 🔥 เพิ่มตรงนี้
      );

      if (data.success) {
        setUserData(data.userData);
        return data.userData;
      }

      return null;
    } catch (err) {
      console.log("GET USER ERROR:", err);
      return null;
    }
  };

  // ── ลูกค้า (โหมด multi เท่านั้น) — โหลดหลัง login ──
  const loggedIn = !!userData;
  useEffect(() => {
    if (!MULTI_CLIENT || !loggedIn) return;
    let ignore = false;
    axios
      .get(`${backendUrl}/api/clients`, { withCredentials: true })
      .then(({ data }) => {
        if (!ignore) setClients(sortClients(Array.isArray(data) ? data : []));
      })
      .catch((err) => console.error("GET CLIENTS ERROR:", err));
    return () => {
      ignore = true;
    };
  }, [loggedIn, backendUrl]);

  const setClientFilter = useCallback((value) => {
    const next = MULTI_CLIENT ? value || "all" : "all";
    setClientFilterState(next);
    try {
      localStorage.setItem(CLIENT_FILTER_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  // ลูกค้าที่จำไว้ถูกลบ / เป็นของอีกฐานข้อมูล → กลับเป็นทุกลูกค้า
  useEffect(() => {
    if (
      clientFilter !== "all" &&
      clients.length > 0 &&
      !clients.some((c) => c.id === clientFilter)
    ) {
      setClientFilter("all");
    }
  }, [clients, clientFilter, setClientFilter]);

  const selectedClient = useMemo(
    () =>
      MULTI_CLIENT && clientFilter !== "all"
        ? clients.find((c) => c.id === clientFilter) || null
        : null,
    [clients, clientFilter],
  );

  // ใช้กรองในหน้าต่างๆ: clientMatches(ชื่อลูกค้าของ record) — เลือกทุกลูกค้า / โหมด single = true เสมอ
  const clientMatches = useCallback(
    (name) => !selectedClient || sameClient(name, selectedClient.name),
    [selectedClient],
  );

  const value = {
    backendUrl,
    isLoggedin,
    setIsLoggedin,
    userData,
    setUserData,
    getUserData,
    loading,
    // multi-client
    isMultiClient: MULTI_CLIENT,
    clients,
    clientFilter,
    setClientFilter,
    selectedClient,
    clientMatches,
  };

  return (
    <AppContent.Provider value={value}>{props.children}</AppContent.Provider>
  );
};
