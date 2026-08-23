const NOTION_ORIGIN = "https://balidiscount.notion.site";
const NOTION_HOST = "balidiscount.notion.site";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const CONFIG = {
  ru: { prefix: "/stable/ru", rootPath: "/9d9cc7b88191428a86afbaff8b85931d" },
  en: { prefix: "/stable/en", rootPath: "/Private-Bali-Tours-at-Group-Tour-Prices-3c13152813a381c0a3b4c6dd8adff293" },
};

export default {
  async fetch(request, env, ctx) {
    const local = new URL(request.url);
    const lang = getLang(local.pathname);
    if (!lang) return new Response("Not found", { status: 404 });
    const cfg = CONFIG[lang];

    if (local.pathname === cfg.prefix || local.pathname === `${cfg.prefix}/`) {
      const target = new URL(`${cfg.prefix}${cfg.rootPath}`, local.origin);
      target.search = local.search;
      return Response.redirect(target.toString(), 302);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }

    const cache = caches.default;
    const freshKey = new Request(request.url, { method: "GET" });
    const cached = await cache.match(freshKey);
    if (cached) return mark(cached, "fresh-cache");

    const remote = new URL(NOTION_ORIGIN);
    remote.pathname = local.pathname.slice(cfg.prefix.length) || "/";
    remote.search = local.search;
    const staleKey = new Request(new URL(`/__bali_stale/${lang}${remote.pathname}${remote.search}`, local.origin), { method: "GET" });

    let upstream;
    try {
      upstream = await fetch(remote.toString(), {
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "user-agent": BROWSER_UA,
          referer: `${NOTION_ORIGIN}/`,
        },
        redirect: "manual",
      });
    } catch (error) {
      const stale = await cache.match(staleKey);
      if (stale) return mark(stale, "stale-fallback");
      console.error("Stable Notion fetch failed", error);
      return new Response("Bali Discount tours are temporarily unavailable.", { status: 502 });
    }

    const type = (upstream.headers.get("content-type") || "").toLowerCase();
    if (upstream.status >= 400 && type.includes("text/html")) {
      const stale = await cache.match(staleKey);
      if (stale) return mark(stale, "stale-fallback");
    }

    const result = rewrite(upstream, cfg, lang);
    if (upstream.ok && type.includes("text/html")) {
      const fresh = result.clone();
      const stale = result.clone();
      fresh.headers.set("cache-control", "public, max-age=60");
      stale.headers.set("cache-control", "public, max-age=86400");
      ctx.waitUntil(Promise.all([cache.put(freshKey, fresh), cache.put(staleKey, stale)]));
    }
    return result;
  },
};

function getLang(pathname) {
  if (pathname === CONFIG.ru.prefix || pathname.startsWith(`${CONFIG.ru.prefix}/`)) return "ru";
  if (pathname === CONFIG.en.prefix || pathname.startsWith(`${CONFIG.en.prefix}/`)) return "en";
  return null;
}

function rewrite(upstream, cfg, lang) {
  const headers = new Headers(upstream.headers);
  for (const name of ["x-frame-options","content-security-policy","content-security-policy-report-only","set-cookie","report-to","nel"]) headers.delete(name);

  const location = headers.get("location");
  if (location) headers.set("location", localize(location, cfg));

  const type = (headers.get("content-type") || "").toLowerCase();
  if (!type.includes("text/html") || !upstream.body) {
    headers.set("cache-control", type.startsWith("image/") || type.includes("font") || type.includes("css") ? "public, max-age=86400" : "public, max-age=300");
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  }

  headers.set("cache-control", "public, max-age=60");
  headers.set("x-bali-renderer", `static-notion-${lang}`);
  const response = new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });

  return new HTMLRewriter()
    .on("script", new Remove())
    .on("head", new Head())
    .on("a[href]", new Link(cfg))
    .on("link[href]", new Resource("href", cfg))
    .on("img[src]", new Resource("src", cfg))
    .on("source[src]", new Resource("src", cfg))
    .on("video[src]", new Resource("src", cfg))
    .on("audio[src]", new Resource("src", cfg))
    .transform(response);
}

function mark(response, value) {
  const out = new Response(response.body, response);
  out.headers.set("x-bali-cache", value);
  return out;
}

class Remove { element(el) { el.remove(); } }

class Head {
  element(el) {
    el.append(`<style id="bali-static-renderer">.notion-topbar,.notion-topbar-mobile,.notion-navbar,[class*="notion-topbar"],[class*="notion-navbar"],[class*="notion-site-header"]{display:none!important}html,body{overflow-x:hidden!important}body{padding-top:0!important}</style>`, { html: true });
  }
}

class Link {
  constructor(cfg) { this.cfg = cfg; }
  element(el) {
    const href = el.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("https://wa.me/") || href.startsWith("https://t.me/") || href.startsWith("https://vk.me/") || href.startsWith("https://max.ru/")) return;
    const next = localize(href, this.cfg);
    el.setAttribute("href", next);
    if (next.startsWith(this.cfg.prefix)) el.removeAttribute("target");
  }
}

class Resource {
  constructor(attr, cfg) { this.attr = attr; this.cfg = cfg; }
  element(el) {
    const value = el.getAttribute(this.attr);
    if (!value || value.startsWith("data:") || value.startsWith("blob:") || value.startsWith("#")) return;
    if (value.startsWith("/")) {
      el.setAttribute(this.attr, `${this.cfg.prefix}${value}`);
      return;
    }
    try {
      const u = new URL(value);
      if (u.hostname === NOTION_HOST) el.setAttribute(this.attr, `${this.cfg.prefix}${u.pathname}${u.search}${u.hash}`);
    } catch {}
  }
}

function localize(value, cfg) {
  try {
    if (value.startsWith("/")) return `${cfg.prefix}${value}`;
    const u = new URL(value, NOTION_ORIGIN);
    const host = u.hostname.toLowerCase();
    if (host === NOTION_HOST) return `${cfg.prefix}${u.pathname}${u.search}${u.hash}`;
    if ((host === "app.notion.com" || host === "www.notion.so" || host === "notion.so") && u.pathname.startsWith("/p/")) {
      return `${cfg.prefix}/${u.pathname.slice(3)}${u.search}${u.hash}`;
    }
    return value;
  } catch { return value; }
}
