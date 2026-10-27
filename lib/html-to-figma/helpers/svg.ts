import { document, SVGSVGElement, getComputedStyle } from "../environment";
import { LayerNode } from "../types/nodes";
import { dashedCirclePath } from './dashed-circle';

export const processSvgUseElements = (el: Element) => {
  // Process SVG <use> elements
  for (const use of Array.from(el.querySelectorAll("use"))) {
    try {
      const symbolSelector = use.href.baseVal;
      const symbol: SVGSymbolElement | null =
        document.querySelector(symbolSelector);
      if (symbol) {
        use.outerHTML = symbol.innerHTML;
      }
    } catch (err) {
      console.warn("Error querying <use> tag href", err);
    }
  }
};

export const createSvgLayer = (el: SVGSVGElement) => {
  const rect = el.getBoundingClientRect();
  const clone=el.cloneNode(true) as SVGSVGElement;
  const originals=[el,...Array.from(el.querySelectorAll('*'))];
  const copies=[clone,...Array.from(clone.querySelectorAll('*'))];
  const properties=['fill','fill-opacity','stroke','stroke-width','stroke-opacity','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','opacity','font-family','font-size','font-weight','text-anchor'];
  originals.forEach((source,index)=>{
    const target=copies[index] as SVGElement;
    const style=getComputedStyle(source);
    properties.forEach(property=>{
      const value=style.getPropertyValue(property);
      if(value)target.style.setProperty(property,value);
    });
    if(source.tagName.toLowerCase()==='circle'){
      const dash=style.strokeDasharray || source.getAttribute('stroke-dasharray') || '';
      if(dash && dash!=='none'){
        const circle=source as SVGCircleElement;
        const array=dash.split(/[\s,]+/).map(parseFloat).filter(Number.isFinite);
        const path=dashedCirclePath(circle.cx.baseVal.value,circle.cy.baseVal.value,circle.r.baseVal.value,array,parseFloat(style.strokeDashoffset || '0'));
        if(path){
          const replacement=document.createElementNS('http://www.w3.org/2000/svg','path');
          Array.from(target.attributes).forEach(attr=>{if(!['cx','cy','r'].includes(attr.name))replacement.setAttribute(attr.name,attr.value);});
          replacement.setAttribute('d',path);
          replacement.removeAttribute('stroke-dasharray');replacement.removeAttribute('stroke-dashoffset');
          replacement.style.setProperty('stroke-dasharray','none');replacement.style.setProperty('stroke-dashoffset','0');
          target.replaceWith(replacement);
        }
      }
    }
  });
  clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
  clone.setAttribute('width',String(rect.width));clone.setAttribute('height',String(rect.height));
  if(!clone.hasAttribute('viewBox'))clone.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);
  const layer: LayerNode = {
    type: "SVG",
    ref: el,
    svg: clone.outerHTML,
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };

  return layer;
};
