const NOTION_ORIGIN = "https://balidiscount.notion.site";
const NOTION_HOST = "balidiscount.notion.site";
const NOTION_ROOT_PATH = "/9d9cc7b88191428a86afbaff8b85931d";
const LOCAL_PREFIX = "/ru";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const MESSENGERS = [
  { label: "ВКонтакте", url: "https://vk.me/balidiscount", icon: "https://cdn.simpleicons.org/vk/FFFFFF", cls: "vk" },
  { label: "MAX", url: "https://max.ru/u/f9LHodD0cOIwcXL9W58ncPrSABr9BRXv84mIqJ3Z3P4qoTFYvTXRCCPWvIg", icon: "https://max.ru/favicon.ico", cls: "max" },
  { label: "Telegram", url: "https://t.me/bali_discount", icon: "https://cdn.simpleicons.org/telegram/FFFFFF", cls: "tg" },
  { label: "WhatsApp", url: "https://wa.me/6281222666226", icon: "https://cdn.simpleicons.org/whatsapp/FFFFFF", cls: "wa" },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/ru" || url.pathname === "/ru/") {
      const target = new URL(`${LOCAL_PREFIX}${NOTION_ROOT_PATH}`, url.origin);
      target.search = url.search;
      return Response.redirect(target.toString(), 302);
    }
    try {
      return await proxyNotion(request);
    } catch (error) {
      console.error("Russian Notion proxy failed", error);
      return new Response("Bali Discount: Russian tours are temporarily unavailable.", {
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
  outHeaders.set("x-bali-content-source", "notion-proxy-ru");
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
    element.append(`<style id="bali-ru-overrides">
.notion-topbar,.notion-topbar-mobile,.notion-navbar,[class*="notion-topbar"],[class*="notion-navbar"],[class*="notion-site-header"]{display:none!important}body{padding-top:0!important}
#bali-ru-contact{position:fixed;right:max(18px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));z-index:2147483646;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
#bali-ru-menu{position:absolute;right:0;bottom:70px;width:224px;padding:9px;border-radius:20px;background:rgba(255,255,255,.97);border:1px solid rgba(15,23,42,.09);box-shadow:0 18px 50px rgba(0,0,0,.20);opacity:0;transform:translateY(10px) scale(.97);pointer-events:none;transition:.18s ease}
#bali-ru-contact.open #bali-ru-menu{opacity:1;transform:none;pointer-events:auto}.bali-ru-item{height:50px;border-radius:13px;display:flex;align-items:center;gap:12px;padding:0 10px;color:#111827;font-weight:600;font-size:15px;text-decoration:none}.bali-ru-item:hover{background:#f4f5f6}.bali-ru-icon{width:35px;height:35px;border-radius:11px;display:grid;place-items:center;flex:0 0 auto}.bali-ru-icon img{display:block;width:23px;height:23px;object-fit:contain}.bali-ru-vk{background:#2787f5}.bali-ru-max{background:linear-gradient(145deg,#2a7df5,#7655ff)}.bali-ru-tg{background:#229ed9}.bali-ru-wa{background:#25D366}
#bali-ru-toggle{width:58px;height:58px;border:0;border-radius:50%;background:#25D366;color:#fff;display:grid;place-items:center;box-shadow:0 14px 34px rgba(0,0,0,.25);cursor:pointer;padding:0}#bali-ru-toggle svg{width:68%;height:68%;fill:currentColor}.bali-ru-close{display:none;font-size:32px;line-height:1}#bali-ru-contact.open .bali-ru-open{display:none}#bali-ru-contact.open .bali-ru-close{display:block}
</style>`, { html: true });
  }
}

class NavigationLinkRewriter {
  element(element) {
    const href = element.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("https://wa.me/") || href.startsWith("https://t.me/") || href.startsWith("https://vk.me/") || href.startsWith("https://max.ru/")) return;
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
    const whatsappSvg = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16.04 3C9.43 3 4.05 8.35 4.05 14.93c0 2.11.56 4.17 1.62 5.97L3.95 27l6.27-1.64a12 12 0 0 0 5.82 1.48h.01c6.61 0 11.99-5.35 11.99-11.93C28.04 8.35 22.66 3 16.04 3Zm0 21.83h-.01a9.98 9.98 0 0 1-5.09-1.39l-.37-.22-3.72.97.99-3.61-.24-.37a9.88 9.88 0 0 1-1.52-5.28c0-5.47 4.47-9.92 9.97-9.92 5.49 0 9.96 4.45 9.96 9.92 0 5.47-4.47 9.9-9.97 9.9Zm5.47-7.42c-.3-.15-1.77-.87-2.04-.97-.28-.1-.48-.15-.68.15-.2.3-.78.97-.95 1.17-.18.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.76-1.66-2.06-.18-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.68-1.64-.93-2.24-.25-.59-.5-.51-.68-.52h-.58c-.2 0-.53.07-.8.37-.28.3-1.05 1.02-1.05 2.49s1.08 2.89 1.23 3.09c.15.2 2.12 3.22 5.14 4.52.72.31 1.28.49 1.72.63.72.23 1.38.2 1.9.12.58-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.18-1.42-.08-.13-.28-.2-.58-.35Z"/></svg>`;
    const items = MESSENGERS.map(m => `<a class="bali-ru-item" href="${m.url}" target="_blank" rel="noopener noreferrer"><span class="bali-ru-icon bali-ru-${m.cls}"><img src="${m.icon}" alt=""></span><span>${m.label}</span></a>`).join("");
    element.append(`<div id="bali-ru-contact"><div id="bali-ru-menu" aria-hidden="true">${items}</div><button id="bali-ru-toggle" type="button" aria-label="Открыть мессенджеры" aria-expanded="false"><span class="bali-ru-open">${whatsappSvg}</span><span class="bali-ru-close">×</span></button></div>
<script id="bali-ru-ui">(()=>{window.CONFIG=window.CONFIG||{};window.CONFIG.domainBaseUrl=location.origin;
const promo=['notion : notes, tâches, ia','notion: notes, tasks, ai','planifier & suivre des projets','mettre à jour','upgrade'];
const localizeNotionHref=raw=>{if(!raw)return null;try{const u=new URL(raw,location.href);const h=u.hostname.toLowerCase();if(!(h==='balidiscount.notion.site'||h==='app.notion.com'||h==='notion.so'||h==='www.notion.so'))return null;const ids=u.pathname.match(/[0-9a-f]{32}/ig);if(!ids||!ids.length)return null;const id=ids[ids.length-1];return '/ru/'+id+u.search+u.hash}catch{return null}};
const rewriteNotionLinks=()=>{document.querySelectorAll('a[href]').forEach(a=>{const local=localizeNotionHref(a.getAttribute('href'));if(local){a.setAttribute('href',local);a.removeAttribute('target')}})};
document.addEventListener('click',e=>{const a=e.target?.closest?.('a[href]');if(!a||a.closest('#bali-ru-menu'))return;const local=localizeNotionHref(a.href);if(!local)return;e.preventDefault();e.stopPropagation();location.assign(local)},true);
const contact=document.getElementById('bali-ru-contact'),toggle=document.getElementById('bali-ru-toggle'),menu=document.getElementById('bali-ru-menu');const setOpen=v=>{contact?.classList.toggle('open',v);toggle?.setAttribute('aria-expanded',String(v));menu?.setAttribute('aria-hidden',String(!v))};toggle?.addEventListener('click',e=>{e.stopPropagation();setOpen(!contact.classList.contains('open'))});menu?.addEventListener('click',e=>e.stopPropagation());document.addEventListener('click',()=>setOpen(false));document.addEventListener('keydown',e=>{if(e.key==='Escape')setOpen(false)});
const clean=()=>{for(const node of document.querySelectorAll('div,header,aside,a,button')){const text=(node.textContent||'').trim().toLowerCase();if(!text||text.length>220||!promo.some(v=>text.includes(v)))continue;let target=node;for(let i=0;i<7&&target?.parentElement;i++){const s=getComputedStyle(target),r=target.getBoundingClientRect();if((s.position==='fixed'||s.position==='sticky'||r.top<90)&&r.width>innerWidth*.65&&r.height<150)break;target=target.parentElement}if(target&&target!==document.body&&target!==document.documentElement){const r=target.getBoundingClientRect();if(r.top<120&&r.height<180)target.style.setProperty('display','none','important')}}document.body.style.setProperty('padding-top','0px','important');rewriteNotionLinks()};clean();let q=false;new MutationObserver(()=>{if(q)return;q=true;requestAnimationFrame(()=>{q=false;clean()})}).observe(document.documentElement,{subtree:true,childList:true});setTimeout(clean,500);setTimeout(clean,1500)})();</script>`, { html: true });
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
