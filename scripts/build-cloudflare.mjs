import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

// The GitHub connector used for maintenance is text-oriented. Keep the
// corrected desktop hero image as base64 source in the repo and materialize
// the real binary WebP during the Cloudflare build. This also gives the asset
// a new URL, bypassing any browser/CDN cache of previous broken versions.
const desktopBgSource = join(root, "assets", "bali-desktop-road-v3.b64.txt");
const desktopBgTarget = join(out, "assets", "bali-desktop-road-v3.webp");
const desktopBgBase64 = (await readFile(desktopBgSource, "utf8")).trim();
await writeFile(desktopBgTarget, Buffer.from(desktopBgBase64, "base64"));

console.log("Prepared Bali Discount static assets in dist/");
