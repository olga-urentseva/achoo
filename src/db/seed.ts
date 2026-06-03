import "dotenv/config";
import cities from "all-the-cities";
import { db } from "./index.js";
import { dailyAggregates, places, regions, reports } from "./schema.js";

/**
 * Seeds the worldwide place index and the agglomerations they report under.
 *
 * - Anchors (regions) = cities >= ANCHOR_MIN people.
 * - Every place snaps to its nearest anchor within RADIUS_KM.
 * - A place with no anchor in range becomes its own region if it is itself
 *   sizable (>= SELF_MIN); otherwise it attaches to the nearest anchor at
 *   any distance, so there are no dead zones.
 *
 * Tune these three numbers to trade coverage vs. anonymity/table size.
 */
const ANCHOR_MIN = 200_000;
const SELF_MIN = 100_000;
const RADIUS_KM = 100;

const EARTH_KM = 6371;
const DEG = Math.PI / 180;

type City = {
  cityId: number;
  name: string;
  country: string;
  adminCode: string;
  population: number;
  loc: { coordinates: [number, number] }; // [lng, lat]
};

const all = cities as unknown as City[];

// Anchor coordinate columns, kept as flat arrays for a fast nearest scan.
const anchors = all.filter((c) => c.population >= ANCHOR_MIN);
const anLng = anchors.map((a) => a.loc.coordinates[0]);
const anLat = anchors.map((a) => a.loc.coordinates[1]);

/** Nearest anchor by equirectangular approximation (good enough under ~100km). */
function nearestAnchor(lat: number, lng: number): { idx: number; distKm: number } {
  const cosLat = Math.cos(lat * DEG);
  let best = -1;
  let bestSq = Infinity;
  for (let i = 0; i < anchors.length; i++) {
    const dx = (anLng[i]! - lng) * cosLat;
    const dy = anLat[i]! - lat;
    const sq = dx * dx + dy * dy;
    if (sq < bestSq) {
      bestSq = sq;
      best = i;
    }
  }
  return { idx: best, distKm: Math.sqrt(bestSq) * DEG * EARTH_KM };
}

function toRegionRow(c: City) {
  return {
    geonameId: c.cityId,
    name: c.name,
    admin1: c.adminCode ?? "",
    country: c.country,
    population: c.population,
    lat: c.loc.coordinates[1],
    lng: c.loc.coordinates[0],
  };
}

async function insertChunked<T>(
  table: typeof regions | typeof places,
  rows: T[],
  size = 1000,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.insert(table).values(rows.slice(i, i + size) as any);
  }
}

async function main() {
  console.log(`dataset: ${all.length} cities, ${anchors.length} anchors`);

  // Resolve every place to the geonameId of the region it reports under.
  const targetOf = new Map<number, number>();
  const regionIds = new Set<number>(anchors.map((a) => a.cityId));

  for (const c of all) {
    const [lng, lat] = c.loc.coordinates;
    const { idx, distKm } = nearestAnchor(lat, lng);
    const nearestId = idx >= 0 ? anchors[idx]!.cityId : c.cityId;

    let target: number;
    if (idx >= 0 && distKm <= RADIUS_KM) {
      target = nearestId; // snap to the metro
    } else if (c.population >= SELF_MIN) {
      target = c.cityId; // isolated real city -> its own region
      regionIds.add(c.cityId);
    } else {
      target = nearestId; // small + isolated -> nearest metro anyway
    }
    targetOf.set(c.cityId, target);
  }

  // Wipe (children first) so re-runs are clean.
  await db.delete(reports);
  await db.delete(dailyAggregates);
  await db.delete(places);
  await db.delete(regions);

  // Insert regions, then map geonameId -> the serial id Postgres assigned.
  const regionCities = all.filter((c) => regionIds.has(c.cityId));
  await insertChunked(regions, regionCities.map(toRegionRow));
  console.log(`inserted ${regionCities.length} regions`);

  const idByGeoname = new Map<number, number>();
  for (const r of await db
    .select({ id: regions.id, geonameId: regions.geonameId })
    .from(regions)) {
    idByGeoname.set(r.geonameId, r.id);
  }

  // Insert every city as a searchable place pointing at its region.
  const placeRows = all.map((c) => ({
    ...toRegionRow(c),
    regionId: idByGeoname.get(targetOf.get(c.cityId)!)!,
  }));
  await insertChunked(places, placeRows);
  console.log(`inserted ${placeRows.length} places`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
