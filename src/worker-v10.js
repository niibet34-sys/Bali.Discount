import defaultWorker from "./worker-v4.js";
import stableRenderer from "./worker-stable-renderer-v2.js";
import notionEmbedWorker from "./worker-notion-embed.js";
import nooxyWorker from "./worker-nooxy.js";

const PREVIEW_HOST = "bali-discount.niibet34.workers.dev";
const PRODUCTION_HOSTS = new Set(["bali.discount", "www.bali.discount"]);
const BUILD_ID = "2026-09-04-official-notion-embed-01";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/__version") {
      const assetUrl = new URL("/assets/bali-desktop-road-user.webp", url.origin);
      let assetStatus = null;
      let assetType = null;
      let assetLength = null;
      try {
        const assetResponse = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
        assetStatus = assetResponse.status;
        assetType = assetResponse.headers.get("content-type");
        assetLength = assetResponse.headers.get("content-length");
      } catch (error) {
        assetStatus = `error:${error?.message || String(error)}`;
      }

      return new Response(JSON.stringify({
        build: BUILD_ID,
        host: url.hostname,
        notionMode: "official-embed",
        asset: {
          path: "/assets/bali-desktop-road-user.webp",
          status: assetStatus,
          contentType: assetType,
          contentLength: assetLength,
        },
      }, null, 2), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "cache-control": "no-store",
        },
      });
    }

    if (url.pathname === "/en/" || url.pathname === "/ru/") {
      const target = new URL(url.toString());
      target.pathname = url.pathname.slice(0, -1);
      return Response.redirect(target.toString(), 301);
    }

    // Keep Nooxy available only on the workers.dev preview host for diagnostics.
    if (url.hostname === PREVIEW_HOST) {
      return nooxyWorker.fetch(request, env, ctx);
    }

    // Keep the custom SSR renderer as a separate fallback/test path.
    if (isBranch(url.pathname, "/stable/ru") || isBranch(url.pathname, "/stable/en")) {
      return stableRenderer.fetch(request, env, ctx);
    }

    // Production tours use Notion's own embeddable public-site runtime directly.
    // Nothing from Notion is reverse-proxied through bali.discount.
    if (
      PRODUCTION_HOSTS.has(url.hostname) &&
      (isBranch(url.pathname, "/ru") || isBranch(url.pathname, "/en"))
    ) {
      return notionEmbedWorker.fetch(request, env, ctx);
    }

    return defaultWorker.fetch(request, env, ctx);
  },
};

function isBranch(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}
