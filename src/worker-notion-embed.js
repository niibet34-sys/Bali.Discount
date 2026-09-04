const NOTION_SITE = "https://balidiscount.notion.site";

const CONFIG = {
  ru: {
    prefix: "/ru",
    rootId: "9d9cc7b88191428a86afbaff8b85931d",
    title: "Экскурсии на Бали — Bali Discount",
    whatsapp: "https://wa.me/6281222666226",
  },
  en: {
    prefix: "/en",
    rootId: "3c13152813a381c0a3b4c6dd8adff293",
    title: "Private Bali Tours — Bali Discount",
    whatsapp: "https://wa.me/628999844455?text=Hello%21%20I%27m%20interested%20in%20private%20tours%20in%20Bali.",
  },
};

export default {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }

    const url = new URL(request.url);
    const cfg = getConfig(url.pathname);
    if (!cfg) return new Response("Not found", { status: 404 });

    const pageId = extractPageId(url.pathname) || cfg.rootId;
    const notionUrl = `${NOTION_SITE}/ebd/${pageId}`;
    const html = renderShell(cfg, notionUrl);

    const headers = new Headers({
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "public, max-age=300",
      "x-bali-notion-mode": "official-embed",
    });

    return new Response(request.method === "HEAD" ? null : html, {
      status: 200,
      headers,
    });
  },
};

function getConfig(pathname) {
  for (const [lang, cfg] of Object.entries(CONFIG)) {
    if (pathname === cfg.prefix || pathname.startsWith(`${cfg.prefix}/`)) {
      return { ...cfg, lang };
    }
  }
  return null;
}

function extractPageId(pathname) {
  const matches = pathname.match(/[0-9a-fA-F]{32}/g);
  return matches?.length ? matches[matches.length - 1].toLowerCase() : null;
}

function renderShell(cfg, notionUrl) {
  return `<!doctype html>
<html lang="${cfg.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#ffffff">
<title>${escapeHtml(cfg.title)}</title>
<link rel="preconnect" href="https://balidiscount.notion.site" crossorigin>
<link rel="dns-prefetch" href="//balidiscount.notion.site">
<link rel="preconnect" href="https://www.notion.so" crossorigin>
<style>
*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;background:#fff;overflow:hidden}
#notion-frame{position:fixed;inset:0;width:100%;height:100vh;height:100dvh;border:0;background:#fff;display:block}
.wa,.contact{position:fixed;right:max(18px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));z-index:2147483646;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
.wa,.contact summary{width:58px;height:58px;border-radius:50%;background:#25D366;color:#fff;display:grid;place-items:center;box-shadow:0 14px 34px rgba(0,0,0,.25);text-decoration:none}
.wa svg,.contact summary svg{display:block;width:39px;height:39px;fill:currentColor}
.contact summary{list-style:none;cursor:pointer}.contact summary::-webkit-details-marker{display:none}
.contact nav{position:absolute;right:0;bottom:70px;width:220px;padding:8px;background:rgba(255,255,255,.98);border:1px solid #e9e9e7;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.18)}
.contact nav a{display:block;padding:11px 12px;border-radius:10px;color:#222;text-decoration:none;font-weight:600;font-size:15px}.contact nav a:hover{background:#f7f7f5}
</style>
</head>
<body>
<iframe id="notion-frame" src="${escapeAttr(notionUrl)}" title="${escapeAttr(cfg.title)}" loading="eager" allow="clipboard-write; fullscreen" allowfullscreen></iframe>
${contactHtml(cfg)}
</body>
</html>`;
}

function contactHtml(cfg) {
  const svg = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16.04 3C9.43 3 4.05 8.35 4.05 14.93c0 2.11.56 4.17 1.62 5.97L3.95 27l6.27-1.64a12 12 0 0 0 5.82 1.48h.01c6.61 0 11.99-5.35 11.99-11.93C28.04 8.35 22.66 3 16.04 3Zm0 21.83h-.01a9.98 9.98 0 0 1-5.09-1.39l-.37-.22-3.72.97.99-3.61-.24-.37a9.88 9.88 0 0 1-1.52-5.28c0-5.47 4.47-9.92 9.97-9.92 5.49 0 9.96 4.45 9.96 9.92 0 5.47-4.47 9.9-9.97 9.9Zm5.47-7.42c-.3-.15-1.77-.87-2.04-.97-.28-.1-.48-.15-.68.15-.2.3-.78.97-.95 1.17-.18.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.76-1.66-2.06-.18-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.68-1.64-.93-2.24-.25-.59-.5-.51-.68-.52h-.58c-.2 0-.53.07-.8.37-.28.3-1.05 1.02-1.05 2.49s1.08 2.89 1.23 3.09c.15.2 2.12 3.22 5.14 4.52.72.31 1.28.49 1.72.63.72.23 1.38.2 1.9.12.58-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.18-1.42-.08-.13-.28-.2-.58-.35Z"/></svg>`;

  if (cfg.lang === "en") {
    return `<a class="wa" href="${escapeAttr(cfg.whatsapp)}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp">${svg}</a>`;
  }

  return `<details class="contact"><summary aria-label="Открыть мессенджеры">${svg}</summary><nav><a href="https://vk.me/balidiscount" target="_blank" rel="noopener noreferrer">ВКонтакте</a><a href="https://max.ru/u/f9LHodD0cOIwcXL9W58ncPrSABr9BRXv84mIqJ3Z3P4qoTFYvTXRCCPWvIg" target="_blank" rel="noopener noreferrer">MAX</a><a href="https://t.me/bali_discount" target="_blank" rel="noopener noreferrer">Telegram</a><a href="${escapeAttr(cfg.whatsapp)}" target="_blank" rel="noopener noreferrer">WhatsApp</a></nav></details>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}
