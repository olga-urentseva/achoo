CREATE TYPE "public"."allergen_category" AS ENUM('plant', 'food', 'animal', 'other');--> statement-breakpoint
CREATE TYPE "public"."plant_type" AS ENUM('tree', 'grass', 'weed');--> statement-breakpoint
CREATE TYPE "public"."protein_kind" AS ENUM('major', 'panallergen');--> statement-breakpoint
CREATE TYPE "public"."strength" AS ENUM('strong', 'moderate', 'weak');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "allergen_proteins" (
	"allergen_id" text NOT NULL,
	"protein_id" text NOT NULL,
	"category" "allergen_category" NOT NULL,
	CONSTRAINT "allergen_proteins_allergen_id_protein_id_category_pk" PRIMARY KEY("allergen_id","protein_id","category")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "allergens" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "plant_type",
	"scientific_name" text,
	"family_id" text,
	"featured" boolean DEFAULT false NOT NULL,
	"display_group_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "daily_aggregates" (
	"region_id" integer NOT NULL,
	"family_id" text NOT NULL,
	"date" date NOT NULL,
	"severity_sum" integer NOT NULL,
	"report_count" integer NOT NULL,
	CONSTRAINT "daily_aggregates_region_id_family_id_date_pk" PRIMARY KEY("region_id","family_id","date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "display_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "families" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "places" (
	"id" serial PRIMARY KEY NOT NULL,
	"geoname_id" integer NOT NULL,
	"name" text NOT NULL,
	"admin1" text DEFAULT '' NOT NULL,
	"country" text NOT NULL,
	"population" integer NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"region_id" integer NOT NULL,
	CONSTRAINT "places_geoname_id_unique" UNIQUE("geoname_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proteins" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "protein_kind" NOT NULL,
	"strength" "strength" NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "regions" (
	"id" serial PRIMARY KEY NOT NULL,
	"geoname_id" integer NOT NULL,
	"name" text NOT NULL,
	"admin1" text DEFAULT '' NOT NULL,
	"country" text NOT NULL,
	"population" integer NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	CONSTRAINT "regions_geoname_id_unique" UNIQUE("geoname_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"region_id" integer NOT NULL,
	"severity" integer NOT NULL,
	"unknown" boolean DEFAULT false NOT NULL,
	"reported_on" date DEFAULT CURRENT_DATE NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "severity_range" CHECK ("submissions"."severity" between 1 and 6)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "allergen_proteins" ADD CONSTRAINT "allergen_proteins_allergen_id_allergens_id_fk" FOREIGN KEY ("allergen_id") REFERENCES "public"."allergens"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "allergen_proteins" ADD CONSTRAINT "allergen_proteins_protein_id_proteins_id_fk" FOREIGN KEY ("protein_id") REFERENCES "public"."proteins"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "allergens" ADD CONSTRAINT "allergens_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "allergens" ADD CONSTRAINT "allergens_display_group_id_display_groups_id_fk" FOREIGN KEY ("display_group_id") REFERENCES "public"."display_groups"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "daily_aggregates" ADD CONSTRAINT "daily_aggregates_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "places" ADD CONSTRAINT "places_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submissions" ADD CONSTRAINT "submissions_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "places_name_idx" ON "places" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submissions_region_date_idx" ON "submissions" USING btree ("region_id","reported_on");