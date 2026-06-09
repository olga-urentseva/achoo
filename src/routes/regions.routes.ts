import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
  getRegionFamilies,
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
  "/:id/families",
  zValidator("query", statusQuerySchema),
  getRegionFamilies,
);

regionsRoutes.get(
  "/:id/trends",
  zValidator("query", trendsQuerySchema),
  getRegionTrends,
);
