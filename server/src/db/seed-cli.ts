// Usage: npm run seed:demo  – fills an empty database with demo data.
import { loadConfig } from "../config.js";
import { get, openDatabase } from "./database.js";
import { DEMO_PASSWORD, seedDemoData } from "./seed.js";

const config = loadConfig();
const db = openDatabase(config.databasePath);
if (get(db, "SELECT 1 FROM people LIMIT 1")) {
  console.error(
    `Die Datenbank ${config.databasePath} enthält bereits Daten – Demo-Daten werden nur in eine leere Datenbank geschrieben.`,
  );
  process.exit(1);
}
seedDemoData(db);
console.log(`Demo-Daten eingespielt (${config.databasePath}). Anmeldung: admin@demo.local / ${DEMO_PASSWORD}`);
