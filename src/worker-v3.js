import defaultWorker from "./worker-v2.js";
import englishWorker from "./worker-en-v2.js";

export default {
  async fetch(request, env, ctx) {
    if (isEnglishRequest(request)) return englishWorker.fetch(request, env, ctx);
    return defaultWorker.fetch(request, env, ctx);
  },
};

function isEnglishRequest(request) {
  const url = new URL(request.url);
  if (url.pathname === "/en" || url.pathname.startsWith("/en/")) return true;

  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    const ref = new URL(referer);
    return ref.origin === url.origin && (ref.pathname === "/en" || ref.pathname.startsWith("/en/"));
  } catch {
    return false;
  }
}
