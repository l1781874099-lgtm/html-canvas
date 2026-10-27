import { Element, Node, getComputedStyle } from '../environment';
import { LocalImportOptions } from '../../../shared/local-import';

export function htmlName(element: Element) {
  const id=element.getAttribute('id');
  const classes=(element.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0,3);
  return (element.tagName.toLowerCase()+(id?'#'+id:'')+(classes.length?'.'+classes.join('.'):'' )).slice(0,110);
}

export function addImportMetadata(layers:any[],options:Partial<LocalImportOptions>) {
  function visit(layer:any){
    const ref=layer.ref;
    const el=ref instanceof Element?ref:ref?.parentElement;
    if(el){
      if(options.htmlNames)layer.name=htmlName(el)+(layer.type==='TEXT'?' · '+String(layer.characters || '').slice(0,18):'');
      const hoverKey=el.getAttribute('data-local-hover-key');
      if(hoverKey && ref===el)layer.hoverKey=hoverKey;
      if(options.autoLayout && layer.type==='FRAME' && ref===el && layer.children?.length){
        const style=getComputedStyle(el);
        if(['flex','inline-flex'].includes(style.display) && style.flexWrap==='nowrap' && !style.flexDirection.endsWith('reverse')){
          const horizontal=style.flexDirection==='row';
          const flow:number[]=[];
          layer.children.forEach((child:any,index:number)=>{
            const childEl=child.ref instanceof Element?child.ref:child.ref?.parentElement;
            if(child.ref===ref || !childEl)return;
            const position=getComputedStyle(childEl).position;
            if(position!=='absolute' && position!=='fixed')flow.push(index);
          });
          if(flow.length){
            layer.autoLayout={horizontal,flow,
              paddingLeft:parseFloat(style.paddingLeft)||0,paddingRight:parseFloat(style.paddingRight)||0,
              paddingTop:parseFloat(style.paddingTop)||0,paddingBottom:parseFloat(style.paddingBottom)||0,
              gap:parseFloat(horizontal?style.columnGap:style.rowGap)||0,
              justify:style.justifyContent,align:style.alignItems};
          }
        }
      }
    }
    (layer.children || []).forEach(visit);
  }
  layers.forEach(visit);
}
