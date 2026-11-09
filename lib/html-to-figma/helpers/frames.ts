import { document, Node, getComputedStyle, Element } from "../environment";
import { LayerNode, WithRef } from "../types/nodes";
import { elementName, hasChildren, traverse } from "./nodes";
import { addConstraints } from "./styles";
import { boundsOf, isTransformed } from "./transforms";

const clips = (el: Element | Node | undefined) => {
  if (!(el instanceof Element)) return false;
  const style = getComputedStyle(el);
  return style.overflowX !== "visible" || style.overflowY !== "visible";
};

const isTextNode = (ref: Element | Node | undefined) => !!ref && (ref as Node).nodeType === Node.TEXT_NODE;
const ownerElement = (ref: Element | Node | undefined): Element | null =>
  !ref ? null : isTextNode(ref) ? (ref as Node).parentElement : (ref as Element);

// Wrap an element's own layer in a frame that will hold its descendants.
// Clipping frames take the element's corner radii and its effects so the
// shadow isn't clipped away and children are masked by the rounded box.
const containerFor = (layer: LayerNode, el: Element): LayerNode => {
  // A rotated box can't clip: the frame is axis-aligned at its bounds.
  const clipsContent = clips(el) && (layer as any)._rotation === undefined && layer.type !== "SVG";
  const bounds = boundsOf(layer);
  const frame: LayerNode = {
    type: "FRAME",
    name: (layer as any).name,
    clipsContent,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    ref: el,
    backgrounds: [] as any,
    children: [layer] as any[],
  };
  const radii = layer as any;
  if (clipsContent) {
    for (const key of ["topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius"]) {
      if (radii[key] !== undefined) (frame as any)[key] = radii[key];
    }
  }
  const effects: Effect[] = (layer as any).effects || [];
  const moved = effects.filter((effect) => clipsContent || effect.type === "LAYER_BLUR");
  if (moved.length) {
    (frame as any).effects = moved;
    (layer as any).effects = effects.filter((effect) => !moved.includes(effect));
  }
  return frame;
};

// Each layer goes into the frame of its nearest ancestor element that has a
// layer; that ancestor's own layer is wrapped into a frame on first use.
const nestLayers = (root: WithRef<FrameNode>, layers: LayerNode[]) => {
  const rootEl = root.ref as Element;
  // An element's first layer is its box; border strips that share the ref
  // must not become the container for its children.
  const own = new Map<Element | Node, LayerNode>();
  const containers = new Map<Element | Node, LayerNode>();
  const parentOf = new Map<LayerNode, LayerNode>();
  containers.set(rootEl, root);
  (root as any).children = [];
  for (const layer of layers) {
    if (layer === root) continue;
    const ref = layer.ref;
    const isText = isTextNode(ref);
    let ancestor: Element | null = ref ? (isText ? (ref as Node).parentElement : (ref as Element).parentElement) : null;
    let container: LayerNode = root;
    while (ancestor && ancestor !== rootEl && ancestor !== document.body) {
      const existing = containers.get(ancestor);
      if (existing) { container = existing; break; }
      const ownLayer = own.get(ancestor);
      if (ownLayer) {
        const parent = parentOf.get(ownLayer)!;
        const frame = containerFor(ownLayer, ancestor);
        const siblings = (parent as any).children as LayerNode[];
        siblings.splice(siblings.indexOf(ownLayer), 1, frame);
        parentOf.set(frame, parent);
        parentOf.set(ownLayer, frame);
        containers.set(ancestor, frame);
        container = frame;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    ((container as any).children as LayerNode[]).push(layer);
    parentOf.set(layer, container);
    if (ref && !isText && !own.has(ref)) own.set(ref, layer);
  }
};

// Group siblings that share a deeper DOM ancestor than the frame's own
// element, deepest first, so the layer tree follows the HTML structure.
const groupByAncestors = (frame: LayerNode) => {
  const children = (frame as any).children as LayerNode[];
  const frameEl = ownerElement(frame.ref);
  const depths = new Map<Element, number>();
  const depth = (el: Element): number => {
    let d = depths.get(el);
    if (d === undefined) { d = el.parentElement ? depth(el.parentElement) + 1 : 0; depths.set(el, d); }
    return d;
  };
  while (frameEl && children.length > 2) {
    const counts = new Map<Element, number>();
    for (const child of children) {
      if (!child.ref || child.ref === frameEl) continue;
      let ancestor: Element | null = isTextNode(child.ref) ? (child.ref as Node).parentElement : (child.ref as Element).parentElement;
      for (; ancestor && ancestor !== frameEl && frameEl.contains(ancestor); ancestor = ancestor.parentElement) {
        counts.set(ancestor, (counts.get(ancestor) || 0) + 1);
      }
    }
    let best: Element | null = null;
    counts.forEach((count, el) => {
      if (count >= 2 && count < children.length && (!best || depth(el) > depth(best))) best = el;
    });
    if (!best) break;
    const group: Element = best;
    const members = children.filter((child) => child.ref && child.ref !== frameEl && group.contains(child.ref as Node));
    const boxes = members.map(boundsOf);
    const left = Math.min(...boxes.map((box) => box.x)), top = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map((box) => box.x + box.width)), bottom = Math.max(...boxes.map((box) => box.y + box.height));
    const first = children.indexOf(members[0]);
    const node: LayerNode = {
      type: "FRAME",
      name: elementName(group),
      clipsContent: false,
      ref: group,
      x: left,
      y: top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
      backgrounds: [] as any,
      children: members as any,
    };
    for (const member of members) children.splice(children.indexOf(member), 1);
    children.splice(Math.min(first, children.length), 0, node);
  }
  for (const child of children) if (hasChildren(child)) groupByAncestors(child);
};

// CSS painting order inside a stacking context: negative z-index, in-flow
// content, positioned z-index auto/0, then positive z-index; ties keep DOM order.
const stackLevel = (ref: Element | Node | undefined, containerEl: Element | null): number => {
  let level = 0;
  for (let el = ownerElement(ref); el && el !== containerEl && el !== document.body; el = el.parentElement) {
    const style = getComputedStyle(el);
    const z = parseInt(style.zIndex, 10);
    const parentDisplay = el.parentElement ? getComputedStyle(el.parentElement).display : "";
    // Transforms and opacity create stacking contexts painted with positioned boxes.
    const positioned = style.position !== "static" || isTransformed(el) || parseFloat(style.opacity) < 1 ||
      (!isNaN(z) && /flex|grid/.test(parentDisplay));
    if (!positioned) continue;
    const clamped = isNaN(z) ? 0 : Math.max(-1e6, Math.min(1e6, z));
    level = (clamped < 0 ? -1 : clamped > 0 ? 2 : 1) * 1e7 + clamped;
  }
  return level;
};

const sortByPaintOrder = (frame: LayerNode) => {
  const children = (frame as any).children as LayerNode[];
  const frameEl = ownerElement(frame.ref);
  const levels = new Map<LayerNode, number>();
  for (const child of children) {
    levels.set(child, child.ref === frameEl ? -Infinity : stackLevel(child.ref, frameEl));
  }
  children.sort((a, b) => {
    const level = levels.get(a)! - levels.get(b)!;
    if (level || a.ref === b.ref || !a.ref || !b.ref) return level || 0;
    return (a.ref as Node).compareDocumentPosition(b.ref as Node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
  for (const child of children) if (hasChildren(child)) sortByPaintOrder(child);
};

const makeTree = ({
  root,
  layers,
}: {
  root: WithRef<FrameNode>;
  layers: LayerNode[];
}) => {
  nestLayers(root, layers);
  groupByAncestors(root);
  sortByPaintOrder(root);
  // Update all positions
  traverse(root, (layer) => {
    if (layer.type === "FRAME" || (layer as any).type === "GROUP") {
      const { x, y } = layer;
      if (x || y) {
        traverse(layer, (child) => {
          if (child === layer) {
            return;
          }
          child.x = child.x! - x!;
          child.y = child.y! - y!;
        });
      }
    }
  });
};

export const getLayersForFrames = ({
  root,
  layers,
}: {
  root: WithRef<FrameNode>;
  layers: LayerNode[];
}) => {
  makeTree({ root, layers });
  const framesLayers = [root];
  addConstraints(framesLayers);

  return framesLayers;
};
