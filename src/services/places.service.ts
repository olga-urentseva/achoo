import { desc, eq, ilike, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { places, regions } from "../db/schema.js";
import { NotFoundError } from "../lib/errors.js";

export interface PlaceResult {
  placeId: number;
  name: string;
  admin1: string;
  country: string;
  population: number;
  region: {
    id: number;
    name: string;
    admin1: string;
    country: string;
  };
}

export interface NearestPlace extends PlaceResult {
  /** Great-circle distance from the queried point to the place, km. */
  distanceKm: number;
}

/**
 * Prefix search over the worldwide place index, largest first. Each match
 * carries the region it reports under, so the UI can show
 * "Zelenodolsk -> reporting under Kazan".
 */
export async function searchPlaces(
  q: string,
  limit: number,
): Promise<PlaceResult[]> {
  const rows = await db
    .select({
      placeId: places.id,
      name: places.name,
      admin1: places.admin1,
      country: places.country,
      population: places.population,
      regionId: regions.id,
      regionName: regions.name,
      regionAdmin1: regions.admin1,
      regionCountry: regions.country,
    })
    .from(places)
    .innerJoin(regions, eq(places.regionId, regions.id))
    .where(ilike(places.name, `${q}%`))
    .orderBy(desc(places.population))
    .limit(limit);

  return rows.map((r) => ({
    placeId: r.placeId,
    name: r.name,
    admin1: r.admin1,
    country: r.country,
    population: r.population,
    region: {
      id: r.regionId,
      name: r.regionName,
      admin1: r.regionAdmin1,
      country: r.regionCountry,
    },
  }));
}

/**
 * The place closest (great-circle) to the given coordinates, with the region it
 * reports under. This is the geolocation counterpart of `searchPlaces`: both
 * resolve a location to a `Place`, so the client gets a `placeId` to report
 * with and a region to read counts for. `distanceKm` lets the UI flag
 * "nearest city is far" (oceans / remote areas).
 */
export async function getNearestPlace(
  lat: number,
  lng: number,
): Promise<NearestPlace> {
  // Haversine in SQL; clamp the acos argument to [-1, 1] against float drift.
  const distanceKm = sql<number>`6371 * acos(least(1, greatest(-1,
    cos(radians(${lat})) * cos(radians(${places.lat}))
      * cos(radians(${places.lng}) - radians(${lng}))
    + sin(radians(${lat})) * sin(radians(${places.lat}))
  )))`;

  const [r] = await db
    .select({
      placeId: places.id,
      name: places.name,
      admin1: places.admin1,
      country: places.country,
      population: places.population,
      regionId: regions.id,
      regionName: regions.name,
      regionAdmin1: regions.admin1,
      regionCountry: regions.country,
      distanceKm,
    })
    .from(places)
    .innerJoin(regions, eq(places.regionId, regions.id))
    .orderBy(distanceKm)
    .limit(1);

  if (!r) throw new NotFoundError("no places available");

  return {
    placeId: r.placeId,
    name: r.name,
    admin1: r.admin1,
    country: r.country,
    population: r.population,
    region: {
      id: r.regionId,
      name: r.regionName,
      admin1: r.regionAdmin1,
      country: r.regionCountry,
    },
    distanceKm: Math.round(Number(r.distanceKm) * 10) / 10,
  };
}
