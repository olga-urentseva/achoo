import type { Context } from "hono";
import { validated } from "../lib/validated.js";
import type { CreateSubmissionInput } from "../schemas.js";
import * as reportsService from "../services/reports.service.js";

export async function createReport(c: Context) {
  const input = validated<CreateSubmissionInput>(c, "json");
  const submission = await reportsService.createSubmission(input);
  return c.json(submission, 201);
}
