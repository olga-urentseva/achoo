import { asc, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  displayGroups,
  families,
  plantProteins,
  plants,
  proteins,
} from "../db/schema.js";
import { SEVERITY_COLORS } from "../lib/severity.js";

/**
 * Everything the report form needs: the pickable plants (with their family, so
 * the client can match a user's saved plants to families locally), the friendly
 * display groups, the family labels, and the severity scale + colors.
 */
export async function getMeta() {
  const [plantRows, groupRows, familyRows] = await Promise.all([
    db
      .select({
        id: plants.id,
        name: plants.name,
        scientificName: plants.scientificName,
        type: plants.type,
        family: plants.familyId,
        featured: plants.featured,
        displayGroup: plants.displayGroupId,
      })
      .from(plants)
      .orderBy(desc(plants.featured), plants.name),
    db
      .select({ id: displayGroups.id, label: displayGroups.label })
      .from(displayGroups)
      .orderBy(asc(displayGroups.sort)),
    db
      .select({ id: families.id, label: families.label })
      .from(families)
      .orderBy(asc(families.sort)),
  ]);

  return {
    plants: plantRows,
    displayGroups: groupRows,
    families: familyRows,
    severity: { min: 1, max: 6 },
    colors: SEVERITY_COLORS,
  };
}

export interface CrossReactivityGroup {
  protein: string;
  name: string;
  kind: "major" | "panallergen";
  strength: "strong" | "moderate" | "weak";
  plants: string[];
}

/**
 * Public cross-reactivity map, built from the proteins and their plants. The
 * client pairs it with the user's locally stored plants to suggest others they
 * may react to — ranking by `strength` and treating panallergens as weak hints.
 */
export async function getCrossReactivity(): Promise<CrossReactivityGroup[]> {
  const rows = await db
    .select({
      protein: proteins.id,
      name: proteins.name,
      kind: proteins.kind,
      strength: proteins.strength,
      plant: plantProteins.plantId,
    })
    .from(proteins)
    .innerJoin(plantProteins, eq(plantProteins.proteinId, proteins.id))
    .orderBy(proteins.id);

  const byProtein = new Map<string, CrossReactivityGroup>();
  for (const r of rows) {
    let group = byProtein.get(r.protein);
    if (!group) {
      group = {
        protein: r.protein,
        name: r.name,
        kind: r.kind,
        strength: r.strength,
        plants: [],
      };
      byProtein.set(r.protein, group);
    }
    group.plants.push(r.plant);
  }
  return [...byProtein.values()];
}
