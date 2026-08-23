import defaultWorker from "./worker-v4.js";
import stableRenderer from "./worker-stable-renderer-v2.js";
import nooxyWorker from "./worker-nooxy.js";

const PREVIEW_HOST = "bali-discount.niibet34.workers.dev";
const PRODUCTION_HOSTS = new Set(["bali.discount", "www.bali.discount"]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.hostname === PREVIEW_HOST) {
      return nooxyWorker.fetch(request, env, ctx);
    }

    if (isBranch(url.pathname, "/stable/ru") || isBranch(url.pathname, "/stable/en")) {
      return stableRenderer.fetch(request, env, ctx);
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
