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

      const whatsappSvg = '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" style="display:block;width:66%;height:66%;fill:currentColor"><path d="M16.04 3C9.43 3 4.05 8.35 4.05 14.93c0 2.11.56 4.17 1.62 5.97L3.95 27l6.27-1.64a12 12 0 0 0 5.82 1.48h.01c6.61 0 11.99-5.35 11.99-11.93C28.04 8.35 22.66 3 16.04 3Zm0 21.83h-.01a9.98 9.98 0 0 1-5.09-1.39l-.37-.22-3.72.97.99-3.61-.24-.37a9.88 9.88 0 0 1-1.52-5.28c0-5.47 4.47-9.92 9.97-9.92 5.49 0 9.96 4.45 9.96 9.92 0 5.47-4.47 9.9-9.97 9.9Zm5.47-7.42c-.3-.15-1.77-.87-2.04-.97-.28-.1-.48-.15-.68.15-.2.3-.78.97-.95 1.17-.18.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.76-1.66-2.06-.18-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.68-1.64-.93-2.24-.25-.59-.5-.51-.68-.52h-.58c-.2 0-.53.07-.8.37-.28.3-1.05 1.02-1.05 2.49s1.08 2.89 1.23 3.09c.15.2 2.12 3.22 5.14 4.52.72.31 1.28.49 1.72.63.72.23 1.38.2 1.9.12.58-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.18-1.42-.08-.13-.28-.2-.58-.35Z"/></svg>';

      const applyWhatsappIcons = () => {
        const menuIcon = document.querySelector('.bali-wa');
        if (menuIcon && !menuIcon.querySelector('svg')) {
          menuIcon.innerHTML = whatsappSvg;
          menuIcon.style.color = '#fff';
        }
        const floatingIcon = document.querySelector('#bali-contact-toggle .bali-open');
        if (floatingIcon && !floatingIcon.querySelector('svg')) {
          floatingIcon.innerHTML = whatsappSvg;
          floatingIcon.style.display = 'grid';
          floatingIcon.style.placeItems = 'center';
          floatingIcon.style.width = '100%';
          floatingIcon.style.height = '100%';
          floatingIcon.style.color = '#fff';
        }
      };

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
        applyWhatsappIcons();
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
