import type { Context } from "hono";
import { validated } from "../lib/validated.js";
import type { NearbyQuery, StatusQuery, TrendsQuery } from "../schemas.js";
import * as regionsService from "../services/regions.service.js";

function regionId(c: Context): number | null {
  const id = Number(c.req.param("id"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function getRegionStatus(c: Context) {
  const { date } = validated<StatusQuery>(c, "query");
  return c.json(await regionsService.getRegionStatus(date));
}

export async function getNearbyRegions(c: Context) {
  const { lat, lng, radiusKm, limit } = validated<NearbyQuery>(c, "query");
  return c.json(
    await regionsService.getNearbyRegions(lat, lng, radiusKm, limit),
  );
}

export async function getRegionFamilies(c: Context) {
  const id = regionId(c);
  if (id === null) return c.json({ error: "invalid region id" }, 400);

  const { date } = validated<StatusQuery>(c, "query");
  return c.json(await regionsService.getRegionFamilies(id, date));
}

export async function getRegionTrends(c: Context) {
  const id = regionId(c);
  if (id === null) return c.json({ error: "invalid region id" }, 400);

  const { family, days } = validated<TrendsQuery>(c, "query");
  return c.json(await regionsService.getRegionTrends(id, family, days));
}
