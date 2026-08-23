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
    #bali-nooxy-wa {
      position: fixed;
      right: max(18px, env(safe-area-inset-right));
      bottom: max(18px, env(safe-area-inset-bottom));
      width: 58px;
      height: 58px;
      border-radius: 50%;
      background: #25D366;
      color: #fff;
      display: grid;
      place-items: center;
      z-index: 2147483646;
      box-shadow: 0 14px 34px rgba(0,0,0,.25);
      text-decoration: none;
      line-height: 0;
    }
    #bali-nooxy-wa svg {
      display: block;
      width: 39px;
      height: 39px;
      fill: currentColor;
    }
  `,
  customBodyJS: `
    (() => {
      const ID = 'bali-nooxy-wa';
      const SVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16.04 3C9.43 3 4.05 8.35 4.05 14.93c0 2.11.56 4.17 1.62 5.97L3.95 27l6.27-1.64a12 12 0 0 0 5.82 1.48h.01c6.61 0 11.99-5.35 11.99-11.93C28.04 8.35 22.66 3 16.04 3Zm0 21.83h-.01a9.98 9.98 0 0 1-5.09-1.39l-.37-.22-3.72.97.99-3.61-.24-.37a9.88 9.88 0 0 1-1.52-5.28c0-5.47 4.47-9.92 9.97-9.92 5.49 0 9.96 4.45 9.96 9.92 0 5.47-4.47 9.9-9.97 9.9Zm5.47-7.42c-.3-.15-1.77-.87-2.04-.97-.28-.1-.48-.15-.68.15-.2.3-.78.97-.95 1.17-.18.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.76-1.66-2.06-.18-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.68-1.64-.93-2.24-.25-.59-.5-.51-.68-.52h-.58c-.2 0-.53.07-.8.37-.28.3-1.05 1.02-1.05 2.49s1.08 2.89 1.23 3.09c.15.2 2.12 3.22 5.14 4.52.72.31 1.28.49 1.72.63.72.23 1.38.2 1.9.12.58-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.18-1.42-.08-.13-.28-.2-.58-.35Z"/></svg>';

      function detectRu() {
        if (location.pathname === '/ru' || location.pathname.startsWith('/ru/')) return true;
        if (location.pathname === '/en' || location.pathname.startsWith('/en/')) return false;
        const sample = (document.body?.innerText || '').slice(0, 3000);
        return /[А-Яа-яЁё]/.test(sample);
      }

      function ensureButton() {
        let button = document.getElementById(ID);
        if (!button) {
          button = document.createElement('a');
          button.id = ID;
          button.target = '_blank';
          button.rel = 'noopener noreferrer';
          button.setAttribute('aria-label', 'WhatsApp');
          button.innerHTML = SVG;
          document.body.appendChild(button);
        }
        const ru = detectRu();
        button.href = ru
          ? 'https://wa.me/6281222666226'
          : 'https://wa.me/628999844455?text=Hello%21%20I%27m%20interested%20in%20private%20tours%20in%20Bali.';
      }

      ensureButton();
      const observer = new MutationObserver(() => ensureButton());
      observer.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener('popstate', ensureButton);
    })();
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
