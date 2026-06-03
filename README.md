# achoo — API

Community allergy severity tracker. Anonymous reports aggregated by region into
trend graphs and red/yellow/green/purple status colors.

Stack: **Hono · PostgreSQL · Drizzle ORM · Zod · TypeScript**

Docs: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (how it's built) ·
[`docs/API.md`](docs/API.md) (endpoint reference).

## Privacy model

- Reports are **anonymous**: only `severity`, `allergen`, `region`, `date`.
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
| GET    | `/meta`                  | allergen list + severity scale + colors       |
| GET    | `/places/search`         | typeahead (`?q=zelen&limit=10`)               |
| GET    | `/regions/status`        | today's color per active region (`?date=`)    |
| GET    | `/regions/:id/trends`    | daily trend (`?allergen=`, `?days=30`)        |
| POST   | `/reports`               | submit one anonymous report                   |

### Find a place, then submit

The user searches a place; the response carries the region it reports under.
A small town (Zelenodolsk) rolls up into its metro (Kazan).

```bash
curl "http://localhost:3000/places/search?q=zelenodolsk"
# -> [{ "placeId": 104187, "name": "Zelenodolsk", ..., "region": { "name": "Kazan", ... } }]

curl -X POST http://localhost:3000/reports \
  -H 'content-type: application/json' \
  -d '{ "placeId": 104187, "allergen": "birch", "severity": 5 }'
```

### Region colors today

```bash
curl http://localhost:3000/regions/status
```

## Schema

- `regions` — agglomerations (the aggregation units). Reports and colors attach here.
- `places` — worldwide searchable index; each place points to the region it
  reports under. Small towns roll up into their nearest metro.
- `reports` — anonymous source of truth (`severity` 1–6, `allergen`, `region`, `date`).
- `daily_aggregates` — pre-computed per region/allergen/day rollup; refreshed on
  each insert. The performance cache behind trends and colors.

Color thresholds live in `src/lib/severity.ts` (single source of truth).

## Worldwide seed

`npm run db:seed` loads ~135k cities (GeoNames-derived `all-the-cities`) and maps
each to the metro it reports under. Tune the three knobs at the top of
`src/db/seed.ts`:

- `ANCHOR_MIN` (200k) — what counts as a metro/agglomeration.
- `RADIUS_KM` (100) — how far a town snaps to a metro.
- `SELF_MIN` (100k) — isolated cities this big become their own region.
