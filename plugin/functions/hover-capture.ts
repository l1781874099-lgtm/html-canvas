export function hoverSelector(selector:string):string {
  return selector.replace(/:hover\b/g,'[data-local-hover="true"]');
}

export function prepareHoverCapture(doc:Document) {
  const candidates=new Set<Element>();const rewritten:string[]=[];
  const inspect=(rules:CSSRuleList,wrap:(text:string)=>string=(text=>text))=>{
    for(const rule of Array.from(rules)){
      const style=rule as CSSStyleRule;
      if(style.selectorText && style.selectorText.includes(':hover')){
        const text=hoverSelector(style.selectorText)+'{'+style.style.cssText+'}';
        rewritten.push(wrap(text));
        // Locate the element receiving hover, including descendant hover rules.
        for(const selector of style.selectorText.split(',')){
          const end=selector.indexOf(':hover');if(end<0)continue;
          const target=selector.slice(0,end).trim();
          try{doc.querySelectorAll(target).forEach(el=>{if(!['HTML','BODY'].includes(el.tagName))candidates.add(el);});}catch(_error){}
        }
      } else if((rule as CSSGroupingRule).cssRules){
        const nested=rule as CSSGroupingRule;
        const header=rule.cssText.slice(0,rule.cssText.indexOf('{')).trim();
        inspect(nested.cssRules,text=>wrap(header+'{'+text+'}'));
      }
    }
  };
  for(const sheet of Array.from(doc.styleSheets || [])){try{inspect(sheet.cssRules);}catch(_error){}}
  const elements=Array.from(candidates).filter(el=>{
    const r=el.getBoundingClientRect();return r.width>0 && r.height>0;
  }).slice(0,60);
  elements.forEach((el,i)=>el.setAttribute('data-local-hover-key','hover-'+i));
  const style=doc.createElement('style');style.textContent=rewritten.join('\n');doc.head.appendChild(style);
  return {elements,truncated:candidates.size>60};
}

export async function upgradeImageSources(doc:Document) {
  const decode=(image:HTMLImageElement)=>new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('image timeout')),5000);
    image.decode().then(()=>{clearTimeout(timer);resolve();},error=>{clearTimeout(timer);reject(error);});
  });
  const work=Array.from(doc.images).map(async image=>{
    const candidates=(image.getAttribute('srcset') || '').split(',').map(part=>{
      const match=part.trim().match(/^(\S+)\s+([\d.]+)(w|x)$/);
      return match?{url:match[1],size:Number(match[2])}:null;
    }).filter(Boolean) as {url:string;size:number}[];
    candidates.sort((a,b)=>b.size-a.size);
    const original=image.getAttribute('data-full-src') || image.getAttribute('data-original') || candidates[0]?.url;
    if(!original || original.startsWith('javascript:'))return;
    const previous=image.src,previousSrcset=image.getAttribute('srcset');
    image.removeAttribute('srcset');image.src=original;
    try{
      await decode(image);
    }catch(_error){image.src=previous;if(previousSrcset)image.setAttribute('srcset',previousSrcset);await decode(image).catch(()=>{});}
  });
  await Promise.all(work);
}
