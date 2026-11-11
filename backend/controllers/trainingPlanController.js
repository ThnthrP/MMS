import * as service from "../services/trainingPlanService.js";

const actor = (req) => ({ id: req.userId, name: req.user?.name || null });
const fail = (res, error) => {
  if (!error.status) console.error(error);
  res.status(error.status || 500).json({ message: error.message });
};

// GET /api/training-plan?endedDays=30
export async function listSessions(req, res) {
  try {
    res.json(await service.listSessions({ endedDays: req.query.endedDays }));
  } catch (error) {
    fail(res, error);
  }
}

// POST /api/training-plan
// body: { globalTrainingId, start, end, provider, note, employeeIds[] }
export async function createPlan(req, res) {
  try {
    res.status(201).json(await service.createPlan(req.body, actor(req)));
  } catch (error) {
    fail(res, error);
  }
}

// PUT /api/training-plan/session
// body: { itemIds[], start, end, provider }
export async function updateSession(req, res) {
  try {
    res.json(await service.updateSession(req.body, actor(req)));
  } catch (error) {
    fail(res, error);
  }
}

// PUT /api/training-plan/items/:itemId/cancel
export async function cancelAttendee(req, res) {
  try {
    res.json(await service.cancelAttendee(req.params.itemId, actor(req)));
  } catch (error) {
    fail(res, error);
  }
}
