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

    const response = await notionProxy.fetch(request, env, ctx);
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html") || !response.body) return response;

    return new HTMLRewriter()
      .on("body", new NotionPromoCleaner())
      .transform(response);
  },
};

class NotionPromoCleaner {
  element(element) {
    element.append(`<script id="bali-hide-notion-promo">(()=>{
      const promotionalText = [
        'notion : notes, tâches, ia',
        'notion: notes, tasks, ai',
        'planifier & suivre des projets',
        'mettre à jour',
        'upgrade'
      ];

      const hidePromo = () => {
        const all = [...document.querySelectorAll('div,header,aside,a,button')];
        for (const node of all) {
          const text = (node.textContent || '').trim().toLowerCase();
          if (!text || text.length > 220) continue;
          if (!promotionalText.some(value => text.includes(value))) continue;

          let target = node;
          for (let i = 0; i < 7 && target?.parentElement; i++) {
            const style = getComputedStyle(target);
            const rect = target.getBoundingClientRect();
            if ((style.position === 'fixed' || style.position === 'sticky' || rect.top < 90) && rect.width > innerWidth * .65 && rect.height < 150) break;
            target = target.parentElement;
          }

          if (target && target !== document.body && target !== document.documentElement) {
            const rect = target.getBoundingClientRect();
            if (rect.top < 120 && rect.height < 180) target.style.setProperty('display','none','important');
          }
        }
        document.documentElement.style.setProperty('scroll-padding-top','0px');
        document.body.style.setProperty('padding-top','0px','important');
      };

      hidePromo();
      let queued = false;
      new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; hidePromo(); });
      }).observe(document.documentElement,{subtree:true,childList:true});
      setTimeout(hidePromo,500);
      setTimeout(hidePromo,1500);
    })();</script>`, { html: true });
  }
}
