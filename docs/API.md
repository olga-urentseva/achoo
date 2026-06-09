# achoo API reference

Anonymous community allergy tracker. Users search their town, pick the plants
they're allergic to, report one severity (1–6), and read aggregated trends and
status colors per region.

- **Base URL (dev):** `http://localhost:3000`
- **Content type:** all request bodies and responses are JSON.
- **No auth, privacy-first.** A report stores only the **region**, the single
  **severity**, and the **date** — never which plants/families the user picked.
  The picked plants are mapped to families and folded into the daily rollups at
  write time, then discarded. Once-per-day throttling is enforced client-side.

## Core flow

```
GET /meta                  load plants + display groups + families + scale
GET /places/search?q=…     user finds their town  ──▶ placeId, region.id
POST /reports {placeId}    submit severity + picked plants (mapped to families, plants discarded)
GET /regions/:id/families  per-family signal for one region ("people like you")
GET /regions/:id/trends    chart one region over time
GET /regions/status        overall colors for the map
```

Two IDs are passed forward:

- **`placeId`** — a specific town; used only to **submit**. The server rolls it
  up into the region it belongs to.
- **`regionId`** (`region.id`) — the agglomeration/metro; used to **read**.

## Conventions

### The model: plants, families, proteins

- **Plant** — what a user picks (e.g. `birch`, `timothy`). `GET /meta` lists them.
- **Family** — the aggregation unit; each plant has exactly one home `family`
  (e.g. birch and oak → `fagales`). Reports aggregate by family, counting each
  person once per distinct family. This is what the per-family signal is keyed on.
- **Protein** — drives cross-reactivity *predictions* (`GET /meta/cross-reactivity`).
  A plant carries several proteins; panallergens are weak hints, not family merges.

### Reference values

| Field      | Values |
| ---------- | ------ |
| `severity` | integer `1`–`6` |
| `color`    | `green`, `yellow`, `red`, `purple` |

Color is derived from average severity (1–6 scale):

| avg severity | color    | meaning            |
| ------------ | -------- | ------------------ |
| `< 2.0`      | `green`  | low                |
| `2.0–3.49`   | `yellow` | moderate           |
| `3.5–4.99`   | `red`    | high               |
| `≥ 5.0`      | `purple` | extreme            |

`avgSeverity` is a floating-point average — round it for display.

### Errors

| Status | When |
| ------ | ---- |
| `400`  | request validation failed (bad/missing field, out-of-range value) |
| `404`  | referenced resource does not exist (e.g. unknown `placeId` or plant) |
| `500`  | unexpected server error |

Validation errors (`400`) return a Zod error object. Resource errors (`404`/
`500`) return `{ "error": "<message>" }`.

---

## Endpoints

### GET /health

Liveness check (ops / Docker healthcheck). No product data.

**200** — `{ "ok": true }`

---

### GET /meta

Metadata for building the report form. Safe to fetch once and cache.

**200**

```json
{
  "plants": [
    { "id": "birch", "name": "Birch", "scientificName": "Betula pendula", "type": "tree", "family": "fagales", "featured": true, "displayGroup": null },
    { "id": "timothy", "name": "Timothy grass", "scientificName": "Phleum pratense", "type": "grass", "family": "poaceae", "featured": false, "displayGroup": "grasses" }
  ],
  "displayGroups": [
    { "id": "grasses", "label": "Grasses" },
    { "id": "cypress", "label": "Cypress & cedar" }
  ],
  "families": [
    { "id": "fagales", "label": "Birch & related trees" },
    { "id": "poaceae", "label": "Grasses" }
  ],
  "severity": { "min": 1, "max": 6 },
  "colors": ["green", "yellow", "red", "purple"]
}
```

| Field                 | Notes |
| --------------------- | ----- |
| `plants[].featured`   | headline chips; the rest live behind an "other" expander |
| `plants[].displayGroup` | if set, the plant sits behind a friendly group chip (e.g. all grasses behind "Grasses") instead of its own chip |
| `plants[].family`     | the plant's home family — lets the client match a user's saved plants to families **locally**, without sending them to the server |
| `families`            | id → label, for showing "people who share your &lt;family&gt;" |

> The server has no `unknown` plant. To report symptoms without a known cause,
> send `unknown: true` to `POST /reports` (see below).

---

### GET /meta/cross-reactivity

Public cross-reactivity map, built from the proteins and the plants that carry
them: sharing a protein means a sensitivity to one often comes with the others.
Safe to fetch once and cache.

This carries **no personal data**. The client pairs it with the user's own plant
list — which lives only in their browser's `localStorage` — to suggest plants
they may also react to. Recommendations are computed on-device.

**200** — array of protein groups:

```json
[
  { "protein": "PR-10", "name": "Bet v 1 family (PR-10-like)", "kind": "major", "strength": "strong", "plants": ["birch", "alder", "hazel", "hornbeam", "hop-hornbeam", "beech", "oak", "chestnut"] },
  { "protein": "profilin", "name": "Profilin (Bet v 2 family)", "kind": "panallergen", "strength": "weak", "plants": ["birch", "timothy", "mugwort", "ragweed", "olive"] }
]
```

| Field      | Type     | Notes |
| ---------- | -------- | ----- |
| `protein`  | string   | protein id |
| `name`     | string   | human-readable protein/family name |
| `kind`     | string   | `major` (species-specific) or `panallergen` (broad, usually weak) |
| `strength` | string   | `strong` / `moderate` / `weak` — rank suggestions by this |
| `plants`   | string[] | plant ids that carry this protein |

> **Client recipe:** for each plant in the user's local list, find the groups
> containing it and suggest the *other* members, ranked by `strength`. Treat
> `weak`/`panallergen` links as hints, not predictions. Add a "not medical
> advice" disclaimer.

---

### GET /places/search

Typeahead over the worldwide place index. Prefix match on the place name,
ordered by population (largest first). Each result carries the region it reports
under.

**Query parameters**

| Name    | Type   | Required | Default | Notes |
| ------- | ------ | -------- | ------- | ----- |
| `q`     | string | yes      | —       | 1–80 chars; prefix match (`zelen` matches `Zelenodolsk`) |
| `limit` | int    | no       | `10`    | 1–20 |

**200**

```json
[
  {
    "placeId": 104187,
    "name": "Zelenodolsk",
    "admin1": "Tatarstan Republic",
    "country": "Russia",
    "population": 99600,
    "region": { "id": 2162, "name": "Kazan", "admin1": "Tatarstan Republic", "country": "Russia" }
  }
]
```

`placeId` → `POST /reports`; `region.id` → `/regions/:id/*`. Search is
prefix-only (`lenodolsk` mid-word or typos return nothing).

---

### POST /reports

Submit one anonymous report: a single overall severity plus the plants the user
is allergic to. The `placeId` is resolved server-side to its region; the plants
are mapped to their families and folded into the rollups, then **discarded** —
nothing per-person is stored.

**Request body**

| Field      | Type     | Required | Notes |
| ---------- | -------- | -------- | ----- |
| `placeId`  | int      | yes      | from `/places/search` |
| `severity` | int      | yes      | 1–6, one value for the whole submission |
| `plants`   | string[] | yes\*    | plant ids from `/meta`; \*required unless `unknown` is set |
| `unknown`  | bool     | no       | `true` = "symptoms, cause unknown"; counts toward the `unknown` family |

**Request**

```bash
curl -X POST http://localhost:3000/reports \
  -H 'content-type: application/json' \
  -d '{ "placeId": 104187, "severity": 5, "plants": ["birch", "oak"] }'
```

**201** — the stored submission (no allergen fields):

```json
{
  "id": 3,
  "regionId": 2162,
  "severity": 5,
  "unknown": false,
  "reportedOn": "2026-06-08",
  "createdAt": "2026-06-08T19:35:35.354Z"
}
```

`regionId` is the resolved region (Kazan). `birch`/`oak` are **not** in the
response or the database — they only determined which family buckets
(`fagales`) were incremented.

**Errors**

- `400` — validation failed: bad severity, or empty `plants` without `unknown`.
- `404` — `{ "error": "unknown place" }` or `{ "error": "unknown plant" }`.

---

### GET /regions/:id/families

Per-family signal for one region on a day — the data behind *"people who share
your &lt;family&gt; report X/6 today."* Families with fewer than the suppression
floor (`MIN_REPORTS`, currently 3) are **omitted** (k-anonymity + statistical
floor).

The client maps the user's saved plants → families locally (via `/meta`) and
shows the matching families from this response.

**Path:** `id` — a `region.id`. **Query:** `date` (optional, `YYYY-MM-DD`, default today).

**Request**

```bash
curl "http://localhost:3000/regions/2162/families?date=2026-06-08"
```

**200** — array, ordered by family:

```json
[
  { "family": "fagales", "label": "Birch & related trees", "avgSeverity": 4.5, "reportCount": 6, "color": "red" },
  { "family": "poaceae", "label": "Grasses", "avgSeverity": 2.0, "reportCount": 4, "color": "yellow" }
]
```

**Errors:** `400` — `{ "error": "invalid region id" }`.

---

### GET /regions/:id/trends

Daily severity trend for one region. With `family`, reads that family's rollup.
Without it, the overall trend is computed from submissions (one vote per report).

**Path:** `id` — a `region.id`.

**Query parameters**

| Name     | Type   | Required | Default | Notes |
| -------- | ------ | -------- | ------- | ----- |
| `family` | string | no       | all     | filter to one family id (e.g. `fagales`) |
| `days`   | int    | no       | `30`    | 1–365; window ending today |

**Request**

```bash
curl "http://localhost:3000/regions/2162/trends?family=fagales&days=7"
```

**200** — array of daily points, oldest first:

```json
[
  { "date": "2026-06-08", "avgSeverity": 4.5, "reportCount": 6, "color": "red" }
]
```

**Errors:** `400` — `{ "error": "invalid region id" }`.

---

### GET /regions/status

Overall status color for every region that has reports on a given day — the data
behind the **home-page world map**. One vote per report (no fan-out inflation).
Each item includes `lat`/`lng` for plotting a colored dot. Regions with no
reports that day are omitted.

**Query parameters**

| Name   | Type   | Required | Default | Notes |
| ------ | ------ | -------- | ------- | ----- |
| `date` | string | no       | today   | `YYYY-MM-DD` |

**200**

```json
[
  {
    "regionId": 2162,
    "name": "Kazan",
    "admin1": "Tatarstan Republic",
    "country": "Russia",
    "lat": 55.78874,
    "lng": 49.12214,
    "date": "2026-06-08",
    "reportCount": 3,
    "avgSeverity": 4.33,
    "color": "red"
  }
]
```

**Errors:** `400` — validation failed when `date` is not a valid `YYYY-MM-DD`.
