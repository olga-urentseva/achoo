import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Applies any pending SQL migrations from ./drizzle. Safe to run repeatedly —
 * Drizzle records applied migrations in a `__drizzle_migrations` table and
 * skips ones already run. Uses its own single-connection client so it can run
 * standalone in CI / on deploy without booting the API.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  // `onnotice` silences harmless "already exists, skipping" notices that
  // Drizzle's migrator emits when re-checking its bookkeeping schema.
  const client = postgres(connectionString, { max: 1, onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  await client.end();

  console.log("migrations applied");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
