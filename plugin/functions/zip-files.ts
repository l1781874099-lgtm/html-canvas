import { unzipSync, strFromU8 } from 'fflate';
export interface ImportPage {name:string; html:string; warnings:string[]}
export const archiveLimits={compressed:32*1024*1024,expanded:128*1024*1024,entry:32*1024*1024,files:1000,pages:50};

export function normalizeArchivePath(value:string,base=''):string {
  const parts:string[]=[];
  let path=value.replace(/\\/g,'/');
  try{path=decodeURIComponent(path);}catch(_error){}
  if(!path.startsWith('/'))path=base.slice(0,base.lastIndexOf('/')+1)+path;
  for(const part of path.split('/')){
    if(!part || part==='.')continue;
    if(part==='..'){if(!parts.length)throw new Error('资源路径超出 ZIP 根目录');parts.pop();}
    else {if(part.indexOf('\0')!==-1)throw new Error('资源路径无效');parts.push(part);}
  }
  return parts.join('/');
}
export function readArchive(bytes:Uint8Array):Map<string,Uint8Array>{
  if(bytes.length>archiveLimits.compressed)throw new Error('ZIP 请小于 32 MB');
  let count=0,total=0;
  const entries=unzipSync(bytes,{filter(entry){
    if(++count>archiveLimits.files)throw new Error('ZIP 文件数超过 1000');
    total+=entry.originalSize;
    if(entry.originalSize>archiveLimits.entry || total>archiveLimits.expanded)throw new Error('ZIP 解压后过大，请拆成较小文件');
    return !entry.name.endsWith('/') && !/^(__MACOSX\/|.*\/\.DS_Store$)/.test(entry.name);
  }});
  const files=new Map<string,Uint8Array>();let actual=0;
  for(const name of Object.keys(entries)){
    const normalized=normalizeArchivePath(name),data=entries[name];actual+=data.length;
    if(data.length>archiveLimits.entry || actual>archiveLimits.expanded)throw new Error('ZIP 解压后过大');
    if(files.has(normalized))throw new Error('ZIP 包含重复路径：'+normalized);
    files.set(normalized,data);
  }
  return files;
}
const mimeTypes:{[key:string]:string}={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',svg:'image/svg+xml',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',ico:'image/x-icon'};
function dataUri(bytes:Uint8Array,path:string):string {
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return 'data:'+(mimeTypes[path.split('.').pop()!.toLowerCase()] || 'application/octet-stream')+';base64,'+btoa(binary);
}
const external=(url:string)=>/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url);

export function inlineArchivePage(name:string,files:Map<string,Uint8Array>):ImportPage {
  const warnings=new Set<string>(),cache=new Map<string,string>();
  const paths=Array.from(files.keys()),prefix=paths[0]?.split('/')[0]+'/';
  const webRoot=paths.length && paths.every(path=>path.startsWith(prefix))?prefix:'';
  const resolve=(url:string,base:string)=>normalizeArchivePath(url.startsWith('/')?'/'+webRoot+url.replace(/^\/+/, '').split(/[?#]/)[0]:url.split(/[?#]/)[0],base);
  const asset=(value:string,base:string,stack:string[]=[]):string=>{
    const url=value.trim();if(!url || url[0]==='#' || /^data:/i.test(url))return url;
    if(external(url)){warnings.add('未导入外部资源：'+url);return 'data:,';}
    let path:string;
    try{path=resolve(url,base);}catch(error){warnings.add(String(error));return 'data:,';}
    if(cache.has(path))return cache.get(path)!;
    const bytes=files.get(path);
    if(!bytes){warnings.add('缺少资源：'+path);return 'data:,';}
    if(stack.includes(path)||stack.length>=16){warnings.add('资源循环引用：'+path);return 'data:,';}
    let data=bytes;
    if(/\.svg$/i.test(path)){
      const doc=new DOMParser().parseFromString(strFromU8(bytes),'image/svg+xml');
      doc.querySelectorAll('script,foreignObject').forEach(el=>el.remove());
      doc.querySelectorAll('image').forEach(el=>{for(const attr of ['href','xlink:href'])if(el.hasAttribute(attr))el.setAttribute(attr,asset(el.getAttribute(attr)!,path,[...stack,path]));});
      data=new TextEncoder().encode(doc.documentElement.outerHTML);
    }
    const encoded=dataUri(data,path);cache.set(path,encoded);return encoded;
  };
  const rewriteCss=(css:string,base:string,stack:string[]=[]):string=>{
    // Expand imports before URLs so each stylesheet keeps its own resource base.
    css=css.replace(/@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)|"([^"]*)"|'([^']*)')\s*([^;]*);/gi,(_m,a,b,c,d,e,media)=>{
      const url=a||b||c||d||e;if(external(url)){warnings.add('未导入外部样式：'+url);return '';}
      let path:string;try{path=resolve(url,base);}catch(error){warnings.add(String(error));return '';}
      const bytes=files.get(path);
      if(!bytes){warnings.add('缺少样式：'+path);return '';}
      if(stack.includes(path)||stack.length>=16){warnings.add('样式循环引用：'+path);return '';}
      const content=rewriteCss(strFromU8(bytes),path,[...stack,path]);
      return media.trim()?'@media '+media.trim()+'{'+content+'}':content;
    });
    return css.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,(_m,a,b,c)=>'url("'+asset(a||b||c||'',base)+'")');
  };
  const html=files.get(name);if(!html)throw new Error('找不到页面：'+name);
  const doc=new DOMParser().parseFromString(strFromU8(html),'text/html');
  doc.querySelectorAll('link[rel~="stylesheet"]').forEach(link=>{
    const href=link.getAttribute('href') || '';let css='';
    if(external(href))warnings.add('未导入外部样式：'+href);
    else {try{const path=resolve(href,name),bytes=files.get(path);if(bytes)css=rewriteCss(strFromU8(bytes),path,[path]);else warnings.add('缺少样式：'+path);}catch(error){warnings.add(String(error));}}
    const style=doc.createElement('style');style.textContent=css;
    if(link.getAttribute('media'))style.setAttribute('media',link.getAttribute('media')!);
    link.parentNode!.replaceChild(style,link);
  });
  doc.querySelectorAll('style').forEach(style=>{style.textContent=rewriteCss(style.textContent || '',name);});
  doc.querySelectorAll('[style]').forEach(el=>el.setAttribute('style',rewriteCss(el.getAttribute('style') || '',name)));
  doc.querySelectorAll('img').forEach(el=>{
    const picture=el.parentElement?.tagName.toLowerCase()==='picture'?el.parentElement:null;
    // Lazy-load scripts never run; their real source must be packed too.
    const lazy=el.getAttribute('data-src') || el.getAttribute('data-original') || el.getAttribute('data-lazy-src');
    if(lazy && (!el.getAttribute('src') || /^data:(,|image\/gif)/i.test(el.getAttribute('src')!)))el.setAttribute('src',lazy);
    if(el.getAttribute('data-srcset') && !el.getAttribute('srcset'))el.setAttribute('srcset',el.getAttribute('data-srcset')!);
    let srcset=el.getAttribute('srcset') || '';
    if(picture){const source=Array.from(picture.querySelectorAll('source')).find(s=>!s.getAttribute('media'));if(source)srcset=source.getAttribute('srcset') || srcset;}
    if(srcset && !/^\s*data:/i.test(srcset)){
      const candidates=srcset.split(',').map(s=>s.trim().split(/\s+/)).sort((a,b)=>parseFloat(b[1]||'1')-parseFloat(a[1]||'1'));
      if(candidates[0])el.setAttribute('src',candidates[0][0]);
    }
    el.removeAttribute('srcset');el.removeAttribute('sizes');el.removeAttribute('loading');
    if(el.hasAttribute('src'))el.setAttribute('src',asset(el.getAttribute('src')!,name));
    picture?.querySelectorAll('source').forEach(source=>source.remove());
  });
  doc.querySelectorAll('image').forEach(el=>{for(const attr of ['href','xlink:href'])if(el.hasAttribute(attr))el.setAttribute(attr,asset(el.getAttribute(attr)!,name));});
  doc.querySelectorAll('[poster]').forEach(el=>el.setAttribute('poster',asset(el.getAttribute('poster')!,name)));
  return {name,html:'<!doctype html>'+doc.documentElement.outerHTML,warnings:Array.from(warnings)};
}
export async function prepareImportFiles(files:File[],report:(label:string)=>void):Promise<{pages:ImportPage[];errors:string[]}>{
  const pages:ImportPage[]=[],errors:string[]=[];
  for(const file of files){
    try{
      if(/\.zip$/i.test(file.name)){
        report('正在解压 '+file.name+'……');
        const archive=readArchive(new Uint8Array(await file.arrayBuffer()));
        const names=Array.from(archive.keys()).filter(name=>/\.html?$/i.test(name)).sort((a,b)=>a.localeCompare(b));
        if(!names.length)throw new Error('ZIP 中没有 HTML 页面');
        if(names.length>archiveLimits.pages)throw new Error('单个 ZIP 最多支持 50 个页面，请拆分导入');
        for(const name of names){report('正在打包资源：'+name);pages.push(inlineArchivePage(name,archive));await new Promise(resolve=>setTimeout(resolve,0));}
      }else if(/\.html?$/i.test(file.name))pages.push({name:file.name,html:await file.text(),warnings:[]});
      else throw new Error('请选择 HTML 或 ZIP 文件');
    }catch(error){errors.push(file.name+'：'+(error instanceof Error?error.message:String(error)));}
  }
  return {pages,errors};
}
