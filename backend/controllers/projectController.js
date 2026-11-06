import * as service from "../services/projectService.js";
import { notifyProjectCreated } from "../services/notifyService.js";

export async function getProjects(req, res) {
  try {
    const projects = await service.getProjects();
    res.json(projects);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
}

export async function getProjectById(req, res) {
  try {
    const project = await service.getProjectById(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });
    res.json(project);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
}

export async function createProject(req, res) {
  try {
    const project = await service.createProject(req.body);

    // แจ้งเตือนทีม manpower_supply ว่ามี project ใหม่ให้เตรียมจัดหาคน
    // await ให้รันเสร็จจริงก่อน response (กันหายตอน server restart กะทันหัน)
    // แต่แยก try/catch ของตัวเอง — ถ้าแจ้งเตือนพัง ไม่ทำให้ request หลัก fail
    // เพราะ project ถูกสร้างสำเร็จแล้วจริงๆ ไม่ควรให้ user เห็น error ที่ทำให้เข้าใจผิด
        try {
      await notifyProjectCreated(project, req.user.id);
    } catch (notifyError) {
      console.error("Failed to notify MP (project_created):", notifyError);
    }

    res.status(201).json(project);
  } catch (error) {
    if (
      [
        "MASTER_RECORD_REQUIRED",
        "CONTRACT_REQUIRED",
        "MASTER_RECORD_NOT_FOUND",
      ].includes(error.code)
    ) {
      return res.status(400).json({ message: error.message });
    }
    console.error(error);
    res.status(500).json({ message: error.message });
  }
}

export async function updateProject(req, res) {
  try {
    const project = await service.updateProject(req.params.id, req.body);
    res.json(project);
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ message: "Project not found" });
    }
    console.error(error);
    res.status(500).json({ message: "Failed to update project" });
  }
}

// GET /api/projects/deletable — id ของ project ที่ผู้ใช้คนนี้ลบได้ (admin + เป็นผู้สร้าง)
export async function getDeletableProjects(req, res) {
  try {
    const ids = await service.getDeletableProjectIds(req.user?.id);
    res.json({ ids });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
}

// DELETE /api/projects/:id — เฉพาะ admin ที่เป็นผู้สร้าง project (ดูจาก Audit Log)
export async function deleteProject(req, res) {
  try {
    const project = await service.assertCanDeleteProject(
      req.params.id,
      req.user?.id,
    );
    // ให้ Audit Log อ่านออกว่าลบอะไร (ON + ชื่อ + จำนวนที่ผูกอยู่)
    const code = project.masterProjectRecord?.projectCode;
    req.audit = {
      ...(req.audit || {}),
      summary: `ลบ project ${code ? `${code} ` : ""}${project.name}`,
      extra: {
        projectCode: code || null,
        name: project.name,
        positions: project._count.requests,
        assignments: project._count.assignments,
      },
    };
    await service.deleteProject(req.params.id);
    res.json({ message: "Project deleted successfully" });
  } catch (error) {
    if (error.code === "FORBIDDEN") {
      return res.status(403).json({ message: error.message });
    }
    if (error.code === "P2025") {
      return res.status(404).json({ message: "Project not found" });
    }
    console.error(error);
    res.status(500).json({ message: "Failed to delete project" });
  }
}

export async function addProjectRequest(req, res) {
  try {
    // ส่งผู้ใช้ที่ login อยู่ → REQUESTED BY แสดงชื่อคนเพิ่มตำแหน่งจริง
    const request = await service.addProjectRequest(
      req.params.id,
      req.body,
      req.user?.id,
    );
    res.status(201).json(request);
  } catch (error) {
    if (error.code === "USER_REQUIRED") {
      return res.status(401).json({ message: error.message });
    }
    console.error(error);
    res.status(500).json({ message: "Failed to add position request" });
  }
}

export async function deleteProjectRequest(req, res) {
  try {
    await service.deleteProjectRequest(req.params.id, req.params.requestId);
    res.json({ message: "Position request deleted successfully" });
  } catch (error) {
    if (error.code === "REQUEST_HAS_BOOKINGS") {
      return res.status(409).json({
        message:
          "ลบไม่ได้ — request นี้มีการ booking/shortlist พนักงานแล้ว ต้องยกเลิก booking ก่อน",
      });
    }
    if (error.code === "P2025") {
      return res.status(404).json({ message: "Position request not found" });
    }
    console.error(error);
    res.status(500).json({ message: "Failed to delete position request" });
  }
}

export async function updateProjectRequest(req, res) {
  try {
    const { id, requestId } = req.params;
    const { quantity } = req.body;
    if (!quantity || Number(quantity) < 1) {
      return res.status(400).json({ message: "quantity must be at least 1" });
    }
    const updated = await service.updateProjectRequestQuantity(
      id,
      requestId,
      quantity,
    );
    res.json(updated);
  } catch (error) {
    console.error(error);
    res
      .status(error.code === "P2025" ? 404 : 500)
      .json({ message: error.message });
  }
}

// GET /api/projects/master-records?search=...
export async function searchMasterProjectRecords(req, res) {
  try {
    const records = await service.searchMasterProjectRecords(req.query.search);
    res.json(records);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
}

export async function getMasterProjectYears(req, res) {
  try {
    const years = await service.getMasterProjectYears();
    res.json(years);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
}

export async function browseMasterProjectRecords(req, res) {
  try {
    const { year, search, page, pageSize } = req.query;
    const result = await service.browseMasterProjectRecords({
      year,
      search,
      page,
      pageSize,
    });
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
}
