import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { createReport } from "../controllers/reports.controller.js";
import { createSubmissionSchema } from "../schemas.js";

export const reportsRoutes = new Hono();

reportsRoutes.post("/", zValidator("json", createSubmissionSchema), createReport);
