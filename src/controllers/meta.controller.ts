import type { Context } from "hono";
import { validated } from "../lib/validated.js";
import type { CrossReactivityQuery } from "../schemas.js";
import * as metaService from "../services/meta.service.js";

/** Metadata for the report form: plants, display groups, families, scale, colors. */
export async function getMeta(c: Context) {
  return c.json(await metaService.getMeta());
}

/**
 * Public cross-reactivity map for the requested `?categories=` (plant, food,
 * animal, other; defaults to plants only). The client pairs it with the user's
 * locally stored picks to suggest others they may react to — no personal data
 * is sent or stored here.
 */
export async function getCrossReactivity(c: Context) {
  const { categories } = validated<CrossReactivityQuery>(c, "query");
  return c.json(await metaService.getCrossReactivity(categories));
}
