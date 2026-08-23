import appWorker from "./worker-v6.js";

const NOTION_HOSTS = [
  "www.notion.so",
  "notion.so",
  "app.notion.com",
  "balidiscount.notion.site",
];

export default {
  async fetch(request, env, ctx) {
    const response = await appWorker.fetch(request, env, ctx);
    if (!response.body) return response;

    const url = new URL(request.url);
    const type = (response.headers.get("content-type") || "").toLowerCase();
    const isRu = isBranch(url.pathname, "/ru");
    const isEn = isBranch(url.pathname, "/en");
    const isNotionBranch = isRu || isEn;

    // Keep Notion hydration inside bali.discount instead of letting client
    // bundles call notion.so/app.notion.com directly.
    if (isNotionBranch && isJavascript(url.pathname, type)) {
      return rewriteJavascript(response, url.origin);
    }

    if (isNotionBranch && type.includes("text/html")) {
      const rewriter = new HTMLRewriter().on("head", new EarlyNotionConfig());

      // The snapshot guard is intentionally NOT used on Russian pages.
      // Replacing #notion-app with a clone breaks Notion's native mobile
      // scroll/touch handling. Russian pages now keep the live Notion DOM.
      if (isEn) rewriter.on("body", new HydrationStabilityGuard());

      return rewriter.transform(response);
    }

    return response;
  },
};

function isBranch(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isJavascript(pathname, type) {
  return type.includes("javascript") || type.includes("ecmascript") || /\.(?:m?js)(?:$|\?)/i.test(pathname);
}

async function rewriteJavascript(response, localOrigin) {
  let text = await response.text();
  const localHost = new URL(localOrigin).host;

  for (const host of NOTION_HOSTS) {
    text = text.split(`https://${host}`).join(localOrigin);
    text = text.split(`http://${host}`).join(localOrigin);
    text = text.split(host).join(localHost);
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("cache-control", "public, max-age=300");
  if (!headers.get("content-type")) headers.set("content-type", "application/javascript; charset=UTF-8");

  return new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

class EarlyNotionConfig {
  element(element) {
    element.prepend(`<script id="bali-early-notion-config">window.CONFIG=window.CONFIG||{};window.CONFIG.domainBaseUrl=location.origin;</script>`, { html: true });
  }
}

class HydrationStabilityGuard {
  element(element) {
    element.append(`<script id="bali-notion-stability">(()=>{
      const ERROR_RE=/this page couldn[’']t be found|you may not have access, or it might have been deleted or moved/i;
      let snapshot=null;
      let bestLength=0;
      let restored=false;

      const root=()=>document.getElementById('notion-app');
      const isError=el=>ERROR_RE.test((el?.textContent||'').replace(/\\s+/g,' ').trim());

      const capture=()=>{
        if(restored)return;
        const app=root();
        if(!app||isError(app))return;
        const length=(app.textContent||'').trim().length;
        if(length>Math.max(120,bestLength)){
          snapshot=app.cloneNode(true);
          bestLength=length;
        }
      };

      const restoreIfNeeded=()=>{
        if(restored||!snapshot)return false;
        const app=root();
        if(!app||!isError(app))return false;
        const stable=snapshot.cloneNode(true);
        app.replaceWith(stable);
        restored=true;
        return true;
      };

      capture();
      requestAnimationFrame(capture);
      setTimeout(capture,80);
      setTimeout(capture,250);
      setTimeout(capture,600);
      setTimeout(capture,1200);

      const observer=new MutationObserver(()=>{
        if(restoreIfNeeded()){
          observer.disconnect();
          return;
        }
        capture();
      });
      observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});

      setTimeout(()=>{restoreIfNeeded();if(restored)observer.disconnect()},2500);
    })();</script>`, { html: true });
  }
}
