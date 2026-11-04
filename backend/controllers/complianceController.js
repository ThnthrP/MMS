import * as service from "../services/complianceService.js";
import { notifyRoles } from "../services/notificationService.js";
import { ROLE_GROUPS } from "../utils/roles.js";

export async function getComplianceDashboard(req, res) {
  try {
    const data = await service.getComplianceDashboard();

    res.json(data);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: error.message,
    });
  }
}

export async function getWorkerGap(req, res) {
  try {
    const data = await service.getWorkerGap(req.params.id);

    res.json(data);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: error.message,
    });
  }
}

export async function getComplianceStats(req, res) {
  try {
    const stats = await service.getComplianceStats();
    res.json(stats);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
}

export async function getWorkerAlerts(req, res) {
  try {
    const data = await service.getWorkerAlerts(req.params.id);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

export async function getCertificationDetail(req, res) {
  try {
    const data = await service.getCertificationDetail(req.params.id);
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ message: error.message });
  }
}

export async function requestTraining(req, res) {
  try {
    const { trainingId, employeeIds } = req.body;
    if (!trainingId || !employeeIds?.length) {
      return res
        .status(400)
        .json({ message: "trainingId and employeeIds are required" });
    }

    const result = await service.requestTraining(trainingId, employeeIds);

    // ── แจ้งเตือนทุก role ที่เกี่ยวข้องกับ HR ──
    const payload = {
      type: "training_request",
      title: "MP ขอให้จัด Training",
      message: `${result.trainingName} — ${result.employeeCount} คน (${result.employeeNames.slice(0, 3).join(", ")}${result.employeeCount > 3 ? " และอื่นๆ" : ""})`,
      link: `/certifications?trainingId=${trainingId}&empIds=${employeeIds.join(",")}`,
    };

    notifyRoles(ROLE_GROUPS.HR, payload, {
      excludeUserIds: [req.user.id],
    }).catch((err) =>
      console.error("notifyRoles (training_request) failed:", err),
    );

    res.json({ success: true, ...result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
}

// export async function requestTraining(req, res) {
//   try {
//     const { trainingId, employeeIds } = req.body;
//     if (!trainingId || !employeeIds?.length) {
//       return res
//         .status(400)
//         .json({ message: "trainingId and employeeIds are required" });
//     }

//     const result = await service.requestTraining(trainingId, employeeIds);

//     // ── แจ้งเตือน HR ทุกคน ──
//     notifyRole("hr", {
//       type: "training_request",
//       title: "MP ขอให้จัด Training",
//       message: `${result.trainingName} — ${result.employeeCount} คน (${result.employeeNames.slice(0, 3).join(", ")}${result.employeeCount > 3 ? " และอื่นๆ" : ""})`,
//       link: `/certifications?trainingId=${trainingId}&empIds=${employeeIds.join(",")}`,
//     }).catch((err) =>
//       console.error("notifyRole (training_request) failed:", err),
//     );

//     res.json({ success: true, ...result });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ message: error.message });
//   }
// }
