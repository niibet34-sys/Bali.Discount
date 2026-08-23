import appWorker from "./worker-v3.js";

export default {
  async fetch(request, env, ctx) {
    const response = await appWorker.fetch(request, env, ctx);
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html") || !response.body) return response;

    const russian = isRussianRequest(request);
    if (!russian) return response;

    const rewriter = new HTMLRewriter();
    rewriter.on("body", new RussianMessengerEnhancer());
    return rewriter.transform(response);
  },
};

function isRussianRequest(request) {
  const url = new URL(request.url);
  if (url.pathname === "/ru" || url.pathname.startsWith("/ru/")) return true;

  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    const ref = new URL(referer);
    return ref.origin === url.origin && (ref.pathname === "/ru" || ref.pathname.startsWith("/ru/"));
  } catch {
    return false;
  }
}

class RussianMessengerEnhancer {
  element(element) {
    element.append(`<script id="bali-ru-messengers">(()=>{
      const messengerConfig = {
        'ВКонтакте': {
          url: 'https://vk.me/balidiscount',
          icon: 'https://cdn.simpleicons.org/vk/FFFFFF'
        },
        'MAX': {
          url: 'https://max.ru/u/f9LHodD0cOIwcXL9W58ncPrSABr9BRXv84mIqJ3Z3P4qoTFYvTXRCCPWvIg',
          icon: 'https://max.ru/favicon.ico'
        },
        'Telegram': {
          url: 'https://t.me/bali_discount',
          icon: 'https://cdn.simpleicons.org/telegram/FFFFFF'
        },
        'WhatsApp': {
          url: 'https://wa.me/6281222666226',
          icon: 'https://cdn.simpleicons.org/whatsapp/FFFFFF'
        }
      };

      const enhance = () => {
        document.querySelectorAll('#bali-contact-menu .bali-contact-item').forEach(item => {
          const label = [...item.querySelectorAll('span')].map(s => (s.textContent || '').trim()).find(t => messengerConfig[t]);
          if (!label) return;
          const config = messengerConfig[label];
          const icon = item.querySelector('.bali-msg-icon');

          if (icon && icon.dataset.brandReady !== '1') {
            icon.innerHTML = '<img src="' + config.icon + '" alt="" aria-hidden="true" style="display:block;width:23px;height:23px;object-fit:contain">';
            icon.dataset.brandReady = '1';
          }

          item.style.cursor = 'pointer';
          item.setAttribute('aria-label', label);
          if (item.dataset.linkReady !== '1') {
            item.addEventListener('click', event => {
              event.preventDefault();
              event.stopImmediatePropagation();
              window.location.href = config.url;
            }, true);
            item.dataset.linkReady = '1';
          }
        });
      };

      enhance();
      let queued = false;
      new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; enhance(); });
      }).observe(document.documentElement, { subtree:true, childList:true });
      setTimeout(enhance, 400);
      setTimeout(enhance, 1200);
    })();</script>`, { html: true });
  }
}
