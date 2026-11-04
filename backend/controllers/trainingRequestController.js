import * as service from "../services/trainingRequestService.js";
import { notifyBookingRequest } from "../services/notifyService.js";

// POST /api/training-requests
// body: { items: [{ employeeId, globalTrainingId, clientName }], requestedStart?, requestedEnd?, provider?, remarks? }
export async function createBatch(req, res) {
  try {
    const { items, requestedStart, requestedEnd, provider, remarks } = req.body;
    if (!items?.length) {
      return res.status(400).json({ message: "items are required" });
    }
    const { batch, employeeCount, trainingCount } = await service.createBatch(
      req.user.id,
      items,
      { requestedStart, requestedEnd, provider, remarks },
    );

    // แจ้ง HR ทุก role (กระดิ่ง + อีเมล) — ไม่รอ ไม่ทำให้การส่งคำขอพัง
    notifyBookingRequest({
      kind: "training",
      batch,
      employeeCount,
      trainingCount,
      actorUserId: req.user.id,
    }).catch((err) =>
      console.error("notifyBookingRequest (training) failed:", err),
    );

    res.status(201).json({ id: batch.id, employeeCount, trainingCount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
}

export async function getBatch(req, res) {
  try {
    const data = await service.getBatch(req.params.id);
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ message: error.message });
  }
}

export async function getAllBatches(req, res) {
  try {
    const data = await service.getAllBatches();
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
}

export async function updateStatus(req, res) {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ message: "status is required" });
    }
    const batch = await service.updateStatus(req.params.id, status);
    res.json(batch);
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ message: error.message });
  }
}

// PATCH /api/training-requests/:id/items — HR ยืนยัน / ปฏิเสธ รายคน
export async function decideItems(req, res) {
  try {
    const data = await service.decideItems(req.params.id, req.body, req.user);
    res.json(data);
  } catch (error) {
    if (!error.status) console.error(error);
    res.status(error.status || 500).json({ message: error.message });
  }
}

// GET /api/training-requests/availability?start=&end=&globalTrainingId=&employeeIds=a,b
export async function getAvailability(req, res) {
  try {
    const { start, end, globalTrainingId, employeeIds } = req.query;
    const data = await service.getAvailability({
      start,
      end,
      globalTrainingId,
      employeeIds: employeeIds ? String(employeeIds).split(",") : undefined,
    });
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
}
