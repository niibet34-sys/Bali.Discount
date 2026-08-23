import { initializeNooxy } from "nooxy";

const SITE_CONFIG = {
  domain: "bali-discount.niibet34.workers.dev",
  notionDomain: "balidiscount.notion.site",
  siteName: "Bali Discount",
  slugToPage: {
    "/en": "3c13152813a381c0a3b4c6dd8adff293",
    "/ru": "9d9cc7b88191428a86afbaff8b85931d",
  },
  seo: {
    indexing: false,
    brandReplacement: "Bali Discount",
  },
  nooxy: {
    showBadge: false,
  },
  customHeadCSS: `
    .notion-topbar,
    .notion-topbar-mobile,
    [class*="notion-topbar"],
    [class*="notion-navbar"] {
      display: none !important;
    }
    html, body {
      overflow-x: hidden !important;
    }
  `,
};

const proxy = initializeNooxy({ configKey: "bali-discount-workers-preview", config: SITE_CONFIG });

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "") {
      return Response.redirect(`${url.origin}/en`, 302);
    }

    const response = await proxy(request);
    const headers = new Headers(response.headers);
    headers.set("x-bali-proxy", "nooxy-2.0.0-preview");
    headers.set("cache-control", "no-store");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
