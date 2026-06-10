# achoo

Community allergy severity tracker. Anonymous reports aggregated by region into
trend graphs and red/yellow/green/purple status colors.

This is the **API**. The web frontend lives in a **separate repo**
(`../achoo-web` — React · TypeScript · Vite).

- **API** (this repo) — **Hono · PostgreSQL · Drizzle ORM · Zod · TypeScript**
- **Web** (separate repo) — report flow now; world map next

Docs: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (how it's built) ·
[`docs/API.md`](docs/API.md) (endpoint reference).

## Run both

```bash
# terminal 1 — API (needs Postgres up + migrated + seeded, see Setup below)
npm run dev                                   # http://localhost:3000

# terminal 2 — web app (separate repo)
cd ../achoo-web && npm install && npm run dev # http://localhost:5173
```

The web app reads `VITE_API_URL` (defaults to `http://localhost:3000`).

## Privacy model

- Reports are **anonymous**: only `severity`, `region`, `date` are stored. The
  picked plants are mapped to families and folded into the daily rollups at write
  time, then **discarded** — no per-person allergen profile is ever persisted.
- No auth, no IP, no session token reaches the database.
- Once-per-day throttling and personal history live **client-side** (later).

## Setup

```bash
npm install
cp .env.example .env

docker-compose up -d        # start Postgres
npm run db:migrate          # apply SQL migrations (creates the schema)
npm run db:seed             # seed worldwide places + regions (~135k cities)
npm run dev                 # start the API on :3000
```

## Database migrations

Schema changes are versioned as SQL files in `drizzle/`, generated from
`src/db/schema.ts`. The workflow:

```bash
# 1. edit src/db/schema.ts, then generate a migration from the diff:
npm run db:generate

# 2. apply pending migrations (idempotent; safe in CI / on deploy):
npm run db:migrate
```

`db:migrate` runs `src/db/migrate.ts`, which uses Drizzle's runtime migrator
(no `drizzle-kit` needed in production) and records applied migrations in a
`__drizzle_migrations` table.

> `npm run db:push` also exists — it shoves the schema straight into the DB
> without a migration file. Handy for throwaway prototyping, but **migrations
> are the source of truth**; don't mix the two on a database you care about.

## Endpoints

Full reference with request/response shapes and error formats:
[`docs/API.md`](docs/API.md).

| Method | Path                     | Purpose                                       |
| ------ | ------------------------ | --------------------------------------------- |
| GET    | `/health`                | liveness check                                |
| GET    | `/meta`                  | plants + display groups + families + scale + colors |
| GET    | `/meta/cross-reactivity` | shared-protein map for client recommendations |
| GET    | `/places/search`         | typeahead (`?q=zelen&limit=10`)               |
| GET    | `/regions/status`        | today's overall color per active region (`?date=`) |
| GET    | `/regions/:id/families`  | per-family signal for one region (`?date=`)   |
| GET    | `/regions/:id/trends`    | daily trend (`?family=`, `?days=30`)          |
| POST   | `/reports`               | submit an anonymous report (severity + picked plants) |

### Find a place, then submit

The user searches a place; the response carries the region it reports under.
A small town (Zelenodolsk) rolls up into its metro (Kazan).

```bash
curl "http://localhost:3000/places/search?q=zelenodolsk"
# -> [{ "placeId": 104187, "name": "Zelenodolsk", ..., "region": { "name": "Kazan", ... } }]

curl -X POST http://localhost:3000/reports \
  -H 'content-type: application/json' \
  -d '{ "placeId": 104187, "severity": 5, "plants": ["birch", "oak"] }'
```

### Region colors today

```bash
curl http://localhost:3000/regions/status
```

## Schema

- `regions` — agglomerations (the aggregation units). The map and aggregates attach here.
- `places` — worldwide searchable index; each place points to the region it
  reports under. Small towns roll up into their nearest metro.
- `submissions` — one anonymous row per report (`severity` 1–6, `region`, `date`);
  no allergen info. Powers the region-overall map color.
- `daily_aggregates` — per region/**family**/day rollup (`severitySum`,
  `reportCount`); incremented on each report. The only place allergen signal lives.
- `plants` / `proteins` / `families` / `display_groups` — reference data seeded
  from `src/db/data/*.json` (what users pick; cross-reactivity; aggregation family).

Color thresholds live in `src/lib/severity.ts` (single source of truth).

## Worldwide seed

`npm run db:seed` loads ~135k cities (GeoNames-derived `all-the-cities`) and maps
each to the metro it reports under. Tune the three knobs at the top of
`src/db/seed.ts`:

- `ANCHOR_MIN` (200k) — what counts as a metro/agglomeration.
- `RADIUS_KM` (100) — how far a town snaps to a metro.
- `SELF_MIN` (100k) — isolated cities this big become their own region.
