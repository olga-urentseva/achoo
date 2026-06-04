# achoo API reference

Anonymous community allergy tracker. Users search their town, report severity
(1–6) for an allergen, and read aggregated trends and status colors per region.

- **Base URL (dev):** `http://localhost:3000`
- **Content type:** all request bodies and responses are JSON.
- **No auth.** Reports are anonymous — only `severity`, `allergen`, `region`,
  and `date` are stored. Once-per-day throttling is enforced client-side.

## Core flow

```
GET /meta                  load allergen list + severity scale
GET /places/search?q=…     user finds their town  ──▶ placeId, region.id
POST /reports {placeId}    submit severity        (server resolves place → region)
GET /regions/:id/trends    chart one region       (id = region.id)
GET /regions/status        colors for the map
```

Two IDs are passed forward:

- **`placeId`** — a specific town; used only to **submit**. The server rolls it
  up into the region it belongs to.
- **`regionId`** (`region.id`) — the agglomeration/metro; used to **read**
  trends. Found in a search result's `region.id` or a report's `regionId`.

## Conventions

### Reference values

| Field      | Values |
| ---------- | ------ |
| `allergen` | `birch`, `oak`, `alder`, `hazel`, `grass`, `mugwort`, `ragweed`, `olive` |
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
| `404`  | referenced resource does not exist (e.g. unknown `placeId`) |
| `500`  | unexpected server error |

Validation errors (`400`) return a Zod error object:

```json
{
  "success": false,
  "error": {
    "name": "ZodError",
    "issues": [
      {
        "code": "too_big",
        "maximum": 6,
        "path": ["severity"],
        "message": "Number must be less than or equal to 6"
      }
    ]
  }
}
```

Resource errors (`404`/`500`) return `{ "error": "<message>" }`.

---

## Endpoints

### GET /health

Liveness check (ops / Docker healthcheck). No product data.

**200**

```json
{ "ok": true }
```

---

### GET /meta

Static metadata for building the report form. Safe to fetch once and cache.

**200**

```json
{
  "allergens": ["birch", "oak", "alder", "hazel", "grass", "mugwort", "ragweed", "olive"],
  "unknownAllergen": "unknown",
  "severity": { "min": 1, "max": 6 },
  "colors": ["green", "yellow", "red", "purple"]
}
```

`unknownAllergen` is the sentinel a user submits when they have symptoms but
don't know the cause. It's deliberately **not** in `allergens`, so it never
renders as a selectable chip — submit it on its own (see `POST /reports`).

---

### GET /meta/cross-reactivity

Public pollen cross-reactivity map: which allergens share a protein family, so
a sensitivity to one often comes with the others. Static reference data, safe
to fetch once and cache.

This carries **no personal data**. The client pairs it with the user's own
allergen list — which lives only in their browser's `localStorage`, never on
the server — to suggest allergens they may also react to. Recommendations are
computed on-device; the server never sees a user's allergen profile.

**200** — array of protein groups:

```json
[
  {
    "protein": "Bet v 1 (PR-10)",
    "family": "Fagales tree pollen",
    "strength": "strong",
    "allergens": ["birch", "alder", "hazel", "oak"]
  },
  {
    "protein": "Artemisia / Ambrosia weed group",
    "family": "Weed pollen",
    "strength": "moderate",
    "allergens": ["mugwort", "ragweed"]
  },
  {
    "protein": "Profilin",
    "family": "Panallergen (broad, usually mild)",
    "strength": "weak",
    "allergens": ["birch", "grass", "mugwort", "ragweed", "olive"]
  }
]
```

| Field       | Type     | Notes |
| ----------- | -------- | ----- |
| `protein`   | string   | the shared molecule that explains the cross-reactivity |
| `family`    | string   | human-readable family label (for showing the user "why") |
| `strength`  | string   | `strong` / `moderate` / `weak` — how strongly the protein drives cross-reactivity; rank or filter suggestions by this |
| `allergens` | string[] | members of the group; each is one of the allergen enum values |

> **Client recipe:** for each allergen in the user's local list, find the
> groups containing it and suggest the *other* members, ranked by `strength`.
> Treat `weak` (profilin) links as hints, not strong predictions. Pair with a
> "not medical advice" disclaimer.

---

### GET /places/search

Typeahead over the worldwide place index. Prefix match on the place name,
ordered by population (largest first). Each result carries the region it
reports under, so the UI can show e.g. "Zelenodolsk → reporting under Kazan".

**Query parameters**

| Name    | Type   | Required | Default | Notes |
| ------- | ------ | -------- | ------- | ----- |
| `q`     | string | yes      | —       | 1–80 chars; prefix match (`zelen` matches `Zelenodolsk`) |
| `limit` | int    | no       | `10`    | 1–20 |

**Request**

```bash
curl "http://localhost:3000/places/search?q=zelen&limit=3"
```

**200**

```json
[
  {
    "placeId": 104187,
    "name": "Zelenodolsk",
    "admin1": "Tatarstan Republic",
    "country": "Russia",
    "population": 99600,
    "region": {
      "id": 2162,
      "name": "Kazan",
      "admin1": "Tatarstan Republic",
      "country": "Russia"
    }
  }
]
```

| Field         | Type   | Notes |
| ------------- | ------ | ----- |
| `placeId`     | int    | pass to `POST /reports` |
| `name`        | string | place name |
| `admin1`      | string | full region/state name (e.g. `Texas`), may be empty |
| `country`     | string | full country name (e.g. `United States`) |
| `population`  | int    | |
| `region.id`   | int    | the region it reports under; pass to `/regions/:id/trends` |
| `region.*`    |        | region's name / admin1 / country |

> **Note:** search is prefix-only. `lenodolsk` (mid-word) or typos like `kazn`
> return no results.

---

### POST /reports

Submit an anonymous report covering one or more allergens the user is reacting
to, each at its own severity. The `placeId` is resolved server-side to the
region it aggregates into; clients cannot post a region directly. One stored
report row is created per allergen.

**Request body**

| Field                | Type   | Required | Notes |
| -------------------- | ------ | -------- | ----- |
| `placeId`            | int    | yes      | from `/places/search` |
| `reports`            | array  | yes      | 1–9 items; one per allergen, no duplicates |
| `reports[].allergen` | string | yes      | an allergen enum value, or `unknown` |
| `reports[].severity` | int    | yes      | 1–6 |

To report symptoms without a known cause, include an item with
`allergen: "unknown"` (from `/meta`'s `unknownAllergen`). It can stand alone or
sit alongside named allergens.

**Request**

```bash
curl -X POST http://localhost:3000/reports \
  -H 'content-type: application/json' \
  -d '{
    "placeId": 104187,
    "reports": [
      { "allergen": "birch", "severity": 5 },
      { "allergen": "grass", "severity": 2 }
    ]
  }'
```

**201** — array of stored reports, one per allergen:

```json
[
  {
    "id": 3,
    "regionId": 2162,
    "allergen": "birch",
    "severity": 5,
    "reportedOn": "2026-06-02",
    "createdAt": "2026-06-02T19:35:35.354Z"
  },
  {
    "id": 4,
    "regionId": 2162,
    "allergen": "grass",
    "severity": 2,
    "reportedOn": "2026-06-02",
    "createdAt": "2026-06-02T19:35:35.354Z"
  }
]
```

`regionId` is the resolved region (Kazan), not the place (Zelenodolsk).

**Errors**

- `400` — validation failed: empty `reports`, an out-of-range severity, or a
  duplicate allergen (see error format above).
- `404` — `{ "error": "unknown place" }` when `placeId` does not exist.

---

### GET /regions/:id/trends

Daily severity trend for one region, read from the pre-computed aggregates —
for charting a month/year of history. Without `allergen`, all allergens are
combined via a count-weighted average.

**Path parameters**

| Name | Type | Notes |
| ---- | ---- | ----- |
| `id` | int  | a `region.id` (positive integer) |

**Query parameters**

| Name       | Type   | Required | Default | Notes |
| ---------- | ------ | -------- | ------- | ----- |
| `allergen` | string | no       | all     | filter to one allergen |
| `days`     | int    | no       | `30`    | 1–365; window ending today |

**Request**

```bash
curl "http://localhost:3000/regions/2162/trends?allergen=birch&days=7"
```

**200** — array of daily points, oldest first:

```json
[
  { "date": "2026-06-02", "avgSeverity": 5.33, "reportCount": 3, "color": "purple" }
]
```

**Errors**

- `400` — `{ "error": "invalid region id" }` when `id` is not a positive integer.

---

### GET /regions/status

Current status color for every region that has reports on a given day — the
data behind the **home-page world map** and "don't go outside" overview. Each
item includes `lat`/`lng` so the client can plot a colored dot directly.
Regions with no reports that day are omitted.

**Query parameters**

| Name   | Type   | Required | Default | Notes |
| ------ | ------ | -------- | ------- | ----- |
| `date` | string | no       | today   | `YYYY-MM-DD` |

**Request**

```bash
curl "http://localhost:3000/regions/status?date=2026-06-02"
```

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
    "date": "2026-06-02",
    "reportCount": 3,
    "avgSeverity": 5.33,
    "color": "purple"
  }
]
```

| Field         | Type   | Notes |
| ------------- | ------ | ----- |
| `regionId`    | int    | region id |
| `name`        | string | region (metro) name |
| `admin1`      | string | full region/state name |
| `country`     | string | full country name |
| `lat` / `lng` | float  | dot position for the map |
| `reportCount` | int    | reports that day |
| `avgSeverity` | float  | average severity (round for display) |
| `color`       | string | dot color (`green`/`yellow`/`red`/`purple`) |

**Errors**

- `400` — validation failed when `date` is not a valid `YYYY-MM-DD`.
