CREATE TYPE "public"."allergen" AS ENUM('birch', 'oak', 'alder', 'hazel', 'grass', 'mugwort', 'ragweed', 'olive');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "daily_aggregates" (
	"region_id" integer NOT NULL,
	"allergen" "allergen" NOT NULL,
	"date" date NOT NULL,
	"avg_severity" real NOT NULL,
	"report_count" integer NOT NULL,
	CONSTRAINT "daily_aggregates_region_id_allergen_date_pk" PRIMARY KEY("region_id","allergen","date")
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
CREATE TABLE IF NOT EXISTS "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"region_id" integer NOT NULL,
	"allergen" "allergen" NOT NULL,
	"severity" integer NOT NULL,
	"reported_on" date DEFAULT CURRENT_DATE NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "severity_range" CHECK ("reports"."severity" between 1 and 6)
);
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
 ALTER TABLE "reports" ADD CONSTRAINT "reports_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "places_name_idx" ON "places" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reports_region_date_idx" ON "reports" USING btree ("region_id","reported_on");