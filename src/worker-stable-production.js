import stableRenderer from "./worker-stable-renderer-v2.js";

const ROUTES = {
  ru: {
    livePrefix: "/ru",
    stablePrefix: "/stable/ru",
    rootId: "9d9cc7b88191428a86afbaff8b85931d",
  },
  en: {
    livePrefix: "/en",
    stablePrefix: "/stable/en",
    rootId: "3c13152813a381c0a3b4c6dd8adff293",
  },
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const route = getRoute(url.pathname);
    if (!route) return new Response("Not found", { status: 404 });

    const upstreamUrl = new URL(url.toString());
    const suffix = url.pathname.slice(route.livePrefix.length);

    // Render the root page directly so /ru and /en remain the public URLs.
    if (!suffix || suffix === "/") {
      upstreamUrl.pathname = `${route.stablePrefix}/${route.rootId}`;
    } else {
      upstreamUrl.pathname = `${route.stablePrefix}${suffix}`;
    }

    const upstreamRequest = new Request(upstreamUrl.toString(), request);
    const response = await stableRenderer.fetch(upstreamRequest, env, ctx);
    return localizeResponse(response, route);
  },
};

function getRoute(pathname) {
  for (const route of Object.values(ROUTES)) {
    if (pathname === route.livePrefix || pathname.startsWith(`${route.livePrefix}/`)) {
      return route;
    }
  }
  return null;
}

async function localizeResponse(response, route) {
  const headers = new Headers(response.headers);
  const location = headers.get("location");
  if (location) headers.set("location", replacePrefix(location, route));

  headers.set("x-bali-production-renderer", "stable-ssr-v2");

  const type = (headers.get("content-type") || "").toLowerCase();
  if (!type.includes("text/html")) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const html = await response.text();
  headers.delete("content-length");

  return new Response(replacePrefix(html, route), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function replacePrefix(value, route) {
  return String(value).split(route.stablePrefix).join(route.livePrefix);
}
