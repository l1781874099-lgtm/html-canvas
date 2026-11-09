import { document, Node, NodeFilter, getComputedStyle } from "../environment";
import { LayerNode } from "../types/nodes";

export const hasChildren = (node: LayerNode): node is ChildrenMixin =>
  node && Array.isArray((node as ChildrenMixin).children);

export function traverse(
  layer: LayerNode,
  cb: (layer: LayerNode, parent?: LayerNode | null) => void,
  parent?: LayerNode | null
) {
  if (layer) {
    cb(layer, parent);
    if (hasChildren(layer)) {
      layer.children.forEach((child) =>
        traverse(child as LayerNode, cb, layer)
      );
    }
  }
}

export function textNodesUnder(el: Element) {
  let n: Node | null = null;
  const a: Node[] = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);

  while ((n = walk.nextNode())) {
    a.push(n);
  }
  return a;
}

export const elementName = (el: Element) => {
  const tag = el.tagName.toLowerCase();
  if (tag === "html-to-figma-pseudo") return "::" + (el.getAttribute("data-pseudo") || "before");
  if (el.id) return tag + "#" + el.id;
  const className = (el.getAttribute("class") || "").trim().split(/\s+/)[0];
  return className ? tag + "." + className : tag;
};

let hiddenCache = new WeakMap<Element, boolean>();
let opacityCache = new WeakMap<Element, number>();

// The DOM must not change while cached results are in use.
export function resetNodeCaches() {
  hiddenCache = new WeakMap();
  opacityCache = new WeakMap();
}

// A closed <details> lays out its content but only paints the summary.
function closedDetailsContent(element: Element): boolean {
  const parent = element.parentElement;
  if (!parent || parent.tagName.toLowerCase() !== "details" || parent.hasAttribute("open")) return false;
  return element !== parent.querySelector(":scope > summary");
}

export function isHidden(element: Element): boolean {
  const cached = hiddenCache.get(element);
  if (cached !== undefined) return cached;
  const computed = getComputedStyle(element);
  const hidden =
    computed.display === "none" ||
    computed.visibility === "hidden" ||
    // Some sites hide things by having overflow: hidden and height: 0, e.g. dropdown menus that animate height in
    (computed.overflow !== "visible" && element.getBoundingClientRect().height < 1) ||
    closedDetailsContent(element) ||
    (!!element.parentElement && isHidden(element.parentElement));
  hiddenCache.set(element, hidden);
  return hidden;
}

// CSS opacity multiplies down the tree; Figma leaves carry the product.
export function effectiveOpacity(element: Element | null): number {
  if (!element) return 1;
  const cached = opacityCache.get(element);
  if (cached !== undefined) return cached;
  const own = parseFloat(getComputedStyle(element).opacity);
  const value = (Number.isFinite(own) ? own : 1) * effectiveOpacity(element.parentElement);
  opacityCache.set(element, value);
  return value;
}

export function getParents(node: Element | Node): Element[] {
  let el: Element | null =
    node instanceof Node && node.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : (node as Element);

  const parents: Element[] = [];
  while (el && (el = el.parentElement)) {
    parents.push(el);
  }
  return parents;
}

export function getDepth(node: Element | Node) {
  return getParents(node).length;
}
