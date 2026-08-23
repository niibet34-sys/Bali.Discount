import appWorker from "./worker-v7.js";

export default {
  async fetch(request, env, ctx) {
    const response = await appWorker.fetch(request, env, ctx);
    if (!isRussianPage(request) || !response.body) return response;

    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (!type.includes("text/html")) return response;

    return new HTMLRewriter()
      .on("head", new RussianScrollStyles())
      .on("body", new RussianScrollRepair())
      .transform(response);
  },
};

function isRussianPage(request) {
  const url = new URL(request.url);
  return url.pathname === "/ru" || url.pathname.startsWith("/ru/");
}

class RussianScrollStyles {
  element(element) {
    element.append(`<style id="bali-ru-scroll-fix">
html,body{
  overscroll-behavior-y:auto!important;
  touch-action:pan-y!important;
  -webkit-overflow-scrolling:touch!important;
}
#notion-app{
  touch-action:pan-y!important;
}
.notion-scroller,[class*="notion-scroller"]{
  overflow-y:auto!important;
  overscroll-behavior-y:auto!important;
  touch-action:pan-y!important;
  -webkit-overflow-scrolling:touch!important;
}
</style>`, { html: true });
  }
}

class RussianScrollRepair {
  element(element) {
    element.append(`<script id="bali-ru-scroll-repair">(()=>{
      const repair=()=>{
        const html=document.documentElement;
        const body=document.body;
        html.style.setProperty('overflow-y','auto','important');
        body.style.setProperty('overflow-y','auto','important');
        html.style.setProperty('touch-action','pan-y','important');
        body.style.setProperty('touch-action','pan-y','important');

        const app=document.getElementById('notion-app');
        if(app) app.style.setProperty('touch-action','pan-y','important');

        const candidates=[...document.querySelectorAll('.notion-scroller,[class*="notion-scroller"],#notion-app div')]
          .filter(el=>{
            const r=el.getBoundingClientRect();
            return r.height>180 && el.scrollHeight>el.clientHeight+40;
          })
          .sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight));

        const scroller=candidates[0];
        if(scroller){
          scroller.style.setProperty('overflow-y','auto','important');
          scroller.style.setProperty('touch-action','pan-y','important');
          scroller.style.setProperty('-webkit-overflow-scrolling','touch','important');
          scroller.style.setProperty('overscroll-behavior-y','auto','important');
        }

        // If Notion's restored snapshot no longer has its internal scroller,
        // fall back to normal document scrolling instead of leaving body locked.
        if(!scroller && app){
          app.style.setProperty('height','auto','important');
          app.style.setProperty('min-height','100vh','important');
          app.style.setProperty('overflow','visible','important');
          document.querySelectorAll('.notion-frame').forEach(frame=>{
            frame.style.setProperty('height','auto','important');
            frame.style.setProperty('min-height','100vh','important');
            frame.style.setProperty('overflow','visible','important');
          });
        }
      };

      repair();
      requestAnimationFrame(repair);
      setTimeout(repair,150);
      setTimeout(repair,500);
      setTimeout(repair,1200);
      setTimeout(repair,2600);

      let queued=false;
      new MutationObserver(()=>{
        if(queued)return;
        queued=true;
        requestAnimationFrame(()=>{queued=false;repair()});
      }).observe(document.documentElement,{subtree:true,childList:true});
    })();</script>`, { html: true });
  }
}
