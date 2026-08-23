const NOTION_ORIGIN = "https://balidiscount.notion.site";
const NOTION_HOST = "balidiscount.notion.site";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FRESH_TTL = 120;
const STALE_TTL = 604800;

const ROOTS = {
  ru: "/9d9cc7b88191428a86afbaff8b85931d",
  en: "/Private-Bali-Tours-at-Group-Tour-Prices-3c13152813a381c0a3b4c6dd8adff293",
};

const PREFIXES = [
  { prefix: "/stable/ru", lang: "ru" },
  { prefix: "/stable/en", lang: "en" },
  { prefix: "/ru", lang: "ru" },
  { prefix: "/en", lang: "en" },
];

export default {
  async fetch(request, env, ctx) {
    const local = new URL(request.url);
    const cfg = getConfig(local.pathname);
    if (!cfg) return new Response("Not found", { status: 404 });

    if (local.pathname === cfg.prefix || local.pathname === `${cfg.prefix}/`) {
      const target = new URL(`${cfg.prefix}${cfg.rootPath}`, local.origin);
      target.search = local.search;
      return Response.redirect(target.toString(), 302);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }

    const cache = caches.default;
    const cacheKey = new Request(request.url, { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (cached) return mark(cached, "fresh-cache");

    const remote = new URL(NOTION_ORIGIN);
    remote.pathname = local.pathname.slice(cfg.prefix.length) || "/";
    remote.search = local.search;

    const staleUrl = new URL(request.url);
    staleUrl.pathname = `/__bali_stale/${cfg.lang}${remote.pathname}`;
    staleUrl.search = remote.search;
    const staleKey = new Request(staleUrl.toString(), { method: "GET" });

    const fetched = await fetchWithRetry(remote, cfg, 3);
    if (!fetched.ok) {
      const stale = await cache.match(staleKey);
      if (stale) return mark(stale, "stale-fallback");
      if (fetched.response) return rewriteNonHtmlOrError(fetched.response, cfg);
      return new Response("Bali Discount tours are temporarily unavailable.", {
        status: 502,
        headers: { "content-type": "text/plain; charset=UTF-8", "cache-control": "no-store" },
      });
    }

    const upstream = fetched.response;
    const type = (upstream.headers.get("content-type") || "").toLowerCase();

    if (!type.includes("text/html")) {
      const result = await rewriteAsset(upstream, cfg);
      if (upstream.ok && request.method === "GET") {
        const fresh = result.clone();
        fresh.headers.set("cache-control", "public, max-age=86400");
        ctx.waitUntil(cache.put(cacheKey, fresh));
      }
      return request.method === "HEAD" ? headOnly(result) : result;
    }

    const html = fetched.html;
    const result = rewriteHtml(html, upstream, cfg);

    if (upstream.ok && request.method === "GET") {
      const fresh = result.clone();
      const stale = result.clone();
      fresh.headers.set("cache-control", `public, max-age=${FRESH_TTL}`);
      stale.headers.set("cache-control", `public, max-age=${STALE_TTL}`);
      ctx.waitUntil(Promise.all([cache.put(cacheKey, fresh), cache.put(staleKey, stale)]));
    }

    return request.method === "HEAD" ? headOnly(result) : result;
  },
};

function getConfig(pathname) {
  for (const item of PREFIXES) {
    if (pathname === item.prefix || pathname.startsWith(`${item.prefix}/`)) {
      return { ...item, rootPath: ROOTS[item.lang] };
    }
  }
  return null;
}

async function fetchWithRetry(remote, cfg, attempts) {
  let lastResponse = null;
  let lastHtml = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(remote.toString(), {
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "accept-language": cfg.lang === "ru" ? "ru-RU,ru;q=0.9,en;q=0.7" : "en-US,en;q=0.9",
          "user-agent": BROWSER_UA,
          referer: `${NOTION_ORIGIN}${cfg.rootPath}`,
        },
        redirect: "manual",
      });

      lastResponse = response;
      const type = (response.headers.get("content-type") || "").toLowerCase();
      if (!type.includes("text/html")) {
        if (response.ok || (response.status >= 300 && response.status < 400)) return { ok: true, response, html: null };
      } else {
        const html = await response.text();
        lastHtml = html;
        if (response.ok && isValidNotionHtml(html)) {
          const headers = new Headers(response.headers);
          return {
            ok: true,
            response: new Response(html, { status: response.status, statusText: response.statusText, headers }),
            html,
          };
        }
      }

      if (!shouldRetry(response.status, lastHtml) || attempt === attempts) break;
    } catch (error) {
      console.error(`Static Notion fetch attempt ${attempt} failed`, error);
      if (attempt === attempts) break;
    }

    await sleep(120 * attempt);
  }

  return { ok: false, response: lastResponse, html: lastHtml };
}

function shouldRetry(status, html) {
  return status === 0 || status === 408 || status === 429 || status >= 500 || (html && !isValidNotionHtml(html));
}

function isValidNotionHtml(html) {
  if (!html || html.length < 1000) return false;
  const text = html.toLowerCase();
  const bad = [
    "this page couldn’t be found",
    "this page couldn't be found",
    "this page cannot be found",
    "you may not have access, or it might have been deleted or moved",
    "page not found",
  ];
  return !bad.some(marker => text.includes(marker));
}

function rewriteHtml(html, upstream, cfg) {
  const headers = sanitizeHeaders(upstream.headers);
  const location = headers.get("location");
  if (location) headers.set("location", localizePageUrl(location, cfg));
  headers.set("cache-control", `public, max-age=${FRESH_TTL}`);
  headers.set("x-bali-renderer", `static-notion-${cfg.lang}`);
  headers.set("x-bali-hydration", "disabled");

  const response = new Response(html, { status: upstream.status, statusText: upstream.statusText, headers });
  return new HTMLRewriter()
    .on("script", new RemoveElement())
    .on("head", new HeadInjector())
    .on("body", new BodyInjector(cfg.lang))
    .on("a[href]", new NavigationLinkRewriter(cfg))
    .on("link[href]", new ResourceAttributeRewriter("href", cfg))
    .on("img[src]", new ResourceAttributeRewriter("src", cfg))
    .on("img[srcset]", new SrcsetRewriter("srcset", cfg))
    .on("source[src]", new ResourceAttributeRewriter("src", cfg))
    .on("source[srcset]", new SrcsetRewriter("srcset", cfg))
    .on("video[src]", new ResourceAttributeRewriter("src", cfg))
    .on("audio[src]", new ResourceAttributeRewriter("src", cfg))
    .on("[style]", new InlineStyleRewriter(cfg))
    .transform(response);
}

async function rewriteAsset(upstream, cfg) {
  const headers = sanitizeHeaders(upstream.headers);
  const type = (headers.get("content-type") || "").toLowerCase();
  headers.set("cache-control", "public, max-age=86400");

  if (type.includes("text/css")) {
    let css = await upstream.text();
    css = css
      .replace(/url\(\s*(["']?)\//g, `url($1${cfg.prefix}/`)
      .replace(/@import\s+(["'])\//g, `@import $1${cfg.prefix}/`);
    return new Response(css, { status: upstream.status, statusText: upstream.statusText, headers });
  }

  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
}

function rewriteNonHtmlOrError(upstream, cfg) {
  const headers = sanitizeHeaders(upstream.headers);
  const location = headers.get("location");
  if (location) headers.set("location", localizePageUrl(location, cfg));
  headers.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
}

function sanitizeHeaders(input) {
  const headers = new Headers(input);
  for (const name of [
    "x-frame-options",
    "content-security-policy",
    "content-security-policy-report-only",
    "set-cookie",
    "report-to",
    "nel",
  ]) headers.delete(name);
  return headers;
}

function mark(response, value) {
  const out = new Response(response.body, response);
  out.headers.set("x-bali-cache", value);
  out.headers.set("x-bali-hydration", "disabled");
  return out;
}

function headOnly(response) {
  return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class RemoveElement {
  element(element) { element.remove(); }
}

class HeadInjector {
  element(element) {
    element.append(`<style id="bali-static-renderer">
.notion-topbar,.notion-topbar-mobile,.notion-navbar,[class*="notion-topbar"],[class*="notion-navbar"],[class*="notion-site-header"]{display:none!important}
html,body{overflow-x:hidden!important}body{padding-top:0!important}
#bali-static-contact{position:fixed;right:max(18px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));z-index:2147483646;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
#bali-static-contact summary{list-style:none;width:58px;height:58px;border-radius:50%;background:#25D366;color:#fff;display:grid;place-items:center;box-shadow:0 14px 34px rgba(0,0,0,.25);cursor:pointer}
#bali-static-contact summary::-webkit-details-marker{display:none}#bali-static-contact summary svg{display:block;width:39px;height:39px;fill:currentColor}
#bali-static-menu{position:absolute;right:0;bottom:70px;width:224px;padding:9px;border-radius:20px;background:rgba(255,255,255,.98);border:1px solid rgba(15,23,42,.09);box-shadow:0 18px 50px rgba(0,0,0,.20)}
.bali-static-item{height:48px;border-radius:13px;display:flex;align-items:center;padding:0 12px;color:#111827!important;font-weight:600;font-size:15px;text-decoration:none!important}.bali-static-item:hover{background:#f4f5f6}
#bali-static-wa{width:58px;height:58px;border-radius:50%;background:#25D366;color:#fff;display:grid;place-items:center;box-shadow:0 14px 34px rgba(0,0,0,.25);text-decoration:none}#bali-static-wa svg{display:block;width:39px;height:39px;fill:currentColor}
</style>`, { html: true });
  }
}

class BodyInjector {
  constructor(lang) { this.lang = lang; }
  element(element) {
    const svg = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16.04 3C9.43 3 4.05 8.35 4.05 14.93c0 2.11.56 4.17 1.62 5.97L3.95 27l6.27-1.64a12 12 0 0 0 5.82 1.48h.01c6.61 0 11.99-5.35 11.99-11.93C28.04 8.35 22.66 3 16.04 3Zm0 21.83h-.01a9.98 9.98 0 0 1-5.09-1.39l-.37-.22-3.72.97.99-3.61-.24-.37a9.88 9.88 0 0 1-1.52-5.28c0-5.47 4.47-9.92 9.97-9.92 5.49 0 9.96 4.45 9.96 9.92 0 5.47-4.47 9.9-9.97 9.9Zm5.47-7.42c-.3-.15-1.77-.87-2.04-.97-.28-.1-.48-.15-.68.15-.2.3-.78.97-.95 1.17-.18.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.76-1.66-2.06-.18-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.68-1.64-.93-2.24-.25-.59-.5-.51-.68-.52h-.58c-.2 0-.53.07-.8.37-.28.3-1.05 1.02-1.05 2.49s1.08 2.89 1.23 3.09c.15.2 2.12 3.22 5.14 4.52.72.31 1.28.49 1.72.63.72.23 1.38.2 1.9.12.58-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.18-1.42-.08-.13-.28-.2-.58-.35Z"/></svg>`;
    if (this.lang === "ru") {
      element.append(`<details id="bali-static-contact"><summary aria-label="Открыть мессенджеры">${svg}</summary><div id="bali-static-menu"><a class="bali-static-item" href="https://vk.me/balidiscount" target="_blank" rel="noopener noreferrer">ВКонтакте</a><a class="bali-static-item" href="https://max.ru/u/f9LHodD0cOIwcXL9W58ncPrSABr9BRXv84mIqJ3Z3P4qoTFYvTXRCCPWvIg" target="_blank" rel="noopener noreferrer">MAX</a><a class="bali-static-item" href="https://t.me/bali_discount" target="_blank" rel="noopener noreferrer">Telegram</a><a class="bali-static-item" href="https://wa.me/6281222666226" target="_blank" rel="noopener noreferrer">WhatsApp</a></div></details>`, { html: true });
    } else {
      element.append(`<div id="bali-static-contact"><a id="bali-static-wa" href="https://wa.me/628999844455?text=Hello%21%20I%27m%20interested%20in%20private%20tours%20in%20Bali." target="_blank" rel="noopener noreferrer" aria-label="WhatsApp">${svg}</a></div>`, { html: true });
    }
  }
}

class NavigationLinkRewriter {
  constructor(cfg) { this.cfg = cfg; }
  element(element) {
    const href = element.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || isMessenger(href)) return;
    const next = localizePageUrl(href, this.cfg);
    element.setAttribute("href", next);
    if (next.startsWith(this.cfg.prefix)) element.removeAttribute("target");
  }
}

class ResourceAttributeRewriter {
  constructor(attribute, cfg) { this.attribute = attribute; this.cfg = cfg; }
  element(element) {
    const value = element.getAttribute(this.attribute);
    if (!value || value.startsWith("data:") || value.startsWith("blob:") || value.startsWith("#")) return;
    element.setAttribute(this.attribute, localizeResourceUrl(value, this.cfg));
  }
}

class SrcsetRewriter {
  constructor(attribute, cfg) { this.attribute = attribute; this.cfg = cfg; }
  element(element) {
    const value = element.getAttribute(this.attribute);
    if (!value) return;
    const rewritten = value.split(",").map(part => {
      const bits = part.trim().split(/\s+/);
      if (!bits[0]) return part;
      bits[0] = localizeResourceUrl(bits[0], this.cfg);
      return bits.join(" ");
    }).join(", ");
    element.setAttribute(this.attribute, rewritten);
  }
}

class InlineStyleRewriter {
  constructor(cfg) { this.cfg = cfg; }
  element(element) {
    const style = element.getAttribute("style");
    if (!style) return;
    element.setAttribute("style", style.replace(/url\(\s*(["']?)\//g, `url($1${this.cfg.prefix}/`));
  }
}

function localizePageUrl(value, cfg) {
  try {
    if (value.startsWith("/")) return `${cfg.prefix}${value}`;
    const url = new URL(value, NOTION_ORIGIN);
    const host = url.hostname.toLowerCase();
    if (host === NOTION_HOST) return `${cfg.prefix}${url.pathname}${url.search}${url.hash}`;
    if ((host === "app.notion.com" || host === "www.notion.so" || host === "notion.so") && url.pathname.startsWith("/p/")) {
      return `${cfg.prefix}/${url.pathname.slice(3)}${url.search}${url.hash}`;
    }
    return value;
  } catch { return value; }
}

function localizeResourceUrl(value, cfg) {
  try {
    if (value.startsWith("/")) return `${cfg.prefix}${value}`;
    const url = new URL(value);
    if (url.hostname.toLowerCase() === NOTION_HOST) return `${cfg.prefix}${url.pathname}${url.search}${url.hash}`;
    return value;
  } catch { return value; }
}

function isMessenger(href) {
  return href.startsWith("https://wa.me/") || href.startsWith("https://t.me/") || href.startsWith("https://vk.me/") || href.startsWith("https://max.ru/");
}
