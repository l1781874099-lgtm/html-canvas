// Live DOM bindings let the parser inspect another document without executing
// JavaScript inside that document. Parsing is synchronous; context is restored.
export let document = globalThis.document;
export let window = globalThis.window;
export let HTMLElement = globalThis.HTMLElement;
export let Element = globalThis.Element;
export type Element = globalThis.Element;
export type HTMLElement = globalThis.HTMLElement;
export let HTMLAnchorElement = globalThis.HTMLAnchorElement;
export type HTMLAnchorElement = globalThis.HTMLAnchorElement;
export let HTMLImageElement = globalThis.HTMLImageElement;
export type HTMLImageElement = globalThis.HTMLImageElement;
export let HTMLVideoElement = globalThis.HTMLVideoElement;
export type HTMLVideoElement = globalThis.HTMLVideoElement;
export let HTMLPictureElement = globalThis.HTMLPictureElement;
export type HTMLPictureElement = globalThis.HTMLPictureElement;
export let HTMLSourceElement = globalThis.HTMLSourceElement;
export type HTMLSourceElement = globalThis.HTMLSourceElement;
export let SVGSVGElement = globalThis.SVGSVGElement;
export type SVGSVGElement = globalThis.SVGSVGElement;
export let SVGElement = globalThis.SVGElement;
export type SVGElement = globalThis.SVGElement;
export let Node = globalThis.Node;
export type Node = globalThis.Node;
export let NodeFilter = globalThis.NodeFilter;
export let imageDensity = 3;
export function setImageDensity(density: number) {
  const previous=imageDensity;imageDensity=density;
  return () => {imageDensity=previous;};
}
export function getComputedStyle(el: Element, pseudo?: string | null) {
  return el.ownerDocument.defaultView!.getComputedStyle(el, pseudo);
}
export function setDomDocument(doc: Document) {
  const previous = document;
  const view = doc.defaultView as Window & typeof globalThis;
  if (!view) throw new Error('渲染文档未就绪');
  document = doc;
  window = view;
  HTMLElement = view.HTMLElement;
  Element = view.Element;
  HTMLAnchorElement = view.HTMLAnchorElement;
  HTMLImageElement = view.HTMLImageElement;
  HTMLVideoElement = view.HTMLVideoElement;
  HTMLPictureElement = view.HTMLPictureElement;
  HTMLSourceElement = view.HTMLSourceElement;
  SVGSVGElement = view.SVGSVGElement;
  SVGElement = view.SVGElement;
  Node = view.Node;
  NodeFilter = view.NodeFilter;
  return () => setDomDocument(previous);
}
