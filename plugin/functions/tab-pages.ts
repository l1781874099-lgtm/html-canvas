export interface TabItem {control:string; panel:string; label:string}
export interface TabGroup {items:TabItem[]; initial:number; controlClasses:string[]; panelClasses:string[]; parent?:{group:number;item:number}}
export interface TabState {name:string; selected:number[]}
const controlSelector='[role="tab"],[data-tab],[data-tab-target],[data-bs-toggle="tab"],[data-toggle="tab"],.tab,.tab-btn,.tab-button,.tab-link,.tab-item,.tabs button,.tabs a,.tab-list button,[role="tablist"] button,[role="tablist"] a,.nav-tabs a,.tabs input[type="radio"],input[type="radio"][aria-controls],[data-html-canvas-target]';
const activeClass=(value:string)=>/(?:^|[-_])(active|selected|current|visible|show|open|on)$/i.test(value);
const tokens=(element:Element)=>Array.from(element.classList).filter(activeClass);

// Read literal target identifiers only. Never evaluate inline handlers or scripts.
export function annotateTabTargets(doc:Document){
  doc.querySelectorAll('[onclick],a[href^="#"]').forEach(el=>{
    const handler=el.getAttribute('onclick') || '';
    const match=handler.match(/\b(?:showTab|switchTab|openTab|activateTab|changeTab|selectTab|setTab|setActiveTab|showPage|switchPage|openPage)\s*\(\s*(?:(?:event|this)\s*,\s*)?['"]([^'"]+)['"]/i);
    const href=el.getAttribute('href') || '';
    if(match)el.setAttribute('data-html-canvas-target',match[1]);
    else if(href.length>1 && el.matches(controlSelector+', [role="tablist"] a'))el.setAttribute('data-html-canvas-target',href);
  });
}
function resolvePanel(doc:Document,control:Element):Element|null {
  let value=control.getAttribute('aria-controls') || control.getAttribute('data-tab-target') || control.getAttribute('data-bs-target') || control.getAttribute('data-target') || control.getAttribute('data-html-canvas-target') || control.getAttribute('data-tab') || control.getAttribute('href') || (control.getAttribute('type')==='radio'?control.id:'') || '';
  if(!value && control.id){
    const panel=Array.from(doc.querySelectorAll('[role="tabpanel"][aria-labelledby]')).find(p=>(p.getAttribute('aria-labelledby') || '').split(/\s+/).includes(control.id));
    if(panel)return panel;
  }
  if(value.startsWith('#')){try{value=decodeURIComponent(value.slice(1));}catch(_error){value=value.slice(1);}}
  if(!value || /\s|[:/>]/.test(value))return null;
  const ids=[value,'panel-'+value,value+'-panel','page-'+value,value+'-page','tab-'+value,value+'-tab','content-'+value,value.replace(/^tab[-_]?/i,'panel-'),value.replace(/^tab/i,'panel')];
  for(const id of ids){const panel=doc.getElementById(id);if(panel && panel!==control && !panel.contains(control) && panel.getAttribute('role')!=='tab')return panel;}
  return null;
}
export function discoverTabPages(html:string):{html:string;groups:TabGroup[];states:TabState[];warnings:string[]} {
  const doc=new DOMParser().parseFromString(html,'text/html');
  const warnings:string[]=[],groups:TabGroup[]=[],nodes:{control:Element;panel:Element}[][]=[];
  const buckets=new Map<Element,{control:Element;panel:Element}[]>();
  const candidates=Array.from(doc.querySelectorAll(controlSelector));
  const knownPanels=new Set(candidates.map(control=>resolvePanel(doc,control)).filter((panel):panel is Element=>Boolean(panel)));
  let unresolved=0;
  for(const control of candidates){
    if(knownPanels.has(control))continue;
    const panel=resolvePanel(doc,control);
    if(!panel){if(!control.querySelector(controlSelector))unresolved++;continue;}
    const owner=control.closest('[role="tablist"],[data-tabs],.tabs,.tab-list,.tablist,.nav-tabs,.tab-nav,.tabs-nav,.tab-buttons,.tabs-header,.tabs-list') || panel.parentElement;
    if(!owner)continue;
    const bucket=buckets.get(owner) || [];
    if(!bucket.some(item=>item.panel===panel))bucket.push({control,panel});
    buckets.set(owner,bucket);
  }
  for(const bucket of buckets.values()){
    if(bucket.length<2)continue;
    // Nested targets in one group are ambiguous, unlike nested independent tablists.
    if(bucket.some(a=>bucket.some(b=>a!==b && a.panel.contains(b.panel)))){warnings.push('一组 Tab 的目标区域互相嵌套，无法可靠拆分，保留当前显示状态。');continue;}
    const groupIndex=groups.length;
    const items=bucket.map(({control,panel},index)=>{
      const key=groupIndex+'-'+index;
      control.setAttribute('data-html-canvas-control',key);panel.setAttribute('data-html-canvas-panel',key);
      const radioLabel=control.getAttribute('type')==='radio'?Array.from(doc.querySelectorAll('label')).find(el=>el.getAttribute('for')===control.id)?.textContent:null;
      const label=control.getAttribute('aria-label') || radioLabel || control.textContent || panel.getAttribute('aria-label') || panel.id || '页面 '+(index+1);
      if(!panel.children.length && !(panel.textContent || '').trim())warnings.push('Tab “'+label.trim()+'”的内容区域没有静态正文，可能需要脚本加载；本次只能还原已有背景和公共区域。');
      return {control:key,panel:key,label:label.trim().replace(/\s+/g,' ').slice(0,80) || '页面 '+(index+1)};
    });
    let initial=bucket.findIndex(({control})=>control.getAttribute('aria-selected')==='true' || (control as HTMLInputElement).checked || tokens(control).length>0);
    if(initial<0)initial=bucket.findIndex(({panel})=>!panel.hasAttribute('hidden') && panel.getAttribute('aria-hidden')!=='true' && !/display\s*:\s*none/i.test(panel.getAttribute('style') || ''));
    groups.push({items,initial:Math.max(0,initial),controlClasses:Array.from(new Set(bucket.reduce((all:string[],item)=>all.concat(tokens(item.control)),[]))),panelClasses:Array.from(new Set(bucket.reduce((all:string[],item)=>all.concat(tokens(item.panel)),[])))});
    nodes.push(bucket);
  }
  if(unresolved && candidates.length>=2)warnings.push('有 '+unresolved+' 个疑似 Tab 控件找不到静态内容区域；可能由脚本动态生成，本次未展开这些控件。');
  for(let child=0;child<groups.length;child++){
    let nearest:{group:number;item:number;panel:Element}|undefined;
    for(let parent=0;parent<groups.length;parent++)if(parent!==child){
      nodes[parent].forEach(({panel},item)=>{
        if(nodes[child].every(pair=>panel.contains(pair.control) && panel.contains(pair.panel)) && (!nearest || nearest.panel.contains(panel)))nearest={group:parent,item,panel};
      });
    }
    if(nearest)groups[child].parent={group:nearest.group,item:nearest.item};
  }
  const states:TabState[]=[],selected=groups.map(()=>-1),done=new Set<number>();
  function visit(){
    if(states.length>32)return;
    if(done.size===groups.length){
      const labels=groups.map((group,index)=>selected[index]<0?'':group.items[selected[index]].label).filter(Boolean);
      states.push({name:labels.join(' / '),selected:selected.slice()});return;
    }
    const index=groups.findIndex((group,i)=>!done.has(i) && (!group.parent || done.has(group.parent.group)));
    if(index<0)throw new Error('Tab 目标循环关联，无法拆分');
    const group=groups[index];done.add(index);
    if(group.parent && selected[group.parent.group]!==group.parent.item){selected[index]=-1;visit();}
    else for(let item=0;item<group.items.length;item++){selected[index]=item;visit();}
    selected[index]=-1;done.delete(index);
  }
  if(groups.length)visit();else states.push({name:'',selected:[]});
  if(states.length>32)throw new Error('检测到超过 32 种 Tab 页面组合，请拆分 HTML 或减少独立 Tab 组后再导入。');
  return {html:'<!doctype html>'+doc.documentElement.outerHTML,groups,states,warnings};
}
export function applyTabState(doc:Document,groups:TabGroup[],state:TabState){
  const computed=(el:Element)=>doc.defaultView?.getComputedStyle?.(el);
  const fallback=groups.map(group=>{
    for(const item of group.items){const panel=doc.querySelector('[data-html-canvas-panel="'+item.panel+'"]');if(panel){const display=computed(panel)?.display;if(display && display!=='none')return display;}}
    return 'block';
  });
  groups.forEach((group,index)=>{
    group.items.forEach((item,i)=>{
      const control=doc.querySelector('[data-html-canvas-control="'+item.control+'"]') as HTMLElement|null;
      const panel=doc.querySelector('[data-html-canvas-panel="'+item.panel+'"]') as HTMLElement|null;
      if(!control || !panel)throw new Error('Tab 内容区域在解析时丢失');
      const active=state.selected[index]===i;
      for(const name of new Set([...tokens(control),...group.controlClasses,'active']))control.classList.toggle(name,active);
      for(const name of new Set([...tokens(panel),...group.panelClasses,'active']))panel.classList.toggle(name,active);
      control.setAttribute('aria-selected',String(active));control.setAttribute('tabindex',active?'0':'-1');
      control.setAttribute('data-state',active?'active':'inactive');panel.setAttribute('data-state',active?'active':'inactive');
      if(control.tagName.toLowerCase()==='input' && control.getAttribute('type')==='radio'){
        (control as HTMLInputElement).checked=active;
        if(active)control.setAttribute('checked','');else control.removeAttribute('checked');
      }
      panel.setAttribute('aria-hidden',String(!active));
      if(active){panel.removeAttribute('hidden');panel.removeAttribute('inert');if(panel.style.display==='none')panel.style.removeProperty('display');}
      else {panel.setAttribute('hidden','');panel.style.setProperty('display','none','important');}
    });
  });
  groups.forEach((group,index)=>{
    const active=state.selected[index];if(active<0)return;
    const panel=doc.querySelector('[data-html-canvas-panel="'+group.items[active].panel+'"]') as HTMLElement;
    if(computed(panel)?.display==='none')panel.style.setProperty('display',panel.getAttribute('data-figma-display') || fallback[index],'important');
    panel.style.setProperty('visibility','visible','important');panel.style.setProperty('opacity','1','important');
  });
}
