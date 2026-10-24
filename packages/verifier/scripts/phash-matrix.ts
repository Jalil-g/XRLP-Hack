// Prints pairwise pHash distances for every fixture photo (calibrate phash thresholds in policy.ts).
//   pnpm --filter @xrlp/verifier exec tsx scripts/phash-matrix.ts [dir]
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { hammingDistance, perceptualHash } from "../src/meta.ts";
import { FIXTURES_DIR } from "../fixtures/scenarios.ts";

const dir = process.argv[2] ?? join(FIXTURES_DIR, "evidence", "maple-st", "framing");
const files = (await readdir(dir)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
const hashes = await Promise.all(files.map(async (f) => perceptualHash(await readFile(join(dir, f)))));
const short = files.map((f) => f.replace(/\.\w+$/, "").slice(0, 14));
console.log("".padEnd(16) + short.map((s) => s.slice(0, 5).padStart(6)).join(""));
files.forEach((_, i) => {
  console.log(short[i]!.padEnd(16) + hashes.map((h) => String(hammingDistance(hashes[i]!, h)).padStart(6)).join(""));
});
