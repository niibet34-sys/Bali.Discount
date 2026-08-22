import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const out = join(root, "dist");
const skip = new Set([".git", ".github", "dist", "functions", "scripts", "README.md", "CLOUDFLARE_SETUP.md", ".DS_Store"]);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (skip.has(entry.name)) continue;
  const src = join(root, entry.name);
  const dst = join(out, entry.name);
  await cp(src, dst, { recursive: true });
}

console.log("Cloudflare Pages static assets prepared in dist/");
