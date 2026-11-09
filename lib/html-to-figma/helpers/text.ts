import { document, Node, getComputedStyle } from "../environment";
import { WithRef } from "../types/nodes";
import { effectiveOpacity, isHidden } from "./nodes";
import { parseUnits, getRgb, parseShadowList } from "./parsers";
import { getTextShadowEffects } from "./styles";
import { rasterCanvas } from "./image";
import { backgroundPaints } from "./visual-paints";

const cssSpace = /[ \t\n\r\f]/;

interface LineBox { top: number; bottom: number; left: number; right: number }

function rangeOf(node: Node, start: number, end: number) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return range;
}

function lineBoxes(node: Node, start: number, end: number): LineBox[] {
  const range = rangeOf(node, start, end);
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
  range.detach();
  const lines: LineBox[] = [];
  for (const r of rects.sort((a, b) => a.top - b.top)) {
    const line = lines.find((l) => r.top + r.height / 2 > l.top && r.top + r.height / 2 < l.bottom);
    if (line) {
      line.left = Math.min(line.left, r.left); line.right = Math.max(line.right, r.right);
      line.top = Math.min(line.top, r.top); line.bottom = Math.max(line.bottom, r.bottom);
    } else lines.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
  }
  return lines;
}

// Largest offset whose text, starting at `start`, still fits on `line`.
function lineEnd(node: Node, start: number, end: number, line: LineBox): number {
  const text = node.textContent || "";
  const fits = (k: number) => {
    const range = rangeOf(node, start, k);
    const ok = Array.from(range.getClientRects()).every((r) => r.width <= 0 || r.top + r.height / 2 < line.bottom);
    range.detach();
    return ok;
  };
  let lo = start + 1, hi = end;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid; else hi = mid - 1;
  }
  const code = text.charCodeAt(lo);
  if (lo < end && code >= 0xdc00 && code <= 0xdfff) lo--;
  return lo;
}

const preservesSpaces = (whiteSpace: string) => /^(pre|pre-wrap|break-spaces)$/.test(whiteSpace);

function blockOf(el: Element): Element {
  let block = el;
  while (block.parentElement && /^(inline|contents)$/.test(getComputedStyle(block).display)) block = block.parentElement;
  return block;
}

let measureDocument: Document | undefined;
let measureContext: CanvasRenderingContext2D | null = null;
function measure(text: string, style: CSSStyleDeclaration): number {
  if (measureDocument !== document) {
    measureDocument = document;
    measureContext = document.createElement("canvas").getContext("2d");
  }
  if (!measureContext) return text.length * (parseFloat(style.fontSize) || 16) * 0.55;
  measureContext.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  try { (measureContext as any).letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing; } catch (_error) {}
  return measureContext.measureText(text).width;
}

// Drop characters until the text plus an ellipsis fits, like the browser.
function truncate(text: string, available: number, style: CSSStyleDeclaration): string {
  let value = text;
  while (value && measure(value.replace(/\s+$/, "") + "…", style) > available) {
    const code = value.charCodeAt(value.length - 1);
    value = value.slice(0, value.length - (code >= 0xdc00 && code <= 0xdfff ? 2 : 1));
  }
  return value.replace(/\s+$/, "") + "…";
}

interface FontPolicy { rasterize: boolean; available: Set<string>; webFonts: Set<string> }
let policy: FontPolicy = { rasterize: false, available: new Set(), webFonts: new Set() };
const rasterized = new Set<string>();
const installed = new Map<string, boolean>();
const familyKey = (family: string) => family.trim().replace(/^["']|["']$/g, "").toLowerCase();
const generic = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[\w-]+|math|emoji|fangsong|-apple-system|blinkmacsystemfont)$/;

export function setFontPolicy(options: { rasterize?: boolean; available?: string[] }) {
  const webFonts = new Set<string>();
  try {
    (document as any).fonts?.forEach((face: FontFace) => { if (face.status === "loaded") webFonts.add(familyKey(face.family)); });
  } catch (_error) {}
  policy = {
    rasterize: !!options.rasterize && !!options.available?.length,
    available: new Set((options.available || []).map(familyKey)),
    webFonts,
  };
  rasterized.clear();
  installed.clear();
}

export const rasterizedFonts = () => Array.from(rasterized);

// Classic width probe: a local font changes the width of a fallback stack.
function isInstalled(family: string): boolean {
  let known = installed.get(family);
  if (known !== undefined) return known;
  const probe = "mmmmmmmmmmlli10OQ字体";
  const ctx = document.createElement("canvas").getContext("2d");
  known = false;
  if (ctx) {
    for (const base of ["monospace", "serif"]) {
      ctx.font = `72px ${base}`;
      const plain = ctx.measureText(probe).width;
      ctx.font = `72px "${family}", ${base}`;
      if (Math.abs(ctx.measureText(probe).width - plain) > 0.5) { known = true; break; }
    }
  }
  installed.set(family, known);
  return known;
}

// The web font the browser actually renders with, if Figma doesn't have it.
function missingWebFont(style: CSSStyleDeclaration): string | undefined {
  if (!policy.rasterize) return;
  for (const raw of (style.fontFamily || "").split(",")) {
    const family = familyKey(raw);
    if (!family) continue;
    if (policy.webFonts.has(family)) return policy.available.has(family) ? undefined : raw.trim().replace(/^["']|["']$/g, "");
    if (generic.test(family) || isInstalled(family)) return;
  }
}

function transformText(text: string, transform: string): string {
  if (transform === "uppercase") return text.toUpperCase();
  if (transform === "lowercase") return text.toLowerCase();
  if (transform === "capitalize") return text.replace(/(^|[\s\-–—(“"'])(\p{L})/gu, (_m, lead, ch) => lead + ch.toUpperCase());
  return text;
}

// Draw the text exactly as laid out by the browser, line by line.
function rasterText(node: Node, lines: LineBox[], texts: string[], justified: boolean, style: CSSStyleDeclaration,
  fills: Paint[], parent: Element): WithRef<RectangleNode> | undefined {
  const fill = fills[0];
  if (fills.length !== 1 || fill.type !== "SOLID") return;
  const fontSize = parseFloat(style.fontSize) || 16;
  const shadow = parseShadowList(style.textShadow === "none" ? "" : style.textShadow)[0];
  const pad = Math.ceil(fontSize * 0.6 + (shadow ? shadow.blurRadius + Math.max(Math.abs(shadow.offsetX), Math.abs(shadow.offsetY)) : 0));
  const left = Math.min(...lines.map((line) => line.left)) - pad;
  const top = lines[0].top - pad;
  const width = Math.max(...lines.map((line) => line.right)) + pad - left;
  const height = lines[lines.length - 1].bottom + pad - top;
  const { canvas, context, scale } = rasterCanvas(width, height);
  if (!context) return;
  const caps = (style as any).fontVariantCaps === "small-caps" ? "small-caps " : "";
  context.font = `${style.fontStyle} ${caps}${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  try {
    (context as any).letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
    (context as any).wordSpacing = style.wordSpacing === "normal" ? "0px" : style.wordSpacing;
  } catch (_error) {}
  const color = fill.color;
  context.fillStyle = `rgba(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)},${fill.opacity ?? 1})`;
  if (shadow) {
    const c = shadow.color;
    context.shadowColor = `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;
    // Canvas shadows ignore the transform.
    context.shadowOffsetX = shadow.offsetX * scale;
    context.shadowOffsetY = shadow.offsetY * scale;
    context.shadowBlur = shadow.blurRadius * scale;
  }
  context.textBaseline = "alphabetic";
  const decoration = textDecoration(parent);
  lines.forEach((line, i) => {
    const text = transformText(texts[i] ?? "", style.textTransform);
    if (!text) return;
    const metrics = context.measureText(text);
    const ascent = (metrics as any).fontBoundingBoxAscent || fontSize * 0.8;
    const x = line.left - left, baseline = line.top - top + ascent;
    const spaces = text.split(" ").length - 1;
    const extra = justified && i < lines.length - 1 && spaces ? (line.right - line.left - metrics.width) / spaces : 0;
    if (extra > 0) {
      let cursor = x;
      for (const word of text.split(" ")) {
        context.fillText(word, cursor, baseline);
        cursor += context.measureText(word + " ").width + extra;
      }
    } else context.fillText(text, x, baseline);
    if (decoration) {
      const thickness = Math.max(1, fontSize / 15);
      const y = decoration === "UNDERLINE" ? baseline + Math.max(1, fontSize * 0.1) : baseline - fontSize * 0.3;
      context.fillRect(x, y, line.right - line.left, thickness);
    }
  });
  return {
    type: "RECTANGLE",
    ref: node,
    name: "文字图片 · " + texts.join(" ").slice(0, 30),
    x: left,
    y: top,
    width,
    height,
    fills: [{ type: "IMAGE", scaleMode: "FILL", imageHash: null, url: canvas.toDataURL("image/png") } as any],
  } as WithRef<RectangleNode>;
}

function contentRight(el: Element): number {
  const style = getComputedStyle(el);
  return el.getBoundingClientRect().right - (parseFloat(style.paddingRight) || 0) - (parseFloat(style.borderRightWidth) || 0);
}

function clipBottom(el: Element): number {
  const style = getComputedStyle(el);
  return el.getBoundingClientRect().bottom - (parseFloat(style.paddingBottom) || 0) - (parseFloat(style.borderBottomWidth) || 0);
}

function normalize(text: string, whiteSpace: string): string {
  if (/^(pre|pre-wrap|break-spaces)$/.test(whiteSpace)) return text.replace(/\r\n?/g, "\n");
  if (whiteSpace === "pre-line") return text.replace(/[ \t\r\f]+/g, " ").replace(/ ?\n ?/g, "\n");
  return text.replace(/[ \t\n\r\f\u00a0]+/g, " ");
}

// Text decorations propagate from ancestors, except into atomic inlines,
// floats and absolutely positioned boxes.
function textDecoration(el: Element | null): TextDecoration | undefined {
  while (el) {
    const style = getComputedStyle(el);
    const line = style.textDecorationLine || style.textDecoration || "";
    if (line.includes("underline")) return "UNDERLINE";
    if (line.includes("line-through")) return "STRIKETHROUGH";
    if (/^inline-/.test(style.display) || style.float !== "none" || /absolute|fixed/.test(style.position)) return;
    el = el.parentElement;
  }
}

function textAlign(style: CSSStyleDeclaration): TextNode["textAlignHorizontal"] | undefined {
  const rtl = style.direction === "rtl";
  switch (style.textAlign) {
    case "center": case "-webkit-center": return "CENTER";
    case "justify": return "JUSTIFIED";
    case "right": case "-webkit-right": return "RIGHT";
    case "left": case "-webkit-left": return "LEFT";
    case "end": return rtl ? "LEFT" : "RIGHT";
    case "start": return rtl ? "RIGHT" : "LEFT";
  }
}

function textFills(parent: Element, style: CSSStyleDeclaration, width: number, height: number): Paint[] | undefined {
  const rgb = getRgb((style as any).webkitTextFillColor || style.color) || getRgb(style.color);
  if (rgb && rgb.a > 0) return [{ type: "SOLID", color: { r: rgb.r, g: rgb.g, b: rgb.b }, opacity: rgb.a }];
  // Transparent glyphs usually reveal a `background-clip: text` gradient.
  let el: Element | null = parent;
  for (let depth = 0; el && depth < 6; depth++, el = el.parentElement) {
    const clipStyle = getComputedStyle(el);
    if ((clipStyle.backgroundClip || (clipStyle as any).webkitBackgroundClip) === "text") {
      const paints = backgroundPaints(clipStyle, width, height);
      return paints.length ? paints : undefined;
    }
  }
}

export const buildTextNodes = ({ node }: { node: Node }): WithRef<TextNode>[] => {
  const text = node.textContent || "";
  const parent = node.parentElement;
  if (!parent || !text.trim() || isHidden(parent)) return [];
  const opacity = effectiveOpacity(parent);
  if (opacity <= 0.01) return [];
  let start = 0, end = text.length;
  while (start < end && cssSpace.test(text[start])) start++;
  while (end > start && cssSpace.test(text[end - 1])) end--;
  if (start >= end) return [];
  const style = getComputedStyle(parent);
  const lines = lineBoxes(node, start, end);
  if (!lines.length) return [];
  const segments: [number, number][] = [[start, end]];
  // A text run that starts mid-line (after a link or badge) has a bounding box
  // wider than its first line. Import that first line separately.
  if (lines.length > 1 && lines[0].left > Math.min(...lines.slice(1).map((l) => l.left)) + 1) {
    const split = lineEnd(node, start, end, lines[0]);
    if (split > start && split < end) {
      let next = split;
      while (next < end && cssSpace.test(text[next])) next++;
      segments.splice(0, 1, [start, split], [next, end]);
    }
  }
  const layers: WithRef<TextNode>[] = [];
  for (const [from, to] of segments) {
    const layer = buildSegment(node, from, to, parent, style, opacity);
    if (layer) layers.push(layer);
  }
  return layers;
};

function buildSegment(node: Node, start: number, end: number, parent: Element, style: CSSStyleDeclaration, opacity: number): WithRef<TextNode> | undefined {
  const source = node.textContent || "";
  const whiteSpace = style.whiteSpace;
  let lines = lineBoxes(node, start, end);
  if (!lines.length) return;
  const align = textAlign(style);
  // Justified paragraphs need Figma to re-justify at a fixed width; every
  // other multi-line text gets the browser's line breaks written out.
  const justified = align === "JUSTIFIED" && lines.length > 1;

  const breaks: number[] = [];
  for (let i = 0, from = start; i < lines.length - 1; i++) {
    const k = lineEnd(node, from, end, lines[i]);
    if (k <= from || k >= end) break;
    breaks.push(k);
    from = k;
  }

  const block = blockOf(parent);
  const blockStyle = getComputedStyle(block);
  let stop = end;
  let ellipsis: number | undefined;
  // -webkit-line-clamp: lines past the clamp are hidden and the last visible
  // one ends with an ellipsis that isn't part of the DOM.
  const clamp = parseInt((blockStyle as any).webkitLineClamp, 10);
  if (clamp > 0 && blockStyle.overflowY !== "visible") {
    const bottom = clipBottom(block);
    const visible = lines.filter((line) => (line.top + line.bottom) / 2 < bottom).length;
    if (!visible) return;
    if (visible < lines.length && breaks.length >= visible) {
      stop = breaks[visible - 1];
      breaks.length = visible - 1;
      lines = lines.slice(0, visible);
      ellipsis = contentRight(block) - lines[visible - 1].left;
    }
  }
  if (blockStyle.textOverflow === "ellipsis" && blockStyle.overflowX !== "visible") {
    const right = contentRight(block);
    const last = lines[lines.length - 1];
    if (last.right > right + 0.5) ellipsis = right - last.left;
  }

  const bounds = [start, ...breaks, stop];
  const pieces = bounds.slice(0, -1).map((from, i) => source.slice(from, bounds[i + 1]));
  let lineTexts: string[];
  if (justified) {
    lineTexts = [normalize(source.slice(start, stop), whiteSpace).trim()];
  } else if (preservesSpaces(whiteSpace)) {
    lineTexts = pieces.map((piece) => normalize(piece, whiteSpace));
  } else {
    lineTexts = pieces.map((piece) => normalize(piece, whiteSpace).trim());
  }
  if (ellipsis !== undefined) {
    const last = lineTexts.length - 1;
    lineTexts[last] = truncate(lineTexts[last].replace(/\s+$/, ""), ellipsis, style);
  }
  let characters: string;
  if (preservesSpaces(whiteSpace) && !justified) {
    // Only soft wraps need a break; hard breaks are already in the text.
    characters = lineTexts.reduce((text, piece, i) => {
      if (!i) return piece;
      if (text.endsWith("\n") || piece.startsWith("\n")) return text + piece;
      return text.replace(/[ \t]+$/, "") + "\n" + piece;
    }, "").replace(/\n+$/, "");
  } else {
    characters = lineTexts.filter(Boolean).join("\n");
  }
  if (!characters.trim()) return;

  const left = Math.min(...lines.map((line) => line.left));
  let right = Math.max(...lines.map((line) => line.right));
  if (ellipsis !== undefined) right = Math.min(right, lines[lines.length - 1].left + ellipsis);
  const first = lines[0], last = lines[lines.length - 1];
  let lineHeight = parseUnits(style.lineHeight);
  if (!lineHeight && lines.length > 1) {
    lineHeight = { unit: "PIXELS", value: (last.top - first.top) / (lines.length - 1) } as any;
  }
  const rect = { left, top: first.top, width: right - left, height: last.bottom - first.top };
  if (lineHeight) {
    const content = first.bottom - first.top;
    rect.top = first.top - (lineHeight.value - content) / 2;
    rect.height = lines.length * lineHeight.value;
  }
  if (rect.height < 1 || rect.width < 1) return;
  const lineCount = lines.length;

  const textNode: WithRef<TextNode> = {
    x: rect.left,
    ref: node,
    y: rect.top,
    width: Math.ceil(rect.width) + 1,
    height: rect.height,
    type: "TEXT",
    characters,
  };
  const fills = textFills(parent, style, rect.width, rect.height);
  if (!fills) return;
  textNode.fills = fills;
  if (opacity < 1) textNode.opacity = opacity;

  const missingFont = missingWebFont(style);
  if (missingFont) {
    const texts = (justified ? pieces.map((piece) => normalize(piece, whiteSpace).trim()) : lineTexts)
      .map((text) => text.replace(/^\n+/, "").split("\n")[0]);
    const raster = rasterText(node, lines, texts, justified, style, fills, parent);
    if (raster) {
      rasterized.add(missingFont);
      if (opacity < 1) raster.opacity = opacity;
      return raster as any;
    }
  }

  const letterSpacing = parseUnits(style.letterSpacing);
  if (letterSpacing) textNode.letterSpacing = letterSpacing;
  if (lineHeight) textNode.lineHeight = lineHeight;

  switch (style.textTransform) {
    case "uppercase": textNode.textCase = "UPPER"; break;
    case "lowercase": textNode.textCase = "LOWER"; break;
    case "capitalize": textNode.textCase = "TITLE"; break;
  }
  if (!textNode.textCase) {
    const caps = (style as any).fontVariantCaps;
    if (caps === "small-caps") textNode.textCase = "SMALL_CAPS";
    else if (caps === "all-small-caps") textNode.textCase = "SMALL_CAPS_FORCED";
  }

  const fontSize = parseUnits(style.fontSize);
  if (fontSize) textNode.fontSize = Math.round(fontSize.value * 100) / 100;
  if (style.fontFamily) (textNode as any).fontFamily = style.fontFamily;
  (textNode as any).fontWeight = Number(style.fontWeight) || (style.fontWeight === "bold" ? 700 : 400);
  (textNode as any).fontStyle = style.fontStyle;
  // Text with explicit line breaks grows with its content in Figma instead of
  // re-wrapping with Figma's slightly different glyph metrics.
  (textNode as any).singleLine = lineCount <= 1 || !justified;

  const decoration = textDecoration(parent);
  if (decoration) textNode.textDecoration = decoration;
  if (align) textNode.textAlignHorizontal = align;
  const shadows = getTextShadowEffects(style.textShadow);
  if (shadows) textNode.effects = shadows;
  return textNode;
}
