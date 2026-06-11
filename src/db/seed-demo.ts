/**
 * Demo seed — inject fake "today" reports so the map and family panel have
 * something to show. Run with `npm run seed:demo`.
 *
 * Each scenario is filed through the real `createSubmission` flow, so the data
 * is identical to genuine reports: plants are mapped to their families and the
 * daily rollups are bumped (birch + oak both count once, as `fagales`). Edit
 * the SCENARIOS list below and re-run to taste.
 *
 * This only ADDS rows. To start from a clean slate first, truncate the report
 * tables (reference data + places/regions are untouched):
 *
 *   docker exec -e PGPASSWORD=achoo achoo-db-1 psql -U achoo -d achoo \
 *     -c "truncate submissions, daily_aggregates restart identity;"
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "./index.js";
import { places } from "./schema.js";
import { createSubmission } from "../services/reports.service.js";

type Scenario = {
  label: string;
  /** Stable GeoNames id (resolved to the current placeId at run time, since the
   * serial placeId changes on every re-seed). Find one: GET /places/search. */
  geonameId: number;
  plants: string[];
  count: number;
  /** Fixed severity, or a [min, max] range picked at random per report. */
  severity: number | [number, number];
  unknown?: boolean;
};

const VANCOUVER = 6173331; // Vancouver, BC — GeoNames id (stable)

const SCENARIOS: Scenario[] = [
  { label: "4× mugwort (asteraceae)", geonameId: VANCOUVER, plants: ["mugwort"], count: 4, severity: [1, 6] },
  { label: "20× olive (oleaceae)", geonameId: VANCOUVER, plants: ["olive"], count: 20, severity: [1, 6] },
  { label: "1× tobacco (solanaceae)", geonameId: VANCOUVER, plants: ["tobacco"], count: 1, severity: [1, 6] },
  { label: "3× lilac (oleaceae)", geonameId: VANCOUVER, plants: ["lilac"], count: 3, severity: [1, 6] },
  { label: "3× english-plantain (plantaginaceae)", geonameId: VANCOUVER, plants: ["english-plantain"], count: 3, severity: [1, 6] },
];

function pickSeverity(s: number | [number, number]): number {
  if (typeof s === "number") return s;
  const [min, max] = s;
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Resolve a stable GeoNames id to the current serial placeId. */
async function placeIdOf(geonameId: number): Promise<number> {
  const [row] = await db
    .select({ id: places.id })
    .from(places)
    .where(eq(places.geonameId, geonameId));
  if (!row) throw new Error(`no place for geonameId ${geonameId} — run db:seed`);
  return row.id;
}

async function main() {
  for (const sc of SCENARIOS) {
    const placeId = await placeIdOf(sc.geonameId);
    for (let i = 0; i < sc.count; i++) {
      await createSubmission({
        placeId,
        severity: pickSeverity(sc.severity),
        plants: sc.unknown ? [] : sc.plants,
        unknown: sc.unknown ?? false,
      });
    }
    console.log(`seeded ${sc.count.toString().padStart(3)} × ${sc.label}`);
  }
  console.log("demo seed done");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
