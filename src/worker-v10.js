import defaultWorker from "./worker-v4.js";
import stableRenderer from "./worker-stable-renderer-v2.js";
import stableProductionRenderer from "./worker-stable-production.js";
import nooxyWorker from "./worker-nooxy.js";

const PREVIEW_HOST = "bali-discount.niibet34.workers.dev";
const PRODUCTION_HOSTS = new Set(["bali.discount", "www.bali.discount"]);
const BUILD_ID = "2026-09-04-stable-ssr-production-01";

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

    if (url.hostname === PREVIEW_HOST) {
      return nooxyWorker.fetch(request, env, ctx);
    }

    if (isBranch(url.pathname, "/stable/ru") || isBranch(url.pathname, "/stable/en")) {
      return stableRenderer.fetch(request, env, ctx);
    }

    if (
      PRODUCTION_HOSTS.has(url.hostname) &&
      (isBranch(url.pathname, "/ru") || isBranch(url.pathname, "/en"))
    ) {
      return stableProductionRenderer.fetch(request, env, ctx);
    }

    if (PRODUCTION_HOSTS.has(url.hostname) && shouldUseNooxy(request, url)) {
      return nooxyWorker.fetch(request, env, ctx);
    }

    return defaultWorker.fetch(request, env, ctx);
  },
};

function shouldUseNooxy(request, url) {
  const path = url.pathname;

  if (isBranch(path, "/ru") || isBranch(path, "/en")) return true;

  if (
    path.startsWith("/api/") ||
    path.startsWith("/_assets/") ||
    path.startsWith("/image/") ||
    path.startsWith("/images/") ||
    path.startsWith("/f/refresh") ||
    path.startsWith("/app/") ||
    path.startsWith("/200/")
  ) return true;

  if (looksLikeNotionPage(path)) return true;

  const referer = request.headers.get("referer");
  if (!referer) return false;

  try {
    const ref = new URL(referer);
    if (ref.origin !== url.origin) return false;
    return isBranch(ref.pathname, "/ru") ||
      isBranch(ref.pathname, "/en") ||
      looksLikeNotionPage(ref.pathname);
  } catch {
    return false;
  }
}

function looksLikeNotionPage(pathname) {
  return /[0-9a-f]{32}(?:\/)?$/i.test(pathname);
}

function isBranch(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}
