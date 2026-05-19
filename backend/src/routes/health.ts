import { Router } from "express";
import { pingDb } from "../db.js";
import { asyncHandler } from "../lib/asyncHandler.js";

const router = Router();

router.get(
  "/health",
  asyncHandler(async (_req, res) => {
    const dbOk = await pingDb();
    res.json({
      status: "ok",
      db: dbOk ? "connected" : "unreachable",
      time: new Date().toISOString(),
    });
  }),
);

export default router;
