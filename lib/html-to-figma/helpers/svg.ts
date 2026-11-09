import { document, SVGSVGElement, getComputedStyle } from "../environment";
import { LayerNode } from "../types/nodes";
import { dashedCirclePath } from './dashed-circle';

const SVG_NS = "http://www.w3.org/2000/svg";

// Figma's SVG importer can't resolve <use>, so inline each referenced element.
// A <symbol> keeps its own viewBox, which scales it into the <use> box.
export const processSvgUseElements = (el: Element) => {
  for (let pass = 0; pass < 8; pass++) {
    const uses = Array.from(el.querySelectorAll("use"));
    if (!uses.length) return;
    for (const use of uses) {
      try {
        const href = use.getAttribute("href") || use.getAttribute("xlink:href") || "";
        const target = href.startsWith("#") ? document.getElementById(href.slice(1)) : null;
        if (!target || target.contains(use)) { use.remove(); continue; }
        const x = use.getAttribute("x") || "0", y = use.getAttribute("y") || "0";
        const width = use.getAttribute("width"), height = use.getAttribute("height");
        const tag = target.tagName.toLowerCase();
        const viewBox = target.getAttribute("viewBox");
        const owner = use.ownerSVGElement;
        let replacement: Element;
        if ((tag === "symbol" || tag === "svg") && viewBox) {
          if (owner && use.parentNode === owner && !owner.hasAttribute("viewBox") && !width && !height && x === "0" && y === "0") {
            owner.setAttribute("viewBox", viewBox);
            const aspect = target.getAttribute("preserveAspectRatio");
            if (aspect) owner.setAttribute("preserveAspectRatio", aspect);
            replacement = document.createElementNS(SVG_NS, "g");
          } else {
            replacement = document.createElementNS(SVG_NS, "svg");
            replacement.setAttribute("x", x); replacement.setAttribute("y", y);
            replacement.setAttribute("width", width || "100%"); replacement.setAttribute("height", height || "100%");
            replacement.setAttribute("viewBox", viewBox);
            const aspect = target.getAttribute("preserveAspectRatio");
            if (aspect) replacement.setAttribute("preserveAspectRatio", aspect);
          }
          Array.from(target.childNodes).forEach((child) => replacement.appendChild(child.cloneNode(true)));
        } else {
          replacement = document.createElementNS(SVG_NS, "g");
          if (x !== "0" || y !== "0") replacement.setAttribute("transform", `translate(${x} ${y})`);
          if (tag === "symbol" || tag === "svg") Array.from(target.childNodes).forEach((child) => replacement.appendChild(child.cloneNode(true)));
          else { const copy = target.cloneNode(true) as Element; copy.removeAttribute("id"); replacement.appendChild(copy); }
        }
        for (const attr of Array.from(use.attributes)) {
          if (!["href", "xlink:href", "x", "y", "width", "height"].includes(attr.name)) replacement.setAttribute(attr.name, attr.value);
        }
        use.replaceWith(replacement);
      } catch (err) {
        console.warn("Error inlining <use> element", err);
      }
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
    // CSS transforms on SVG children (often from animations) become attributes,
    // with the transform origin resolved against the transform box.
    const transform=style.transform;
    if(index>0 && transform && transform!=='none'){
      let [ox=0,oy=0]=(style.transformOrigin || '').split(/\s+/).map(v=>parseFloat(v)||0);
      if(style.transformBox==='fill-box' || style.transformBox==='content-box'){
        try{const box=(source as SVGGraphicsElement).getBBox();ox+=box.x;oy+=box.y;}catch(_error){}
      }
      target.setAttribute('transform',`translate(${ox} ${oy}) ${transform.replace(/,/g,' ')} translate(${-ox} ${-oy})`);
      target.style.removeProperty('transform');
    }
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
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };

  return layer;
};
