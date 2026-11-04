import * as service from "../services/medicalRequestService.js";
import { notifyBookingRequest } from "../services/notifyService.js";

// POST /api/medical-requests
// body: { items: [{ employeeId, checkType?, clientName?, reason? }], requestedStart?, requestedEnd?, provider?, remarks? }
export async function createBatch(req, res) {
  try {
    const { items, requestedStart, requestedEnd, provider, remarks } = req.body;
    if (!items?.length) {
      return res.status(400).json({ message: "items are required" });
    }
    const { batch, employeeCount } = await service.createBatch(
      req.user.id,
      items,
      { requestedStart, requestedEnd, provider, remarks },
    );

    notifyBookingRequest({
      kind: "medical",
      batch,
      employeeCount,
      actorUserId: req.user.id,
    }).catch((err) =>
      console.error("notifyBookingRequest (medical) failed:", err),
    );

    res.status(201).json({ id: batch.id, employeeCount });
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

// PATCH /api/medical-requests/:id/items — HR ยืนยันวันนัด / ปฏิเสธ รายคน
export async function decideItems(req, res) {
  try {
    const data = await service.decideItems(req.params.id, req.body, req.user);
    res.json(data);
  } catch (error) {
    if (!error.status) console.error(error);
    res.status(error.status || 500).json({ message: error.message });
  }
}
