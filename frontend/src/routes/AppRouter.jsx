import { useContext } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AppContent } from "../context/AppContext";

import Layout from "../components/layout/Layout";
import ProtectedRoute from "../components/ProtectedRoute";
import MenuTabs from "../components/layout/MenuTabs";

import Dashboard from "../pages/dashboard/Dashboard"; // ← เดิม AdminDashboard (ทุก role ใช้หน้านี้)

import AdminUsers from "../pages/admin/AdminUsers";

import TrainingMatrix from "../pages/training/TrainingMatrix";
import Workers from "../pages/workers/Workers";
import AddWorker from "../pages/workers/AddWorker";
import ComplianceDashboard from "../pages/compliance/ComplianceDashboard";
import Project from "../pages/projects/Project";
import ManpowerRequirements from "../pages/projects/ManpowerRequirements";
import Allocation from "../pages/projects/Allocation";

import WorkerDetail from "../pages/workers/WorkerDetail";
import EditWorker from "../pages/workers/EditWorker";

import ProjectDetail from "../pages/projects/ProjectDetail";
import EditProject from "../pages/projects/EditProject";

import ManagePositions from "../pages/positions/ManagePositions";
import MatrixEditor from "../pages/positions/MatrixEditor";
import ManageDivisions from "../pages/positions/ManageDivisions";
import ManageTrainings from "../pages/training/ManageTrainings";

import Mobilization from "../pages/projects/Mobilization";
import PostProjectReview from "../pages/projects/PostProjectReview";

import AnalyticsReports from "../pages/projects/AnalyticsReports";

import Certifications from "../pages/compliance/Certifications";

import TrainingRequestDetail from "../pages/compliance/TrainingRequestDetail";
import RequestsHistory from "../pages/compliance/RequestsHistory";
import MedicalRequestDetail from "../pages/compliance/MedicalRequestDetail";

import ProjectsOverview from "../pages/projects/ProjectsOverview";
import ProjectCalendarDetail from "../pages/projects/ProjectCalendarDetail";

import BulkAddCertification from "../pages/compliance/BulkAddCertification";
import TrainingCalendar from "../pages/compliance/TrainingCalendar";
import TrainingPlanForm from "../pages/compliance/TrainingPlanForm";

import BulkSetPin from "../pages/workers/BulkSetPin";

import PEApprovals from "../pages/projects/PEApprovals";

import AuditLogs from "../pages/admin/AuditLogs";

import DataImport from "../pages/admin/DataImport";

// ── Role scheme (9 roles ปัจจุบันในระบบ) ──
// admin, project_engineer, manpower_supply, hr_supervisor,
// personal_record_officer, hr_officer, safety_manager, safety_officer,
// training_officer
// role อื่นที่เคยมี (pe_head, nurse, bd, expert, supervisor, executive,
// manager) ถูกลบออกจากระบบแล้ว — เอาออกจากทุก allowRoles ด้านล่าง
//
// ต้อง sync กับ sidebarMenu.js เสมอ — allowRoles ที่นี่คือ enforcement จริง
// sidebarMenu.js แค่คุมว่าเมนู/แท็บโชว์ไหม (ชุด role อยู่ในตัวแปร R ของไฟล์นั้น)

// role ที่เข้า "Requests from MP" ได้ — ใช้ร่วมกับหน้า detail ของคำขอ
const REQUESTS_ROLES = [
  "admin",
  "manpower_supply",
  "hr_supervisor",
  "personal_record_officer",
  "hr_officer",
  "training_officer",
];

// role ที่เห็น Dashboard — PE ไม่มี Dashboard จึงส่งไปหน้า PE Approvals แทน
// (หลัง login ทุก role จะมาที่ "/" ก่อน ถ้าไม่ redirect PE จะเจอหน้าไม่มีสิทธิ์)
const DASHBOARD_ROLES = [
  "admin",
  "manpower_supply",
  "hr_supervisor",
  "personal_record_officer",
  "hr_officer",
  "safety_manager",
  "safety_officer",
  "training_officer",
];

function HomeRoute() {
  const { userData } = useContext(AppContent);
  if (userData?.role?.name === "project_engineer") {
    return <Navigate to="/pe-approvals" replace />;
  }
  return (
    <ProtectedRoute allowRoles={DASHBOARD_ROLES}>
      <Dashboard />
    </ProtectedRoute>
  );
}

const AppRouter = () => {
  return (
    <ProtectedRoute>
      <Layout>
        {/* แท็บสลับหน้าที่อยู่ใต้เมนูเดียวกัน (เช่น Assign Names | PE Approvals) */}
        <MenuTabs />
        <Routes>
          {/* Dashboard — ทุก role ยกเว้น PE (PE ถูกส่งไป /pe-approvals) */}
          <Route path="/" element={<HomeRoute />} />

          {/* Training Matrix */}
          <Route
            path="/training-matrix"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "manpower_supply",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "training_officer",
                ]}
              >
                <TrainingMatrix />
              </ProtectedRoute>
            }
          />

          <Route
            path="/workers"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "manpower_supply",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "safety_manager",
                  "training_officer",
                ]}
              >
                <Workers />
              </ProtectedRoute>
            }
          />
          <Route
            path="/workers/add"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "manpower_supply",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "training_officer",
                ]}
              >
                <AddWorker />
              </ProtectedRoute>
            }
          />
          <Route
            path="/workers/:id"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "manpower_supply",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "safety_manager",
                  "training_officer",
                ]}
              >
                <WorkerDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/workers/:id/edit"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "manpower_supply",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "training_officer",
                ]}
              >
                <EditWorker />
              </ProtectedRoute>
            }
          />
          <Route
            path="/compliance"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "manpower_supply",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "safety_manager",
                  "training_officer",
                ]}
              >
                <ComplianceDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/certifications"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "manpower_supply",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "safety_manager",
                  "training_officer",
                ]}
              >
                <Certifications />
              </ProtectedRoute>
            }
          />

          <Route
            path="/certifications/bulk-add"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "manpower_supply",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "training_officer",
                ]}
              >
                <BulkAddCertification />
              </ProtectedRoute>
            }
          />

          {/* Training Plan — อบรมที่กำลังดำเนินอยู่ / กำลังจะเริ่ม (ดู: + safety_manager · เพิ่มแผน: HR) */}
          <Route
            path="/training-plan"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "manpower_supply",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "safety_manager",
                  "training_officer",
                ]}
              >
                <TrainingCalendar />
              </ProtectedRoute>
            }
          />
          <Route
            path="/training-plan/new"
            element={
              <ProtectedRoute allowRoles={REQUESTS_ROLES}>
                <TrainingPlanForm />
              </ProtectedRoute>
            }
          />

          {/* Requests from MP + หน้า detail — ใช้ role ชุดเดียวกัน
              (เดิม /training-requests/:id ประกาศซ้ำ 2 ครั้ง และหน้า detail ไม่มี allowRoles
              role ที่ไม่เห็นเมนู Requests from MP ก็เปิดผ่าน URL ตรงได้) */}
          <Route
            path="/requests-history"
            element={
              <ProtectedRoute allowRoles={REQUESTS_ROLES}>
                <RequestsHistory />
              </ProtectedRoute>
            }
          />
          {/* Medical Bookings — หน้าเดียวกับ Training Bookings แต่แสดงคำขอตรวจสุขภาพ */}
          <Route
            path="/medical-bookings"
            element={
              <ProtectedRoute allowRoles={REQUESTS_ROLES}>
                <RequestsHistory type="medical" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/training-requests/:id"
            element={
              <ProtectedRoute allowRoles={REQUESTS_ROLES}>
                <TrainingRequestDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/medical-requests/:id"
            element={
              <ProtectedRoute allowRoles={REQUESTS_ROLES}>
                <MedicalRequestDetail />
              </ProtectedRoute>
            }
          />

          {/* Manpower Requirements — รายการตำแหน่งที่ขอทั้งหมด (ข้อมูลชุดเดียวกับ /projects/:id) */}
          <Route
            path="/requirements"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "manpower_supply",
                  "training_officer",
                  "project_engineer",
                  "safety_manager",
                ]}
              >
                <ManpowerRequirements />
              </ProtectedRoute>
            }
          />
          {/* Projects (ON Number) — อยู่ที่เมนู Projects & Positions */}
          <Route
            path="/projects"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "manpower_supply",
                  "training_officer",
                  "project_engineer",
                  "safety_manager",
                ]}
              >
                <Project />
              </ProtectedRoute>
            }
          />
          <Route
            path="/projects/:id"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "manpower_supply",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "training_officer",
                  "project_engineer",
                  "safety_manager",
                ]}
              >
                <ProjectDetail />
              </ProtectedRoute>
            }
          />

          <Route
            path="/projects/:id/edit"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "manpower_supply",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "training_officer",
                  "project_engineer",
                  "safety_manager",
                ]}
              >
                <EditProject />
              </ProtectedRoute>
            }
          />

          <Route
            path="/allocation"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "manpower_supply",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "training_officer",
                  "project_engineer",
                  "safety_manager",
                ]}
              >
                <Allocation />
              </ProtectedRoute>
            }
          />

          <Route
            path="/pe-approvals"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "project_engineer",
                  "manpower_supply",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "training_officer",
                ]}
              >
                <PEApprovals />
              </ProtectedRoute>
            }
          />

          <Route
            path="/positions"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "manpower_supply",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "training_officer",
                ]}
              >
                <ManagePositions />
              </ProtectedRoute>
            }
          />

          <Route
            path="/positions/matrix"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "manpower_supply",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "training_officer",
                ]}
              >
                <MatrixEditor />
              </ProtectedRoute>
            }
          />

          <Route
            path="/mobilization"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "manpower_supply",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "project_engineer",
                  "safety_manager",
                  "safety_officer",
                  "training_officer",
                ]}
              >
                <Mobilization />
              </ProtectedRoute>
            }
          />

          <Route
            path="/review"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "manpower_supply",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "training_officer",
                  "project_engineer",
                ]}
              >
                <PostProjectReview />
              </ProtectedRoute>
            }
          />

          <Route
            path="/reports"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "manpower_supply",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "training_officer",
                ]}
              >
                <AnalyticsReports />
              </ProtectedRoute>
            }
          />

          <Route
            path="/projects-overview"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "manpower_supply",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "training_officer",
                  "project_engineer",
                ]}
              >
                <ProjectsOverview />
              </ProtectedRoute>
            }
          />

          {/* Manpower Calendar — รายละเอียด requirement (timeline ขั้นตอน + ตารางวันทำงาน) */}
          <Route
            path="/projects-overview/:id"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "manpower_supply",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "training_officer",
                  "project_engineer",
                ]}
              >
                <ProjectCalendarDetail />
              </ProtectedRoute>
            }
          />

          <Route
            path="/divisions"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "manpower_supply",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "training_officer",
                ]}
              >
                <ManageDivisions />
              </ProtectedRoute>
            }
          />

          <Route
            path="/trainings"
            element={
              <ProtectedRoute
                allowRoles={[
                  "admin",
                  "manpower_supply",
                  "hr_supervisor",
                  "personal_record_officer",
                  "hr_officer",
                  "training_officer",
                ]}
              >
                <ManageTrainings />
              </ProtectedRoute>
            }
          />

          {/* User Management */}
          <Route
            path="/users"
            element={
              <ProtectedRoute allowRoles={["admin"]}>
                <AdminUsers />
              </ProtectedRoute>
            }
          />

          {/* Bulk Set PIN — Worker App access, admin only */}
          <Route
            path="/workers/bulk-set-pin"
            element={
              <ProtectedRoute allowRoles={["admin"]}>
                <BulkSetPin />
              </ProtectedRoute>
            }
          />

          {/* Audit Log — บันทึกการใช้งานระบบ, admin only */}
          <Route
            path="/audit-logs"
            element={
              <ProtectedRoute allowRoles={["admin"]}>
                <AuditLogs />
              </ProtectedRoute>
            }
          />

          <Route
            path="/data-import"
            element={
              <ProtectedRoute allowRoles={["admin"]}>
                <DataImport />
              </ProtectedRoute>
            }
          />
        </Routes>
      </Layout>
    </ProtectedRoute>
  );
};

export default AppRouter;
