import { setDomDocument, setImageDensity } from "./environment";
import { LocalImportOptions } from '../../shared/local-import';
import { document, window, HTMLElement, HTMLImageElement, HTMLVideoElement, HTMLPictureElement, HTMLSourceElement, SVGSVGElement, SVGElement, getComputedStyle } from "./environment";
import { getBoundingClientRect } from "./helpers/dimensions";
import { getImagePaintWithUrl } from "./helpers/image";
import { isHidden, textNodesUnder, traverse } from "./helpers/nodes";
import { size } from "./helpers/object";
import { getRgb } from "./helpers/parsers";
import {
  addStrokesFromBorder,
  getStrokesRectangle,
  getAppliedComputedStyles,
  getShadowEffects,
  getBorderRadii,
} from "./helpers/styles";
import { createSvgLayer, processSvgUseElements } from "./helpers/svg";
import { buildTextNode } from "./helpers/text";
import { backgroundPaints } from './helpers/visual-paints';
import { glyphLayer, splitSymbolRuns } from './helpers/glyphs';
import { materializeFormLabels } from './helpers/form-labels';
import { getLayersForFrames } from "./helpers/frames";
import { LayerNode, WithRef } from "./types/nodes";

const generateElements = (el: Element) => {
  const getShadowEls = (el: Element): Element[] =>
    Array.from(el.shadowRoot?.querySelectorAll("*") || []).reduce(
      (memo, el) => [...memo, el, ...getShadowEls(el)],
      [] as Element[]
    );

  const els = Array.from(el.querySelectorAll("*")).reduce(
    (memo, el) => [...memo, el, ...getShadowEls(el)],
    [] as Element[]
  );

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

const getLayersForElement = (el: Element) => {
  const elementLayers: LayerNode[] = [];
  if (isHidden(el)) {
    return [];
  }
  if (el instanceof SVGSVGElement) {
    elementLayers.push(createSvgLayer(el));
    return elementLayers;
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

  // TO-DO: what does `appliedStyles` do here? All we do is check that it's non-empty
  const appliedStyles = getAppliedComputedStyles(el);

  const computedStyle = getComputedStyle(el);

  if (
    (size(appliedStyles) ||
      el instanceof HTMLImageElement ||
      el instanceof HTMLVideoElement) &&
    computedStyle.display !== "none"
  ) {
    const rect = getBoundingClientRect(el);

    if (rect.width >= 1 && rect.height >= 1) {
      const fills = backgroundPaints(computedStyle,rect.width,rect.height);

      const rectNode: WithRef<RectangleNode> = {
        type: "RECTANGLE",
        ref: el,
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        fills,
      };

      const strokes = addStrokesFromBorder({ computedStyle });

      if (strokes) {
        Object.assign(rectNode, strokes);
      }

      if (!rectNode.strokes) {
        for (const dir of ["top", "left", "right", "bottom"] as const) {
          const strokesLayer = getStrokesRectangle({
            dir,
            rect,
            computedStyle,
            el,
          });

          if (strokesLayer) {
            elementLayers.push(strokesLayer);
          }
        }
      }
      const imagePaint = getImagePaintWithUrl({ computedStyle, el });

      if (imagePaint) {
        fills.push(imagePaint);
        rectNode.name = "IMAGE";
      }

      const shadowEffects = getShadowEffects({ computedStyle });

      if (shadowEffects) {
        rectNode.effects = shadowEffects;
      }

      const borderRadii = getBorderRadii({ computedStyle,width:rect.width,height:rect.height });
      Object.assign(rectNode, borderRadii);

      elementLayers.push(rectNode);
    }
  }

  return elementLayers;
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

  if (el) {
    processSvgUseElements(el);
    materializeFormLabels(el);
    splitSymbolRuns(el);

    const els = generateElements(el);

    els.forEach((el) => {
      const elLayers = getLayersForElement(el);
      layers.push(...elLayers);
    });

    const textNodes = textNodesUnder(el);

    for (const node of textNodes) {
      if(node.parentElement?.closest('svg,script,style,noscript'))continue;
      if(node.parentElement && isHidden(node.parentElement))continue;
      const icon=glyphLayer(node);
      if(icon){layers.push(icon);continue;}
      const textNode = buildTextNode({ node });
      if (textNode) {
        layers.push(textNode);
      }
    }
  }

  // TODO: send frame: { children: []}
  const selected=el || document.body;
  const isDocumentRoot=selected===document.body;
  const selectedRect=selected.getBoundingClientRect();
  const rootWidth=isDocumentRoot?window.innerWidth:selectedRect.width;
  const rootHeight=isDocumentRoot?document.documentElement.scrollHeight:selectedRect.height;
  const rootStyle=getComputedStyle(selected);
  const root: WithRef<FrameNode> = {
    type: "FRAME",
    width: rootWidth,
    height: rootHeight,
    x: isDocumentRoot?0:selectedRect.left,
    y: isDocumentRoot?0:selectedRect.top,
    ref: selected,
    fills: backgroundPaints(rootStyle,rootWidth,rootHeight),
    ...getBorderRadii({computedStyle:rootStyle,width:rootWidth,height:rootHeight}),
  };
  if(isDocumentRoot && (!Array.isArray(root.fills) || !root.fills.length))root.fills=backgroundPaints(getComputedStyle(document.documentElement),rootWidth,rootHeight);
  if(!isDocumentRoot){
    Object.assign(root,addStrokesFromBorder({computedStyle:rootStyle}));
    const shadow=getShadowEffects({computedStyle:rootStyle});if(shadow)root.effects=shadow;
  }

  layers.unshift(root);

  const framesLayers = useFrames
    ? getLayersForFrames({ layers, root })
    : layers;

  removeRefs({ layers: framesLayers, root });

  if (time) {
    console.info("\n");
    console.timeEnd("Parse dom");
  }

  return framesLayers;
  } finally {restoreDensity(); if (restore) restore(); }
}
