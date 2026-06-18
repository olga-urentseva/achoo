import { asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  allergenProteins,
  allergens,
  displayGroups,
  families,
  proteins,
} from "../db/schema.js";
import { SEVERITY_COLORS } from "../lib/severity.js";
import type { AllergenCategory } from "../schemas.js";

/**
 * Everything the report form needs: the pickable plants (with their family, so
 * the client can match a user's saved plants to families locally), the friendly
 * display groups, the family labels, and the severity scale + colors. Plants are
 * the allergen rows that carry a pollen `type` (the rest are food/animal/other).
 */
export async function getMeta() {
  const [plantRows, groupRows, familyRows] = await Promise.all([
    db
      .select({
        id: allergens.id,
        name: allergens.name,
        scientificName: allergens.scientificName,
        type: allergens.type,
        family: allergens.familyId,
        featured: allergens.featured,
        displayGroup: allergens.displayGroupId,
      })
      .from(allergens)
      .where(isNotNull(allergens.type))
      .orderBy(desc(allergens.featured), allergens.name),
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

/** One allergen source in a cross-reactivity group, tagged with its category. */
export interface CrossReactivitySource {
  id: string;
  name: string;
  category: AllergenCategory;
}

export interface CrossReactivityGroup {
  protein: string;
  name: string;
  kind: "major" | "panallergen";
  strength: "strong" | "moderate" | "weak";
  sources: CrossReactivitySource[];
}

/**
 * Public cross-reactivity map for the requested categories (plant, food, animal,
 * other; defaults to plants only). All sources live in one `allergens` table and
 * link to proteins via `allergen_proteins`, where the category sits on the edge
 * so a source can belong to several (cattle: animal + food). The client pairs it
 * with the user's saved picks to suggest others they may react to — ranking by
 * `strength`, treating panallergens as weak hints.
 */
export async function getCrossReactivity(
  categories: AllergenCategory[] = ["plant"],
): Promise<CrossReactivityGroup[]> {
  const rows = await db
    .select({
      protein: proteins.id,
      name: proteins.name,
      kind: proteins.kind,
      strength: proteins.strength,
      id: allergens.id,
      sourceName: allergens.name,
      category: allergenProteins.category,
    })
    .from(proteins)
    .innerJoin(allergenProteins, eq(allergenProteins.proteinId, proteins.id))
    .innerJoin(allergens, eq(allergens.id, allergenProteins.allergenId))
    .where(inArray(allergenProteins.category, categories))
    .orderBy(proteins.id);

  const byProtein = new Map<string, CrossReactivityGroup>();
  for (const r of rows) {
    let g = byProtein.get(r.protein);
    if (!g) {
      g = {
        protein: r.protein,
        name: r.name,
        kind: r.kind,
        strength: r.strength,
        sources: [],
      };
      byProtein.set(r.protein, g);
    }
    g.sources.push({ id: r.id, name: r.sourceName, category: r.category });
  }
  return [...byProtein.values()];
}
