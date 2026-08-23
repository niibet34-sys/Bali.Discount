const NOTION_ORIGIN = "https://balidiscount.notion.site";
const NOTION_HOST = "balidiscount.notion.site";
const NOTION_ROOT_PATH = "/9d9cc7b88191428a86afbaff8b85931d";
const LOCAL_PREFIX = "/ru";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (isRuPath(url.pathname) || cameFromRu(request)) {
      try {
        const response = await proxyNotion(request);
        if (response.status < 500) return response;
      } catch (error) {
        console.error("Notion proxy failed", error);
      }

      if (url.pathname === "/ru" || url.pathname === "/ru/") {
        return env.ASSETS.fetch(new Request(new URL("/ru/", url.origin), request));
      }

      return new Response("Bali Discount: this tour page is temporarily unavailable.", {
        status: 502,
        headers: { "content-type": "text/plain; charset=UTF-8" },
      });
    }

    return env.ASSETS.fetch(request);
  },
};

function isRuPath(pathname) {
  return pathname === LOCAL_PREFIX || pathname.startsWith(`${LOCAL_PREFIX}/`);
}

function cameFromRu(request) {
  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    const ref = new URL(referer);
    return ref.origin === new URL(request.url).origin && isRuPath(ref.pathname);
  } catch {
    return false;
  }
}

function remoteUrlFor(request) {
  const local = new URL(request.url);
  const remote = new URL(NOTION_ORIGIN);

  if (local.pathname === "/ru" || local.pathname === "/ru/") {
    remote.pathname = NOTION_ROOT_PATH;
    remote.search = local.search;
    return remote;
  }

  if (local.pathname.startsWith("/ru/")) {
    remote.pathname = local.pathname.slice(3) || "/";
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

  // Notion public pages hydrate through /api/v3/* calls. These need to look
  // like direct anonymous browser requests to the Notion public-site host.
  if (remoteUrl.pathname.startsWith("/api/")) {
    return proxyNotionApi(request, remoteUrl);
  }

  const headers = new Headers(request.headers);
  headers.delete("cookie");
  headers.delete("authorization");
  headers.delete("host");
  headers.delete("cf-connecting-ip");
  headers.delete("cf-ipcountry");
  headers.delete("cf-ray");
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
  if (!remoteUrl.pathname.startsWith("/api/v3/getPublicPageData") && !new Set(["GET", "HEAD"]).has(request.method)) {
    body = request.body;
  }

  const upstream = await fetch(remoteUrl.toString(), {
    method: request.method === "GET" ? "GET" : "POST",
    headers,
    body,
    redirect: "manual",
  });

  const outHeaders = sanitizeHeaders(upstream.headers);
  outHeaders.set("access-control-allow-origin", "*");
  outHeaders.set("cache-control", "no-store");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

function sanitizeHeaders(input) {
  const headers = new Headers(input);
  headers.delete("x-frame-options");
  headers.delete("content-security-policy");
  headers.delete("content-security-policy-report-only");
  headers.delete("set-cookie");
  headers.delete("report-to");
  headers.delete("nel");
  return headers;
}

function rewriteUpstream(upstream) {
  const outHeaders = sanitizeHeaders(upstream.headers);
  const location = outHeaders.get("location");
  if (location) outHeaders.set("location", localizeUrl(location));

  const type = outHeaders.get("content-type") || "";
  if (!type.includes("text/html") || !upstream.body) {
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeaders,
    });
  }

  outHeaders.set("cache-control", "private, no-cache, no-store, must-revalidate");
  outHeaders.set("x-bali-content-source", "notion-proxy");

  const response = new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });

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
    element.append(`<style id="bali-notion-overrides">
.notion-topbar,.notion-topbar-mobile,.notion-navbar,[class*="notion-topbar"],[class*="notion-navbar"],[class*="notion-site-header"]{display:none!important}body{padding-top:0!important}
#bali-contact-wrap{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:2147483646;display:flex;flex-direction:column;align-items:flex-end;gap:11px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
#bali-contact-menu{width:228px;padding:9px;border-radius:22px;background:rgba(255,255,255,.97);border:1px solid rgba(15,23,42,.09);box-shadow:0 18px 50px rgba(0,0,0,.18);backdrop-filter:blur(18px);opacity:0;transform:translateY(12px) scale(.97);pointer-events:none;transition:.18s ease}
#bali-contact-wrap.open #bali-contact-menu{opacity:1;transform:none;pointer-events:auto}.bali-contact-item{width:100%;height:51px;border:0;background:transparent;border-radius:14px;padding:0 10px;display:flex;align-items:center;gap:12px;font:600 15px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#111827;text-align:left}.bali-contact-item+.bali-contact-item{margin-top:3px}.bali-contact-item:hover{background:#f5f6f7}.bali-msg-icon{width:36px;height:36px;border-radius:12px;display:grid;place-items:center;color:#fff;font-weight:800;flex:0 0 auto}.bali-vk{background:#2787f5;font-size:13px}.bali-max{background:linear-gradient(145deg,#2a7df5,#7655ff)}.bali-tg{background:#229ed9}.bali-wa{background:#25d366}
#bali-contact-toggle{width:58px;height:58px;border:0;padding:0;border-radius:50%;background:#25d366;color:#fff;display:grid;place-items:center;box-shadow:0 14px 34px rgba(0,0,0,.25);font-size:28px;line-height:1;cursor:pointer}#bali-contact-toggle .bali-close{display:none}#bali-contact-wrap.open #bali-contact-toggle .bali-open{display:none}#bali-contact-wrap.open #bali-contact-toggle .bali-close{display:block}
</style>`, { html: true });
  }
}

class NavigationLinkRewriter {
  element(element) {
    const href = element.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    const localized = localizeNavigationHref(href);
    if (localized) element.setAttribute("href", localized);
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
    element.append(`<div id="bali-contact-wrap">
<div id="bali-contact-menu" aria-hidden="true">
<button class="bali-contact-item" type="button"><span class="bali-msg-icon bali-vk">VK</span><span>ВКонтакте</span></button>
<button class="bali-contact-item" type="button"><span class="bali-msg-icon bali-max">M</span><span>MAX</span></button>
<button class="bali-contact-item" type="button"><span class="bali-msg-icon bali-tg">✈</span><span>Telegram</span></button>
<button class="bali-contact-item" type="button"><span class="bali-msg-icon bali-wa">☎</span><span>WhatsApp</span></button>
</div><button id="bali-contact-toggle" type="button" aria-label="Открыть мессенджеры" aria-expanded="false"><span class="bali-open">☎</span><span class="bali-close">×</span></button></div>
<script id="bali-notion-ui">(()=>{window.CONFIG=window.CONFIG||{};window.CONFIG.domainBaseUrl=location.origin;const w=document.getElementById('bali-contact-wrap'),t=document.getElementById('bali-contact-toggle'),m=document.getElementById('bali-contact-menu');const setOpen=v=>{w?.classList.toggle('open',v);t?.setAttribute('aria-expanded',String(v));m?.setAttribute('aria-hidden',String(!v))};t?.addEventListener('click',e=>{e.stopPropagation();setOpen(!w.classList.contains('open'))});m?.addEventListener('click',e=>{e.stopPropagation();e.preventDefault()});document.addEventListener('click',()=>setOpen(false));document.addEventListener('keydown',e=>{if(e.key==='Escape')setOpen(false)});const clean=()=>{document.querySelectorAll('a,button,div').forEach(el=>{const txt=(el.textContent||'').trim().toLowerCase();if((txt==='get notion free'||txt==='get notion'||txt==='built with notion')&&el.children.length<4)el.style.setProperty('display','none','important')});document.querySelectorAll('a[href]').forEach(a=>{try{const u=new URL(a.href);if(u.hostname==='${NOTION_HOST}')a.href='/ru'+u.pathname+u.search+u.hash}catch{}})};clean();new MutationObserver(clean).observe(document.documentElement,{subtree:true,childList:true})})();</script>`, { html: true });
  }
}

function localizeNavigationHref(href) {
  try {
    if (href.startsWith("/")) return `${LOCAL_PREFIX}${href}`;
    const url = new URL(href, NOTION_ORIGIN);
    if (url.hostname === NOTION_HOST) return `${LOCAL_PREFIX}${url.pathname}${url.search}${url.hash}`;
    return href;
  } catch {
    return href;
  }
}

function localizeUrl(value) {
  try {
    const url = new URL(value, NOTION_ORIGIN);
    if (url.hostname === NOTION_HOST) return `${LOCAL_PREFIX}${url.pathname}${url.search}${url.hash}`;
    return value;
  } catch {
    return value;
  }
}
