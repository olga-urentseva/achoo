import type { Context } from "hono";
import { ALLERGENS } from "../db/schema.js";
import { SEVERITY_COLORS } from "../lib/severity.js";

/** Static metadata for the report form (allergens, severity scale, colors). */
export function getMeta(c: Context) {
  return c.json({
    allergens: ALLERGENS,
    severity: { min: 1, max: 6 },
    colors: SEVERITY_COLORS,
  });
}
