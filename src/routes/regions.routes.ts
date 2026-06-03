import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
  getRegionStatus,
  getRegionTrends,
} from "../controllers/regions.controller.js";
import { statusQuerySchema, trendsQuerySchema } from "../schemas.js";

export const regionsRoutes = new Hono();

regionsRoutes.get(
  "/status",
  zValidator("query", statusQuerySchema),
  getRegionStatus,
);

regionsRoutes.get(
  "/:id/trends",
  zValidator("query", trendsQuerySchema),
  getRegionTrends,
);
