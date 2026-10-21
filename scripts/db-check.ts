// Quick sanity check: PostGIS is enabled and the app tables exist.
import "./load-env";
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set in .env.local");
  const sql = neon(url);

  const [{ version }] = (await sql`SELECT postgis_full_version() AS version`) as { version: string }[];
  console.log("PostGIS:", version.split(" ").slice(0, 2).join(" "));

  const tables = (await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('poi', 'road_segment', 'cell_score', 'report')
    ORDER BY table_name
  `) as { table_name: string }[];
  const found = tables.map((t) => t.table_name);
  for (const name of ["cell_score", "poi", "report", "road_segment"]) {
    console.log(`${found.includes(name) ? "OK     " : "MISSING"} ${name}`);
  }
  if (found.length !== 4) process.exit(1);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
