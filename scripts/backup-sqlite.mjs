import { backup, DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const source = resolve(process.env.LNKZ_DB_FILE ?? ".data/lnkz.db");
const destination = process.argv[2];
if (!destination) throw new Error("Supply a destination file: pnpm db:backup ./backup.db");
if (!existsSync(source)) throw new Error("Source database does not exist; check LNKZ_DB_FILE.");
if (existsSync(resolve(destination))) throw new Error("Destination already exists; choose a new backup filename.");
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, destination);
  console.log("SQLite backup complete.");
} finally {
  db.close();
}
