import { desc, eq, ilike } from "drizzle-orm";
import { db } from "../db/index.js";
import { places, regions } from "../db/schema.js";

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
