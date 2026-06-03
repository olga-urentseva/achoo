import { Hono } from "hono";
import { getHealth } from "../controllers/health.controller.js";
import { getMeta } from "../controllers/meta.controller.js";
import { placesRoutes } from "./places.routes.js";
import { regionsRoutes } from "./regions.routes.js";
import { reportsRoutes } from "./reports.routes.js";

export const router = new Hono();

router.get("/health", getHealth);
router.get("/meta", getMeta);
router.route("/places", placesRoutes);
router.route("/reports", reportsRoutes);
router.route("/regions", regionsRoutes);
