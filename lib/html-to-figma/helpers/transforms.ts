import { getComputedStyle } from '../environment';
import { paintsToSvg } from './visual-paints';

// Layers are measured with CSS transforms switched off, so every box is in
// untransformed layout space. Each layer is then mapped through the
// accumulated transform of its element: translations move it, rotation and
// scale become a Figma rotation and size, skews and flips fall back to the
// transformed bounding box (SVG layers bake the exact matrix).
export type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const SVG_NS = 'http://www.w3.org/2000/svg';
const replaced = new Set(['svg', 'img', 'video', 'canvas', 'input', 'textarea', 'select', 'iframe', 'object', 'embed']);

export const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
export const applyMatrix = (m: Matrix, x: number, y: number): [number, number] =>
  [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const isIdentity = (m: Matrix) => Math.abs(m[0] - 1) + Math.abs(m[1]) + Math.abs(m[2]) + Math.abs(m[3] - 1) + Math.abs(m[4]) + Math.abs(m[5]) < 1e-6;
const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];

export function parseMatrix(value?: string | null): Matrix | null {
  if (!value || value === 'none') return null;
  const m2 = value.match(/^matrix\(([^)]+)\)$/);
  if (m2) return m2[1].split(',').map(Number) as Matrix;
  const m3 = value.match(/^matrix3d\(([^)]+)\)$/);
  if (m3) { const v = m3[1].split(',').map(Number); return [v[0], v[1], v[4], v[5], v[12], v[13]]; }
  return null;
}

function angle(value: string): number {
  const match = value.match(/(-?[\d.]+)(deg|rad|turn|grad)$/);
  if (!match) return 0;
  const n = Number(match[1]);
  return match[2] === 'deg' ? n * Math.PI / 180 : match[2] === 'turn' ? n * 2 * Math.PI : match[2] === 'grad' ? n * Math.PI / 200 : n;
}

interface Captured { transform: string; translate: string; rotate: string; scale: string; origin: string }

let captured = new WeakMap<Element, Captured>();
let local = new WeakMap<Element, Matrix>();
let cumulative = new WeakMap<Element, Matrix>();
let transformed = new WeakSet<Element>();

// Record transforms, then neutralize them with inline !important styles so
// that later measurements are in layout space. Must run after animations
// settle and pseudo elements are materialized.
export function captureTransforms(root: Element) {
  captured = new WeakMap(); local = new WeakMap(); cumulative = new WeakMap(); transformed = new WeakSet();
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];
  const found: Element[] = [];
  for (const el of elements) {
    // Transforms inside an SVG are part of the vector drawing.
    if (el.namespaceURI === SVG_NS && el.tagName.toLowerCase() !== 'svg') continue;
    if (el.namespaceURI === SVG_NS && el.parentElement?.closest('svg')) continue;
    const style = getComputedStyle(el);
    if (style.display === 'none') continue;
    // Transforms don't apply to non-replaced inline boxes.
    if (style.display === 'inline' && !replaced.has(el.tagName.toLowerCase())) continue;
    const value: Captured = {
      transform: style.transform || 'none',
      translate: (style as any).translate || 'none',
      rotate: (style as any).rotate || 'none',
      scale: (style as any).scale || 'none',
      origin: style.transformOrigin || '0px 0px',
    };
    if (value.transform === 'none' && value.translate === 'none' && value.rotate === 'none' && value.scale === 'none') continue;
    captured.set(el, value);
    found.push(el);
  }
  for (const el of found) {
    const style = (el as HTMLElement).style;
    // A transform makes the element the containing block of its absolute and
    // fixed descendants; will-change keeps that without transforming.
    style.setProperty('will-change', 'transform', 'important');
    for (const property of ['transform', 'translate', 'rotate', 'scale']) style.setProperty(property, 'none', 'important');
  }
  for (const el of found) {
    const value = captured.get(el)!;
    const rect = el.getBoundingClientRect();
    const [ox = 0, oy = 0] = value.origin.split(/\s+/).map((v) => parseFloat(v) || 0);
    let m: Matrix = translate(rect.left + ox, rect.top + oy);
    if (value.translate !== 'none') {
      const [tx = '0px', ty = '0px'] = value.translate.split(/\s+/);
      const resolve = (v: string, size: number) => v.endsWith('%') ? parseFloat(v) * size / 100 : parseFloat(v) || 0;
      m = multiply(m, translate(resolve(tx, rect.width), resolve(ty, rect.height)));
    }
    if (value.rotate !== 'none') {
      const parts = value.rotate.split(/\s+/);
      const axis = parts.length === 4 ? parts.slice(0, 3).map(Number) : parts.length === 2 && parts[0] === 'z' ? [0, 0, 1] : [0, 0, 1];
      if (axis[0] === 0 && axis[1] === 0) {
        const a = angle(parts[parts.length - 1]) * (axis[2] < 0 ? -1 : 1);
        m = multiply(m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]);
      }
    }
    if (value.scale !== 'none') {
      const factors: number[] = value.scale.split(/\s+/).map((v) => v.endsWith('%') ? parseFloat(v) / 100 : Number(v));
      const sx = factors[0] ?? 1, sy = factors[1] ?? sx;
      m = multiply(m, [sx, 0, 0, sy, 0, 0]);
    }
    const matrix = parseMatrix(value.transform);
    if (matrix) m = multiply(m, matrix);
    m = multiply(m, translate(-(rect.left + ox), -(rect.top + oy)));
    if (!isIdentity(m)) { local.set(el, m); transformed.add(el); }
  }
}

export const isTransformed = (el: Element) => transformed.has(el);

export function matrixFor(el: Element | null): Matrix {
  if (!el) return IDENTITY;
  const cached = cumulative.get(el);
  if (cached) return cached;
  const own = local.get(el);
  const parent = matrixFor(el.parentElement);
  const value = own ? multiply(parent, own) : parent;
  cumulative.set(el, value);
  return value;
}

export interface Box { x: number; y: number; width: number; height: number }

export function transformedBox(m: Matrix, box: Box): Box {
  const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
    .map(([x, y]) => applyMatrix(m, x, y));
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

// Rotation (radians, clockwise on screen) and scale, if the linear part has
// no skew or reflection.
export function decompose(m: Matrix): { rotation: number; sx: number; sy: number } | null {
  const [a, b, c, d] = m;
  const det = a * d - b * c;
  const sx = Math.hypot(a, b);
  if (sx < 1e-9 || det <= 1e-9) return null;
  const sy = det / sx;
  const shear = (a * c + b * d) / (sx * sy);
  if (Math.abs(shear) > 0.01) return null;
  return { rotation: Math.atan2(b, a), sx, sy };
}

const scaleKeys = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'strokeWeight',
  'strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight'];

// Map a layer measured in layout space into page space. Returns false when
// the transform collapses the layer (e.g. scale(0)).
export function placeLayer(layer: any, el: Element | null): boolean {
  const m = matrixFor(el);
  if (isIdentity(m)) return true;
  const box = { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-6) return false;
  if (Math.abs(m[0] - 1) + Math.abs(m[1]) + Math.abs(m[2]) + Math.abs(m[3] - 1) < 1e-6) {
    layer.x += m[4]; layer.y += m[5];
    return true;
  }
  const bbox = transformedBox(m, box);
  const parts = decompose(m);
  if (!parts && layer.type === 'RECTANGLE' && Array.isArray(layer.fills) && layer.fills.length) {
    const r = Math.min(layer.topLeftRadius || 0, box.width / 2, box.height / 2);
    layer.svg = paintsToSvg(layer.fills, box.width, box.height, `<rect width="${box.width}" height="${box.height}" rx="${r}"/>`);
    layer.type = 'SVG';
    for (const key of ['fills', 'strokes', 'strokeWeight', ...scaleKeys]) delete layer[key];
  }
  if (layer.type === 'SVG' && layer.svg) {
    const [px, py] = applyMatrix(m, box.x, box.y);
    const inner = layer.svg.replace(/^<svg\b/, `<svg x="0" y="0"`);
    layer.svg = `<svg xmlns="${SVG_NS}" width="${bbox.width}" height="${bbox.height}" viewBox="0 0 ${bbox.width} ${bbox.height}">` +
      `<g transform="matrix(${m[0]} ${m[1]} ${m[2]} ${m[3]} ${px - bbox.x} ${py - bbox.y})">${inner}</g></svg>`;
    Object.assign(layer, bbox);
    return true;
  }
  if (!parts) { Object.assign(layer, bbox); return true; }
  const { rotation, sx, sy } = parts;
  const [px, py] = applyMatrix(m, box.x, box.y);
  layer.width = box.width * sx; layer.height = box.height * sy;
  const uniform = Math.sqrt(sx * sy);
  for (const key of scaleKeys) if (typeof layer[key] === 'number') layer[key] *= uniform;
  if (layer.type === 'TEXT') {
    if (layer.fontSize) layer.fontSize = Math.round(layer.fontSize * sy * 100) / 100;
    if (layer.lineHeight?.unit === 'PIXELS') layer.lineHeight = { ...layer.lineHeight, value: layer.lineHeight.value * sy };
    if (layer.letterSpacing?.unit === 'PIXELS') layer.letterSpacing = { ...layer.letterSpacing, value: layer.letterSpacing.value * sx };
  }
  if (Array.isArray(layer.effects)) {
    layer.effects = layer.effects.map((effect: any) => ({ ...effect, radius: effect.radius * uniform,
      ...(effect.offset ? { offset: { x: effect.offset.x * sx, y: effect.offset.y * sy } } : {}),
      ...(effect.spread !== undefined ? { spread: effect.spread * uniform } : {}) }));
  }
  if (Math.abs(rotation) < 1e-6) { layer.x = px; layer.y = py; return true; }
  layer.x = px; layer.y = py;
  layer._rotation = rotation;
  layer._bbox = bbox;
  return true;
}

export const boundsOf = (layer: any): Box => layer._bbox || { x: layer.x, y: layer.y, width: layer.width, height: layer.height };

// Rotated layers become a Figma relativeTransform once positions are
// relative to their parent frame.
export function finalizeTransforms(layer: any) {
  if (layer._rotation !== undefined) {
    const cos = Math.cos(layer._rotation), sin = Math.sin(layer._rotation);
    layer.relativeTransform = [[cos, -sin, layer.x], [sin, cos, layer.y]];
  }
  delete layer._rotation;
  delete layer._bbox;
  for (const child of layer.children || []) finalizeTransforms(child);
}
