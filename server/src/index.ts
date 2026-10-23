import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { loadConfig } from "./config.js";
import { get, openDatabase, run } from "./db/database.js";
import { createApp } from "./app.js";
import { hashPassword } from "./auth/auth.js";
import { DEMO_PASSWORD, seedDemoData } from "./db/seed.js";

const config = loadConfig();
if (!config.staticDir) {
  const bundled = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (existsSync(join(bundled, "index.html"))) config.staticDir = bundled;
}

const db = openDatabase(config.databasePath);

const hasPeople = !!get(db, "SELECT 1 FROM people LIMIT 1");
if (!hasPeople) {
  if (config.seedDemo) {
    seedDemoData(db);
    console.log(`Demo-Daten eingespielt. Anmeldung z. B. mit admin@demo.local / ${DEMO_PASSWORD}`);
  } else {
    const email = config.adminEmail ?? "admin@example.com";
    const password = config.adminPassword ?? randomBytes(12).toString("base64url");
    run(db, "INSERT INTO people (email, name, roles, password_hash) VALUES (:e, 'Administrator', '[\"admin\"]', :p)", {
      e: email,
      p: hashPassword(password),
    });
    console.log(`Erster Admin angelegt: ${email}${config.adminPassword ? "" : ` / Passwort: ${password} (bitte sofort ändern)`}`);
  }
}

const app = createApp(db, config);
app.listen(config.port, () => {
  console.log(`MackAIdmin läuft auf http://localhost:${config.port}`);
});
