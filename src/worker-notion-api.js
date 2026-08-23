const NOTION_ORIGIN = "https://balidiscount.notion.site";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const RU_ROOT = "/9d9cc7b88191428a86afbaff8b85931d";
const EN_ROOT = "/Private-Bali-Tours-at-Group-Tour-Prices-3c13152813a381c0a3b4c6dd8adff293";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export default {
  async fetch(request) {
    const localUrl = new URL(request.url);
    if (!localUrl.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

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

    const remoteUrl = new URL(`${localUrl.pathname}${localUrl.search}`, NOTION_ORIGIN);
    const headers = new Headers();
    headers.set("content-type", request.headers.get("content-type") || "application/json;charset=UTF-8");
    headers.set("accept", request.headers.get("accept") || "*/*");
    headers.set("user-agent", BROWSER_UA);
    headers.set("origin", NOTION_ORIGIN);
    headers.set("referer", notionReferer(request));

    const hasBody = !remoteUrl.pathname.startsWith("/api/v3/getPublicPageData") && !new Set(["GET", "HEAD"]).has(request.method);
    const body = hasBody ? await request.arrayBuffer() : undefined;
    const method = request.method === "GET" ? "GET" : request.method === "HEAD" ? "HEAD" : "POST";

    let upstream;
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        upstream = await fetch(remoteUrl.toString(), {
          method,
          headers,
          body,
          redirect: "manual",
        });
        if (!RETRYABLE.has(upstream.status) || attempt === 1) break;
      } catch (error) {
        lastError = error;
        if (attempt === 1) throw error;
      }
      await sleep(120);
    }

    if (!upstream) throw lastError || new Error("Notion API request failed");

    const outHeaders = sanitizeHeaders(upstream.headers);
    outHeaders.set("access-control-allow-origin", "*");
    outHeaders.set("cache-control", "no-store");
    outHeaders.set("x-bali-content-source", "notion-api-shared");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeaders,
    });
  },
};

function notionReferer(request) {
  const referer = request.headers.get("referer") || "";
  try {
    const ref = new URL(referer);
    if (ref.pathname === "/en" || ref.pathname.startsWith("/en/")) return `${NOTION_ORIGIN}${EN_ROOT}`;
    if (ref.pathname === "/ru" || ref.pathname.startsWith("/ru/")) return `${NOTION_ORIGIN}${RU_ROOT}`;
  } catch {}
  return `${NOTION_ORIGIN}/`;
}

function sanitizeHeaders(input) {
  const headers = new Headers(input);
  for (const name of ["x-frame-options", "content-security-policy", "content-security-policy-report-only", "set-cookie", "report-to", "nel"]) {
    headers.delete(name);
  }
  return headers;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
