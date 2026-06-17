import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Sentinel family used when a user reports "I have symptoms but don't know
 * which plant". It is a real aggregate bucket (so it counts toward a region's
 * activity) but is not a botanical family and has no plants.
 */
export const UNKNOWN_FAMILY = "unknown" as const;

export const plantTypeEnum = pgEnum("plant_type", ["tree", "grass", "weed"]);
export const proteinKindEnum = pgEnum("protein_kind", ["major", "panallergen"]);
export const strengthEnum = pgEnum("strength", ["strong", "moderate", "weak"]);

/**
 * Botanical/clinical families — the aggregation grain. Each plant belongs to
 * exactly one "home" family (the dominant major-protein cluster), so a report
 * counts once per distinct family among the picked plants. Seeded from
 * `data/families.json`.
 */
export const families = pgTable("families", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  sort: integer("sort").notNull(),
});

/**
 * Friendly picker groupings for species users can't tell apart (e.g. the eight
 * grasses behind one "Grasses" chip). Purely a UI concern — distinct from the
 * aggregation family. Seeded from `data/display-groups.json`.
 */
export const displayGroups = pgTable("display_groups", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  sort: integer("sort").notNull(),
});

/**
 * Every allergen source — plants, foods, animals (dander, mites, venom) and
 * "other" (moulds) — all in one table, at the same level. The pollen-only
 * fields (type, scientificName, familyId, displayGroupId, featured) are set for
 * plants and null for the rest; the report form picks the rows that have a
 * `type`. Seeded from `data/plants.json` + `data/allergens.json`.
 */
export const allergens = pgTable("allergens", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // Pollen-only fields — null for non-plant sources.
  type: plantTypeEnum("type"),
  scientificName: text("scientific_name"),
  familyId: text("family_id").references(() => families.id),
  featured: boolean("featured").notNull().default(false),
  displayGroupId: text("display_group_id").references(() => displayGroups.id),
});

/**
 * Allergenic proteins. `kind`/`strength` drive cross-reactivity predictions —
 * panallergens (profilin, polcalcin) are broad but weak hints, never family
 * merges. Seeded from `data/proteins.json` + `data/allergen-proteins.json`.
 */
export const proteins = pgTable("proteins", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: proteinKindEnum("kind").notNull(),
  strength: strengthEnum("strength").notNull(),
});

export const allergenCategoryEnum = pgEnum("allergen_category", [
  "plant",
  "food",
  "animal",
  "other",
]);

/**
 * Which allergen carries which protein, and the category that link represents.
 * Category lives on the edge (not the allergen) because one source can belong to
 * several — cattle is dander (animal) via lipocalin and milk/meat (food) via
 * casein/alpha-Gal; chestnut is pollen (plant) and a nut (food). Seeded from
 * `data/proteins.json` (plant edges) + `data/allergen-proteins.json` (the rest).
 */
export const allergenProteins = pgTable(
  "allergen_proteins",
  {
    allergenId: text("allergen_id")
      .notNull()
      .references(() => allergens.id),
    proteinId: text("protein_id")
      .notNull()
      .references(() => proteins.id),
    category: allergenCategoryEnum("category").notNull(),
  },
  (t) => [primaryKey({ columns: [t.allergenId, t.proteinId, t.category] })],
);

/**
 * Agglomerations — the aggregation units (anchors). A small town's reports
 * roll up into its nearest metro, so every region is big enough to stay
 * anonymous and statistically meaningful.
 */
export const regions = pgTable("regions", {
  id: serial("id").primaryKey(),
  geonameId: integer("geoname_id").notNull().unique(),
  name: text("name").notNull(),
  admin1: text("admin1").notNull().default(""),
  country: text("country").notNull(),
  population: integer("population").notNull(),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
});

/**
 * Searchable place index for the typeahead — worldwide, including small towns.
 * Each place points to the region it reports under.
 */
export const places = pgTable(
  "places",
  {
    id: serial("id").primaryKey(),
    geonameId: integer("geoname_id").notNull().unique(),
    name: text("name").notNull(),
    admin1: text("admin1").notNull().default(""),
    country: text("country").notNull(),
    population: integer("population").notNull(),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    regionId: integer("region_id")
      .notNull()
      .references(() => regions.id),
  },
  (t) => [index("places_name_idx").on(t.name)],
);

/**
 * Anonymous reports. Privacy-first: a submission stores ONLY the region, the
 * single overall severity, and the date — never which plants/families the
 * person picked. The picked plants are mapped to families and folded into
 * `daily_aggregates` at write time, then discarded. This row exists only to
 * compute the region's overall severity (one vote per person).
 */
export const submissions = pgTable(
  "submissions",
  {
    id: serial("id").primaryKey(),
    regionId: integer("region_id")
      .notNull()
      .references(() => regions.id),
    severity: integer("severity").notNull(),
    unknown: boolean("unknown").notNull().default(false),
    reportedOn: date("reported_on", { mode: "string" })
      .notNull()
      .default(sql`CURRENT_DATE`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("severity_range", sql`${t.severity} between 1 and 6`),
    index("submissions_region_date_idx").on(t.regionId, t.reportedOn),
  ],
);

/**
 * Per region / family / day rollup — the only place allergen signal lives at
 * rest, fully anonymous. Stores `severity_sum` + `report_count` (not an
 * average) so each report is a cheap atomic increment with nothing to
 * recompute. `family_id` is a family id or the `unknown` sentinel.
 */
export const dailyAggregates = pgTable(
  "daily_aggregates",
  {
    regionId: integer("region_id")
      .notNull()
      .references(() => regions.id),
    familyId: text("family_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    severitySum: integer("severity_sum").notNull(),
    reportCount: integer("report_count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.regionId, t.familyId, t.date] })],
);
