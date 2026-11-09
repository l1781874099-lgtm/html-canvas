// Browser-only visual check: parse an HTML file and draw the resulting layer
// tree with absolutely positioned DOM nodes, next to the original page.
const {renderLocalHtml, makeLocalHtmlDocument, prerenderScripts} = require('../plugin/functions/local-html');
window.__parser = {...require('../lib/html-to-figma'), makeLocalHtmlDocument, prerenderScripts};

const css = c => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a ?? 1})`;
function paintCss(paint, w, h) {
  if (paint.visible === false) return '';
  const alpha = paint.opacity ?? 1;
  if (paint.type === 'SOLID') return `linear-gradient(${css({...paint.color, a: alpha})},${css({...paint.color, a: alpha})})`;
  if (paint.type === 'IMAGE' && paint.url) return `url("${paint.url}") center/${paint.scaleMode === 'FIT' ? 'contain' : 'cover'} no-repeat`;
  const [[a, b, c], [d, e, f]] = paint.gradientTransform || [[1, 0, 0], [0, 1, 0]];
  const det = a * e - b * d || 1;
  const inv = (u, v) => [(e * (u - c) - b * (v - f)) / det, (-d * (u - c) + a * (v - f)) / det];
  const stops = (paint.gradientStops || []).map(s => `${css(s.color)} ${(s.position * 100).toFixed(1)}%`).join(',');
  if (paint.type === 'GRADIENT_LINEAR') {
    const [x0, y0] = inv(0, .5), [x1, y1] = inv(1, .5);
    const angle = Math.atan2((x1 - x0) * w, -(y1 - y0) * h) * 180 / Math.PI;
    return `linear-gradient(${angle}deg,${stops})`;
  }
  if (paint.type === 'GRADIENT_RADIAL') {
    const [cx, cy] = inv(.5, .5), [rx] = inv(1, .5), [, ry] = inv(.5, 1);
    return `radial-gradient(${Math.abs(rx - cx) * w}px ${Math.abs(ry - cy) * h}px at ${cx * 100}% ${cy * 100}%,${stops})`;
  }
  return '';
}
function draw(layer, parent) {
  const el = document.createElement('div');
  const s = el.style;
  s.position = 'absolute'; s.left = layer.x + 'px'; s.top = layer.y + 'px';
  s.width = layer.width + 'px'; s.height = layer.height + 'px'; s.boxSizing = 'border-box';
  if (layer.opacity !== undefined) s.opacity = layer.opacity;
  if (layer.relativeTransform) {
    const [[a, c, x], [b, d, y]] = layer.relativeTransform;
    s.left = x + 'px'; s.top = y + 'px'; s.transformOrigin = '0 0';
    s.transform = `matrix(${a},${b},${c},${d},0,0)`;
  }
  if (layer.blendMode && layer.blendMode !== 'NORMAL') s.mixBlendMode = layer.blendMode.toLowerCase().replace(/_/g, '-');
  const radii = ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'].map(k => (layer[k] || 0) + 'px');
  s.borderRadius = radii.join(' ');
  const fills = Array.isArray(layer.fills) ? layer.fills : [];
  if (layer.type === 'TEXT') {
    const fill = fills[0];
    if (fill) s.color = css({...fill.color, a: fill.opacity ?? 1});
    s.fontFamily = layer.fontFamily; s.fontSize = layer.fontSize + 'px'; s.fontWeight = layer.fontWeight;
    s.fontStyle = layer.fontStyle || 'normal';
    if (layer.lineHeight && layer.lineHeight.unit === 'PIXELS') s.lineHeight = layer.lineHeight.value + 'px';
    if (layer.letterSpacing) s.letterSpacing = layer.letterSpacing.value + 'px';
    s.whiteSpace = layer.singleLine ? 'pre' : 'pre-wrap';
    s.height = 'auto'; if (layer.singleLine) s.width = 'auto';
    s.textAlign = {CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify'}[layer.textAlignHorizontal] || 'left';
    s.textDecoration = {UNDERLINE: 'underline', STRIKETHROUGH: 'line-through'}[layer.textDecoration] || 'none';
    s.textTransform = {UPPER: 'uppercase', LOWER: 'lowercase', TITLE: 'capitalize'}[layer.textCase] || 'none';
    el.textContent = layer.characters;
  } else if (layer.type === 'SVG') {
    el.innerHTML = layer.svg;
    const svg = el.firstElementChild; if (svg) {svg.style.width = '100%'; svg.style.height = '100%'; svg.style.display = 'block';}
  } else {
    const backgrounds = fills.slice().reverse().map(p => paintCss(p, layer.width, layer.height)).filter(Boolean);
    if (backgrounds.length) s.background = backgrounds.join(',');
  }
  if (layer.clipsContent) s.overflow = 'hidden';
  const shadows = [];
  const stroke = (layer.strokes || []).find(p => p.visible !== false && p.type === 'SOLID');
  if (stroke) {
    const color = css({...stroke.color, a: stroke.opacity ?? 1});
    const w = k => layer[k] ?? layer.strokeWeight ?? 1;
    const dashed = layer.dashPattern && layer.dashPattern.length ? 'dashed' : 'solid';
    if (layer.strokeAlign === 'OUTSIDE') s.outline = `${layer.strokeWeight}px ${dashed} ${color}`;
    else {
      s.borderStyle = dashed; s.borderColor = color;
      s.borderWidth = [w('strokeTopWeight'), w('strokeRightWeight'), w('strokeBottomWeight'), w('strokeLeftWeight')].map(v => v + 'px').join(' ');
    }
  }
  for (const effect of layer.effects || []) {
    if (effect.visible === false) continue;
    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      shadows.push(`${effect.type === 'INNER_SHADOW' ? 'inset ' : ''}${effect.offset.x}px ${effect.offset.y}px ${effect.radius}px ${effect.spread || 0}px ${css(effect.color)}`);
    } else if (effect.type === 'LAYER_BLUR') s.filter = `blur(${effect.radius / 2}px)`;
    else if (effect.type === 'BACKGROUND_BLUR') s.backdropFilter = `blur(${effect.radius / 2}px)`;
  }
  if (shadows.length && layer.type === 'SVG') s.filter = shadows.map(v => `drop-shadow(${v.replace(/ -?[\d.]+px (rgba?\()/, ' $1')})`).join(' ');
  else if (shadows.length) s.boxShadow = shadows.join(',');
  el.title = (layer.name || layer.type);
  parent.appendChild(el);
  for (const child of layer.children || []) draw(child, el);
  return el;
}
let counts;
function count(layer) {counts[layer.type] = (counts[layer.type] || 0) + 1; (layer.children || []).forEach(count);}
async function run() {
  const params = new URLSearchParams(location.search);
  const file = params.get('file') || 'fidelity.html';
  const width = Number(params.get('width') || 1200);
  document.getElementById('panes').style.zoom = params.get('zoom') || '1';
  const html = await (await fetch(file)).text();
  const original = document.getElementById('original');
  original.style.width = width + 'px'; original.srcdoc = html;
  // ?fonts=Arial,Inter simulates the families Figma reports and enables rasterizing.
  const fonts = params.get('fonts');
  const result = await renderLocalHtml(html, width, fonts ? {rasterizeMissingFonts: true, availableFonts: fonts.split(',')} : {});
  window.__warnings = result.warnings;
  const target = document.getElementById('preview');
  target.innerHTML = '';
  counts = {};
  for (const layer of result.layers) {const root = draw(layer, target); root.style.position = 'relative'; root.style.left = root.style.top = '0'; count(layer);}
  original.style.height = result.layers[0].height + 'px';
  window.__layers = result.layers;
  document.getElementById('status').textContent = 'done ' + JSON.stringify(counts);
}
run().catch(error => {document.getElementById('status').textContent = 'error ' + (error && error.stack || error);});
