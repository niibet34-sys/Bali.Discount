const NOTION_ORIGIN = "https://balidiscount.notion.site";
const API_BASE = `${NOTION_ORIGIN}/api/v3`;
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FRESH_TTL = 120;
const STALE_TTL = 604800;
const RENDERER_VERSION = "v2";

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

    if (url.pathname === `${cfg.prefix}/__asset`) {
      return proxyAsset(request, cfg, ctx);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }

    const pageId = extractPageId(url.pathname) || cfg.rootId;
    const cache = caches.default;
    const freshKey = versionedCacheKey(url.origin, cfg.lang, pageId, "fresh");
    const staleKey = versionedCacheKey(url.origin, cfg.lang, pageId, "stale");

    const fresh = await cache.match(freshKey);
    if (fresh) return request.method === "HEAD" ? headOnly(fresh) : mark(fresh, "fresh-cache");

    const stale = await cache.match(staleKey);
    if (stale) {
      ctx.waitUntil(
        refreshAndCache(pageId, cfg, freshKey, staleKey, ctx)
          .catch(err => console.error("Notion background refresh failed", err))
      );
      return request.method === "HEAD" ? headOnly(stale) : mark(stale, "stale-while-revalidate");
    }

    const rendered = await buildPage(pageId, cfg);
    if (!rendered.ok) {
      const fallback = emergencyPage(cfg);
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

function versionedCacheKey(origin, lang, pageId, tier) {
  return new Request(
    new URL(`/__bali_notion_cache/${RENDERER_VERSION}/${lang}/${tier}/${stripDashes(pageId)}`, origin).toString(),
    { method: "GET" }
  );
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
    const record = await fetchPageRecord(pageId);
    const root = record.blocks.get(normalizeId(pageId)) || record.blocks.get(stripDashes(pageId)) || findRoot(record.blocks, pageId);
    if (!root) throw new Error(`Root block ${pageId} not found`);

    const title = plainRichText(root.properties?.title) || (cfg.lang === "ru" ? "Экскурсии на Бали" : "Bali Private Tours");
    const content = renderChildren(root.content || [], record, cfg, pageId, 0);
    const isRoot = stripDashes(pageId) === cfg.rootId;
    const html = documentHtml({ title, content, cfg, isRoot, root, pageId });

    return {
      ok: true,
      response: new Response(html, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=UTF-8",
          "cache-control": `public, max-age=${FRESH_TTL}`,
          "x-bali-renderer": `notion-api-${RENDERER_VERSION}-${cfg.lang}`,
          "x-bali-hydration": "none",
        },
      }),
    };
  } catch (error) {
    console.error("Server-side Notion render failed", error);
    return { ok: false, error };
  }
}

async function fetchPageRecord(pageId) {
  const rootId = normalizeId(pageId);
  const blocks = new Map();
  const signedUrls = new Map();
  let cursor = { stack: [] };
  let chunkNumber = 0;
  let spaceId = null;

  for (let page = 0; page < 14; page++) {
    const data = await notionPost("loadCachedPageChunkV2", {
      page: { id: rootId },
      limit: 100,
      cursor,
      chunkNumber,
      verticalColumns: false,
    });

    mergeRecordMap(blocks, signedUrls, data?.recordMap);

    const records = data?.recordMap?.block || {};
    for (const record of Object.values(records)) {
      const block = unwrapRecord(record);
      spaceId ||= record?.spaceId || record?.value?.spaceId || block?.space_id || null;
    }

    const next = Array.isArray(data?.cursors) ? data.cursors[0] : null;
    if (!next?.stack?.length) break;
    cursor = { stack: next.stack };
    chunkNumber += 1;
  }

  if (spaceId) await fillMissingChildren(blocks, signedUrls, spaceId);
  return { blocks, signedUrls, spaceId };
}

function mergeRecordMap(blocks, signedUrls, recordMap) {
  for (const [id, record] of Object.entries(recordMap?.block || {})) {
    const block = unwrapRecord(record);
    if (!block) continue;
    blocks.set(normalizeId(id), block);
    blocks.set(stripDashes(id), block);
  }

  for (const [id, value] of Object.entries(recordMap?.signed_urls || {})) {
    const url = typeof value === "string" ? value : value?.url || value?.signedUrl || "";
    if (!url) continue;
    signedUrls.set(normalizeId(id), url);
    signedUrls.set(stripDashes(id), url);
  }
}

async function fillMissingChildren(blocks, signedUrls, spaceId) {
  for (let round = 0; round < 4; round++) {
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
      }, 4);
    } catch {
      return;
    }

    const before = blocks.size;
    mergeRecordMap(blocks, signedUrls, data?.recordMap);
    if (blocks.size === before) return;
  }
}

async function notionPost(endpoint, body, attempts = 7) {
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(`${API_BASE}/${endpoint}`, {
        method: "POST",
        headers: {
          "content-type": "application/json;charset=UTF-8",
          accept: "application/json",
          "user-agent": BROWSER_UA,
          origin: NOTION_ORIGIN,
          referer: `${NOTION_ORIGIN}/`,
        },
        body: JSON.stringify(body),
      });

      if (response.ok) return await response.json();

      const text = await response.text().catch(() => "");
      lastError = new Error(`${endpoint}: ${response.status} ${text.slice(0, 220)}`);
      if (!(response.status === 408 || response.status === 429 || response.status >= 500)) throw lastError;
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts - 1) await sleep(Math.min(400 * (attempt + 1), 2200));
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

function renderChildren(ids, record, cfg, pageId, depth) {
  return ids.map((id, index) => renderBlock(id, record, cfg, pageId, depth, index + 1)).join("");
}

function renderBlock(id, record, cfg, pageId, depth, index) {
  const block = record.blocks.get(normalizeId(id)) || record.blocks.get(stripDashes(id));
  if (!block) return "";

  const type = block.type;
  const title = renderRichText(block.properties?.title, cfg);
  const children = block.content || [];
  const colorClass = colorClassName(block.format?.block_color);
  const cls = colorClass ? ` ${colorClass}` : "";

  if (type === "page") {
    const href = `${cfg.prefix}/${stripDashes(block.id || id)}`;
    const icon = renderInlineIcon(block.format?.page_icon, cfg, pageId, block.id || id);
    return `<a class="subpage${cls}" href="${escapeAttr(href)}"><span class="subpage-main">${icon}${title || escapeHtml(cfg.lang === "ru" ? "Страница" : "Page")}</span><span class="chev">›</span></a>`;
  }

  if (type === "header") return `<h2 class="${colorClass}">${title}</h2>${renderChildren(children, record, cfg, pageId, depth + 1)}`;
  if (type === "sub_header") return `<h3 class="${colorClass}">${title}</h3>${renderChildren(children, record, cfg, pageId, depth + 1)}`;
  if (type === "sub_sub_header") return `<h4 class="${colorClass}">${title}</h4>${renderChildren(children, record, cfg, pageId, depth + 1)}`;
  if (type === "header_4") return `<h5 class="${colorClass}">${title}</h5>${renderChildren(children, record, cfg, pageId, depth + 1)}`;

  if (type === "text") {
    return `<div class="text${cls}">${title || "&nbsp;"}</div>${renderChildren(children, record, cfg, pageId, depth + 1)}`;
  }

  if (type === "bulleted_list") {
    return `<div class="list${cls}"><span class="marker">•</span><div>${title}${renderChildren(children, record, cfg, pageId, depth + 1)}</div></div>`;
  }

  if (type === "numbered_list") {
    const n = Number(block.format?.list_start_index) || index;
    return `<div class="list${cls}"><span class="marker">${n}.</span><div>${title}${renderChildren(children, record, cfg, pageId, depth + 1)}</div></div>`;
  }

  if (type === "to_do") {
    const checked = JSON.stringify(block.properties?.checked || "").includes("Yes");
    return `<div class="list${cls}"><span class="check">${checked ? "✓" : ""}</span><div>${title}${renderChildren(children, record, cfg, pageId, depth + 1)}</div></div>`;
  }

  if (type === "toggle") {
    return `<details class="toggle${cls}"><summary>${title}</summary><div class="toggle-body">${renderChildren(children, record, cfg, pageId, depth + 1)}</div></details>`;
  }

  if (type === "quote") {
    return `<blockquote class="${colorClass}">${title}${renderChildren(children, record, cfg, pageId, depth + 1)}</blockquote>`;
  }

  if (type === "callout") {
    const icon = renderInlineIcon(block.format?.page_icon, cfg, pageId, block.id || id);
    return `<div class="callout${cls}"><div class="callout-icon">${icon || "💡"}</div><div>${title}${renderChildren(children, record, cfg, pageId, depth + 1)}</div></div>`;
  }

  if (type === "divider") return `<hr>`;

  if (type === "column_list") {
    return `<div class="columns">${renderChildren(children, record, cfg, pageId, depth + 1)}</div>`;
  }

  if (type === "column") {
    const ratio = Number(block.format?.column_ratio);
    const style = ratio > 0 ? ` style="--ratio:${Math.max(0.15, Math.min(ratio, 1))}"` : "";
    return `<div class="column"${style}>${renderChildren(children, record, cfg, pageId, depth + 1)}</div>`;
  }

  if (type === "image") return renderImage(block, record, cfg, pageId);
  if (type === "video") return renderVideo(block, record, cfg, pageId);

  if (type === "code") {
    const language = escapeHtml(plainRichText(block.properties?.language) || "");
    const caption = renderRichText(block.properties?.caption, cfg);
    return `<figure class="code-figure"><pre><code data-lang="${escapeAttr(language)}">${escapeHtml(plainRichText(block.properties?.title) || "")}</code></pre>${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;
  }

  if (type === "bookmark") return renderBookmark(block, cfg);

  if (["embed", "file", "pdf", "audio", "figma", "maps", "drive"].includes(type)) {
    const source = preferredSource(block, record);
    if (!source) return renderChildren(children, record, cfg, pageId, depth + 1);
    const label = title || escapeHtml(type === "file" ? (cfg.lang === "ru" ? "Открыть файл" : "Open file") : source);
    return `<a class="embed${cls}" href="${escapeAttr(source)}" target="_blank" rel="noopener noreferrer">${label}</a>${renderChildren(children, record, cfg, pageId, depth + 1)}`;
  }

  if (type === "table") return `<div class="table-wrap">${renderChildren(children, record, cfg, pageId, depth + 1)}</div>`;

  if (type === "table_row") {
    const keys = block.parent_table === "block" && block.format?.table_block_column_order
      ? block.format.table_block_column_order
      : Object.keys(block.properties || {}).sort();
    const cells = keys.map(key => `<div class="cell">${renderRichText(block.properties?.[key], cfg)}</div>`).join("");
    return `<div class="table-row">${cells}</div>`;
  }

  if (type === "alias") {
    const target = block.format?.alias_pointer?.id;
    if (target) {
      const linked = record.blocks.get(normalizeId(target)) || record.blocks.get(stripDashes(target));
      const linkedTitle = renderRichText(linked?.properties?.title, cfg) || (cfg.lang === "ru" ? "Страница" : "Page");
      return `<a class="subpage" href="${cfg.prefix}/${stripDashes(target)}"><span>${linkedTitle}</span><span class="chev">›</span></a>`;
    }
  }

  return `${title ? `<div class="text${cls}">${title}</div>` : ""}${renderChildren(children, record, cfg, pageId, depth + 1)}`;
}

function renderImage(block, record, cfg, pageId) {
  const source = stableSource(block);
  const signed = signedForBlock(record, block.id);
  if (!source && !signed) return "";

  const caption = renderRichText(block.properties?.caption, cfg);
  const alt = plainRichText(block.properties?.alt_text) || plainRichText(block.properties?.caption) || "";
  const src = assetUrl(cfg, pageId, block.id, source, "image", signed);
  const width = Number(block.format?.block_width) || 0;
  const style = width > 0 ? ` style="max-width:${Math.min(Math.max(width, 240), 1200)}px"` : "";

  return `<figure class="media"${style}><img loading="lazy" decoding="async" src="${escapeAttr(src)}" alt="${escapeAttr(alt)}">${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;
}

function renderVideo(block, record, cfg, pageId) {
  const source = stableSource(block);
  const signed = signedForBlock(record, block.id);
  if (!source && !signed) return "";

  const direct = signed || source;
  const isFile = !!signed || /^attachment:|prod-files-secure\.s3|notionusercontent\.com/i.test(String(source || ""));
  const caption = renderRichText(block.properties?.caption, cfg);

  if (isFile) {
    const src = assetUrl(cfg, pageId, block.id, source, "video", signed);
    return `<figure class="media"><video controls preload="metadata" playsinline src="${escapeAttr(src)}"></video>${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;
  }

  return `<a class="embed" href="${escapeAttr(direct)}" target="_blank" rel="noopener noreferrer">${cfg.lang === "ru" ? "Открыть видео" : "Open video"}</a>`;
}

function renderBookmark(block, cfg) {
  const href = richTextUrl(block.properties?.link) || plainRichText(block.properties?.link);
  if (!href) return "";
  const title = renderRichText(block.properties?.title, cfg) || escapeHtml(href);
  const description = renderRichText(block.properties?.description, cfg);
  const cover = block.format?.bookmark_cover;
  const icon = block.format?.bookmark_icon;

  return `<a class="bookmark" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer"><div class="bookmark-copy"><strong>${title}</strong>${description ? `<span>${description}</span>` : ""}<small>${escapeHtml(new URL(href, NOTION_ORIGIN).hostname)}</small></div>${cover ? `<img src="${escapeAttr(cover)}" alt="">` : icon ? `<img class="bookmark-icon" src="${escapeAttr(icon)}" alt="">` : ""}</a>`;
}

function renderInlineIcon(icon, cfg, pageId, blockId) {
  if (!icon) return "";
  const value = String(icon);
  if (!looksLikeAsset(value)) return `<span class="emoji">${escapeHtml(value)}</span>`;
  return `<img class="inline-icon" src="${escapeAttr(assetUrl(cfg, pageId, blockId, value, "image", ""))}" alt="">`;
}

function stableSource(block) {
  const display = block.format?.display_source;
  if (display && typeof display === "string") return display;
  const source = plainRichText(block.properties?.source) || block.format?.source;
  return typeof source === "string" ? source : "";
}

function preferredSource(block, record) {
  return signedForBlock(record, block.id) || stableSource(block) || richTextUrl(block.properties?.link) || plainRichText(block.properties?.link);
}

function signedForBlock(record, blockId) {
  if (!blockId) return "";
  return record.signedUrls.get(normalizeId(blockId)) || record.signedUrls.get(stripDashes(blockId)) || "";
}

function assetUrl(cfg, pageId, blockId, source, kind, signed) {
  const params = new URLSearchParams();
  params.set("page", stripDashes(pageId));
  params.set("id", stripDashes(blockId || ""));
  params.set("kind", kind || "image");
  if (source) params.set("src", source);
  if (signed) params.set("sig", signed);
  return `${cfg.prefix}/__asset?${params.toString()}`;
}

async function proxyAsset(request, cfg, ctx) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(request.url);
  const pageId = url.searchParams.get("page") || cfg.rootId;
  const blockId = url.searchParams.get("id") || "";
  const kind = url.searchParams.get("kind") || "image";
  const source = url.searchParams.get("src") || "";
  const suppliedSigned = url.searchParams.get("sig") || "";

  const cache = caches.default;
  const assetKeyUrl = new URL(`/__bali_asset_cache/${RENDERER_VERSION}/${cfg.lang}/${kind}/${blockId || "asset"}`, url.origin);
  if (source) assetKeyUrl.searchParams.set("src", stableAssetCacheSource(source));
  const key = new Request(assetKeyUrl.toString(), { method: "GET" });

  const cached = await cache.match(key);
  if (cached) return request.method === "HEAD" ? headOnly(cached) : cached;

  const candidates = [];
  addCandidate(candidates, suppliedSigned);
  addCandidate(candidates, source);

  if (source) {
    addCandidate(candidates, notionImageUrl(source, blockId));
    addCandidate(candidates, `https://www.notion.so/image/${encodeURIComponent(source)}?table=block&id=${encodeURIComponent(normalizeId(blockId))}&cache=v2`);
  }

  if (pageId && blockId) {
    try {
      const record = await fetchPageRecord(pageId);
      addCandidate(candidates, signedForBlock(record, blockId));
      const block = record.blocks.get(normalizeId(blockId)) || record.blocks.get(stripDashes(blockId));
      if (block) {
        const freshSource = stableSource(block);
        addCandidate(candidates, freshSource);
        if (freshSource) addCandidate(candidates, notionImageUrl(freshSource, blockId));
      }
    } catch (error) {
      console.error("Asset signed-url refresh failed", error);
    }
  }

  let lastStatus = 502;
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const response = await fetch(candidate, {
        headers: {
          "user-agent": BROWSER_UA,
          referer: `${NOTION_ORIGIN}/`,
          accept: kind === "video" ? "video/*,*/*;q=0.8" : "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
        redirect: "follow",
      });

      lastStatus = response.status;
      if (!response.ok) continue;

      const headers = new Headers(response.headers);
      for (const name of ["set-cookie", "content-security-policy", "x-frame-options"]) headers.delete(name);
      headers.set("cache-control", "public, max-age=604800, immutable");
      headers.set("access-control-allow-origin", "*");

      const out = new Response(request.method === "HEAD" ? null : response.body, {
        status: 200,
        headers,
      });

      if (request.method === "GET") ctx?.waitUntil?.(cache.put(key, out.clone()));
      return out;
    } catch {}
  }

  return new Response(kind === "video" ? "Video unavailable" : "Image unavailable", {
    status: lastStatus >= 400 ? lastStatus : 502,
    headers: { "cache-control": "no-store" },
  });
}

function stableAssetCacheSource(source) {
  try {
    const u = new URL(source, NOTION_ORIGIN);
    u.search = "";
    return u.toString().slice(0, 500);
  } catch {
    return String(source).slice(0, 500);
  }
}

function notionImageUrl(source, blockId) {
  if (!source) return "";
  try {
    const u = new URL(source, NOTION_ORIGIN);
    if (["balidiscount.notion.site", "www.notion.so", "notion.so"].includes(u.hostname.toLowerCase()) && u.pathname.startsWith("/image/")) {
      return u.toString();
    }
  } catch {}
  return `${NOTION_ORIGIN}/image/${encodeURIComponent(source)}?table=block&id=${encodeURIComponent(normalizeId(blockId))}&cache=v2`;
}

function addCandidate(list, value) {
  if (!value || typeof value !== "string") return;
  const v = value.trim();
  if (!v || list.includes(v)) return;
  if (v.startsWith("attachment:")) return;
  try {
    const u = new URL(v, NOTION_ORIGIN);
    if (u.protocol === "http:" || u.protocol === "https:") list.push(u.toString());
  } catch {}
}

function renderRichText(runs, cfg) {
  if (!Array.isArray(runs)) return "";

  return runs.map(run => {
    if (!Array.isArray(run) || !run.length) return "";

    let text = escapeHtml(String(run[0] ?? "")).replace(/\n/g, "<br>");
    let href = null;

    for (const decoration of run[1] || []) {
      if (!Array.isArray(decoration) || !decoration.length) continue;
      const code = decoration[0];

      if (code === "b") text = `<strong>${text}</strong>`;
      else if (code === "i") text = `<em>${text}</em>`;
      else if (code === "s") text = `<s>${text}</s>`;
      else if (code === "c") text = `<code>${text}</code>`;
      else if (code === "_") text = `<u>${text}</u>`;
      else if (code === "h" && decoration[1]) text = `<span class="${colorClassName(decoration[1])}">${text}</span>`;
      else if (code === "a" && decoration[1]) href = localizeHref(String(decoration[1]), cfg);
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

function documentHtml({ title, content, cfg, isRoot, root, pageId }) {
  const back = isRoot ? "" : `<a class="back" href="${cfg.prefix}/">← ${escapeHtml(cfg.back)}</a>`;
  const cover = pageAssetMarkup(root.format?.page_cover, cfg, pageId, root.id || pageId, "cover");
  const icon = pageIconMarkup(root.format?.page_icon, cfg, pageId, root.id || pageId);

  return `<!doctype html>
<html lang="${cfg.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#ffffff">
<title>${escapeHtml(title)} — Bali Discount</title>
<style>${PAGE_CSS}</style>
</head>
<body>
${cover}
<main class="page${cover ? " has-cover" : ""}">
${back}
${icon}
<h1>${escapeHtml(title)}</h1>
<div class="content">${content}</div>
</main>
${contactHtml(cfg)}
</body>
</html>`;
}

function pageAssetMarkup(value, cfg, pageId, blockId, cls) {
  if (!value || !looksLikeAsset(String(value))) return "";
  const src = assetUrl(cfg, pageId, blockId, String(value), "image", "");
  return `<div class="${cls}"><img src="${escapeAttr(src)}" alt=""></div>`;
}

function pageIconMarkup(value, cfg, pageId, blockId) {
  if (!value) return "";
  const icon = String(value);
  if (!looksLikeAsset(icon)) return `<div class="page-icon emoji-page">${escapeHtml(icon)}</div>`;
  const src = assetUrl(cfg, pageId, blockId, icon, "image", "");
  return `<div class="page-icon"><img src="${escapeAttr(src)}" alt=""></div>`;
}

function looksLikeAsset(value) {
  const v = String(value || "");
  return v.startsWith("/") || v.startsWith("http://") || v.startsWith("https://") || v.startsWith("attachment:");
}

function colorClassName(value) {
  const raw = String(value || "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!raw || raw === "default") return "";
  const known = new Set([
    "gray","brown","orange","yellow","green","blue","purple","pink","red",
    "gray_background","brown_background","orange_background","yellow_background",
    "green_background","blue_background","purple_background","pink_background","red_background"
  ]);
  return known.has(raw) ? `notion-${raw}` : "";
}

function contactHtml(cfg) {
  const svg = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16.04 3C9.43 3 4.05 8.35 4.05 14.93c0 2.11.56 4.17 1.62 5.97L3.95 27l6.27-1.64a12 12 0 0 0 5.82 1.48h.01c6.61 0 11.99-5.35 11.99-11.93C28.04 8.35 22.66 3 16.04 3Zm0 21.83h-.01a9.98 9.98 0 0 1-5.09-1.39l-.37-.22-3.72.97.99-3.61-.24-.37a9.88 9.88 0 0 1-1.52-5.28c0-5.47 4.47-9.92 9.97-9.92 5.49 0 9.96 4.45 9.96 9.92 0 5.47-4.47 9.9-9.97 9.9Zm5.47-7.42c-.3-.15-1.77-.87-2.04-.97-.28-.1-.48-.15-.68.15-.2.3-.78.97-.95 1.17-.18.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.76-1.66-2.06-.18-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.68-1.64-.93-2.24-.25-.59-.5-.51-.68-.52h-.58c-.2 0-.53.07-.8.37-.28.3-1.05 1.02-1.05 2.49s1.08 2.89 1.23 3.09c.15.2 2.12 3.22 5.14 4.52.72.31 1.28.49 1.72.63.72.23 1.38.2 1.9.12.58-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.18-1.42-.08-.13-.28-.2-.58-.35Z"/></svg>`;

  if (cfg.lang === "en") {
    return `<a class="wa" href="${cfg.whatsapp}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp">${svg}</a>`;
  }

  return `<details class="contact"><summary aria-label="Открыть мессенджеры">${svg}</summary><nav><a href="https://vk.me/balidiscount" target="_blank" rel="noopener noreferrer">ВКонтакте</a><a href="https://max.ru/u/f9LHodD0cOIwcXL9W58ncPrSABr9BRXv84mIqJ3Z3P4qoTFYvTXRCCPWvIg" target="_blank" rel="noopener noreferrer">MAX</a><a href="https://t.me/bali_discount" target="_blank" rel="noopener noreferrer">Telegram</a><a href="${cfg.whatsapp}" target="_blank" rel="noopener noreferrer">WhatsApp</a></nav></details>`;
}

function emergencyPage(cfg) {
  const title = cfg.unavailable;
  const home = `${cfg.prefix}/`;
  const body = cfg.lang === "ru"
    ? "Notion сейчас временно не отвечает. Напишите нам — мы сразу пришлём список и поможем выбрать экскурсию."
    : "Notion is temporarily unavailable. Message us and we’ll send the tour list and help you choose a tour right away.";

  const html = `<!doctype html><html lang="${cfg.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${PAGE_CSS}</style></head><body><main class="page emergency"><a class="back" href="${home}">← ${escapeHtml(cfg.back)}</a><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p><a class="emergency-cta" href="${cfg.whatsapp}" target="_blank" rel="noopener noreferrer">WhatsApp</a></main>${contactHtml(cfg)}</body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store",
      "x-bali-renderer": "emergency-fallback",
    },
  });
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

function stripDashes(id) {
  return String(id || "").replace(/-/g, "").toLowerCase();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function headOnly(response) {
  return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
}

function mark(response, value) {
  const out = new Response(response.body, response);
  out.headers.set("x-bali-cache", value);
  return out;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[ch]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

const PAGE_CSS = `
:root{color-scheme:light;--text:#272727;--muted:#787774;--line:#e9e9e7;--soft:#f7f7f5;--green:#25D366}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:#fff;color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:#2f6597}
.cover{width:100%;height:min(30vw,280px);min-height:160px;overflow:hidden;background:#eee}.cover img{width:100%;height:100%;object-fit:cover;display:block}
.page{width:min(100%,980px);margin:0 auto;padding:38px 54px 120px}.page.has-cover{padding-top:0}
.back{display:inline-block;margin:8px 0 22px;color:#676767;text-decoration:none;font-size:15px}
.page-icon{width:78px;height:78px;margin:18px 0 10px;border-radius:12px;overflow:hidden;display:grid;place-items:center}.page-icon img{max-width:100%;max-height:100%;display:block;object-fit:contain}.emoji-page{font-size:62px;line-height:1;overflow:visible}
.page h1{font-size:clamp(34px,5.8vw,48px);line-height:1.12;letter-spacing:-.026em;margin:0 0 28px;font-weight:730}
.content{font-size:16.5px;line-height:1.62}.content h2{font-size:27px;line-height:1.24;margin:31px 0 10px}.content h3{font-size:22px;line-height:1.3;margin:27px 0 9px}.content h4{font-size:19px;line-height:1.35;margin:23px 0 8px}.content h5{font-size:17px;line-height:1.4;margin:20px 0 7px}
.text{margin:6px 0;padding:1px 3px;border-radius:4px}.text:empty{min-height:8px}
.columns{display:flex;gap:38px;margin:10px 0;align-items:flex-start}.column{min-width:0;flex:var(--ratio,1) 1 0}
.subpage{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 11px;margin:4px -11px;border-radius:8px;color:#202020;text-decoration:none;font-weight:500}.subpage:hover{background:var(--soft)}.subpage-main{display:flex;align-items:center;gap:8px;min-width:0}.chev{color:#aaa;font-size:23px;line-height:1}.inline-icon{width:22px;height:22px;object-fit:contain;border-radius:4px}.emoji{font-size:20px}
.list{display:grid;grid-template-columns:25px 1fr;gap:5px;margin:4px 0;padding:1px 3px;border-radius:4px}.marker{color:#666;text-align:right;padding-right:3px}.check{width:17px;height:17px;border:1px solid #aaa;border-radius:3px;display:grid;place-items:center;font-size:12px;margin-top:4px}
blockquote{margin:15px 0;padding:3px 0 3px 16px;border-left:3px solid #37352f}
.callout{display:grid;grid-template-columns:28px 1fr;gap:10px;margin:14px 0;padding:14px 16px;background:var(--soft);border-radius:5px}.callout-icon{font-size:20px;line-height:1.45}.callout .inline-icon{width:22px;height:22px}
.toggle{margin:7px 0;padding:2px 3px;border-radius:4px}.toggle summary{cursor:pointer;font-weight:600}.toggle-body{padding:5px 0 2px 20px}
hr{border:0;border-top:1px solid var(--line);margin:24px 0}
.media{margin:22px auto;max-width:100%}.media img,.media video{display:block;width:100%;height:auto;max-height:78vh;object-fit:contain;border-radius:5px;background:#f4f4f2}.media video{background:#111}figcaption{font-size:13px;color:var(--muted);margin-top:6px}
pre{overflow:auto;padding:16px;background:#f4f4f2;border-radius:5px;font-size:13px;line-height:1.5}.code-figure{margin:16px 0}
.embed{display:block;margin:12px 0;padding:13px 14px;border:1px solid var(--line);border-radius:5px;text-decoration:none;color:#333}
.bookmark{display:grid;grid-template-columns:minmax(0,1fr) 180px;min-height:108px;border:1px solid var(--line);border-radius:5px;overflow:hidden;text-decoration:none;color:#333;margin:14px 0}.bookmark-copy{padding:14px;display:flex;flex-direction:column;gap:5px}.bookmark-copy span{font-size:14px;color:#555}.bookmark-copy small{margin-top:auto;color:#888}.bookmark>img{width:100%;height:100%;object-fit:cover}.bookmark>.bookmark-icon{width:48px;height:48px;object-fit:contain;margin:auto}
.table-wrap{overflow:auto;margin:12px 0;border:1px solid var(--line);border-bottom:0}.table-row{display:flex;min-width:520px;border-bottom:1px solid var(--line)}.cell{flex:1;padding:8px;border-right:1px solid var(--line)}.cell:last-child{border-right:0}
strong{font-weight:700}code{background:rgba(135,131,120,.15);border-radius:3px;padding:.15em .3em;font-size:.88em}
.notion-gray{color:#787774}.notion-brown{color:#9f6b53}.notion-orange{color:#d9730d}.notion-yellow{color:#cb912f}.notion-green{color:#448361}.notion-blue{color:#337ea9}.notion-purple{color:#9065b0}.notion-pink{color:#c14c8a}.notion-red{color:#d44c47}
.notion-gray_background{background:#f1f1ef}.notion-brown_background{background:#f4eeee}.notion-orange_background{background:#fbecdd}.notion-yellow_background{background:#fbf3db}.notion-green_background{background:#edf3ec}.notion-blue_background{background:#e7f3f8}.notion-purple_background{background:#f4f0f7}.notion-pink_background{background:#f9eef3}.notion-red_background{background:#fdebec}
.wa,.contact{position:fixed;right:max(18px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));z-index:2147483646}.wa,.contact summary{width:58px;height:58px;border-radius:50%;background:var(--green);color:#fff;display:grid;place-items:center;box-shadow:0 14px 34px rgba(0,0,0,.25);text-decoration:none}.wa svg,.contact summary svg{display:block;width:39px;height:39px;fill:currentColor}.contact summary{list-style:none;cursor:pointer}.contact summary::-webkit-details-marker{display:none}.contact nav{position:absolute;right:0;bottom:70px;width:220px;padding:8px;background:#fff;border:1px solid var(--line);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.18)}.contact nav a{display:block;padding:11px 12px;border-radius:10px;color:#222;text-decoration:none;font-weight:600}.contact nav a:hover{background:var(--soft)}
.emergency{padding-top:70px}.emergency p{font-size:18px;line-height:1.6;color:#555}.emergency-cta{display:inline-block;margin-top:12px;padding:13px 18px;border-radius:999px;background:var(--green);color:#fff;text-decoration:none;font-weight:700}
@media(max-width:700px){.cover{height:190px}.page{padding:28px 18px 105px}.page.has-cover{padding-top:0}.page-icon{margin-top:15px}.columns{display:block}.column{width:100%}.content{font-size:16px}.content h2{font-size:24px}.bookmark{grid-template-columns:1fr}.bookmark>img{height:160px}.subpage{padding:11px 10px;margin:4px -10px}.media{margin:18px 0}}
`;
