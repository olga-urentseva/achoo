import type { Context } from "hono";
import * as metaService from "../services/meta.service.js";

/** Metadata for the report form: plants, display groups, families, scale, colors. */
export async function getMeta(c: Context) {
  return c.json(await metaService.getMeta());
}

/**
 * Public cross-reactivity map. The client pairs it with the user's locally
 * stored plants to suggest others they may react to — no personal data is sent
 * or stored here.
 */
export async function getCrossReactivity(c: Context) {
  return c.json(await metaService.getCrossReactivity());
}
