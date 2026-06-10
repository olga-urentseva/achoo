# Architecture

How achoo's API is structured, how a request flows, and how the data connects.

## 1. Two running pieces

```
┌─────────────────────────┐         ┌──────────────────────────┐
│   API (Node, your Mac)  │  SQL    │  PostgreSQL (Docker)     │
│   Hono app on :3000     │ ──────▶ │  achoo-db-1 container    │
│   `npm run dev`         │         │  `docker-compose up -d`  │
└─────────────────────────┘         └──────────────────────────┘
        ▲                                      ▲
        │ HTTP (JSON)                          │ data in a
        │                                      │ Docker volume
   browser / curl                         (survives restarts)
```

The **API** holds the logic; **Postgres** holds the data — two separate processes,
which is why local dev starts two things. Drizzle (in the API) generates SQL and
talks to Postgres over a connection.

## 2. Startup

`npm run dev` runs `tsx watch src/index.ts`. The entry file wires everything:

```ts
// src/index.ts
import "dotenv/config";              // 1. load DATABASE_URL etc. from .env
const app = new Hono();              // 2. create the web app
app.route("/", router);             // 3. mount all routes (routes/index.ts)
app.onError((err, c) => { ... });   // 4. one place mapping errors -> HTTP
serve({ fetch: app.fetch, port });  // 5. listen on :3000
```

When `db/index.ts` is first imported (via the services), it reads `DATABASE_URL`
and opens the connection. The exported `db` is the single typed query handle every
service uses:

```ts
// src/db/index.ts
const client = postgres(process.env.DATABASE_URL);
export const db = drizzle(client, { schema });
```

## 3. Layers

A request flows **down** the layers; the response flows back **up**:

```
HTTP request
    │
    ▼
routes/        path + validator + which controller        (wiring only)
    │
    ▼
controllers/   extract validated input → call service → c.json(result)
    │             (knows HTTP: Context, status codes, JSON)
    ▼
services/      business rules + db queries → data / throws domain error
    │             (knows the domain + Drizzle; HTTP-agnostic)
    ▼
db/ (Drizzle)  builds SQL → Postgres
    │
    ▼
PostgreSQL     runs the query, returns rows
```

Supporting code:

- **`schemas.ts`** — Zod validation rules + the TS types inferred from them
  (shared by controllers and services).
- **`lib/`** — shared helpers: `severity.ts` (color thresholds), `dates.ts`
  (`isoDate`), `errors.ts` (`NotFoundError`), `validated.ts` (read validator output).
- **`db/schema.ts`** — table definitions (the shape of the data).

### What goes in which layer

| | Controller | Service |
| --- | --- | --- |
| Talks to | the HTTP client | the database / other services |
| Knows about | `Context`, status codes, JSON | business rules, Drizzle, the domain |
| Input | the raw HTTP request | plain typed arguments |
| Output | an HTTP response | plain data, or throws a domain error |
| Rule of thumb | "does this line care we're on the web?" → yes | → no |

If you see `db.select` in a controller, or `c.json` in a service, it's in the
wrong layer.

## 4. A request traced: `POST /reports`

Body: `{ "placeId": 104187, "severity": 5, "plants": ["birch", "oak"] }`
(Zelenodolsk). One overall severity; `plants` lists what the user is allergic to.

**1. Route** — match path, validate, hand off:

```ts
// routes/reports.routes.ts
reportsRoutes.post("/", zValidator("json", createSubmissionSchema), createReport);
```

If the body is invalid, `zValidator` returns `400` itself and the controller
never runs.

**2. Controller** — move data between HTTP and the service:

```ts
// controllers/reports.controller.ts
const input = validated<CreateSubmissionInput>(c, "json");
const submission = await reportsService.createSubmission(input);
return c.json(submission, 201);
```

**3. Service** — the work and the rules (privacy-first):

```ts
// services/reports.service.ts
const [place] = await db.select({ regionId: places.regionId })
  .from(places).where(eq(places.id, input.placeId));
if (!place) throw new NotFoundError("unknown place");

// Map picked plants → distinct home families (the plants are NOT stored).
const rows = await db.select({ familyId: plants.familyId })
  .from(plants).where(inArray(plants.id, input.plants));
const families = [...new Set(rows.map((r) => r.familyId))];

// Store only region + severity + date; fold each family into the rollup once.
const [submission] = await db.insert(submissions)
  .values({ regionId: place.regionId, severity: input.severity }).returning();
for (const familyId of families)
  await bumpAggregate(submission.regionId, familyId, submission.reportedOn, input.severity);
return submission;
```

Here Zelenodolsk's `placeId` (104187) is translated to **Kazan's `regionId`**
(2162). `birch`+`oak` both resolve to `fagales`, so the family is counted once;
the plant ids are never written anywhere.

**4. Error path** — if the place doesn't exist the service throws
`NotFoundError`, which bubbles to `app.onError` in `index.ts` and becomes
`404 {"error":"unknown place"}`. The service never names a status code; that
mapping lives in one place.

## 5. Data model

```
places  (~135k rows)              regions  (~2.7k rows)
─────────────────────             ─────────────────────
id            104187 ──┐          id          2162
name      "Zelenodolsk"│  region  name        "Kazan"
regionId      2162 ────┴────────▶ lat, lng    (for the map)
                                       ▲
submissions (anonymous)                │ regionId
──────────────────────                 │
regionId ──────────────────────────────┤
severity  5                            │ (picked plants mapped to
reportedOn 2026-06-08                  │  families at write, then
   (no allergen columns)               │  discarded — never stored)
                                       │ regionId + family + date
                                       ▼
                            daily_aggregates
                            ───────────────────────────
                            regionId, familyId, date  (PK)
                            severitySum, reportCount

reference data (seeded from src/db/data/*.json):
  plants ─(family_id)→ families      plants ─◀ plant_proteins ▶─ proteins
  plants ─(display_group_id)→ display_groups
```

- **`places`** — what users search; each points to the region it reports under.
- **`regions`** — the metros; the map and aggregates attach here; holds `lat/lng`.
- **`submissions`** — one anonymous row per report: region / severity / date,
  **no allergen info**. Powers the region-overall map color.
- **`daily_aggregates`** — the only place allergen signal lives, by family.
  Stores `severitySum + reportCount` so each write is an atomic increment.
- **`plants` / `proteins` / `families` / `display_groups`** — reference data:
  what users pick, the proteins that drive predictions, and the family each plant
  aggregates into.

## 6. How the data got there (seed)

`npm run db:seed` runs `db/seed.ts` once:

1. Load ~135k cities from the `all-the-cities` dataset.
2. Anchors = cities ≥ `ANCHOR_MIN` (200k) → these become `regions`.
3. Each city snaps to its nearest anchor within `RADIUS_KM` (100) → that anchor's id.
4. Insert every city into `places` with that `regionId`.

This is why "Zelenodolsk" resolves to "Kazan": the mapping is computed and stored
at seed time, so requests only do a fast lookup. Tune `ANCHOR_MIN`, `RADIUS_KM`,
`SELF_MIN` at the top of the seed to trade coverage vs. anonymity.

## 7. The two user journeys

**Reporting (write):**

```
type town → GET /places/search → pick result (placeId)
          → POST /reports {placeId} → service resolves place→region,
            stores report, refreshes daily_aggregates
```

**Home-page map (read):**

```
GET /regions/status → today's reports grouped by region, joined to regions for
                      name + lat/lng, color computed → array of dots
click a dot (regionId) → GET /regions/:id/trends → reads daily_aggregates
                      → line chart for that metro
```

## Directory map

```
src/
├── index.ts                 bootstrap + central error handler
├── routes/                  wiring: path + validator + controller
│   ├── index.ts             mounts everything; /health, /meta
│   ├── places.routes.ts
│   ├── reports.routes.ts
│   └── regions.routes.ts
├── controllers/             HTTP in/out only
│   ├── health.controller.ts
│   ├── meta.controller.ts
│   ├── places.controller.ts
│   ├── reports.controller.ts
│   └── regions.controller.ts
├── services/                business logic + DB access (HTTP-agnostic)
│   ├── places.service.ts
│   ├── reports.service.ts
│   ├── regions.service.ts
│   └── aggregate.service.ts
├── lib/                     shared helpers
│   ├── severity.ts          color thresholds (single source)
│   ├── dates.ts             isoDate()
│   ├── errors.ts            NotFoundError
│   └── validated.ts         typed validator extraction
├── schemas.ts               Zod schemas + inferred types
└── db/
    ├── schema.ts            table definitions
    ├── index.ts             connection + `db` handle
    ├── migrate.ts           applies SQL migrations from drizzle/
    └── seed.ts              worldwide places/regions seed

drizzle/                     generated SQL migrations (versioned schema history)
├── 0000_*.sql
└── meta/                    Drizzle's migration journal + snapshots
```
