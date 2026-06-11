import { Router } from "express";
import { isDatabaseEnabled, pingDatabase } from "../db/pool.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const database = isDatabaseEnabled();
  const databaseOk = database ? await pingDatabase() : false;
  res.json({
    ok: true,
    service: "localguide-ai-backend",
    database,
    databaseOk,
    authRequired: database,
  });
});
