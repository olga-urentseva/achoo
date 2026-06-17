import "dotenv/config";
import { readFileSync } from "node:fs";
import cities from "all-the-cities";
import { db } from "./index.js";
import {
  allergenProteins,
  allergens,
  dailyAggregates,
  displayGroups,
  families,
  places,
  proteins,
  regions,
  submissions,
} from "./schema.js";

/**
 * The category buckets inside `allergen-proteins.json`. Plants are a category
 * too (at the API level), but they live in `plants.json`/`plants` — they were
 * deliberately dropped from this file — so only these three appear here.
 */
const ALLERGEN_FILE_CATEGORIES = ["food", "animal", "other"] as const;
type AllergenFileCategory = (typeof ALLERGEN_FILE_CATEGORIES)[number];

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

// Anchors = the regions every place reports under. A city qualifies only if it
// is big enough (>= ANCHOR_MIN) AND not within RADIUS_KM of an already chosen,
// larger anchor. Without that second rule a populous suburb (Surrey, Burnaby,
// Richmond — all >= 200k but ~20km from Vancouver) splits into its own region
// instead of rolling up into its metro. Candidates are taken largest-first, so
// the biggest city in each ~RADIUS_KM cluster wins and the rest snap into it.
// Flat lat/lng arrays double as the fast nearest-scan columns below.
const anchorMaxSq = (RADIUS_KM / (EARTH_KM * DEG)) ** 2;
const anchors: City[] = [];
const anLng: number[] = [];
const anLat: number[] = [];
for (const c of all
  .filter((c) => c.population >= ANCHOR_MIN)
  .sort((a, b) => b.population - a.population)) {
  const [lng, lat] = c.loc.coordinates;
  const cosLat = Math.cos(lat * DEG);
  let merged = false;
  for (let i = 0; i < anchors.length; i++) {
    const dx = (anLng[i]! - lng) * cosLat;
    const dy = anLat[i]! - lat;
    if (dx * dx + dy * dy <= anchorMaxSq) {
      merged = true; // within RADIUS_KM of a bigger anchor → same metro
      break;
    }
  }
  if (!merged) {
    anchors.push(c);
    anLng.push(lng);
    anLat.push(lat);
  }
}

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
/** A protein in `allergen-proteins.json`: its non-plant carriers, by category. */
type AllergenProteinData = {
  name: string;
  kind: "major" | "panallergen";
  strength: "strong" | "moderate" | "weak";
} & Partial<Record<AllergenFileCategory, string[]>>;

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
  const allergenProteinData = readJson<Record<string, AllergenProteinData>>(
    "allergen-proteins.json",
  );
  const allergenNames = readJson<Record<string, string>>("allergens.json");

  // Proteins come from both files (some, like PR-10/profilin, appear in both —
  // plant carriers in one, food carriers in the other). Merge by id; the plant
  // file wins for the shared defs since it's the long-standing source.
  const proteinDefs = new Map<
    string,
    { name: string; kind: "major" | "panallergen"; strength: "strong" | "moderate" | "weak" }
  >();
  for (const [id, p] of Object.entries(allergenProteinData)) {
    proteinDefs.set(id, { name: p.name, kind: p.kind, strength: p.strength });
  }
  for (const [id, p] of Object.entries(proteinData)) {
    proteinDefs.set(id, { name: p.name, kind: p.kind, strength: p.strength });
  }

  // Every allergen source in one table. Start from the non-plant items (id +
  // name, no pollen fields), then let plants override — so a source that is both
  // (chestnut: tree pollen and a nut; sunflower: pollen and a seed) keeps its
  // pollen fields and is still reachable from its food edges.
  const allergenRows = new Map<
    string,
    {
      id: string;
      name: string;
      type: "tree" | "grass" | "weed" | null;
      scientificName: string | null;
      familyId: string | null;
      featured: boolean;
      displayGroupId: string | null;
    }
  >();
  for (const [id, name] of Object.entries(allergenNames)) {
    allergenRows.set(id, {
      id,
      name,
      type: null,
      scientificName: null,
      familyId: null,
      featured: false,
      displayGroupId: null,
    });
  }
  for (const [id, p] of Object.entries(plantData)) {
    allergenRows.set(id, {
      id,
      name: p.name,
      type: p.type,
      scientificName: p.scientificName,
      familyId: p.family,
      featured: p.featured ?? false,
      displayGroupId: p.displayGroup ?? null,
    });
  }

  // One row per (allergen, protein, category) edge — category on the edge so a
  // source can belong to several (cattle: animal + food; chestnut: plant + food).
  const allergenLinks = [
    ...Object.entries(proteinData).flatMap(([proteinId, p]) =>
      p.plants.map((allergenId) => ({
        allergenId,
        proteinId,
        category: "plant" as const,
      })),
    ),
    ...Object.entries(allergenProteinData).flatMap(([proteinId, p]) =>
      ALLERGEN_FILE_CATEGORIES.flatMap((category) =>
        (p[category] ?? []).map((allergenId) => ({
          allergenId,
          proteinId,
          category,
        })),
      ),
    ),
  ];

  // Children first so re-runs are clean.
  await db.delete(allergenProteins);
  await db.delete(allergens);
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
    [...proteinDefs].map(([id, p]) => ({
      id,
      name: p.name,
      kind: p.kind,
      strength: p.strength,
    })),
  );
  await db.insert(allergens).values([...allergenRows.values()]);
  await db.insert(allergenProteins).values(allergenLinks);

  const plantCount = [...allergenRows.values()].filter((a) => a.type).length;
  console.log(
    `seeded ${Object.keys(familyData).length} families, ` +
      `${proteinDefs.size} proteins, ` +
      `${allergenRows.size} allergens (${plantCount} plants), ` +
      `${allergenLinks.length} links`,
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
