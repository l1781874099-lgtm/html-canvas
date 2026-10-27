import { htmlToFigma } from '../../lib/html-to-figma';
import { LocalImportOptions } from '../../shared/local-import';

// No uploaded scripts execute; the host reads the rendered document directly.
export function makeLocalHtmlDocument(html: string, _token?: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, base, meta[http-equiv], iframe, object, embed, #legacy-capture-button').forEach(el => el.remove());
  doc.querySelectorAll('*').forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      if (/^on/i.test(attr.name) || /^javascript:/i.test(attr.value.trim())) el.removeAttribute(attr.name);
    });
    if (el.tagName.toLowerCase() === 'a') el.removeAttribute('href');
  });
  const policy=doc.createElement('meta');policy.setAttribute('http-equiv','Content-Security-Policy');
  policy.setAttribute('content',"default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; media-src data:; script-src 'none'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'");
  doc.head.prepend(policy);
  return '<!doctype html>' + doc.documentElement.outerHTML;
}

export function renderLocalHtml(html: string, width: number, options:Partial<LocalImportOptions>={}, onProgress?:(fraction:number,label:string)=>void): Promise<{layers: any[]; missing: number; hoverCount:number; warnings:string[]}> {
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
        await boundedWait(doc.fonts.ready);
        await boundedWait(Promise.all(Array.from(doc.images).map(img => img.decode().catch(() => {}))));
        if (finished) return;
        // Force offscreen layout without waiting for suspended animation frames.
        doc.body.getBoundingClientRect();
        onProgress?.(.4,'正在解析页面布局……');
        const layers = htmlToFigma(doc.body, true, false, doc);
        const warnings:string[]=[];
        const hoverCount=0;
        const missing = Array.from(doc.images).filter(img => !img.naturalWidth).length;
        if (!layers.length) throw new Error('没有生成有效图层。');
        finished = true; cleanup(); resolve({layers, missing,hoverCount,warnings});
      } catch (error) { fail(error); }
    };
    timeout = window.setTimeout(() => fail(new Error('HTML 渲染未完成。请检查外部资源，或重新打开插件后再试。')), 15000);
    try {
      frame.srcdoc = makeLocalHtmlDocument(html);
      document.body.appendChild(frame);
    } catch (error) { fail(error); }
  });
}
