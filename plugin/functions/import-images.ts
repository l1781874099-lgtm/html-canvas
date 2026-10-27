import { transformWebpToPNG } from './encode-images';
export function getImageFills(layer:any):any[]{
  return Array.isArray(layer.fills)?layer.fills.filter((paint:any)=>paint.type==='IMAGE' && paint.visible!==false && paint.opacity!==0):[];
}
export async function processImages(layer:any){
  for(const paint of getImageFills(layer)){
    if(!paint.url)continue;
    const url=String(paint.url),comma=url.indexOf(',');
    if(!/^data:/i.test(url) || comma<0)throw new Error('图片未内嵌，请把图片放进 ZIP：'+url.slice(0,120));
    const header=url.slice(0,comma),payload=url.slice(comma+1);
    const bytes=/;base64/i.test(header)?Uint8Array.from(atob(payload),c=>c.charCodeAt(0)):new TextEncoder().encode(decodeURIComponent(payload));
    if(/image\/svg\+xml/i.test(header)){
      layer.type='SVG';layer.svg=new TextDecoder().decode(bytes);layer.fills=layer.fills.filter((item:any)=>item.type!=='IMAGE');
    }else paint.intArr=/image\/(webp|avif)/i.test(header)?await transformWebpToPNG(bytes):bytes;
    delete paint.url;
  }
}
