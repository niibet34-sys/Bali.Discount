const NOTION_ORIGIN = "https://balidiscount.notion.site";
const API_BASE = `${NOTION_ORIGIN}/api/v3`;
const FRESH_TTL = 120;
const STALE_TTL = 604800;

const CONFIG = {
  en: {
    prefix: "/stable/en",
    rootId: "3c13152813a381c0a3b4c6dd8adff293",
    whatsapp: "https://wa.me/628999844455?text=Hello%21%20I%27m%20interested%20in%20private%20tours%20in%20Bali.",
    back: "All tours",
    unavailable: "Tours are temporarily unavailable",
  },
  ru: {
    prefix: "/stable/ru",
    rootId: "9d9cc7b88191428a86afbaff8b85931d",
    whatsapp: "https://wa.me/6281222666226",
    back: "Все экскурсии",
    unavailable: "Экскурсии временно недоступны",
  },
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cfg = getConfig(url.pathname);
    if (!cfg) return new Response("Not found", { status: 404 });

    if (url.pathname === cfg.prefix || url.pathname === `${cfg.prefix}/`) {
      return Response.redirect(new URL(`${cfg.prefix}/${cfg.rootId}`, url.origin).toString(), 302);
    }

    if (url.pathname === `${cfg.prefix}/__image`) {
      return proxyImage(request, cfg, ctx);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }

    const pageId = extractPageId(url.pathname) || cfg.rootId;
    const pagePath = `${cfg.prefix}/${stripDashes(pageId)}`;
    const canonicalUrl = new URL(pagePath, url.origin);
    const freshKey = new Request(canonicalUrl.toString(), { method: "GET" });
    const staleUrl = new URL(`/__bali_notion_stale/${cfg.lang}/${stripDashes(pageId)}`, url.origin);
    const staleKey = new Request(staleUrl.toString(), { method: "GET" });
    const cache = caches.default;

    const fresh = await cache.match(freshKey);
    if (fresh) return request.method === "HEAD" ? headOnly(fresh) : mark(fresh, "fresh-cache");

    const stale = await cache.match(staleKey);
    if (stale) {
      ctx.waitUntil(refreshAndCache(pageId, cfg, freshKey, staleKey, ctx).catch(err => console.error("Notion background refresh failed", err)));
      return request.method === "HEAD" ? headOnly(stale) : mark(stale, "stale-while-revalidate");
    }

    const rendered = await buildPage(pageId, cfg);
    if (!rendered.ok) {
      const fallback = emergencyPage(cfg, pageId);
      return request.method === "HEAD" ? headOnly(fallback) : fallback;
    }

    await putBoth(cache, freshKey, staleKey, rendered.response, ctx);
    return request.method === "HEAD" ? headOnly(rendered.response) : rendered.response;
  },
};

function getConfig(pathname) {
  for (const [lang, base] of Object.entries(CONFIG)) {
    if (pathname === base.prefix || pathname.startsWith(`${base.prefix}/`)) return { ...base, lang };
  }
  return null;
}

async function refreshAndCache(pageId, cfg, freshKey, staleKey, ctx) {
  const rendered = await buildPage(pageId, cfg);
  if (!rendered.ok) return;
  await putBoth(caches.default, freshKey, staleKey, rendered.response, ctx);
}

async function putBoth(cache, freshKey, staleKey, response, ctx) {
  const fresh = response.clone();
  const stale = response.clone();
  fresh.headers.set("cache-control", `public, max-age=${FRESH_TTL}`);
  stale.headers.set("cache-control", `public, max-age=${STALE_TTL}`);
  const work = Promise.all([cache.put(freshKey, fresh), cache.put(staleKey, stale)]);
  if (ctx?.waitUntil) ctx.waitUntil(work);
  else await work;
}

async function buildPage(pageId, cfg) {
  try {
    const blocks = await fetchPageBlocks(pageId);
    const root = blocks.get(normalizeId(pageId)) || blocks.get(stripDashes(pageId)) || findRoot(blocks, pageId);
    if (!root) throw new Error(`Root block ${pageId} not found`);

    const title = plainRichText(root.properties?.title) || (cfg.lang === "ru" ? "Экскурсии на Бали" : "Bali Private Tours");
    const content = renderChildren(root.content || [], blocks, cfg, 0);
    const isRoot = stripDashes(pageId) === cfg.rootId;
    const html = documentHtml({ title, content, cfg, isRoot });
    return {
      ok: true,
      response: new Response(html, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=UTF-8",
          "cache-control": `public, max-age=${FRESH_TTL}`,
          "x-bali-renderer": `notion-api-${cfg.lang}`,
          "x-bali-hydration": "none",
        },
      }),
    };
  } catch (error) {
    console.error("Server-side Notion render failed", error);
    return { ok: false, error };
  }
}

async function fetchPageBlocks(pageId) {
  const rootId = normalizeId(pageId);
  const blocks = new Map();
  let cursor = { stack: [] };
  let chunkNumber = 0;
  let spaceId = null;

  for (let page = 0; page < 12; page++) {
    const data = await notionPost("loadCachedPageChunkV2", {
      page: { id: rootId },
      limit: 100,
      cursor,
      chunkNumber,
      verticalColumns: false,
    });

    const records = data?.recordMap?.block || {};
    for (const [id, record] of Object.entries(records)) {
      const block = unwrapRecord(record);
      if (!block) continue;
      blocks.set(normalizeId(id), block);
      blocks.set(stripDashes(id), block);
      spaceId ||= record?.spaceId || record?.value?.spaceId || block?.space_id || null;
    }

    const next = Array.isArray(data?.cursors) ? data.cursors[0] : null;
    if (!next?.stack?.length) break;
    cursor = { stack: next.stack };
    chunkNumber += 1;
  }

  if (spaceId) await fillMissingChildren(blocks, spaceId);
  return blocks;
}

async function fillMissingChildren(blocks, spaceId) {
  for (let round = 0; round < 3; round++) {
    const missing = new Set();
    const unique = new Set();
    for (const block of blocks.values()) {
      if (!block?.id || unique.has(block.id)) continue;
      unique.add(block.id);
      for (const child of block.content || []) {
        if (!blocks.has(normalizeId(child)) && !blocks.has(stripDashes(child))) missing.add(normalizeId(child));
      }
    }
    if (!missing.size) return;

    const ids = [...missing].slice(0, 100);
    let data;
    try {
      data = await notionPost("syncRecordValues", {
        requests: ids.map(id => ({ pointer: { table: "block", id, spaceId }, version: -1 })),
      }, 3);
    } catch {
      return;
    }

    let added = 0;
    for (const [id, record] of Object.entries(data?.recordMap?.block || {})) {
      const block = unwrapRecord(record);
      if (!block) continue;
      blocks.set(normalizeId(id), block);
      blocks.set(stripDashes(id), block);
      added += 1;
    }
    if (!added) return;
  }
}

async function notionPost(endpoint, body, attempts = 6) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(`${API_BASE}/${endpoint}`, {
        method: "POST",
        headers: {
          "content-type": "application/json;charset=UTF-8",
          accept: "application/json",
          "user-agent": "Mozilla/5.0 (compatible; BaliDiscountNotionRenderer/1.0)",
          origin: NOTION_ORIGIN,
          referer: `${NOTION_ORIGIN}/`,
        },
        body: JSON.stringify(body),
      });

      if (response.ok) return await response.json();
      const text = await response.text().catch(() => "");
      lastError = new Error(`${endpoint}: ${response.status} ${text.slice(0, 180)}`);
      if (!(response.status === 408 || response.status === 429 || response.status >= 500)) throw lastError;
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts - 1) await sleep(Math.min(350 * (attempt + 1), 1800));
  }
  throw lastError || new Error(`${endpoint} failed`);
}

function unwrapRecord(record) {
  if (!record) return null;
  const value = record.value;
  if (value?.value && typeof value.value === "object") return value.value;
  if (value && typeof value === "object" && value.type) return value;
  return null;
}

function findRoot(blocks, pageId) {
  const target = stripDashes(pageId);
  for (const block of blocks.values()) if (stripDashes(block?.id || "") === target) return block;
  return null;
}

function renderChildren(ids, blocks, cfg, depth) {
  return ids.map((id, index) => renderBlock(id, blocks, cfg, depth, index + 1)).join("");
}

function renderBlock(id, blocks, cfg, depth, index) {
  const block = blocks.get(normalizeId(id)) || blocks.get(stripDashes(id));
  if (!block) return "";
  const type = block.type;
  const title = renderRichText(block.properties?.title, cfg);
  const children = block.content || [];

  if (type === "page") {
    const href = `${cfg.prefix}/${stripDashes(block.id || id)}`;
    return `<a class="subpage" href="${escapeAttr(href)}"><span>${title || escapeHtml(cfg.lang === "ru" ? "Страница" : "Page")}</span><span class="chev">›</span></a>`;
  }
  if (type === "header") return `<h2>${title}</h2>${renderChildren(children, blocks, cfg, depth + 1)}`;
  if (type === "sub_header") return `<h3>${title}</h3>${renderChildren(children, blocks, cfg, depth + 1)}`;
  if (type === "sub_sub_header") return `<h4>${title}</h4>${renderChildren(children, blocks, cfg, depth + 1)}`;
  if (type === "text") return `<div class="text">${title || "&nbsp;"}</div>${renderChildren(children, blocks, cfg, depth + 1)}`;
  if (type === "bulleted_list") return `<div class="list"><span class="marker">•</span><div>${title}${renderChildren(children, blocks, cfg, depth + 1)}</div></div>`;
  if (type === "numbered_list") return `<div class="list"><span class="marker">${index}.</span><div>${title}${renderChildren(children, blocks, cfg, depth + 1)}</div></div>`;
  if (type === "to_do") {
    const checked = JSON.stringify(block.properties?.checked || "").includes("Yes");
    return `<div class="list"><span class="check">${checked ? "✓" : ""}</span><div>${title}${renderChildren(children, blocks, cfg, depth + 1)}</div></div>`;
  }
  if (type === "toggle") return `<details class="toggle"><summary>${title}</summary>${renderChildren(children, blocks, cfg, depth + 1)}</details>`;
  if (type === "quote") return `<blockquote>${title}${renderChildren(children, blocks, cfg, depth + 1)}</blockquote>`;
  if (type === "callout") {
    const icon = block.format?.page_icon;
    const prefix = icon && !String(icon).startsWith("/") && !String(icon).startsWith("http") ? `${escapeHtml(icon)} ` : "";
    return `<div class="callout">${prefix}${title}${renderChildren(children, blocks, cfg, depth + 1)}</div>`;
  }
  if (type === "divider") return `<hr>`;
  if (type === "column_list") return `<div class="columns">${renderChildren(children, blocks, cfg, depth + 1)}</div>`;
  if (type === "column") return `<div class="column">${renderChildren(children, blocks, cfg, depth + 1)}</div>`;
  if (type === "image") return renderImage(block, cfg);
  if (type === "code") {
    const language = escapeHtml(plainRichText(block.properties?.language) || "");
    return `<pre><code data-lang="${escapeAttr(language)}">${escapeHtml(plainRichText(block.properties?.title) || "")}</code></pre>`;
  }
  if (["bookmark", "video", "embed", "file", "pdf", "audio"].includes(type)) {
    const source = richTextUrl(block.properties?.source) || richTextUrl(block.properties?.link) || plainRichText(block.properties?.source) || plainRichText(block.properties?.link);
    if (!source) return renderChildren(children, blocks, cfg, depth + 1);
    const label = title || escapeHtml(source);
    return `<a class="embed" href="${escapeAttr(source)}" target="_blank" rel="noopener noreferrer">${label}</a>${renderChildren(children, blocks, cfg, depth + 1)}`;
  }
  if (type === "table") return `<div class="table-wrap">${renderChildren(children, blocks, cfg, depth + 1)}</div>`;
  if (type === "table_row") {
    const cells = Object.keys(block.properties || {}).sort().map(key => `<div class="cell">${renderRichText(block.properties[key], cfg)}</div>`).join("");
    return `<div class="table-row">${cells}</div>`;
  }

  return `${title ? `<div class="text">${title}</div>` : ""}${renderChildren(children, blocks, cfg, depth + 1)}`;
}

function renderImage(block, cfg) {
  const source = plainRichText(block.properties?.source) || block.format?.display_source || block.format?.source;
  if (!source) return "";
  const caption = renderRichText(block.properties?.caption, cfg);
  const src = `${cfg.prefix}/__image?src=${encodeURIComponent(source)}&id=${encodeURIComponent(block.id || "")}`;
  return `<figure><img loading="lazy" src="${escapeAttr(src)}" alt="${escapeAttr(plainRichText(block.properties?.caption) || "")}">${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;
}

async function proxyImage(request, cfg, ctx) {
  const url = new URL(request.url);
  const source = url.searchParams.get("src");
  const blockId = url.searchParams.get("id") || "";
  if (!source) return new Response("Missing image", { status: 400 });

  const cache = caches.default;
  const key = new Request(request.url, { method: "GET" });
  const cached = await cache.match(key);
  if (cached) return cached;

  let upstreamUrl;
  try {
    const parsed = new URL(source, NOTION_ORIGIN);
    if (parsed.hostname.endsWith("notion.site") || parsed.hostname.endsWith("notion.so")) upstreamUrl = parsed.toString();
    else upstreamUrl = `${NOTION_ORIGIN}/image/${encodeURIComponent(parsed.toString())}?table=block&id=${encodeURIComponent(blockId)}&cache=v2`;
  } catch {
    upstreamUrl = new URL(source, NOTION_ORIGIN).toString();
  }

  let response;
  try {
    response = await fetch(upstreamUrl, { headers: { "user-agent": "Mozilla/5.0", referer: `${NOTION_ORIGIN}/` } });
  } catch {
    return new Response("Image unavailable", { status: 502 });
  }
  if (!response.ok) return new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  headers.set("cache-control", "public, max-age=86400");
  const out = new Response(response.body, { status: response.status, headers });
  ctx?.waitUntil?.(cache.put(key, out.clone()));
  return out;
}

function renderRichText(runs, cfg) {
  if (!Array.isArray(runs)) return "";
  return runs.map(run => {
    if (!Array.isArray(run) || !run.length) return "";
    let text = escapeHtml(String(run[0] ?? "")).replace(/\n/g, "<br>");
    let href = null;
    for (const decoration of run[1] || []) {
      if (!Array.isArray(decoration) || !decoration.length) continue;
      if (decoration[0] === "b") text = `<strong>${text}</strong>`;
      else if (decoration[0] === "i") text = `<em>${text}</em>`;
      else if (decoration[0] === "s") text = `<s>${text}</s>`;
      else if (decoration[0] === "c") text = `<code>${text}</code>`;
      else if (decoration[0] === "a" && decoration[1]) href = localizeHref(String(decoration[1]), cfg);
    }
    if (href) {
      const external = !href.startsWith(cfg.prefix);
      text = `<a href="${escapeAttr(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${text}</a>`;
    }
    return text;
  }).join("");
}

function plainRichText(runs) {
  if (!Array.isArray(runs)) return "";
  return runs.map(run => Array.isArray(run) ? String(run[0] ?? "") : "").join("");
}

function richTextUrl(runs) {
  if (!Array.isArray(runs)) return "";
  for (const run of runs) {
    for (const decoration of (Array.isArray(run) ? run[1] || [] : [])) {
      if (Array.isArray(decoration) && decoration[0] === "a" && decoration[1]) return String(decoration[1]);
    }
  }
  return "";
}

function localizeHref(value, cfg) {
  try {
    const u = new URL(value, NOTION_ORIGIN);
    const match = `${u.pathname}${u.hash}`.match(/([0-9a-fA-F]{32})(?:[^0-9a-fA-F]|$)/);
    const host = u.hostname.toLowerCase();
    if (match && ["balidiscount.notion.site", "app.notion.com", "www.notion.so", "notion.so"].includes(host)) {
      return `${cfg.prefix}/${match[1].toLowerCase()}${u.search}${u.hash}`;
    }
    return u.toString();
  } catch {
    return value;
  }
}

function documentHtml({ title, content, cfg, isRoot }) {
  const back = isRoot ? "" : `<a class="back" href="${cfg.prefix}/">← ${escapeHtml(cfg.back)}</a>`;
  return `<!doctype html><html lang="${cfg.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#ffffff"><title>${escapeHtml(title)} — Bali Discount</title><style>${PAGE_CSS}</style></head><body><main class="page">${back}<h1>${escapeHtml(title)}</h1><div class="content">${content}</div></main>${contactHtml(cfg)}</body></html>`;
}

function contactHtml(cfg) {
  const svg = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16.04 3C9.43 3 4.05 8.35 4.05 14.93c0 2.11.56 4.17 1.62 5.97L3.95 27l6.27-1.64a12 12 0 0 0 5.82 1.48h.01c6.61 0 11.99-5.35 11.99-11.93C28.04 8.35 22.66 3 16.04 3Zm0 21.83h-.01a9.98 9.98 0 0 1-5.09-1.39l-.37-.22-3.72.97.99-3.61-.24-.37a9.88 9.88 0 0 1-1.52-5.28c0-5.47 4.47-9.92 9.97-9.92 5.49 0 9.96 4.45 9.96 9.92 0 5.47-4.47 9.9-9.97 9.9Zm5.47-7.42c-.3-.15-1.77-.87-2.04-.97-.28-.1-.48-.15-.68.15-.2.3-.78.97-.95 1.17-.18.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.76-1.66-2.06-.18-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.68-1.64-.93-2.24-.25-.59-.5-.51-.68-.52h-.58c-.2 0-.53.07-.8.37-.28.3-1.05 1.02-1.05 2.49s1.08 2.89 1.23 3.09c.15.2 2.12 3.22 5.14 4.52.72.31 1.28.49 1.72.63.72.23 1.38.2 1.9.12.58-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.18-1.42-.08-.13-.28-.2-.58-.35Z"/></svg>`;
  if (cfg.lang === "en") return `<a class="wa" href="${cfg.whatsapp}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp">${svg}</a>`;
  return `<details class="contact"><summary aria-label="Открыть мессенджеры">${svg}</summary><nav><a href="https://vk.me/balidiscount" target="_blank" rel="noopener noreferrer">ВКонтакте</a><a href="https://max.ru/u/f9LHodD0cOIwcXL9W58ncPrSABr9BRXv84mIqJ3Z3P4qoTFYvTXRCCPWvIg" target="_blank" rel="noopener noreferrer">MAX</a><a href="https://t.me/bali_discount" target="_blank" rel="noopener noreferrer">Telegram</a><a href="${cfg.whatsapp}" target="_blank" rel="noopener noreferrer">WhatsApp</a></nav></details>`;
}

function emergencyPage(cfg, pageId) {
  const title = cfg.unavailable;
  const home = `${cfg.prefix}/`;
  const body = cfg.lang === "ru" ? "Notion сейчас временно не отвечает. Напишите нам — мы сразу пришлём список и поможем выбрать экскурсию." : "Notion is temporarily unavailable. Message us and we’ll send the tour list and help you choose a tour right away.";
  const html = `<!doctype html><html lang="${cfg.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${PAGE_CSS}</style></head><body><main class="page emergency"><a class="back" href="${home}">← ${escapeHtml(cfg.back)}</a><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p><a class="emergency-cta" href="${cfg.whatsapp}" target="_blank" rel="noopener noreferrer">WhatsApp</a></main>${contactHtml(cfg)}</body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=UTF-8", "cache-control": "no-store", "x-bali-renderer": "emergency-fallback" } });
}

function extractPageId(pathname) {
  const match = pathname.match(/([0-9a-fA-F]{32})(?:\/)?$/);
  return match ? match[1].toLowerCase() : null;
}

function normalizeId(id) {
  const raw = stripDashes(id).toLowerCase();
  if (raw.length !== 32) return String(id);
  return `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;
}

function stripDashes(id) { return String(id || "").replace(/-/g, "").toLowerCase(); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function headOnly(response) { return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers }); }
function mark(response, value) { const out = new Response(response.body, response); out.headers.set("x-bali-cache", value); return out; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch])); }
function escapeAttr(value) { return escapeHtml(value); }

const PAGE_CSS = `
:root{color-scheme:light;--text:#242424;--muted:#6b6b6b;--line:#e9e9e7;--soft:#f7f7f5;--green:#25D366}
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#fff;color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}a{color:#2563a8}.page{width:min(100%,980px);margin:0 auto;padding:28px 22px 110px}.back{display:inline-block;margin:2px 0 22px;color:#676767;text-decoration:none;font-size:15px}.page h1{font-size:clamp(31px,6vw,44px);line-height:1.12;letter-spacing:-.025em;margin:0 0 24px;font-weight:750}.content{font-size:16px;line-height:1.58}.content h2{font-size:25px;line-height:1.25;margin:30px 0 10px}.content h3{font-size:21px;line-height:1.3;margin:26px 0 8px}.content h4{font-size:18px;line-height:1.35;margin:22px 0 7px}.text{margin:7px 0}.text:empty{min-height:8px}.columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:34px;margin:10px 0}.column{min-width:0}.subpage{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 11px;margin:5px -11px;border-radius:10px;color:#202020;text-decoration:none;font-weight:500}.subpage:hover{background:var(--soft)}.chev{color:#aaa;font-size:23px;line-height:1}.list{display:grid;grid-template-columns:24px 1fr;gap:4px;margin:5px 0}.marker{color:#666;text-align:right;padding-right:4px}.check{width:17px;height:17px;border:1px solid #aaa;border-radius:3px;display:grid;place-items:center;font-size:12px;margin-top:4px}blockquote{margin:14px 0;padding:2px 0 2px 16px;border-left:3px solid #333}.callout{margin:14px 0;padding:14px 16px;background:var(--soft);border-radius:10px}.toggle{margin:8px 0}.toggle summary{cursor:pointer;font-weight:600}hr{border:0;border-top:1px solid var(--line);margin:24px 0}figure{margin:22px 0}figure img{display:block;width:100%;height:auto;border-radius:8px}figcaption{font-size:13px;color:var(--muted);margin-top:6px}pre{overflow:auto;padding:16px;background:#f4f4f2;border-radius:10px;font-size:13px}.embed{display:block;margin:12px 0;padding:13px 14px;border:1px solid var(--line);border-radius:10px;text-decoration:none;color:#333}.table-wrap{overflow:auto}.table-row{display:flex;min-width:520px;border-bottom:1px solid var(--line)}.cell{flex:1;padding:8px}.wa,.contact{position:fixed;right:max(18px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));z-index:2147483646}.wa,.contact summary{width:58px;height:58px;border-radius:50%;background:var(--green);color:#fff;display:grid;place-items:center;box-shadow:0 14px 34px rgba(0,0,0,.25);text-decoration:none}.wa svg,.contact summary svg{display:block;width:39px;height:39px;fill:currentColor}.contact summary{list-style:none;cursor:pointer}.contact summary::-webkit-details-marker{display:none}.contact nav{position:absolute;right:0;bottom:70px;width:220px;padding:8px;background:#fff;border:1px solid var(--line);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.18)}.contact nav a{display:block;padding:11px 12px;border-radius:10px;color:#222;text-decoration:none;font-weight:600}.contact nav a:hover{background:var(--soft)}.emergency{padding-top:70px}.emergency p{font-size:18px;line-height:1.6;color:#555}.emergency-cta{display:inline-block;margin-top:12px;padding:13px 18px;border-radius:999px;background:var(--green);color:#fff;text-decoration:none;font-weight:700}
@media(max-width:700px){.page{padding:22px 18px 100px}.columns{grid-template-columns:1fr;gap:0}.content h2{font-size:23px}.subpage{padding:11px 10px;margin:4px -10px}}
`;
