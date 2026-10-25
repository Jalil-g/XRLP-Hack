// Side-effect import: must be the FIRST import of an entry point, because @xrlp/xrpl reads process.env when it is loaded.
// Loads <repo>/.env (or ENV_FILE) into process.env without overriding anything the shell already set.
import { join } from "node:path";
import { findRepoRoot, loadEnvFile } from "./env.ts";

const root = findRepoRoot();
const file = process.env.ENV_FILE ?? (root ? join(root, ".env") : undefined);
if (file) {
  const keys = loadEnvFile(file);
  if (keys.length) console.log(`[core] loaded ${keys.length} vars from ${file}`);
}
