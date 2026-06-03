import type { Context } from "hono";
import { validated } from "../lib/validated.js";
import type { StatusQuery, TrendsQuery } from "../schemas.js";
import * as regionsService from "../services/regions.service.js";

export async function getRegionStatus(c: Context) {
  const { date } = validated<StatusQuery>(c, "query");
  return c.json(await regionsService.getRegionStatus(date));
}

export async function getRegionTrends(c: Context) {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: "invalid region id" }, 400);
  }

  const { allergen, days } = validated<TrendsQuery>(c, "query");
  return c.json(await regionsService.getRegionTrends(id, allergen, days));
}
