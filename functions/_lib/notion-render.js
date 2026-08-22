const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";
const DEFAULT_ROOT_PAGE = "9d9cc7b88191428a86afbaff8b85931d";
const DEFAULT_CACHE_SECONDS = 300;

export async function handleRuRequest(context, pathParts = []) {
  const parts = Array.isArray(pathParts) ? pathParts : pathParts ? [pathParts] : [];
  const rootPageId = normalizeId(context.env.NOTION_RU_ROOT_PAGE_ID || DEFAULT_ROOT_PAGE);
  const pageId = parts[0] === "p" && parts[1] ? normalizeId(parts[1]) : rootPageId;

  if (!context.env.NOTION_TOKEN) {
    return htmlResponse(errorPage("Notion ещё не подключён", "Добавьте секрет NOTION_TOKEN в настройках Cloudflare Pages → Settings → Variables and Secrets."), 503, 30);
  }

  const cacheSeconds = positiveInt(context.env.NOTION_CACHE_SECONDS, DEFAULT_CACHE_SECONDS);
  const cacheKey = new Request(new URL(context.request.url).origin + new URL(context.request.url).pathname + "?render=v1", { method: "GET" });

  try {
    const cached = await caches.default.match(cacheKey);
    if (cached) return cached;
  } catch (_) {}

  try {
    const [page, blocks] = await Promise.all([
      notionGet(context.env.NOTION_TOKEN, `/pages/${pageId}`),
      getAllChildren(context.env.NOTION_TOKEN, pageId),
    ]);

    const title = extractPageTitle(page) || (pageId === rootPageId ? "Экскурсии на Бали" : "Bali Discount");
    const content = await renderBlocks(context.env.NOTION_TOKEN, blocks, 0);
    const html = pageShell({ title, content, isRoot: pageId === rootPageId });
    const response = htmlResponse(html, 200, cacheSeconds);

    try {
      context.waitUntil(caches.default.put(cacheKey, response.clone()));
    } catch (_) {}
    return response;
  } catch (error) {
    console.error("Notion render error", error);
    const status = error?.status && Number.isInteger(error.status) ? error.status : 502;
    return htmlResponse(errorPage("Не удалось загрузить экскурсии", "Попробуйте обновить страницу через несколько секунд. Если ошибка повторится, проверьте доступ интеграции Notion к исходной странице."), status, 20);
  }
}

async function notionGet(token, path) {
  const response = await fetch(`${NOTION_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
  });

  if (response.status === 429) {
    const wait = Math.min(Number(response.headers.get("Retry-After") || 1), 2);
    await new Promise(resolve => setTimeout(resolve, wait * 1000));
    return notionGet(token, path);
  }

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Notion API ${response.status}: ${body.slice(0, 240)}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function getAllChildren(token, blockId) {
  const out = [];
  let cursor = null;
  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (cursor) params.set("start_cursor", cursor);
    const data = await notionGet(token, `/blocks/${normalizeId(blockId)}/children?${params}`);
    out.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return out;
}

async function renderBlocks(token, blocks, depth) {
  if (depth > 8) return "";
  const rendered = [];

  for (const block of blocks) {
    let children = "";
    if (block.has_children && !["child_page", "child_database"].includes(block.type)) {
      const childBlocks = await getAllChildren(token, block.id);
      children = await renderBlocks(token, childBlocks, depth + 1);
    }
    rendered.push(renderBlock(block, children));
  }
  return rendered.join("");
}

function renderBlock(block, children) {
  const type = block.type;
  const data = block[type] || {};

  if (type === "paragraph") return `<p class="n-paragraph">${richText(data.rich_text)}</p>${children}`;
  if (type === "heading_1") return `<h2 class="n-h1">${richText(data.rich_text)}</h2>${children}`;
  if (type === "heading_2") return `<h2 class="n-h2">${richText(data.rich_text)}</h2>${children}`;
  if (type === "heading_3") return `<h3 class="n-h3">${richText(data.rich_text)}</h3>${children}`;
  if (type === "quote") return `<blockquote>${richText(data.rich_text)}${children}</blockquote>`;
  if (type === "callout") return `<div class="callout"><span>${renderIcon(data.icon)}</span><div>${richText(data.rich_text)}${children}</div></div>`;
  if (type === "divider") return `<hr>`;
  if (type === "bulleted_list_item") return `<div class="list-item"><span>•</span><div>${richText(data.rich_text)}${children}</div></div>`;
  if (type === "numbered_list_item") return `<div class="list-item numbered"><span>›</span><div>${richText(data.rich_text)}${children}</div></div>`;
  if (type === "to_do") return `<div class="todo"><span>${data.checked ? "✓" : "○"}</span><div>${richText(data.rich_text)}${children}</div></div>`;
  if (type === "toggle") return `<details><summary>${richText(data.rich_text)}</summary>${children}</details>`;
  if (type === "code") return `<pre><code>${escapeHtml(plainText(data.rich_text))}</code></pre>`;
  if (type === "column_list") return `<div class="columns">${children}</div>`;
  if (type === "column") return `<div class="column">${children}</div>`;

  if (type === "child_page") {
    const id = normalizeId(block.id);
    return `<a class="tour-card" href="/ru/p/${id}"><span>${escapeHtml(data.title || "Экскурсия")}</span><span class="arrow">→</span></a>`;
  }

  if (type === "link_to_page" && data.type === "page_id") {
    return `<a class="tour-card" href="/ru/p/${normalizeId(data.page_id)}"><span>Открыть страницу</span><span class="arrow">→</span></a>`;
  }

  if (type === "image") {
    const src = data.type === "external" ? data.external?.url : data.file?.url;
    if (!src) return children;
    const caption = richText(data.caption || []);
    return `<figure><img src="${escapeAttr(src)}" alt="${escapeAttr(plainText(data.caption || []))}" loading="lazy" decoding="async">${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>${children}`;
  }

  if (type === "bookmark") {
    const url = data.url || "#";
    return `<a class="bookmark" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>${children}`;
  }

  if (type === "embed" || type === "video" || type === "file" || type === "pdf") {
    const url = data.url || data.external?.url || data.file?.url;
    return url ? `<a class="bookmark" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">Открыть материал →</a>${children}` : children;
  }

  return children;
}

function pageShell({ title, content, isRoot }) {
  const safeTitle = escapeHtml(title);
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#fbfaf7">
<meta name="description" content="Индивидуальные экскурсии на Бали — Bali Discount">
<title>${safeTitle} — Bali Discount</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Prata&display=swap" rel="stylesheet">
<style>${pageCss()}</style>
</head>
<body>
<main class="wrap">
<header class="topbar">
<a class="brand" href="/"><img class="logo" src="/assets/bali-discount-logo.webp" alt="Bali Discount"><span>Bali Discount</span></a>
<a class="back" href="${isRoot ? "/" : "/ru/"}">${isRoot ? "← На главную" : "← Все экскурсии"}</a>
</header>
<article class="notion-content">
<h1>${safeTitle}</h1>
${content}
</article>
</main>
${contactMenu()}
<script>${contactScript()}</script>
</body>
</html>`;
}

function errorPage(title, text) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — Bali Discount</title><style>body{font-family:system-ui;background:#fbfaf7;color:#171715;margin:0}.e{max-width:620px;margin:12vh auto;padding:24px;text-align:center}.e a{color:#d97706}</style></head><body><div class="e"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p><p><a href="/">На главную</a></p></div></body></html>`;
}

function pageCss() {
  return `:root{--orange:#ff8a00;--ink:#171715;--muted:#77756f;--paper:#fbfaf7;--card:#fff;--line:#ece8e0;--shadow:0 18px 55px rgba(30,25,15,.12)}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:Manrope,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}a{color:inherit}.wrap{width:min(100%,900px);margin:0 auto;padding:22px 18px 120px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:34px}.brand{display:flex;align-items:center;gap:10px;text-decoration:none;font-size:.9rem;font-weight:700}.logo{width:50px;height:50px;object-fit:cover;border-radius:50%;clip-path:circle(49% at 50% 50%);box-shadow:0 8px 22px rgba(0,0,0,.11)}.back{text-decoration:none;font-size:.8rem;color:#696762;border:1px solid var(--line);border-radius:999px;padding:9px 12px;background:rgba(255,255,255,.78)}.notion-content{max-width:820px;margin:0 auto}.notion-content>h1{font-family:Prata,Georgia,serif;font-size:clamp(2.15rem,8vw,4rem);line-height:1.05;letter-spacing:-.035em;font-weight:400;margin:0 0 24px}.n-h1,.n-h2{font-family:Prata,Georgia,serif;font-weight:400;line-height:1.15;margin:34px 0 14px}.n-h1{font-size:1.75rem}.n-h2{font-size:1.5rem}.n-h3{font-size:1.08rem;margin:26px 0 10px}.n-paragraph{font-size:.98rem;line-height:1.68;margin:9px 0;color:#33322f}.n-paragraph:empty{display:none}.n-paragraph a,.callout a{color:#b85f00;text-underline-offset:3px}.columns{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start;margin-top:12px}.column{min-width:0}.tour-card{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;min-height:62px;padding:14px 15px;margin:9px 0;border:1px solid var(--line);border-radius:18px;background:var(--card);text-decoration:none;box-shadow:0 3px 16px rgba(30,25,15,.035);transition:.16s ease}.tour-card:hover{transform:translateY(-1px);border-color:#e7d8c5;box-shadow:0 9px 25px rgba(30,25,15,.07)}.tour-card span:first-child{font-size:.93rem;font-weight:600;line-height:1.4}.arrow{color:var(--orange);font-size:1.2rem}.callout{display:flex;gap:10px;padding:15px 16px;margin:14px 0;border-radius:16px;background:#fff5e8;border:1px solid #f3dfc5}.list-item,.todo{display:flex;gap:10px;margin:8px 0;line-height:1.6}.list-item>span,.todo>span{color:var(--orange);font-weight:700}.numbered>span{font-size:1.2rem}blockquote{margin:18px 0;padding:2px 0 2px 16px;border-left:3px solid var(--orange);color:#4b4944;line-height:1.65}hr{border:0;border-top:1px solid var(--line);margin:26px 0}figure{margin:20px 0}figure img{display:block;width:100%;height:auto;border-radius:18px}figcaption{font-size:.78rem;color:var(--muted);margin-top:8px}details{margin:10px 0;padding:12px 14px;background:#fff;border:1px solid var(--line);border-radius:14px}summary{cursor:pointer;font-weight:600}pre{overflow:auto;padding:14px;border-radius:14px;background:#161616;color:#f7f7f7}.bookmark{display:block;margin:12px 0;padding:13px 15px;background:#fff;border:1px solid var(--line);border-radius:14px;overflow-wrap:anywhere}.contact-wrap{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:50;display:flex;flex-direction:column;align-items:flex-end;gap:11px}.contact-menu{width:230px;padding:9px;border-radius:22px;background:rgba(255,255,255,.97);border:1px solid rgba(15,23,42,.08);box-shadow:var(--shadow);backdrop-filter:blur(18px);opacity:0;transform:translateY(12px) scale(.97);pointer-events:none;transition:.18s ease}.contact-wrap.open .contact-menu{opacity:1;transform:none;pointer-events:auto}.contact-item{width:100%;height:52px;border:0;background:transparent;border-radius:15px;padding:0 10px;display:flex;align-items:center;gap:12px;font:600 15px Manrope;color:#111827;text-align:left}.contact-item:hover{background:#f6f7f8}.contact-item+.contact-item{margin-top:3px}.icon{width:36px;height:36px;border-radius:12px;display:grid;place-items:center;color:#fff;font-weight:800}.vk{background:#2787f5;font-size:13px}.max{background:linear-gradient(145deg,#2a7df5,#7655ff)}.tg{background:#229ed9}.wa{background:#25d366}.fab{width:58px;height:58px;border:0;border-radius:50%;background:#25d366;color:#fff;display:grid;place-items:center;box-shadow:0 14px 34px rgba(0,0,0,.24);font-size:27px}.fab .x{display:none}.contact-wrap.open .fab .w{display:none}.contact-wrap.open .fab .x{display:block}@media(max-width:680px){.wrap{padding:18px 14px 108px}.columns{grid-template-columns:1fr;gap:0}.topbar{margin-bottom:28px}.brand span{display:none}.notion-content>h1{font-size:2.3rem}.n-h1{font-size:1.55rem}.n-h2{font-size:1.38rem}}@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}`;
}

function contactMenu() {
  return `<div class="contact-wrap" id="contactWrap"><div class="contact-menu" id="contactMenu" aria-hidden="true"><button class="contact-item" type="button"><span class="icon vk">VK</span><span>ВКонтакте</span></button><button class="contact-item" type="button"><span class="icon max">M</span><span>MAX</span></button><button class="contact-item" type="button"><span class="icon tg">✈</span><span>Telegram</span></button><button class="contact-item" type="button"><span class="icon wa">☎</span><span>WhatsApp</span></button></div><button class="fab" id="contactToggle" type="button" aria-label="Открыть мессенджеры" aria-expanded="false"><span class="w">☎</span><span class="x">×</span></button></div>`;
}

function contactScript() {
  return `const w=document.getElementById('contactWrap'),t=document.getElementById('contactToggle'),m=document.getElementById('contactMenu');function o(v){w.classList.toggle('open',v);t.setAttribute('aria-expanded',String(v));m.setAttribute('aria-hidden',String(!v))}t.addEventListener('click',e=>{e.stopPropagation();o(!w.classList.contains('open'))});m.addEventListener('click',e=>e.stopPropagation());document.addEventListener('click',()=>o(false));document.addEventListener('keydown',e=>{if(e.key==='Escape')o(false)});`;
}

function richText(items = []) {
  return items.map(item => {
    const text = escapeHtml(item.plain_text || item.text?.content || "");
    let value = text;
    const a = item.annotations || {};
    if (a.code) value = `<code>${value}</code>`;
    if (a.bold) value = `<strong>${value}</strong>`;
    if (a.italic) value = `<em>${value}</em>`;
    if (a.strikethrough) value = `<s>${value}</s>`;
    if (a.underline) value = `<u>${value}</u>`;
    const href = item.href || item.text?.link?.url;
    if (href) value = `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${value}</a>`;
    return value;
  }).join("");
}

function plainText(items = []) { return items.map(item => item.plain_text || item.text?.content || "").join(""); }
function renderIcon(icon) { return icon?.type === "emoji" ? escapeHtml(icon.emoji) : "✦"; }
function extractPageTitle(page) {
  for (const property of Object.values(page.properties || {})) {
    if (property?.type === "title") return plainText(property.title || []);
  }
  return "";
}
function normalizeId(id = "") { return String(id).replace(/-/g, "").toLowerCase(); }
function positiveInt(value, fallback) { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback; }
function htmlResponse(html, status, cacheSeconds) { return new Response(html, { status, headers: { "content-type": "text/html; charset=UTF-8", "cache-control": `public, max-age=60, s-maxage=${cacheSeconds}`, "x-content-type-options": "nosniff" } }); }
function escapeHtml(value = "") { return String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch])); }
function escapeAttr(value = "") { return escapeHtml(value); }
