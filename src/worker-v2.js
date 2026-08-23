import notionProxy from "./worker.js";

const ROOT_PAGE_ID = "9d9cc7b88191428a86afbaff8b85931d";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Notion's client-side router derives the page ID from window.location.
    // Keep /ru/ as the public entry point, but redirect internally to a URL
    // that still lives on our domain and contains the Notion page ID.
    if (url.pathname === "/ru" || url.pathname === "/ru/") {
      const target = new URL(`/ru/${ROOT_PAGE_ID}`, url.origin);
      target.search = url.search;
      return Response.redirect(target.toString(), 302);
    }

    return notionProxy.fetch(request, env, ctx);
  },
};
