import { annotateTabTargets, discoverTabPages, applyTabState, TabGroup, TabState } from './tab-pages';
import { htmlToFigma, preloadBackgroundImages, rasterizedFonts } from '../../lib/html-to-figma';
import { LocalImportOptions } from '../../shared/local-import';

// No uploaded scripts execute; the host reads the rendered document directly.
export function makeLocalHtmlDocument(html: string, _token?: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const hadScripts=doc.querySelectorAll('script').length>0;
  annotateTabTargets(doc);
  doc.querySelectorAll('script, base, meta[http-equiv], iframe, object, embed, #legacy-capture-button').forEach(el => el.remove());
  doc.querySelectorAll('*').forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      if (/^on/i.test(attr.name) || /^javascript:/i.test(attr.value.trim())) el.removeAttribute(attr.name);
    });
    if (el.tagName.toLowerCase() === 'a') el.removeAttribute('href');
  });
  if(hadScripts && doc.body){
    const remaining=doc.body.cloneNode(true) as HTMLElement;
    remaining.querySelectorAll('style,noscript,template').forEach(el=>el.remove());
    remaining.querySelectorAll('#root,#app,#__next,#__nuxt').forEach(el=>{
      if(!el.children.length && !(el.textContent || '').trim())el.remove();
    });
    if(!remaining.children.length && !(remaining.textContent || '').trim()){
      throw new Error('这是依赖 JavaScript 渲染的动态页面（如 React / Vue）：移除脚本后没有正文。请先导出带完整正文的静态 HTML / 预渲染 HTML，再导入；仅把脚本内嵌进 HTML 仍无法转换。');
    }
  }
  // Lazy loading never triggers in the offscreen render frame, and lazy-load
  // scripts don't run, so promote their real sources.
  doc.querySelectorAll('img').forEach(img=>{
    img.removeAttribute('loading');
    const lazy=img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src');
    const src=img.getAttribute('src') || '';
    if(lazy && (!src || /^data:(,|image\/gif)/i.test(src)))img.setAttribute('src',lazy);
    const lazySet=img.getAttribute('data-srcset');
    if(lazySet && !img.getAttribute('srcset'))img.setAttribute('srcset',lazySet);
  });
  // Classic scrollbars take layout width from the page and from scroll boxes.
  const scrollbars=doc.createElement('style');
  scrollbars.textContent='*{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}';
  doc.head.prepend(scrollbars);
  const policy=doc.createElement('meta');policy.setAttribute('http-equiv','Content-Security-Policy');
  policy.setAttribute('content',"default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; media-src data:; script-src 'none'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'");
  doc.head.prepend(policy);
  return '<!doctype html>' + doc.documentElement.outerHTML;
}

// Storage throws in an opaque-origin sandbox; pages expect it to work.
const PRERENDER_SHIM=`(()=>{const memory=()=>{const m=new Map();return{getItem:k=>m.has(String(k))?m.get(String(k)):null,setItem:(k,v)=>{m.set(String(k),String(v))},removeItem:k=>{m.delete(String(k))},clear:()=>m.clear(),key:i=>Array.from(m.keys())[i]??null,get length(){return m.size}}};
for(const name of ['localStorage','sessionStorage']){try{window[name].getItem('_')}catch(e){try{Object.defineProperty(window,name,{value:memory(),configurable:true})}catch(_){}}}
try{document.cookie}catch(e){try{Object.defineProperty(document,'cookie',{get:()=>'',set:()=>{},configurable:true})}catch(_){}}
// Timeouts started by a simulated click (and timeouts those start) are tracked,
// so state capture can wait for delayed "loading…" → content swaps.
const timers={pending:new Set(),track:0,set:setTimeout.bind(window),clear:clearTimeout.bind(window)};let chained=false;
Object.defineProperty(window,'__h2fTimers',{value:timers});
window.setTimeout=function(fn,delay,...args){const tracked=(timers.track>0||chained)&&typeof fn==='function'&&Number(delay||0)<=4000;let id;
 const run=typeof fn==='function'?function(){timers.pending.delete(id);const prev=chained;chained=tracked||prev;try{return fn.apply(this,args)}finally{chained=prev}}:fn;
 id=timers.set(run,delay);if(tracked)timers.pending.add(id);return id};
window.clearTimeout=id=>{timers.pending.delete(id);timers.clear(id)};
// Animation frames pause in hidden or offscreen frames; timers keep running.
// Frame loops aren't tracked: endless animations would never let a state settle.
window.requestAnimationFrame=cb=>timers.set(()=>cb(performance.now()),16);window.cancelAnimationFrame=id=>timers.clear(id);})();`;

const MAX_SCRIPT_STATES=20;

// Waits until the page stops changing, then serializes the rendered DOM. With
// captureStates, single-select control groups (script-driven tabs, scope
// switchers, segmented buttons) are clicked one item at a time and each
// settled result is serialized as its own state.
const prerenderSnapshot=(token:string,captureStates:boolean)=>`(()=>{const token=${JSON.stringify(token)},captureStates=${captureStates},maxStates=${MAX_SCRIPT_STATES};
const start=Date.now();let last=start;
new MutationObserver(()=>{last=Date.now()}).observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
const send=message=>parent.postMessage(Object.assign({type:'h2f-prerender',token},message),'*');
const timers=window.__h2fTimers,later=timers?timers.set:setTimeout;
const wait=ms=>new Promise(resolve=>later(resolve,ms));
// Settled once no click-started timeout is pending and the DOM has been quiet.
async function settle(min,quiet,max){const begin=Date.now();await wait(min);while(((timers&&timers.pending.size)||Date.now()-last<quiet)&&Date.now()-begin<max)await wait(100)}
// Serializes a copy so the live page (canvases, form state) keeps working between states.
function serialize(){
 const canvases=Array.from(document.querySelectorAll('canvas')).map(canvas=>{try{const r=canvas.getBoundingClientRect();return {src:canvas.toDataURL(),width:r.width,height:r.height}}catch(e){return null}});
 const fields=Array.from(document.querySelectorAll('input,textarea,select'));
 const styles=Array.from(document.querySelectorAll('style')).map(style=>{try{const rules=style.sheet&&style.sheet.cssRules;return rules&&rules.length&&!style.textContent.trim()?Array.from(rules).map(r=>r.cssText).join('\\n'):null}catch(e){return null}});
 const root=document.documentElement.cloneNode(true);
 const copies=Array.from(root.querySelectorAll('input,textarea,select'));
 fields.forEach((el,i)=>{const copy=copies[i];if(!copy)return;
  if(el.tagName==='TEXTAREA')copy.textContent=el.value;
  else if(el.tagName==='SELECT')Array.from(el.options).forEach((o,j)=>{const c=copy.options[j];if(c)o.selected?c.setAttribute('selected',''):c.removeAttribute('selected')});
  else if(/^(checkbox|radio)$/i.test(el.type))el.checked?copy.setAttribute('checked',''):copy.removeAttribute('checked');
  else copy.setAttribute('value',el.value);
 });
 Array.from(root.querySelectorAll('canvas')).forEach((canvas,i)=>{const data=canvases[i];if(!data)return;const img=document.createElement('img');for(const a of Array.from(canvas.attributes))img.setAttribute(a.name,a.value);img.src=data.src;img.style.width=data.width+'px';img.style.height=data.height+'px';canvas.replaceWith(img)});
 Array.from(root.querySelectorAll('style')).forEach((style,i)=>{if(styles[i]!=null)style.textContent=styles[i]});
 const head=root.querySelector('head');
 try{for(const sheet of document.adoptedStyleSheets||[]){const s=document.createElement('style');s.textContent=Array.from(sheet.cssRules).map(r=>r.cssText).join('\\n');if(head)head.appendChild(s)}}catch(e){}
 root.querySelectorAll('#h2f-prerender,#h2f-prerender-shim').forEach(el=>el.remove());
 return '<!doctype html>'+root.outerHTML;
}
const CONTROL='button,a[href],[role=tab],[role=radio],[role=button],[role=option],[onclick],[aria-pressed],[aria-selected]';
const ACTIVE=/(?:^|[-_])(active|selected|current|checked|on)$/i;
const clean=text=>(text||'').trim().replace(/\\s+/g,' ');
const labelOf=el=>el.tagName==='OPTION'?clean(el.textContent):el.tagName==='INPUT'?clean(el.labels&&el.labels[0]?el.labels[0].textContent:el.value):clean(el.getAttribute('aria-label')||el.textContent);
function shown(el){if(el.checkVisibility&&!el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0}
function mark(el){
 const aria=el.getAttribute('aria-selected')||el.getAttribute('aria-pressed')||el.getAttribute('aria-current');if(aria)return aria==='false'?-1:1;
 const state=el.getAttribute('data-state');if(state)return /^(active|on|checked|selected)$/i.test(state)?1:-1;
 const flag=el.getAttribute('data-active')||el.getAttribute('data-selected');if(flag!=null)return flag==='false'?-1:1;
 return Array.from(el.classList).some(c=>ACTIVE.test(c))?1:0;
}
const filled=s=>(s.backgroundColor!=='transparent'&&!/rgba\\([^)]*,\\s*0\\)$/.test(s.backgroundColor))||s.backgroundImage!=='none';
// Native fields inside a data-entry form are form input, not view switchers.
const entryForm=el=>{const form=el.closest('form');return !!form&&!!form.querySelector('input:not([type=radio]):not([type=checkbox]):not([type=hidden]):not([type=submit]):not([type=button]),textarea')};
// Sibling controls with short labels where exactly one item is marked (aria,
// data-state or class) or, failing that, exactly one item is styled differently.
// Radio sets and small selects are switchers too.
function collectGroups(){
 const groups=[],buckets=new Map(),radios=new Map();
 for(const input of Array.from(document.querySelectorAll('input[type=radio]'))){
  if(input.disabled||entryForm(input)||!(shown(input)||(input.labels&&input.labels[0]&&shown(input.labels[0]))))continue;
  const key=input.name?'name:'+input.name:input.parentElement;const list=radios.get(key)||[];list.push(input);radios.set(key,list);
 }
 for(const items of radios.values())if(items.length>=2&&items.length<=12&&items.every(el=>labelOf(el))){const on=items.findIndex(el=>el.checked);groups.push({items,active:on,labels:items.map(labelOf)})}
 for(const select of Array.from(document.querySelectorAll('select:not([multiple])'))){
  const items=Array.from(select.options).filter(o=>!o.disabled&&labelOf(o));
  if(select.disabled||entryForm(select)||!shown(select)||items.length<2||items.length>8)continue;
  groups.push({items,active:items.indexOf(select.options[select.selectedIndex]),labels:items.map(labelOf)});
 }
 for(const el of Array.from(document.body.querySelectorAll(CONTROL+',li,span,div'))){
  if(!el.matches(CONTROL)&&(getComputedStyle(el).cursor!=='pointer'||(el.parentElement&&getComputedStyle(el.parentElement).cursor==='pointer')))continue;
  if((el.parentElement&&el.parentElement.closest(CONTROL))||el.querySelector(CONTROL+',input[type=radio]'))continue;
  const wrap=el.closest('label');if(wrap&&wrap.querySelector('input[type=radio]'))continue;
  if(el.matches(':disabled,[aria-disabled="true"]'))continue;
  const href=el.tagName==='A'?el.getAttribute('href')||'':'';
  if(href&&!href.startsWith('#')&&!/^javascript:/i.test(href))continue;
  const label=labelOf(el);if(!label||label.length>24||!shown(el))continue;
  let owner=el.parentElement;if(owner&&owner!==document.body&&owner.children.length===1&&owner.parentElement)owner=owner.parentElement;
  if(!owner)continue;
  const list=buckets.get(owner)||[];list.push(el);buckets.set(owner,list);
 }
 for(const items of buckets.values()){
  if(items.length<2||items.length>12||items.some(el=>el.tagName!==items[0].tagName))continue;
  // The selected mark often sits on a single-child wrapper (li.current > a).
  const marks=items.map(el=>mark(el)||(el.parentElement&&el.parentElement.children.length===1?mark(el.parentElement):0));
  const on=marks.map((m,i)=>m>0?i:-1).filter(i=>i>=0);
  let active=on.length===1?on[0]:-1;
  // Style-only selection needs items of one shape; differently sized buttons are separate actions.
  const shape=items.map(el=>{const s=getComputedStyle(el);return [s.fontSize,s.paddingTop,s.paddingLeft,s.borderTopLeftRadius].join('|')});
  const heights=items.map(el=>el.getBoundingClientRect().height);
  const uniform=new Set(shape).size===1&&Math.max(...heights)-Math.min(...heights)<=3;
  if(!on.length&&uniform&&items.length>=3){
   const sig=items.map(el=>{const s=getComputedStyle(el);return [s.color,s.backgroundColor,s.backgroundImage,s.borderColor,s.fontWeight,s.boxShadow].join('|')});
   const odd=sig.map((s,i)=>sig.filter(x=>x===s).length===1?i:-1).filter(i=>i>=0);
   if(odd.length===1&&new Set(sig).size===2)active=odd[0];
  }else if(!on.length&&uniform){
   // Two-button toggles: the selected one is the filled, bolder or raised one.
   const weight=items.map(el=>{const s=getComputedStyle(el);return (filled(s)?2:0)+(Number(s.fontWeight)>=600?1:0)+(s.boxShadow!=='none'?1:0)});
   if(weight[0]!==weight[1])active=weight[0]>weight[1]?0:1;
  }
  groups.push({items,active,labels:items.map(labelOf)});
 }
 return groups;
}
const findGroups=()=>collectGroups().filter(group=>group.active>=0);
// Pages often re-render their controls on every switch (sometimes adding or
// dropping items), so an item is found again in the group that shares the most labels.
function locate(group,label){
 let best=null,score=0;
 for(const g of collectGroups()){const i=g.labels.indexOf(label);if(i<0)continue;const s=g.labels.filter(l=>group.labels.includes(l)).length;if(s>score){score=s;best=g.items[i]}}
 return score>=Math.min(2,group.labels.length)?best:null;
}
async function press(el){
 if(timers)timers.track++;
 try{
  if(el.tagName==='OPTION'){const select=el.closest('select');select.value=el.value;el.selected=true;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}))}
  else if(el.tagName==='INPUT')el.click();
  else{const o={bubbles:true,cancelable:true,view:window,button:0};for(const type of ['pointerdown','mousedown','pointerup','mouseup']){try{el.dispatchEvent(type.startsWith('pointer')?new PointerEvent(type,o):new MouseEvent(type,o))}catch(e){}}el.click()}
  // Promise continuations of the handlers run before this resolves, still tracked.
  await wait(0);
 }finally{if(timers)timers.track--}
}
// Registered last on window so page handlers still see an unprevented click.
// srcdoc documents resolve "#x" against the host URL, which would navigate the
// whole frame away; apply the fragment to this document instead.
addEventListener('click',e=>{const a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a||e.defaultPrevented)return;const href=a.getAttribute('href')||'';if(/^javascript:/i.test(href))return;e.preventDefault();if(href.length>1&&href.startsWith('#')&&location.hash!==href)location.hash=href});
addEventListener('submit',e=>e.preventDefault());
async function run(){
 const baseline=serialize();
 const groups=captureStates?findGroups():[];
 const total=Math.min(maxStates,groups.reduce((n,g)=>n+g.items.length-1,0));
 send({kind:'state',name:total?'默认':'',html:baseline});
 const seen=new Set([baseline]),warnings=[];let captured=0,skipped=0;
 for(const group of groups){
  for(let i=0;i<group.labels.length;i++){
   if(i===group.active)continue;
   const name=group.labels[i],el=captured<maxStates?locate(group,name):null;
   if(!el){skipped++;continue}
   send({kind:'progress',label:'正在切换页面状态：'+name+'（'+(captured+1)+'/'+total+'）'});
   await press(el);await settle(500,800,8000);
   const html=serialize();
   if(!seen.has(html)){seen.add(html);captured++;send({kind:'state',name:/^\\d+$/.test(name)?'第 '+name+' 页':name,html})}
  }
  const original=locate(group,group.labels[group.active]);
  if(original){await press(original);await settle(300,800,8000)}
 }
 if(skipped)warnings.push('有 '+skipped+' 个脚本切换状态未导出（超过 '+maxStates+' 个上限或控件已被页面替换）。');
 send({kind:'done',warnings});
}
function tick(){const now=Date.now();if((now-last>700&&now-start>1500)||now-start>8000)return run().catch(()=>send({kind:'done',warnings:[]}));setTimeout(tick,200)}
function begin(){Promise.resolve(document.fonts&&document.fonts.ready).catch(()=>{}).then(()=>setTimeout(tick,300))}
document.readyState==='complete'?begin():addEventListener('load',begin);})();`;

export interface PrerenderResult {states:{name:string;html:string}[];warnings:string[]}

// Pages rendered by JavaScript (charts, dashboards, SPA output) are run in an
// opaque-origin sandbox without network access; each settled DOM is then
// parsed like a static page. Returns null if the page doesn't settle.
export function prerenderScripts(html:string,width:number,captureStates=false,onStatus?:(label:string)=>void):Promise<PrerenderResult|null> {
  return new Promise(resolve=>{
    const token=Math.random().toString(36).slice(2);
    const doc=new DOMParser().parseFromString(html,'text/html');
    doc.querySelectorAll('base, meta[http-equiv]').forEach(el=>el.remove());
    const policy=doc.createElement('meta');policy.setAttribute('http-equiv','Content-Security-Policy');
    policy.setAttribute('content',"default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src data: blob: about:; base-uri 'none'; form-action 'none'");
    const shim=doc.createElement('script');shim.id='h2f-prerender-shim';shim.textContent=PRERENDER_SHIM;
    doc.head.prepend(policy,shim);
    const snapshot=doc.createElement('script');snapshot.id='h2f-prerender';snapshot.textContent=prerenderSnapshot(token,captureStates);
    doc.body.appendChild(snapshot);
    const frame=document.createElement('iframe');
    // Scripts run, but without same-origin access to the plugin or network.
    frame.setAttribute('sandbox','allow-scripts');
    // On screen but invisible, so animation frames aren't throttled.
    frame.style.cssText='position:fixed;left:0;top:0;opacity:0;pointer-events:none;z-index:-1;border:0;';
    frame.style.width=width+'px';frame.style.height='900px';
    const states:PrerenderResult['states']=[],warnings:string[]=[];
    let settled=false,timer=0;
    const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);window.removeEventListener('message',receive);frame.remove();resolve(states.length?{states,warnings}:null);};
    // Restarted by every message, so long state captures don't time out while progressing.
    const arm=()=>{clearTimeout(timer);timer=window.setTimeout(()=>{if(states.length>1)warnings.push('部分脚本切换状态未在限定时间内完成，已导出已捕获的状态。');finish();},12000);};
    const receive=(event:MessageEvent)=>{
      const data=event.data;
      if(event.source!==frame.contentWindow || data?.type!=='h2f-prerender' || data.token!==token)return;
      arm();
      if(data.kind==='state' && typeof data.html==='string')states.push({name:String(data.name || ''),html:data.html});
      else if(data.kind==='progress' && typeof data.label==='string')onStatus?.(data.label);
      else if(data.kind==='done'){if(Array.isArray(data.warnings))warnings.push(...data.warnings.map(String));finish();}
    };
    arm();
    window.addEventListener('message',receive);
    frame.srcdoc='<!doctype html>'+doc.documentElement.outerHTML;
    document.body.appendChild(frame);
  });
}

export async function renderLocalHtml(html:string,width:number,options:Partial<LocalImportOptions>={},onProgress?:(fraction:number,label:string)=>void):Promise<{layers:any[];missing:number;hoverCount:number;warnings:string[]}> {
  let snapshots=[{name:'',html}];const warnings:string[]=[];
  if(options.runScripts!==false && /<script\b/i.test(html)){
    onProgress?.(0,'正在沙箱中运行页面脚本……');
    const rendered=await prerenderScripts(html,width,options.captureScriptStates!==false,label=>onProgress?.(0,label));
    if(rendered){snapshots=rendered.states;warnings.push(...rendered.warnings);}
  }
  const layers:any[]=[];let missing=0;
  const rasterizedFonts=new Set<string>();
  for(let shot=0;shot<snapshots.length;shot++){
    const snapshot=snapshots[shot];
    let prepared:ReturnType<typeof discoverTabPages>;
    try{prepared=discoverTabPages(makeLocalHtmlDocument(snapshot.html));}
    catch(error){if(!shot)throw error;warnings.push('页面状态“'+snapshot.name+'”无法解析，已跳过。');continue;}
    // Script-driven controls were already clicked through when several states exist.
    warnings.push(...prepared.warnings.filter(text=>snapshots.length<2 || !text.includes('疑似 Tab 控件找不到静态内容区域')));
    const total=snapshots.length*prepared.states.length;
    for(let index=0;index<prepared.states.length;index++){
      const state=prepared.states[index],step=shot*prepared.states.length+index;
      const name=[snapshot.name,state.name].filter(Boolean).join(' / ');
      const many=total>1;
      onProgress?.(step/total,many?'正在解析 '+(step+1)+'/'+total+'：'+name:'正在解析页面布局……');
      const result=await renderDocumentHtml(prepared.html,width,prepared.groups,state,options,(fraction,label)=>onProgress?.((step+fraction)/total,many?name+' · '+label:label));
      for(const layer of result.layers){if(name)layer.name=name;layers.push(layer);}
      missing+=result.missing;
      result.rasterizedFonts.forEach(family=>rasterizedFonts.add(family));
      onProgress?.((step+1)/total,many?'解析完成：'+name:'页面解析完成');
    }
  }
  if(rasterizedFonts.size)warnings.push('Figma 中没有这些网页字体，相关文字已转为图片以保持外观：'+Array.from(rasterizedFonts).join('、'));
  return {layers,missing,hoverCount:0,warnings:Array.from(new Set(warnings))};
}

function renderDocumentHtml(html:string,width:number,groups:TabGroup[],state:TabState,options:Partial<LocalImportOptions>,onProgress?:(fraction:number,label:string)=>void):Promise<{layers:any[];missing:number;rasterizedFonts:string[]}> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    // Same-origin access is for the host parser; scripts are NOT allowed.
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.style.cssText = 'position:fixed;left:-20000px;top:0;border:0;pointer-events:none;';
    frame.style.width = width + 'px';
    frame.style.height = '900px';
    let timeout: number;
    let finished = false;
    let loading = false;
    const cleanup = () => { clearTimeout(timeout); frame.onload = null; frame.remove(); };
    const fail = (error: unknown) => {
      if (finished) return;
      finished = true; cleanup(); reject(error);
    };
    const boundedWait = (p: Promise<unknown>) => Promise.race([p, new Promise(resolve => setTimeout(resolve, 4000))]);
    frame.onload = async () => {
      if (loading || finished) return;
      loading = true;
      try {
        const doc = frame.contentDocument;
        if (!doc || !doc.body) throw new Error('无法读取 HTML 渲染区域，请重新打开插件后重试。');
        if(groups.length)applyTabState(doc,groups,state);
        await boundedWait(doc.fonts.ready);
        await boundedWait(Promise.all(Array.from(doc.images).map(img => img.decode().catch(() => {}))));
        await preloadBackgroundImages(doc);
        if (finished) return;
        // Force offscreen layout without waiting for suspended animation frames.
        doc.body.getBoundingClientRect();
        onProgress?.(.4,'正在解析页面布局……');
        const layers = htmlToFigma(doc.body, true, false, doc, options);
        const missing = Array.from(doc.images).filter(img => !img.naturalWidth && (typeof img.getClientRects!=='function' || img.getClientRects().length>0)).length;
        if (!layers.length) throw new Error('没有生成有效图层。');
        finished = true; cleanup(); resolve({layers, missing, rasterizedFonts: rasterizedFonts()});
      } catch (error) { fail(error); }
    };
    timeout = window.setTimeout(() => fail(new Error('HTML 渲染未完成。请检查外部资源，或重新打开插件后再试。')), 15000);
    try {
      frame.srcdoc = html;
      document.body.appendChild(frame);
    } catch (error) { fail(error); }
  });
}
