import { document, HTMLImageElement, HTMLVideoElement, SVGSVGElement, imageDensity } from "../environment";
import { imagePlacement } from './image-layout';
interface ImagePaintWithUrl extends ImagePaint {
  url: string;
}

export const getImagePaintWithUrl = ({
  computedStyle,
  el,
}: {
  computedStyle: CSSStyleDeclaration;
  el: Element;
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
            const scale=Math.min(imageDensity || 3,4096/width,4096/height,Math.sqrt(12_000_000/(width*height)));
            const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil(width*scale));canvas.height=Math.max(1,Math.ceil(height*scale));
            const context=canvas.getContext('2d');
            if(context){
              context.scale(scale,scale);
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
