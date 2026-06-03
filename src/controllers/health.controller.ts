import type { Context } from "hono";

/** Liveness check for ops / Docker healthcheck. */
export function getHealth(c: Context) {
  return c.json({ ok: true });
}
