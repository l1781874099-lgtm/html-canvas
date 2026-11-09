import { document, HTMLImageElement, HTMLVideoElement, SVGSVGElement, imageDensity } from "../environment";
import { imagePlacement } from './image-layout';
import { drawGradient, splitCssList } from './visual-paints';
interface ImagePaintWithUrl extends ImagePaint {
  url: string;
}

const backgroundImages = new Map<string, HTMLImageElement>();
const urlPattern = /url\(\s*['"]?(.*?)['"]?\s*\)/g;

// Parsing is synchronous, so CSS background images must be decoded beforehand
// to be drawn with their CSS size, position and repeat.
export async function preloadBackgroundImages(doc: Document, timeout = 4000) {
  backgroundImages.clear();
  const view = doc.defaultView;
  if (!view) return;
  const urls = new Set<string>();
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const pseudo of [null, '::before', '::after']) {
      const value = view.getComputedStyle(el, pseudo).backgroundImage;
      if (!value || value.indexOf('url(') === -1) continue;
      let match: RegExpExecArray | null;
      urlPattern.lastIndex = 0;
      while ((match = urlPattern.exec(value))) urls.add(match[1]);
    }
  }
  const loads = Array.from(urls).map(url => {
    const image: HTMLImageElement = new (view as any).Image();
    image.src = url;
    return image.decode().then(() => { backgroundImages.set(url, image); }, () => {});
  });
  await Promise.race([Promise.all(loads), new Promise(resolve => setTimeout(resolve, timeout))]);
}

function cssLength(value: string, size: number): number | undefined {
  const calc = value.match(/^calc\(\s*(-?[\d.]+)%\s*([+-])\s*(-?[\d.]+)px\s*\)$/);
  if (calc) return Number(calc[1]) * size / 100 + (calc[2] === '-' ? -1 : 1) * Number(calc[3]);
  const match = value.match(/^(-?[\d.]+)(px|%)$/);
  if (match) return Number(match[1]) * (match[2] === '%' ? size / 100 : 1);
}

export function rasterCanvas(width: number, height: number) {
  const scale = Math.min(imageDensity || 3, 4096 / width, 4096 / height, Math.sqrt(12_000_000 / (width * height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width * scale)); canvas.height = Math.max(1, Math.ceil(height * scale));
  const context = canvas.getContext('2d');
  if (context) context.scale(scale, scale);
  return { canvas, context, scale };
}

interface TileSource {
  // Intrinsic size; gradients have none.
  naturalWidth?: number;
  naturalHeight?: number;
  draw(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void;
}

function layerValue(style: CSSStyleDeclaration, index: number) {
  return (value: string | undefined, fallback: string) => {
    const list = splitCssList(value || '').filter(Boolean);
    return list.length ? list[index % list.length] : fallback;
  };
}

// Renders one CSS background layer with its size, position, repeat and origin.
function tiledPaint(source: TileSource, index: number, style: CSSStyleDeclaration, width: number, height: number, filter = 'none'): ImagePaint | undefined {
  const pick = layerValue(style, index);
  const size = pick(style.backgroundSize, 'auto');
  const repeat = pick(style.backgroundRepeat, 'repeat').split(/\s+/);
  const posX = pick(style.backgroundPositionX, '0%'), posY = pick(style.backgroundPositionY, '0%');
  const border = (side: string) => parseFloat((style as any)['border' + side + 'Width']) || 0;
  const padding = (side: string) => parseFloat((style as any)['padding' + side]) || 0;
  let x0 = 0, y0 = 0, areaW = width, areaH = height;
  const origin = pick(style.backgroundOrigin, 'padding-box');
  if (origin !== 'border-box') {
    x0 += border('Left'); y0 += border('Top');
    areaW -= border('Left') + border('Right'); areaH -= border('Top') + border('Bottom');
    if (origin === 'content-box') {
      x0 += padding('Left'); y0 += padding('Top');
      areaW -= padding('Left') + padding('Right'); areaH -= padding('Top') + padding('Bottom');
    }
  }
  const intrinsic = !!(source.naturalWidth && source.naturalHeight);
  const naturalW = source.naturalWidth || areaW, naturalH = source.naturalHeight || areaH;
  let tileW = naturalW, tileH = naturalH;
  if (size === 'cover' || size === 'contain') {
    const scale = (size === 'cover' ? Math.max : Math.min)(areaW / naturalW, areaH / naturalH);
    tileW = naturalW * scale; tileH = naturalH * scale;
  } else {
    const [w = 'auto', h = 'auto'] = size.split(/\s+/);
    const explicitW = w === 'auto' ? undefined : cssLength(w, areaW);
    const explicitH = h === 'auto' ? undefined : cssLength(h, areaH);
    if (intrinsic) {
      tileW = explicitW ?? (explicitH !== undefined ? explicitH * naturalW / naturalH : naturalW);
      tileH = explicitH ?? (explicitW !== undefined ? explicitW * naturalH / naturalW : naturalH);
    } else {
      tileW = explicitW ?? areaW;
      tileH = explicitH ?? areaH;
    }
  }
  if (!(tileW >= .5 && tileH >= .5)) return;
  const percent = (value: string) => { const m = value.match(/^(-?[\d.]+)%$/); return m ? Number(m[1]) / 100 : undefined; };
  const offset = (value: string, area: number, tile: number) => {
    const p = percent(value);
    if (p !== undefined) return (area - tile) * p;
    const calc = value.match(/^calc\(\s*(-?[\d.]+)%\s*([+-])\s*(-?[\d.]+)px\s*\)$/);
    if (calc) return (area - tile) * Number(calc[1]) / 100 + (calc[2] === '-' ? -1 : 1) * Number(calc[3]);
    return parseFloat(value) || 0;
  };
  const left = x0 + offset(posX, areaW, tileW), top = y0 + offset(posY, areaH, tileH);
  const repeatX = repeat[0] === 'repeat-x' || (repeat[0] !== 'repeat-y' && repeat[0] !== 'no-repeat');
  const repeatY = repeat[0] === 'repeat-y' || (repeat[0] !== 'repeat-x' && (repeat[1] || repeat[0]) !== 'no-repeat');
  const startX = repeatX ? left - Math.ceil(left / tileW) * tileW : left;
  const startY = repeatY ? top - Math.ceil(top / tileH) * tileH : top;
  const countX = repeatX ? Math.ceil((width - startX) / tileW) : 1;
  const countY = repeatY ? Math.ceil((height - startY) / tileH) : 1;
  if (countX * countY > 20000) return;
  const { canvas, context } = rasterCanvas(width, height);
  if (!context) return;
  if (filter !== 'none') context.filter = filter;
  for (let ix = 0; ix < countX; ix++) for (let iy = 0; iy < countY; iy++) {
    source.draw(context, startX + ix * tileW, startY + iy * tileH, tileW, tileH);
  }
  return {type: 'IMAGE', scaleMode: 'FILL', imageHash: null, url: canvas.toDataURL('image/png')} as ImagePaintWithUrl;
}

export function backgroundImagePaint(url: string, index: number, style: CSSStyleDeclaration, width: number, height: number, filter = 'none'): ImagePaintWithUrl | undefined {
  if (!url || url === 'data:,') return;
  const pick = layerValue(style, index);
  const size = pick(style.backgroundSize, 'auto');
  const repeat = pick(style.backgroundRepeat, 'repeat').split(/\s+/);
  const centered = pick(style.backgroundPositionX, '0%') === '50%' && pick(style.backgroundPositionY, '0%') === '50%';
  const image = backgroundImages.get(url);
  const fallback: ImagePaintWithUrl = {url, type: 'IMAGE', scaleMode: size === 'contain' ? 'FIT' : 'FILL', imageHash: null};
  if (!image || width < 1 || height < 1) return fallback;
  if (filter === 'none' && centered && (size === 'cover' || (size === 'contain' && repeat[0] === 'no-repeat'))) return fallback;
  try {
    const paint = tiledPaint({
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      draw: (context, x, y, w, h) => context.drawImage(image, x, y, w, h),
    }, index, style, width, height, filter);
    return (paint as ImagePaintWithUrl) || fallback;
  } catch (error) {
    console.warn('背景图片绘制失败，改用原始图片', error);
    return fallback;
  }
}

// Gradients Figma can't express natively: conic ones, and any gradient layer
// that is sized, offset or tiled (stripes, grids, dot patterns).
export function backgroundGradientPaint(image: string, index: number, style: CSSStyleDeclaration, width: number, height: number): ImagePaint | undefined {
  if (!/gradient\(/i.test(image) || width < 1 || height < 1) return;
  const pick = layerValue(style, index);
  const size = pick(style.backgroundSize, 'auto');
  const position = pick(style.backgroundPositionX, '0%') + ' ' + pick(style.backgroundPositionY, '0%');
  const plain = /^(auto|auto auto|100% 100%|cover|contain)$/.test(size) && /^0(%|px) 0(%|px)$/.test(position);
  if (plain && !/conic-gradient\(/i.test(image)) return;
  try {
    return tiledPaint({
      draw: (context, x, y, w, h) => {
        context.save();
        context.translate(x, y);
        drawGradient(context, image, w, h);
        context.restore();
      },
    }, index, style, width, height);
  } catch (error) {
    console.warn('渐变背景绘制失败', error);
  }
}

export const getImagePaintWithUrl = ({
  computedStyle,
  el,
  filter = 'none',
}: {
  computedStyle: CSSStyleDeclaration;
  el: Element;
  filter?: string;
}): ImagePaintWithUrl | undefined => {
  if (el instanceof SVGSVGElement) {
    const url = `data:image/svg+xml,${encodeURIComponent(
      el.outerHTML.replace(/\s+/g, " ")
    )}`;
    return {
      url,
      type: "IMAGE",
      // TODO: object fit, position
      scaleMode: "FILL",
      imageHash: null,
    };
  } else {
    const baseImagePaint: ImagePaint = {
      type: "IMAGE",
      // TODO: object fit, position
      scaleMode: computedStyle.objectFit === "contain" ? "FIT" : "FILL",
      imageHash: null,
    };

    if (el instanceof HTMLImageElement) {
      // A linked SVG is still an image box. Converting it into native vectors
      // and resizing it distorts cover/contain cropping and loses corner masks.
      // Render that box at high density, keeping the original CSS crop exactly.
      if(el.complete && el.naturalWidth>0 && el.naturalHeight>0){
        try {
          const rect=el.getBoundingClientRect();
          const width=parseFloat(computedStyle.width)||rect.width;
          const height=parseFloat(computedStyle.height)||rect.height;
          if(width>0 && height>0){
            const {canvas,context}=rasterCanvas(width,height);
            if(context){
              if(filter!=='none')context.filter=filter;
              const p=imagePlacement(el.naturalWidth,el.naturalHeight,width,height,computedStyle.objectFit || 'fill',computedStyle.objectPosition);
              context.drawImage(el,p.x,p.y,p.width,p.height);
              return {type:'IMAGE',scaleMode:'FILL',imageHash:null,url:canvas.toDataURL('image/png')};
            }
          }
        }catch(error){console.warn('图片预裁切失败，改用原始图片',error);}
      }
      // we use `currentSrc` instead of `src` as that will be the accurate value in dynamic contexts:
      // when the img is a child of a picture element, or it has `sizes`/`srcSet` attributes, etc.
      const url = el.currentSrc;
      if (url) {
        return {
          url,
          ...baseImagePaint,
        };
      }
    } else if (el instanceof HTMLVideoElement) {
      const url = el.poster;
      if (url) {
        return {
          url,
          ...baseImagePaint,
        };
      }
    }
  }

  // can this be true _and_ one of the previous IFs?
  // i.e. could an element have a computed bg image and be an SVG/img/picture/video element?
  // probably not, we can likely avoid returning this fill _and_ the previous ones.
  // TO-DO: what happens if this is in the fills array, along with something else e.g. an img?
  if (
    computedStyle.backgroundImage &&
    computedStyle.backgroundImage !== "none"
  ) {
    const urlMatch = computedStyle.backgroundImage.match(
      /url\(['"]?(.*?)['"]?\)/
    );
    const url = urlMatch?.[1];
    if (url) {
      return {
        url,
        type: "IMAGE",
        // TODO: background size, position
        scaleMode: computedStyle.backgroundSize === "contain" ? "FIT" : "FILL",
        imageHash: null,
      };
    }
  }

  return undefined;
};
