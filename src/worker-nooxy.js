import { initializeNooxy } from "nooxy";

const SITE_CONFIG = {
  domain: "bali-discount.niibet34.workers.dev",
  notionDomain: "balidiscount.notion.site",
  siteName: "Bali Discount",
  slugToPage: {
    "/en": "3c13152813a381c0a3b4c6dd8adff293",
    "/ru": "9d9cc7b88191428a86afbaff8b85931d",
  },
  seo: { indexing: false, brandReplacement: "Bali Discount" },
  nooxy: { showBadge: false },
  customHeadCSS: `
    .notion-topbar,.notion-topbar-mobile,[class*="notion-topbar"],[class*="notion-navbar"]{display:none!important}
    html,body{overflow-x:hidden!important}

    #bali-nooxy-en-wa{position:fixed;right:max(18px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));width:58px;height:58px;border-radius:50%;background:#25D366;color:#fff;display:grid;place-items:center;z-index:2147483646;box-shadow:0 14px 34px rgba(0,0,0,.25);text-decoration:none;line-height:0}
    #bali-nooxy-en-wa svg{display:block;width:39px;height:39px;fill:currentColor}

    #bali-ru-contact{position:fixed;right:max(18px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));z-index:2147483646;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
    #bali-ru-menu{position:absolute;right:0;bottom:70px;width:224px;padding:9px;border-radius:20px;background:rgba(255,255,255,.97);border:1px solid rgba(15,23,42,.09);box-shadow:0 18px 50px rgba(0,0,0,.20);opacity:0;transform:translateY(10px) scale(.97);pointer-events:none;transition:.18s ease}
    #bali-ru-contact.open #bali-ru-menu{opacity:1;transform:none;pointer-events:auto}
    .bali-ru-item{height:50px;border-radius:13px;display:flex;align-items:center;gap:12px;padding:0 10px;color:#111827!important;font-weight:600;font-size:15px;text-decoration:none!important}
    .bali-ru-item:hover{background:#f4f5f6}
    .bali-ru-icon{width:35px;height:35px;border-radius:11px;display:grid;place-items:center;flex:0 0 auto}
    .bali-ru-icon img{display:block;width:23px;height:23px;object-fit:contain}
    .bali-ru-vk{background:#2787f5}.bali-ru-max{background:linear-gradient(145deg,#2a7df5,#7655ff)}.bali-ru-tg{background:#229ed9}.bali-ru-wa{background:#25D366}
    #bali-ru-toggle{width:58px;height:58px;border:0;border-radius:50%;background:#25D366;color:#fff;display:grid;place-items:center;box-shadow:0 14px 34px rgba(0,0,0,.25);cursor:pointer;padding:0}
    #bali-ru-toggle .bali-ru-open{width:58px;height:58px;display:grid;place-items:center;line-height:0}
    #bali-ru-toggle .bali-ru-open svg{display:block;width:68%;height:68%;fill:currentColor}
    .bali-ru-close{display:none;font-size:32px;line-height:1}
    #bali-ru-contact.open .bali-ru-open{display:none}
    #bali-ru-contact.open .bali-ru-close{display:block}
  `,
  customBodyJS: `
    (() => {
      const SVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16.04 3C9.43 3 4.05 8.35 4.05 14.93c0 2.11.56 4.17 1.62 5.97L3.95 27l6.27-1.64a12 12 0 0 0 5.82 1.48h.01c6.61 0 11.99-5.35 11.99-11.93C28.04 8.35 22.66 3 16.04 3Zm0 21.83h-.01a9.98 9.98 0 0 1-5.09-1.39l-.37-.22-3.72.97.99-3.61-.24-.37a9.88 9.88 0 0 1-1.52-5.28c0-5.47 4.47-9.92 9.97-9.92 5.49 0 9.96 4.45 9.96 9.92 0 5.47-4.47 9.9-9.97 9.9Zm5.47-7.42c-.3-.15-1.77-.87-2.04-.97-.28-.1-.48-.15-.68.15-.2.3-.78.97-.95 1.17-.18.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.76-1.66-2.06-.18-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.68-1.64-.93-2.24-.25-.59-.5-.51-.68-.52h-.58c-.2 0-.53.07-.8.37-.28.3-1.05 1.02-1.05 2.49s1.08 2.89 1.23 3.09c.15.2 2.12 3.22 5.14 4.52.72.31 1.28.49 1.72.63.72.23 1.38.2 1.9.12.58-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.18-1.42-.08-.13-.28-.2-.58-.35Z"/></svg>';
      const RU_ROOT='9d9cc7b88191428a86afbaff8b85931d';
      const EN_ROOT='3c13152813a381c0a3b4c6dd8adff293';
      const stateKey='bali_nooxy_lang';

      const rememberLang=()=>{
        const p=location.pathname.toLowerCase();
        if(p==='/ru'||p.startsWith('/ru/')||p.includes(RU_ROOT)) sessionStorage.setItem(stateKey,'ru');
        else if(p==='/en'||p.startsWith('/en/')||p.includes(EN_ROOT)) sessionStorage.setItem(stateKey,'en');
      };
      const lang=()=>{rememberLang();return sessionStorage.getItem(stateKey)||(/[А-Яа-яЁё]/.test((document.body?.innerText||'').slice(0,3000))?'ru':'en')};

      const removeWidgets=()=>{document.getElementById('bali-nooxy-en-wa')?.remove();document.getElementById('bali-ru-contact')?.remove()};

      const buildEnglish=()=>{
        if(document.getElementById('bali-nooxy-en-wa'))return;
        const a=document.createElement('a');
        a.id='bali-nooxy-en-wa';a.target='_blank';a.rel='noopener noreferrer';a.setAttribute('aria-label','WhatsApp');
        a.href='https://wa.me/628999844455?text=Hello%21%20I%27m%20interested%20in%20private%20tours%20in%20Bali.';a.innerHTML=SVG;document.body.appendChild(a);
      };

      const buildRussian=()=>{
        if(document.getElementById('bali-ru-contact'))return;
        const wrap=document.createElement('div');wrap.id='bali-ru-contact';
        wrap.innerHTML='<div id="bali-ru-menu" aria-hidden="true">'+
          '<a class="bali-ru-item" href="https://vk.me/balidiscount" target="_blank" rel="noopener noreferrer"><span class="bali-ru-icon bali-ru-vk"><img src="https://cdn.simpleicons.org/vk/FFFFFF" alt=""></span><span>ВКонтакте</span></a>'+
          '<a class="bali-ru-item" href="https://max.ru/u/f9LHodD0cOIwcXL9W58ncPrSABr9BRXv84mIqJ3Z3P4qoTFYvTXRCCPWvIg" target="_blank" rel="noopener noreferrer"><span class="bali-ru-icon bali-ru-max"><img src="https://max.ru/favicon.ico" alt=""></span><span>MAX</span></a>'+
          '<a class="bali-ru-item" href="https://t.me/bali_discount" target="_blank" rel="noopener noreferrer"><span class="bali-ru-icon bali-ru-tg"><img src="https://cdn.simpleicons.org/telegram/FFFFFF" alt=""></span><span>Telegram</span></a>'+
          '<a class="bali-ru-item" href="https://wa.me/6281222666226" target="_blank" rel="noopener noreferrer"><span class="bali-ru-icon bali-ru-wa"><img src="https://cdn.simpleicons.org/whatsapp/FFFFFF" alt=""></span><span>WhatsApp</span></a></div>'+
          '<button id="bali-ru-toggle" type="button" aria-label="Открыть мессенджеры" aria-expanded="false"><span class="bali-ru-open">'+SVG+'</span><span class="bali-ru-close">×</span></button>';
        document.body.appendChild(wrap);
        const toggle=wrap.querySelector('#bali-ru-toggle'),menu=wrap.querySelector('#bali-ru-menu');
        const setOpen=v=>{wrap.classList.toggle('open',v);toggle.setAttribute('aria-expanded',String(v));menu.setAttribute('aria-hidden',String(!v))};
        toggle.addEventListener('click',e=>{e.stopPropagation();setOpen(!wrap.classList.contains('open'))});
        menu.addEventListener('click',e=>e.stopPropagation());
        document.addEventListener('click',()=>setOpen(false));
        document.addEventListener('keydown',e=>{if(e.key==='Escape')setOpen(false)});
      };

      const ensure=()=>{
        const current=lang();
        if(current==='ru'){
          document.getElementById('bali-nooxy-en-wa')?.remove();
          buildRussian();
        }else{
          document.getElementById('bali-ru-contact')?.remove();
          buildEnglish();
        }
      };

      ensure();
      let queued=false;
      new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;ensure()})}).observe(document.documentElement,{childList:true,subtree:true});
      addEventListener('popstate',ensure);
    })();
  `,
};

const proxy = initializeNooxy({ configKey: "bali-discount-workers-preview", config: SITE_CONFIG });

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "") return Response.redirect(`${url.origin}/en`, 302);
    const response = await proxy(request);
    const headers = new Headers(response.headers);
    headers.set("x-bali-proxy", "nooxy-2.0.0-preview");
    headers.set("cache-control", "no-store");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
