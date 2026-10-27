import { document, getComputedStyle } from '../environment';
import { LayerNode } from '../types/nodes';

// Text symbols can select completely different emoji fonts inside Figma.
// Preserve their browser-rendered shape as a small high-density image instead.
const symbolRun = /([\u2190-\u2bff\u{1f000}-\u{1faff}][\ufe0e\ufe0f\u200d\u2190-\u2bff\u{1f000}-\u{1faff}]*)/gu;
export function splitSymbolRuns(root: Element) {
  const walker=document.createTreeWalker(root,4);
  const nodes: Node[]=[];let n:Node|null;
  while((n=walker.nextNode()))nodes.push(n);
  for(const node of nodes){
    if(node.parentElement?.closest('svg,script,style,noscript'))continue;
    const text=node.textContent || '';
    const pieces=text.split(symbolRun).filter(Boolean);
    if(pieces.length<=1)continue;
    const fragment=document.createDocumentFragment();
    pieces.forEach(piece=>fragment.appendChild(document.createTextNode(piece)));
    node.parentNode!.replaceChild(fragment,node);
  }
}

export function glyphLayer(node: Node): LayerNode | undefined {
  const text=(node.textContent || '').trim();
  if(!text || text.length>16 || !/^[\p{S}\ufe0e\ufe0f\u200d]+$/u.test(text))return;
  const parent=node.parentElement;
  if(!parent || parent.closest('svg,script,style,noscript'))return;
  const style=getComputedStyle(parent);
  const range=document.createRange();range.selectNodeContents(node);
  const rect=range.getBoundingClientRect();range.detach();
  if(rect.width<1 || rect.height<1)return;
  const canvas=document.createElement('canvas');
  const scale=3;canvas.width=Math.ceil(rect.width*scale);canvas.height=Math.ceil(rect.height*scale);
  const ctx=canvas.getContext('2d');if(!ctx)return;
  ctx.scale(scale,scale);
  ctx.font=style.font || `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  ctx.fillStyle=style.color;ctx.textBaseline='alphabetic';
  const metric=ctx.measureText(text) as TextMetrics & {fontBoundingBoxAscent?:number;fontBoundingBoxDescent?:number};
  const ascent=metric.fontBoundingBoxAscent ?? metric.actualBoundingBoxAscent;
  const descent=metric.fontBoundingBoxDescent ?? metric.actualBoundingBoxDescent;
  ctx.fillText(text,0,(rect.height-ascent-descent)/2+ascent);
  return {type:'RECTANGLE',name:'图标 '+text,ref:node,x:rect.left,y:rect.top,width:rect.width,height:rect.height,
    fills:[{type:'IMAGE',scaleMode:'FILL',imageHash:null,url:canvas.toDataURL('image/png')} as any]};
}
