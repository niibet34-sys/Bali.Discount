import englishProxy from "./worker-en.js";

const ROOT_PAGE_ID = "3c13152813a381c0a3b4c6dd8adff293";
const ROOT_NOTION_SLUG = "Private-Bali-Tours-at-Group-Tour-Prices-3c13152813a381c0a3b4c6dd8adff293";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Keep the browser URL ID-based so Notion's client router can reliably
    // derive the public page id on both workers.dev and bali.discount.
    if (url.pathname === "/en" || url.pathname === "/en/") {
      const target = new URL(`/en/${ROOT_PAGE_ID}`, url.origin);
      target.search = url.search;
      return Response.redirect(target.toString(), 302);
    }

    // The upstream public Notion page itself uses a slugged URL. Fetch that
    // internally while leaving window.location at /en/<page-id>.
    if (url.pathname === `/en/${ROOT_PAGE_ID}`) {
      const upstreamFacing = new URL(request.url);
      upstreamFacing.pathname = `/en/${ROOT_NOTION_SLUG}`;
      return englishProxy.fetch(new Request(upstreamFacing.toString(), request), env, ctx);
    }

    return englishProxy.fetch(request, env, ctx);
  },
};
