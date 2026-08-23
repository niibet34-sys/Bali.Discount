import currentWorker from "./worker-v7.js";
import russianWorker from "./worker-ru-enstyle.js";

export default {
  async fetch(request, env, ctx) {
    if (isRussianRequest(request)) {
      return russianWorker.fetch(request, env, ctx);
    }
    return currentWorker.fetch(request, env, ctx);
  },
};

function isRussianRequest(request) {
  const url = new URL(request.url);
  if (url.pathname === "/ru" || url.pathname.startsWith("/ru/")) return true;

  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    const ref = new URL(referer);
    return ref.origin === url.origin && (ref.pathname === "/ru" || ref.pathname.startsWith("/ru/"));
  } catch {
    return false;
  }
}
