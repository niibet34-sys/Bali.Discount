import russianWorker from "./worker-ru-enstyle.js";

const WHATSAPP_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M16.04 3C9.43 3 4.05 8.35 4.05 14.93c0 2.11.56 4.17 1.62 5.97L3.95 27l6.27-1.64a12 12 0 0 0 5.82 1.48h.01c6.61 0 11.99-5.35 11.99-11.93C28.04 8.35 22.66 3 16.04 3Zm0 21.83h-.01a9.98 9.98 0 0 1-5.09-1.39l-.37-.22-3.72.97.99-3.61-.24-.37a9.88 9.88 0 0 1-1.52-5.28c0-5.47 4.47-9.92 9.97-9.92 5.49 0 9.96 4.45 9.96 9.92 0 5.47-4.47 9.9-9.97 9.9Zm5.47-7.42c-.3-.15-1.77-.87-2.04-.97-.28-.1-.48-.15-.68.15-.2.3-.78.97-.95 1.17-.18.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.76-1.66-2.06-.18-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.68-1.64-.93-2.24-.25-.59-.5-.51-.68-.52h-.58c-.2 0-.53.07-.8.37-.28.3-1.05 1.02-1.05 2.49s1.08 2.89 1.23 3.09c.15.2 2.12 3.22 5.14 4.52.72.31 1.28.49 1.72.63.72.23 1.38.2 1.9.12.58-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.18-1.42-.08-.13-.28-.2-.58-.35Z"/></svg>`;

export default {
  async fetch(request, env, ctx) {
    const response = await russianWorker.fetch(request, env, ctx);
    if (!response.body) return response;

    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (!type.includes("text/html")) return response;

    return new HTMLRewriter()
      .on("head", new WhatsAppIconStyles())
      .on(".bali-ru-wa img", new WhatsAppMenuIconRewriter())
      .transform(response);
  },
};

class WhatsAppIconStyles {
  element(element) {
    element.append(`<style id="bali-ru-floating-wa-fix">
#bali-ru-toggle .bali-ru-open{
  display:grid;
  place-items:center;
  width:100%;
  height:100%;
  line-height:0;
  color:#fff;
}
#bali-ru-toggle .bali-ru-open svg{
  display:block;
  width:68%;
  height:68%;
  fill:currentColor;
}
.bali-ru-wa svg{
  display:block;
  width:23px;
  height:23px;
  fill:#fff;
}
</style>`, { html: true });
  }
}

class WhatsAppMenuIconRewriter {
  element(element) {
    element.replace(WHATSAPP_SVG, { html: true });
  }
}
