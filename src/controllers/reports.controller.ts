import type { Context } from "hono";
import { validated } from "../lib/validated.js";
import type { CreateReportInput } from "../schemas.js";
import * as reportsService from "../services/reports.service.js";

export async function createReport(c: Context) {
  const input = validated<CreateReportInput>(c, "json");
  const reports = await reportsService.createReport(input);
  return c.json(reports, 201);
}
