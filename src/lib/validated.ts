import type { Context, ValidationTargets } from "hono";

/**
 * Reads the output of a `zValidator` middleware that ran earlier in the route.
 * Controllers take a bare `Context`, so this isolates the single cast needed
 * to recover the validated, typed payload.
 */
export function validated<T>(c: Context, target: keyof ValidationTargets): T {
  return c.req.valid(target as never) as T;
}
