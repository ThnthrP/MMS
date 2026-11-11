import express from "express";
import * as controller from "../controllers/trainingPlanController.js";
import userAuth from "../middleware/userAuth.js";

const router = express.Router();
router.use(userAuth);

router.get("/", controller.listSessions);
router.post("/", controller.createPlan);
router.put("/session", controller.updateSession);
router.put("/items/:itemId/cancel", controller.cancelAttendee);

export default router;
