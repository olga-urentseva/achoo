import "dotenv/config";
import { readFileSync } from "node:fs";
import cities from "all-the-cities";
import { db } from "./index.js";
import {
  dailyAggregates,
  displayGroups,
  families,
  places,
  plantProteins,
  plants,
  proteins,
  regions,
  submissions,
} from "./schema.js";

// Readable names so users never see raw GeoNames codes. Country comes from
// the built-in Intl data; region (admin1) from the GeoNames names dataset.
const admin1Names: Record<string, string> = JSON.parse(
  readFileSync(new URL("./data/admin1.json", import.meta.url), "utf8"),
);
const countryDisplay = new Intl.DisplayNames(["en"], { type: "region" });

function countryName(code: string): string {
  try {
    return countryDisplay.of(code) ?? code;
  } catch {
    return code;
  }
}

function admin1Name(country: string, adminCode: string): string {
  return admin1Names[`${country}.${adminCode}`] ?? "";
}

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
    admin1: admin1Name(c.country, c.adminCode),
    country: countryName(c.country),
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

type LabelSort = { label: string; sort: number };
type PlantData = {
  name: string;
  scientificName: string;
  type: "tree" | "grass" | "weed";
  family: string;
  featured?: boolean;
  displayGroup?: string;
};
type ProteinData = {
  name: string;
  kind: "major" | "panallergen";
  strength: "strong" | "moderate" | "weak";
  plants: string[];
};

function readJson<T>(file: string): T {
  return JSON.parse(
    readFileSync(new URL(`./data/${file}`, import.meta.url), "utf8"),
  ) as T;
}

/**
 * Seed the allergen reference data (families, display groups, proteins, plants
 * and the plant↔protein links) from the curated JSON files. Idempotent: wipes
 * and reinserts, child tables first.
 */
async function seedReference(): Promise<void> {
  const familyData = readJson<Record<string, LabelSort>>("families.json");
  const groupData = readJson<Record<string, LabelSort>>("display-groups.json");
  const plantData = readJson<Record<string, PlantData>>("plants.json");
  const proteinData = readJson<Record<string, ProteinData>>("proteins.json");

  // Children first so re-runs are clean.
  await db.delete(plantProteins);
  await db.delete(plants);
  await db.delete(proteins);
  await db.delete(displayGroups);
  await db.delete(families);

  await db.insert(families).values(
    Object.entries(familyData).map(([id, f]) => ({
      id,
      label: f.label,
      sort: f.sort,
    })),
  );
  await db.insert(displayGroups).values(
    Object.entries(groupData).map(([id, g]) => ({
      id,
      label: g.label,
      sort: g.sort,
    })),
  );
  await db.insert(proteins).values(
    Object.entries(proteinData).map(([id, p]) => ({
      id,
      name: p.name,
      kind: p.kind,
      strength: p.strength,
    })),
  );
  await db.insert(plants).values(
    Object.entries(plantData).map(([id, p]) => ({
      id,
      name: p.name,
      scientificName: p.scientificName,
      type: p.type,
      familyId: p.family,
      featured: p.featured ?? false,
      displayGroupId: p.displayGroup ?? null,
    })),
  );
  const links = Object.entries(proteinData).flatMap(([proteinId, p]) =>
    p.plants.map((plantId) => ({ plantId, proteinId })),
  );
  await db.insert(plantProteins).values(links);

  console.log(
    `seeded ${Object.keys(familyData).length} families, ` +
      `${Object.keys(proteinData).length} proteins, ` +
      `${Object.keys(plantData).length} plants, ${links.length} links`,
  );
}

async function main() {
  console.log(`dataset: ${all.length} cities, ${anchors.length} anchors`);

  await seedReference();

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
  await db.delete(submissions);
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
