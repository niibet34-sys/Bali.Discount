import defaultWorker from "./worker-v4.js";
import englishWorker from "./worker-en-v2.js";
import russianWorker from "./worker-ru-enstyle.js";
import stableRenderer from "./worker-static-renderer.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (isBranch(url.pathname, "/stable/ru") || isBranch(url.pathname, "/stable/en")) {
      return stableRenderer.fetch(request, env, ctx);
    }

    const branch = detectBranch(request);

    if (branch === "ru") {
      return russianWorker.fetch(request, env, ctx);
    }

    if (branch === "en") {
      return englishWorker.fetch(request, env, ctx);
    }

    return defaultWorker.fetch(request, env, ctx);
  },
};

function detectBranch(request) {
  const url = new URL(request.url);

  if (isBranch(url.pathname, "/ru")) return "ru";
  if (isBranch(url.pathname, "/en")) return "en";

  const referer = request.headers.get("referer");
  if (!referer) return null;

  try {
    const ref = new URL(referer);
    if (ref.origin !== url.origin) return null;
    if (isBranch(ref.pathname, "/ru")) return "ru";
    if (isBranch(ref.pathname, "/en")) return "en";
  } catch {}

  return null;
}

function isBranch(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}
