const NOTION_ORIGIN = "https://balidiscount.notion.site";
const NOTION_HOST = "balidiscount.notion.site";
const NOTION_ROOT_PATH = "/Private-Bali-Tours-at-Group-Tour-Prices-3c13152813a381c0a3b4c6dd8adff293";
const LOCAL_PREFIX = "/en";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const WHATSAPP_URL = "https://wa.me/628999844455?text=Hello%21%20I%27m%20interested%20in%20private%20tours%20in%20Bali.";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/en" || url.pathname === "/en/") {
      const target = new URL(`${LOCAL_PREFIX}${NOTION_ROOT_PATH}`, url.origin);
      target.search = url.search;
      return Response.redirect(target.toString(), 302);
    }

    try {
      return await proxyNotion(request);
    } catch (error) {
      console.error("English Notion proxy failed", error);
      return new Response("Bali Discount: English tours are temporarily unavailable.", {
        status: 502,
        headers: { "content-type": "text/plain; charset=UTF-8" },
      });
    }
  },
};

function remoteUrlFor(request) {
  const local = new URL(request.url);
  const remote = new URL(NOTION_ORIGIN);

  if (local.pathname.startsWith(`${LOCAL_PREFIX}/`)) {
    remote.pathname = local.pathname.slice(LOCAL_PREFIX.length) || "/";
    remote.search = local.search;
    return remote;
  }

  remote.pathname = local.pathname;
  remote.search = local.search;
  return remote;
}

async function proxyNotion(request) {
  const remoteUrl = remoteUrlFor(request);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, OPTIONS",
        "access-control-allow-headers": "Content-Type",
      },
    });
  }

  if (remoteUrl.pathname.startsWith("/api/")) return proxyNotionApi(request, remoteUrl);

  const headers = new Headers(request.headers);
  for (const name of ["cookie","authorization","host","cf-connecting-ip","cf-ipcountry","cf-ray"]) headers.delete(name);
  headers.set("user-agent", BROWSER_UA);
  headers.set("referer", `${NOTION_ORIGIN}${NOTION_ROOT_PATH}`);
  if (headers.has("origin")) headers.set("origin", NOTION_ORIGIN);

  const init = { method: request.method, headers, redirect: "manual" };
  if (!new Set(["GET", "HEAD"]).has(request.method)) init.body = request.body;

  const upstream = await fetch(remoteUrl.toString(), init);
  return rewriteUpstream(upstream);
}

async function proxyNotionApi(request, remoteUrl) {
  const headers = new Headers();
  headers.set("content-type", "application/json;charset=UTF-8");
  headers.set("accept", "*/*");
  headers.set("user-agent", BROWSER_UA);
  headers.set("origin", NOTION_ORIGIN);
  headers.set("referer", `${NOTION_ORIGIN}${NOTION_ROOT_PATH}`);

  let body;
  if (!remoteUrl.pathname.startsWith("/api/v3/getPublicPageData") && !new Set(["GET", "HEAD"]).has(request.method)) body = request.body;

  const upstream = await fetch(remoteUrl.toString(), {
    method: request.method === "GET" ? "GET" : "POST",
    headers,
    body,
    redirect: "manual",
  });

  const outHeaders = sanitizeHeaders(upstream.headers);
  outHeaders.set("access-control-allow-origin", "*");
  outHeaders.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: outHeaders });
}

function sanitizeHeaders(input) {
  const headers = new Headers(input);
  for (const name of ["x-frame-options","content-security-policy","content-security-policy-report-only","set-cookie","report-to","nel"]) headers.delete(name);
  return headers;
}

function rewriteUpstream(upstream) {
  const outHeaders = sanitizeHeaders(upstream.headers);
  const location = outHeaders.get("location");
  if (location) outHeaders.set("location", localizeUrl(location));

  const type = outHeaders.get("content-type") || "";
  if (!type.includes("text/html") || !upstream.body) {
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: outHeaders });
  }

  outHeaders.set("cache-control", "private, no-cache, no-store, must-revalidate");
  outHeaders.set("x-bali-content-source", "notion-proxy-en");

  const response = new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: outHeaders });

  return new HTMLRewriter()
    .on("head", new HeadInjector())
    .on("a[href]", new NavigationLinkRewriter())
    .on("script[src]", new ResourceAttributeRewriter("src"))
    .on("link[href]", new ResourceAttributeRewriter("href"))
    .on("img[src]", new ResourceAttributeRewriter("src"))
    .on("source[src]", new ResourceAttributeRewriter("src"))
    .on("video[src]", new ResourceAttributeRewriter("src"))
    .on("audio[src]", new ResourceAttributeRewriter("src"))
    .on("form[action]", new ResourceAttributeRewriter("action"))
    .on("body", new BodyInjector())
    .transform(response);
}

class HeadInjector {
  element(element) {
    element.append(`<style id="bali-en-overrides">
.notion-topbar,.notion-topbar-mobile,.notion-navbar,[class*="notion-topbar"],[class*="notion-navbar"],[class*="notion-site-header"]{display:none!important}body{padding-top:0!important}
#bali-en-whatsapp{position:fixed;right:max(18px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));width:58px;height:58px;border-radius:50%;background:#25D366;color:#fff;display:grid;place-items:center;z-index:2147483646;box-shadow:0 14px 34px rgba(0,0,0,.25);text-decoration:none}
#bali-en-whatsapp svg{display:block;width:68%;height:68%;fill:currentColor}
</style>`, { html: true });
  }
}

class NavigationLinkRewriter {
  element(element) {
    const href = element.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("https://wa.me/") || href.startsWith("https://t.me/")) return;
    element.setAttribute("href", localizeNavigationHref(href));
  }
}

class ResourceAttributeRewriter {
  constructor(attribute) { this.attribute = attribute; }
  element(element) {
    const value = element.getAttribute(this.attribute);
    if (!value || value.startsWith("data:") || value.startsWith("blob:") || value.startsWith("#")) return;
    if (value.startsWith("/")) {
      element.setAttribute(this.attribute, `${LOCAL_PREFIX}${value}`);
      return;
    }
    try {
      const parsed = new URL(value);
      if (parsed.hostname === NOTION_HOST) element.setAttribute(this.attribute, `${LOCAL_PREFIX}${parsed.pathname}${parsed.search}${parsed.hash}`);
    } catch {}
  }
}

class BodyInjector {
  element(element) {
    element.append(`<a id="bali-en-whatsapp" href="${WHATSAPP_URL}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16.04 3C9.43 3 4.05 8.35 4.05 14.93c0 2.11.56 4.17 1.62 5.97L3.95 27l6.27-1.64a12 12 0 0 0 5.82 1.48h.01c6.61 0 11.99-5.35 11.99-11.93C28.04 8.35 22.66 3 16.04 3Zm0 21.83h-.01a9.98 9.98 0 0 1-5.09-1.39l-.37-.22-3.72.97.99-3.61-.24-.37a9.88 9.88 0 0 1-1.52-5.28c0-5.47 4.47-9.92 9.97-9.92 5.49 0 9.96 4.45 9.96 9.92 0 5.47-4.47 9.9-9.97 9.9Zm5.47-7.42c-.3-.15-1.77-.87-2.04-.97-.28-.1-.48-.15-.68.15-.2.3-.78.97-.95 1.17-.18.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.76-1.66-2.06-.18-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.68-1.64-.93-2.24-.25-.59-.5-.51-.68-.52h-.58c-.2 0-.53.07-.8.37-.28.3-1.05 1.02-1.05 2.49s1.08 2.89 1.23 3.09c.15.2 2.12 3.22 5.14 4.52.72.31 1.28.49 1.72.63.72.23 1.38.2 1.9.12.58-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.18-1.42-.08-.13-.28-.2-.58-.35Z"/></svg></a>
<script id="bali-en-ui">(()=>{window.CONFIG=window.CONFIG||{};window.CONFIG.domainBaseUrl=location.origin;const promo=['notion : notes, tâches, ia','notion: notes, tasks, ai','planifier & suivre des projets','mettre à jour','upgrade'];const clean=()=>{for(const node of document.querySelectorAll('div,header,aside,a,button')){const text=(node.textContent||'').trim().toLowerCase();if(!text||text.length>220||!promo.some(v=>text.includes(v)))continue;let target=node;for(let i=0;i<7&&target?.parentElement;i++){const s=getComputedStyle(target),r=target.getBoundingClientRect();if((s.position==='fixed'||s.position==='sticky'||r.top<90)&&r.width>innerWidth*.65&&r.height<150)break;target=target.parentElement}if(target&&target!==document.body&&target!==document.documentElement){const r=target.getBoundingClientRect();if(r.top<120&&r.height<180)target.style.setProperty('display','none','important')}}document.body.style.setProperty('padding-top','0px','important')};clean();let q=false;new MutationObserver(()=>{if(q)return;q=true;requestAnimationFrame(()=>{q=false;clean()})}).observe(document.documentElement,{subtree:true,childList:true});setTimeout(clean,500);setTimeout(clean,1500)})();</script>`, { html: true });
  }
}

function localizeNavigationHref(href) {
  try {
    if (href.startsWith("/")) return `${LOCAL_PREFIX}${href}`;
    const url = new URL(href, NOTION_ORIGIN);
    if (url.hostname === NOTION_HOST) return `${LOCAL_PREFIX}${url.pathname}${url.search}${url.hash}`;
    if (url.hostname === "app.notion.com" && url.pathname.startsWith("/p/")) return `${LOCAL_PREFIX}/${url.pathname.slice(3)}${url.search}${url.hash}`;
    return href;
  } catch { return href; }
}

function localizeUrl(value) {
  try {
    const url = new URL(value, NOTION_ORIGIN);
    if (url.hostname === NOTION_HOST) return `${LOCAL_PREFIX}${url.pathname}${url.search}${url.hash}`;
    return value;
  } catch { return value; }
}
