import appWorker from "./worker-v4.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const lang = getCookie(request, "bali_notion_lang");
      if (lang === "ru" || lang === "en") {
        const routed = new URL(request.url);
        routed.pathname = `/${lang}${url.pathname}`;
        request = new Request(routed.toString(), request);
      }
    }

    return appWorker.fetch(request, env, ctx);
  },
};

function getCookie(request, name) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}
