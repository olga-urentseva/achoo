import type { Context } from "hono";
import { ALLERGENS, UNKNOWN_ALLERGEN } from "../db/schema.js";
import { CROSS_REACTIVITY } from "../lib/cross-reactivity.js";
import { SEVERITY_COLORS } from "../lib/severity.js";

/** Static metadata for the report form (allergens, severity scale, colors). */
export function getMeta(c: Context) {
  return c.json({
    allergens: ALLERGENS,
    // Sentinel for "I don't know my allergens" — submit it as the sole
    // report allergen. Kept separate so it isn't rendered as a picker chip.
    unknownAllergen: UNKNOWN_ALLERGEN,
    severity: { min: 1, max: 6 },
    colors: SEVERITY_COLORS,
  });
}

/**
 * Public pollen cross-reactivity map. The client pairs it with the user's
 * locally stored allergens to suggest others they may react to — no personal
 * data is sent or stored here.
 */
export function getCrossReactivity(c: Context) {
  return c.json(CROSS_REACTIVITY);
}
