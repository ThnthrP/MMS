import prisma from "../config/prisma.js";
import { notifyJobRejected } from "../services/notifyService.js";

// ── project ที่ Worker App ใช้แสดงการ์ดงาน ──
// masterProjectRecord.projectCode = ON Number (หัวการ์ด)
// ใช้ include (ไม่ใช่ select) → field ของ project เอง เช่น isOffshore มาครบ
// จำนวนวันที่พนักงานต้องตอบรับ นับจากวันที่ approve (ใช้เมื่อ project ไม่ได้ตั้งค่า)
const DEFAULT_RESPONSE_DAYS = 10;

const PROJECT_INCLUDE = {
  include: {
    contract: { include: { client: true } },
    masterProjectRecord: { select: { projectCode: true } },
  },
};

// ================= หน้าหลัก: งานที่กำลังอยู่ =================
export const getCurrentJob = async (req, res) => {
  try {
    const assignment = await prisma.assignment.findFirst({
      where: {
        employeeId: req.employeeId,
        status: "active",
      },
      include: {
        project: PROJECT_INCLUDE,
        position: true,
      },
      orderBy: { mobDate: "desc" },
    });

    return res.json({ success: true, assignment: assignment || null });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};

// ================= รอยืนยัน: งานที่ client อนุมัติแล้ว รอพนักงานตอบรับ =================
export const getPendingConfirmation = async (req, res) => {
  try {
    const candidates = await prisma.candidate.findMany({
      where: {
        employeeId: req.employeeId,
        workerConfirmStatus: "pending",
        decision: { status: "approved" },
      },
      include: {
        round: {
          include: {
            request: {
              include: {
                position: true,
                project: PROJECT_INCLUDE,
              },
            },
          },
        },
        // วันที่ทีมงาน approve ที่หน้า Allocation — จุดเริ่มนับกำหนดตอบรับ
        decision: { select: { createdAt: true } },
      },
      orderBy: { id: "desc" },
    });

    // กำหนดตอบรับของแต่ละงาน = วันที่ approve + project.responseDays (ค่าเริ่มต้น 10 วัน)
    const withDeadline = candidates.map((c) => {
      const approvedAt = c.decision?.createdAt;
      const days =
        c.round?.request?.project?.responseDays ?? DEFAULT_RESPONSE_DAYS;
      let responseDeadline = null;
      if (approvedAt && days > 0) {
        const d = new Date(approvedAt);
        d.setDate(d.getDate() + days);
        responseDeadline = d;
      }
      return { ...c, approvedAt: approvedAt || null, responseDeadline };
    });

    // เช็ค active ban ของพนักงานคนนี้
    const activeBan = await prisma.employeeBan.findFirst({
      where: {
        employeeId: req.employeeId,
        isActive: true,
        bannedUntil: { gt: new Date() },
      },
    });

    return res.json({
      success: true,
      candidates: withDeadline,
      activeBan: activeBan
        ? { reason: activeBan.reason, bannedUntil: activeBan.bannedUntil }
        : null,
    });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};

// ================= ยืนยันรับงาน =================
export const confirmJob = async (req, res) => {
  const { candidateId } = req.params;
  const { note } = req.body;

  try {
    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
    });

    if (!candidate || candidate.employeeId !== req.employeeId) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบงานนี้ หรือไม่มีสิทธิ์เข้าถึง",
      });
    }

    if (candidate.workerConfirmStatus !== "pending") {
      return res.json({
        success: false,
        message: "งานนี้ถูกตอบรับ/ปฏิเสธไปแล้ว",
      });
    }

    // บล็อกถ้ามี active ban
    const activeBan = await prisma.employeeBan.findFirst({
      where: {
        employeeId: req.employeeId,
        isActive: true,
        bannedUntil: { gt: new Date() },
      },
    });

    if (activeBan) {
      return res.json({
        success: false,
        message: `ไม่สามารถยืนยันงานได้ — บัญชีถูกระงับถึงวันที่ ${new Date(activeBan.bannedUntil).toLocaleDateString("th-TH")}`,
      });
    }

    await prisma.$transaction([
      prisma.candidate.update({
        where: { id: candidateId },
        data: { workerConfirmStatus: "confirmed" },
      }),
      prisma.jobConfirmationEvent.create({
        data: { candidateId, eventType: "confirmed", note: note || null },
      }),
    ]);

    return res.json({ success: true, message: "ยืนยันลงทะเลสำเร็จ" });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};

// ================= ปฏิเสธงาน (บังคับมีเหตุผล) =================
export const rejectJob = async (req, res) => {
  const { candidateId } = req.params;
  const { note } = req.body;

  if (!note || !note.trim()) {
    return res.json({
      success: false,
      message: "กรุณาระบุเหตุผลในการปฏิเสธ",
    });
  }

  try {
    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
    });

    if (!candidate || candidate.employeeId !== req.employeeId) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบงานนี้ หรือไม่มีสิทธิ์เข้าถึง",
      });
    }

    if (candidate.workerConfirmStatus !== "pending") {
      return res.json({
        success: false,
        message: "งานนี้ถูกตอบรับ/ปฏิเสธไปแล้ว",
      });
    }

    await prisma.$transaction([
      prisma.candidate.update({
        where: { id: candidateId },
        data: { workerConfirmStatus: "rejected" },
      }),
      prisma.jobConfirmationEvent.create({
        data: { candidateId, eventType: "rejected", note },
      }),
    ]);

    // แจ้ง Requester + MP (กระดิ่ง + อีเมลด่วน) — ไม่รอ และไม่ให้ error ของการแจ้งเตือนกระทบผู้ใช้
    notifyJobRejected(candidateId, note.trim()).catch((err) =>
      console.error("[notify] job_rejected:", err.message),
    );

    return res.json({ success: true, message: "ปฏิเสธงานเรียบร้อย" });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};

// ================= ประวัติ: สรุปการลงงานทั้งหมด =================
export const getJobHistory = async (req, res) => {
  try {
    const assignments = await prisma.assignment.findMany({
      where: { employeeId: req.employeeId },
      include: {
        project: PROJECT_INCLUDE,
        position: true,
      },
      orderBy: { mobDate: "desc" },
    });

    const totalJobs = assignments.length;
    const totalDays = assignments.reduce((sum, a) => {
      if (!a.mobDate || !a.demobDate) return sum;
      const days = Math.ceil(
        (new Date(a.demobDate) - new Date(a.mobDate)) / 86400000,
      );
      return sum + (days > 0 ? days : 0);
    }, 0);

    return res.json({
      success: true,
      summary: { totalJobs, totalDays },
      assignments,
    });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};

// ================= Timeline ของงานหนึ่งรายการ =================
export const getJobTimeline = async (req, res) => {
  const { candidateId } = req.params;

  try {
    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
      include: {
        confirmationEvents: { orderBy: { timestamp: "asc" } },
        employee: {
          select: {
            mobilizationStatus: true,
            onSiteAt: true,
          },
        },
        round: {
          include: {
            request: {
              include: { position: true, project: PROJECT_INCLUDE },
            },
          },
        },
      },
    });

    if (!candidate || candidate.employeeId !== req.employeeId) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบงานนี้ หรือไม่มีสิทธิ์เข้าถึง",
      });
    }

    const request = candidate.round.request;
    const requestId = request.id;

    // ── หา Pre-Mob Checklist ผ่าน Booking ──
    const booking = await prisma.booking.findFirst({
      where: { requestId, employeeId: req.employeeId },
    });

    let checklistComplete = false;
    let checklistCheckedAt = null;

    if (booking) {
      const tasks = await prisma.mobilizationTask.findMany({
        where: { bookingId: booking.id },
      });
      if (tasks.length > 0) {
        checklistComplete = tasks.every(
          (t) =>
            t.resultStatus === "pass" || t.resultStatus === "not_applicable",
        );
        const checkedTimestamps = tasks
          .map((t) => t.checkedAt)
          .filter(Boolean)
          .sort((a, b) => new Date(b) - new Date(a));
        checklistCheckedAt = checkedTimestamps[0] || null;
      }
    }

    const eventByType = Object.fromEntries(
      candidate.confirmationEvents.map((e) => [e.eventType, e]),
    );

    // assignment ที่ตรงกับ project ของ candidate นี้เท่านั้น
    const projectId = request.project?.id;
    const latestAssignment = projectId
      ? await prisma.assignment.findFirst({
          where: {
            employeeId: req.employeeId,
            projectId,
          },
          orderBy: { createdAt: "desc" },
        })
      : null;

    const mobStatus = candidate.employee.mobilizationStatus;

    // ── รวม event log + สถานะจากแหล่งอื่นเป็น timeline เดียว 6 step ──
    const timeline = [
      {
        step: "received",
        label: "รับงาน",
        completed: true, // มี candidate record แปลว่ารับงานแล้วเสมอ
        timestamp: null,
      },
      {
        step: "confirmed",
        label: "ตอบรับ",
        completed: !!eventByType.confirmed,
        timestamp: eventByType.confirmed?.timestamp || null,
      },
      {
        step: "pre_mob",
        label: "Pre-mob / บรีฟ",
        completed: checklistComplete,
        timestamp: checklistCheckedAt,
      },
      {
        step: "traveling",
        label: "เดินทาง",
        completed: !!eventByType.traveling,
        timestamp: eventByType.traveling?.timestamp || null,
      },
      {
        step: "arrived",
        label: "มาถึง",
        completed: mobStatus === "on_site",
        timestamp: candidate.employee.onSiteAt,
      },
      {
        step: "returned",
        label: "กลับ",
        completed: latestAssignment?.status === "completed",
        timestamp: latestAssignment?.demobDate || null,
      },
    ];

    const currentStepIndex = timeline.findIndex((s) => !s.completed);
    const currentStep =
      currentStepIndex === -1 ? timeline.length : currentStepIndex + 1;

    return res.json({
      success: true,
      job: {
        position: request.position,
        project: request.project,
        startDate: request.startDate,
        endDate: request.endDate,
        // Offshore/Onshore ยึดตาม project ก่อน ให้ตรงกับการ์ดหน้า "รอยืนยัน"
        // และ "งานของฉัน" (ถ้า project ไม่มีค่า ค่อยใช้ของ request)
        isOffshore: request.project?.isOffshore ?? request.isOffshore ?? null,
      },
      timeline,
      currentStep,
      isRejected: candidate.workerConfirmStatus === "rejected",
      rejectedEvent: eventByType.rejected || null,

      // เก็บ field เดิมไว้ด้วย เผื่อโค้ดอื่นยังอ้างถึงอยู่ (backward compat)
      events: candidate.confirmationEvents,
      currentMobilizationStatus: mobStatus,
      latestAssignment,
    });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};

// ================= งานของฉัน: candidate ที่ยืนยันแล้ว =================
export const getConfirmedJobs = async (req, res) => {
  try {
    const candidates = await prisma.candidate.findMany({
      where: {
        employeeId: req.employeeId,
        workerConfirmStatus: "confirmed",
      },
      include: {
        round: {
          include: {
            request: {
              include: {
                position: true,
                project: PROJECT_INCLUDE,
              },
            },
          },
        },
        confirmationEvents: {
          orderBy: { timestamp: "desc" },
          take: 1, // เอาแค่ event ล่าสุด ใช้โชว์ status ย่อในการ์ด list
        },
      },
      orderBy: { id: "desc" },
    });

    // ── แนบ assignment (วัน MOB / D-MOB / แท่นที่ admin บันทึกตอน deploy)
    //    ให้การ์ดหน้ารายการแสดงวันจริงตรงกับหน้ารายละเอียด
    //    query รวมครั้งเดียว แทนการ query ทีละงาน ──
    const projectIds = [
      ...new Set(
        candidates.map((c) => c.round?.request?.project?.id).filter(Boolean),
      ),
    ];

    const assignments = projectIds.length
      ? await prisma.assignment.findMany({
          where: { employeeId: req.employeeId, projectId: { in: projectIds } },
          orderBy: { createdAt: "desc" }, // ล่าสุดก่อน → find() เจอตัวล่าสุด
        })
      : [];

    const withAssignment = candidates.map((c) => ({
      ...c,
      assignment:
        assignments.find(
          (a) => a.projectId === c.round?.request?.project?.id,
        ) || null,
    }));

    return res.json({ success: true, candidates: withAssignment });
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }
};
