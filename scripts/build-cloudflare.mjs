import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const out = join(root, "dist");

const skip = new Set([
  ".git",
  ".github",
  "dist",
  "node_modules",
  "scripts",
  "src",
  "README.md",
  "package.json",
  "package-lock.json",
  "wrangler.jsonc",
  ".DS_Store",
]);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (skip.has(entry.name)) continue;
  await cp(join(root, entry.name), join(out, entry.name), { recursive: true });
}

console.log("Prepared Bali Discount static assets in dist/");
