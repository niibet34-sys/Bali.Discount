import defaultWorker from "./worker-v2.js";
import englishWorker from "./worker-en-v2.js";

export default {
  async fetch(request, env, ctx) {
    const lang = requestLanguage(request);
    const response = lang === "en"
      ? await englishWorker.fetch(request, env, ctx)
      : await defaultWorker.fetch(request, env, ctx);

    return attachLanguageCookie(request, response, lang);
  },
};

function requestLanguage(request) {
  const url = new URL(request.url);

  if (url.pathname === "/en" || url.pathname.startsWith("/en/")) return "en";
  if (url.pathname === "/ru" || url.pathname.startsWith("/ru/")) return "ru";

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const ref = new URL(referer);
      if (ref.origin === url.origin) {
        if (ref.pathname === "/en" || ref.pathname.startsWith("/en/")) return "en";
        if (ref.pathname === "/ru" || ref.pathname.startsWith("/ru/")) return "ru";
      }
    } catch {}
  }

  // Some browsers trim or omit Referer for Notion's client-side API calls.
  // Only use the cookie fallback for ambiguous Notion API requests so normal
  // site routes such as / are never affected by the previously selected language.
  if (url.pathname.startsWith("/api/")) {
    const cookieLang = getCookie(request, "bali_notion_lang");
    if (cookieLang === "en" || cookieLang === "ru") return cookieLang;
  }

  return null;
}

function attachLanguageCookie(request, response, lang) {
  if (lang !== "en" && lang !== "ru") return response;

  const url = new URL(request.url);
  const isLanguagePage = url.pathname === `/${lang}` || url.pathname.startsWith(`/${lang}/`);
  const type = response.headers.get("content-type") || "";
  if (!isLanguagePage || !type.includes("text/html")) return response;

  const headers = new Headers(response.headers);
  headers.set(
    "set-cookie",
    `bali_notion_lang=${lang}; Path=/; Max-Age=3600; SameSite=Lax; Secure`
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function getCookie(request, name) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}
