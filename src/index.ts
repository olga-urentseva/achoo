import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { NotFoundError } from "./lib/errors.js";
import { router } from "./routes/index.js";

const app = new Hono();

app.route("/", router);

// Central error handler — maps domain errors thrown by services to HTTP.
app.onError((err, c) => {
  if (err instanceof NotFoundError) {
    return c.json({ error: err.message }, 404);
  }
  console.error(err);
  return c.json({ error: "internal server error" }, 500);
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`achoo api listening on http://localhost:${port}`);
