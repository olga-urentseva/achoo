import { sql } from "drizzle-orm";
import {
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
 * The selectable allergens — what users pick from and what `/meta` advertises.
 */
export const ALLERGENS = [
  "birch",
  "oak",
  "alder",
  "hazel",
  "grass",
  "mugwort",
  "ragweed",
  "olive",
] as const;

/**
 * Sentinel for "I have symptoms but don't know which allergen". Stored as a
 * real report so it counts toward a region's severity, but kept out of the
 * selectable list above so it never shows up as a pickable chip.
 */
export const UNKNOWN_ALLERGEN = "unknown" as const;

/** Every value a report's `allergen` column can hold (DB enum + validation). */
export const REPORT_ALLERGENS = [...ALLERGENS, UNKNOWN_ALLERGEN] as const;

export type Allergen = (typeof REPORT_ALLERGENS)[number];

export const allergenEnum = pgEnum("allergen", REPORT_ALLERGENS);

/**
 * Agglomerations — the aggregation units (anchors). Reports, daily
 * aggregates, and status colors all attach here. A small town's reports
 * roll up into its nearest metro (e.g. Zelenodolsk -> Kazan), so every
 * region is big enough to stay anonymous and statistically meaningful.
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
 * Searchable place index for the typeahead — worldwide, including small
 * towns. Each place points to the region it reports under. Seeded once
 * from the GeoNames-derived `all-the-cities` dataset; never queried at
 * write time beyond the lookup that resolves a chosen place to its region.
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
 * Anonymous reports — the source of truth.
 * No identity, no IP, no session token reaches this table.
 */
export const reports = pgTable(
  "reports",
  {
    id: serial("id").primaryKey(),
    regionId: integer("region_id")
      .notNull()
      .references(() => regions.id),
    allergen: allergenEnum("allergen").notNull(),
    severity: integer("severity").notNull(),
    reportedOn: date("reported_on", { mode: "string" })
      .notNull()
      .default(sql`CURRENT_DATE`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("severity_range", sql`${t.severity} between 1 and 6`),
    index("reports_region_date_idx").on(t.regionId, t.reportedOn),
  ],
);

/**
 * Pre-computed per region / allergen / day rollup — the cache that keeps
 * trend and region-color queries fast as report volume grows.
 */
export const dailyAggregates = pgTable(
  "daily_aggregates",
  {
    regionId: integer("region_id")
      .notNull()
      .references(() => regions.id),
    allergen: allergenEnum("allergen").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    avgSeverity: real("avg_severity").notNull(),
    reportCount: integer("report_count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.regionId, t.allergen, t.date] })],
);
