import { setDomDocument, setImageDensity } from "./environment";
import { LocalImportOptions } from '../../shared/local-import';
import { document, window, HTMLElement, HTMLImageElement, HTMLVideoElement, HTMLPictureElement, HTMLSourceElement, SVGSVGElement, SVGElement, getComputedStyle } from "./environment";
import { getBoundingClientRect } from "./helpers/dimensions";
import { backgroundGradientPaint, backgroundImagePaint, getImagePaintWithUrl } from "./helpers/image";
import { effectiveOpacity, elementName, isHidden, resetNodeCaches, textNodesUnder, traverse } from "./helpers/nodes";
import { size } from "./helpers/object";
import {
  getBorders,
  getAppliedComputedStyles,
  getShadowEffects,
  getBorderRadii,
  getFilterEffects,
  colorFilter,
  getBlendMode,
  getClipShape,
  getOutline,
} from "./helpers/styles";
import { createSvgLayer, processSvgUseElements } from "./helpers/svg";
import { buildTextNodes, setFontPolicy } from "./helpers/text";
import { backgroundPaints, paintsToSvg } from './helpers/visual-paints';
import { captureTransforms, finalizeTransforms, placeLayer } from './helpers/transforms';
import { glyphLayer, splitSymbolRuns } from './helpers/glyphs';
import { materializeFormLabels } from './helpers/form-labels';
import { materializePseudoElements } from './helpers/pseudo';
import { getLayersForFrames } from "./helpers/frames";
import { LayerNode, WithRef } from "./types/nodes";

export { preloadBackgroundImages } from "./helpers/image";
export { rasterizedFonts } from "./helpers/text";

const generateElements = (el: Element) => {
  const els: Element[] = [];
  const visit = (parent: Element | ShadowRoot) => {
    for (const child of Array.from(parent.querySelectorAll("*"))) {
      els.push(child);
      if (child.shadowRoot) visit(child.shadowRoot);
    }
  };
  visit(el);
  return els;
};

function removeRefs({
  layers,
  root,
}: {
  layers: LayerNode[];
  root: WithRef<FrameNode>;
}) {
  layers.concat([root]).forEach((layer) => {
    traverse(layer, (child) => {
      delete child.ref;
    });
  });
}

// Static captures should show the settled state, not the first frame of an
// entrance animation (which is often fully transparent).
function settleAnimations(doc: Document) {
  const animations: Animation[] = (doc as any).getAnimations?.() || [];
  for (const animation of animations) {
    try { animation.finish(); } catch (_error) { try { animation.cancel(); } catch (_ignored) {} }
  }
}

// Native checkboxes and radios have no stylable box; draw the default control.
function formControlLayer(el: Element): LayerNode | undefined {
  if (el.tagName.toLowerCase() !== "input") return;
  const type = (el.getAttribute("type") || "").toLowerCase();
  if (type !== "checkbox" && type !== "radio") return;
  const style = getComputedStyle(el);
  if (style.appearance === "none" || (style as any).webkitAppearance === "none") return;
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  const checked = !!(el as any).checked;
  const accent = style.accentColor && style.accentColor !== "auto" ? style.accentColor : "#0075ff";
  const shape = type === "radio"
    ? checked
      ? `<circle cx="8" cy="8" r="7.5" fill="${accent}"/><circle cx="8" cy="8" r="3" fill="#fff"/>`
      : `<circle cx="8" cy="8" r="7.25" fill="#fff" stroke="#767676" stroke-width="1.5"/>`
    : checked
      ? `<rect width="16" height="16" rx="3" fill="${accent}"/><path d="M4 8.5l2.8 2.8L12 5.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<rect x=".75" y=".75" width="14.5" height="14.5" rx="2.5" fill="#fff" stroke="#767676" stroke-width="1.5"/>`;
  return {
    type: "SVG",
    ref: el,
    name: type,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}" viewBox="0 0 16 16">${shape}</svg>`,
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  } as LayerNode;
}

const getLayersForElement = (el: Element) => {
  if (isHidden(el)) {
    return [];
  }
  const opacity = effectiveOpacity(el);
  if (opacity <= 0.01) return [];
  const withOpacity = <T extends LayerNode>(layer: T): T => {
    if (opacity < 1) (layer as any).opacity = opacity;
    return layer;
  };
  if (el instanceof SVGSVGElement) {
    const svgLayer = withOpacity(createSvgLayer(el)) as any;
    const svgStyle = getComputedStyle(el);
    const effects = getFilterEffects(svgStyle);
    if (effects.length) svgLayer.effects = effects;
    const blendMode = getBlendMode(svgStyle);
    if (blendMode) svgLayer.blendMode = blendMode;
    return [svgLayer];
  }
  // Sub SVG Eleemnt
  else if (el instanceof SVGElement) {
    return [];
  }

  // for `picture`, we only need the `image` element. We can ignore the parent `picture` and
  // `source` sibling elements.
  if (
    (el.parentElement instanceof HTMLPictureElement &&
      el instanceof HTMLSourceElement) ||
    el instanceof HTMLPictureElement
  ) {
    return [];
  }

  const control = formControlLayer(el);
  if (control) return [withOpacity(control)];

  const computedStyle = getComputedStyle(el);
  const appliedStyles = getAppliedComputedStyles(el);
  const isMedia = el instanceof HTMLImageElement || el instanceof HTMLVideoElement;
  // Clipping and blurring elements need a container even without own paint.
  const clips = computedStyle.overflowX !== "visible" || computedStyle.overflowY !== "visible";
  const filterEffects = getFilterEffects(computedStyle);
  const hasOutline = computedStyle.outlineStyle !== "none" && parseFloat(computedStyle.outlineWidth) > 0;
  if (!(size(appliedStyles) || isMedia || (clips && el.childNodes.length) || filterEffects.length || hasOutline)) {
    return [];
  }

  const rect = getBoundingClientRect(el);
  if (rect.width < 1 || rect.height < 1) return [];

  const imageFilter = colorFilter(computedStyle);
  const textClip = (computedStyle.backgroundClip || (computedStyle as any).webkitBackgroundClip) === "text";
  const fills = textClip ? [] : backgroundPaints(computedStyle, rect.width, rect.height,
    (url, index) => backgroundImagePaint(url, index, computedStyle, rect.width, rect.height, imageFilter),
    (image, index) => backgroundGradientPaint(image, index, computedStyle, rect.width, rect.height));

  let rectNode: WithRef<LayerNode> = withOpacity({
    type: "RECTANGLE",
    ref: el,
    name: elementName(el),
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    fills,
  } as WithRef<RectangleNode>);

  const borders = getBorders({ computedStyle, rect, el });
  if (borders.props) Object.assign(rectNode, borders.props);

  if (isMedia) {
    const imagePaint = getImagePaintWithUrl({ computedStyle, el, filter: imageFilter });
    if (imagePaint) fills.push(imagePaint);
  }

  const effects = [...(getShadowEffects({ computedStyle }) || []), ...filterEffects];
  if (effects.length) (rectNode as RectangleNode).effects = effects;

  const radii = getBorderRadii({ computedStyle, width: rect.width, height: rect.height });
  Object.assign(rectNode, radii);

  const blendMode = getBlendMode(computedStyle);
  if (blendMode) (rectNode as RectangleNode).blendMode = blendMode;

  const clipShape = getClipShape(computedStyle, rect.width, rect.height);
  if (clipShape?.kind === "inset") {
    Object.assign(rectNode, {
      x: rect.left + clipShape.left,
      y: rect.top + clipShape.top,
      width: Math.max(1, rect.width - clipShape.left - clipShape.right),
      height: Math.max(1, rect.height - clipShape.top - clipShape.bottom),
    });
    if (clipShape.radius !== undefined) {
      for (const key of ["topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius"]) (rectNode as any)[key] = clipShape.radius;
    }
  } else if (clipShape?.kind === "svg") {
    const { fills: _fills, strokes: _strokes, strokeWeight: _weight, ...rest } = rectNode as any;
    rectNode = { ...rest, type: "SVG", svg: paintsToSvg(fills, rect.width, rect.height, clipShape.shape) } as WithRef<LayerNode>;
  }

  const outline = hasOutline ? getOutline({ computedStyle, rect, radii: radii as any }) : undefined;
  if (outline) (outline as any).ref = el;
  const extra = clipShape ? [] : borders.layers;
  return [rectNode, ...extra, ...(outline ? [outline] : [])].map(layer => {
    if (blendMode && !(layer as any).blendMode) (layer as any).blendMode = blendMode;
    return layer === rectNode ? layer : withOpacity(layer as LayerNode);
  });
};

export function htmlToFigma(
  selector: HTMLElement | string = "body",
  useFrames = false,
  time = false,
  sourceDocument?: Document,
  options: Partial<LocalImportOptions> = {}
) {
  const restore = sourceDocument ? setDomDocument(sourceDocument) : null;
  const restoreDensity=setImageDensity(3);
  try {
  if (time) {
    console.time("Parse dom");
  }
  const layers: LayerNode[] = [];
  const el =
    selector instanceof HTMLElement
      ? selector
      : document.querySelector(selector || "body");

  setFontPolicy({ rasterize: options.rasterizeMissingFonts, available: options.availableFonts });
  if (el) {
    settleAnimations(document);
    processSvgUseElements(el);
    materializeFormLabels(el);
    materializePseudoElements(el);
    splitSymbolRuns(el);
    // Layout is measured untransformed; transforms are re-applied per layer.
    captureTransforms(el);
    resetNodeCaches();

    const els = generateElements(el);

    els.forEach((el) => {
      for (const layer of getLayersForElement(el)) {
        if (placeLayer(layer, el)) layers.push(layer);
      }
    });

    const textNodes = textNodesUnder(el);

    for (const node of textNodes) {
      if(node.parentElement?.closest('svg,script,style,noscript'))continue;
      if(node.parentElement && isHidden(node.parentElement))continue;
      const icon=glyphLayer(node);
      if(icon){
        const opacity=effectiveOpacity(node.parentElement);
        if(opacity<=0.01)continue;
        if(opacity<1)(icon as any).opacity=opacity;
        if(placeLayer(icon,node.parentElement!))layers.push(icon);
        continue;
      }
      const blendMode=node.parentElement?getBlendMode(getComputedStyle(node.parentElement)):undefined;
      for(const text of buildTextNodes({ node })){
        if(blendMode)(text as any).blendMode=blendMode;
        if(placeLayer(text,node.parentElement!))layers.push(text);
      }
    }
  }

  const selected=el || document.body;
  const isDocumentRoot=selected===document.body;
  const selectedRect=selected.getBoundingClientRect();
  const rootWidth=isDocumentRoot?window.innerWidth:selectedRect.width;
  const rootHeight=isDocumentRoot?document.documentElement.scrollHeight:selectedRect.height;
  const rootFills=(style:CSSStyleDeclaration)=>backgroundPaints(style,rootWidth,rootHeight,(url,index)=>backgroundImagePaint(url,index,style,rootWidth,rootHeight));
  const rootStyle=getComputedStyle(selected);
  const root: WithRef<FrameNode> = {
    type: "FRAME",
    width: rootWidth,
    height: rootHeight,
    x: isDocumentRoot?0:selectedRect.left,
    y: isDocumentRoot?0:selectedRect.top,
    ref: selected,
    fills: rootFills(rootStyle),
    ...getBorderRadii({computedStyle:rootStyle,width:rootWidth,height:rootHeight}),
  };
  if(isDocumentRoot && (!Array.isArray(root.fills) || !root.fills.length))root.fills=rootFills(getComputedStyle(document.documentElement));
  if(!isDocumentRoot){
    const borders=getBorders({computedStyle:rootStyle,rect:selectedRect});
    if(borders.props)Object.assign(root,borders.props);
    const shadow=getShadowEffects({computedStyle:rootStyle});if(shadow)root.effects=shadow;
  }

  layers.unshift(root);

  const framesLayers = useFrames
    ? getLayersForFrames({ layers, root })
    : layers;

  framesLayers.forEach(finalizeTransforms);
  removeRefs({ layers: framesLayers, root });

  if (time) {
    console.info("\n");
    console.timeEnd("Parse dom");
  }

  return framesLayers;
  } finally {restoreDensity(); if (restore) restore(); }
}
