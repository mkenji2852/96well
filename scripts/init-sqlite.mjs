import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const dbPath = path.join(root, "prisma", "dev.db");
const migrationsRoot = path.join(root, "prisma", "migrations");
const db = new DatabaseSync(dbPath);

try {
  const migrations = fs.readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(migrationsRoot, entry.name, "migration.sql"))
    .filter((migrationPath) => fs.existsSync(migrationPath))
    .sort();
  for (const migrationPath of migrations) db.exec(fs.readFileSync(migrationPath, "utf8"));
  console.log(`SQLite database initialized: ${dbPath}`);
} finally {
  db.close();
}
