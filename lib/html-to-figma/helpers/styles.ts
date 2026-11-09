import { HTMLElement, SVGElement, getComputedStyle } from "../environment";
import { LayerNode, WithRef } from "../types/nodes";
import { Dimensions } from "./dimensions";
import { traverse } from "./nodes";
import { getRgb, parseShadowList } from "./parsers";
import { cornerRadius } from './visual-paints';

function setData(
  node: LayerNode & { data?: { [index: string]: string } },
  key: string,
  value: string
) {
  if (!node.data) {
    node.data = {};
  }
  node.data[key] = value;
}

const list: (keyof React.CSSProperties)[] = [
  "backgroundColor",
  "border",
  "borderTop",
  "borderLeft",
  "borderRight",
  "borderBottom",
  "borderRadius",
  "backgroundImage",
  "borderColor",
  "boxShadow",
];

export function getAppliedComputedStyles(
  element: Element,
  pseudo?: string
): { [key: string]: string } {
  if (!(element instanceof HTMLElement || element instanceof SVGElement)) {
    return {};
  }

  const styles = getComputedStyle(element, pseudo);

  const color = styles.color;

  const defaults: any = {
    transform: "none",
    opacity: "1",
    borderRadius: "0px",
    backgroundImage: "none",
    backgroundPosition: "0% 0%",
    backgroundSize: "auto",
    backgroundColor: "rgba(0, 0, 0, 0)",
    backgroundAttachment: "scroll",
    border: "0px none " + color,
    borderTop: "0px none " + color,
    borderBottom: "0px none " + color,
    borderLeft: "0px none " + color,
    borderRight: "0px none " + color,
    borderWidth: "0px",
    borderColor: color,
    borderStyle: "none",
    boxShadow: "none",
    fontWeight: "400",
    textAlign: "start",
    justifyContent: "normal",
    alignItems: "normal",
    alignSelf: "auto",
    flexGrow: "0",
    textDecoration: "none solid " + color,
    lineHeight: "normal",
    letterSpacing: "normal",
    backgroundRepeat: "repeat",
    zIndex: "auto", // TODO
  };

  function pick<T extends { [key: string]: V }, V = any>(
    object: T,
    paths: (keyof T)[]
  ) {
    const newObject: Partial<T> = {};
    paths.forEach((path) => {
      if (object[path]) {
        if (object[path] !== defaults[path]) {
          newObject[path] = object[path];
        }
      }
    });
    return newObject;
  }

  return pick(styles, list as any) as any;
}

export function addConstraints(layers: LayerNode[]) {
  layers.forEach((layer) => {
    traverse(layer, (child) => {
      if (child.type === "SVG") {
        child.constraints = {
          horizontal: "CENTER",
          vertical: "MIN",
        };
      } else {
        const ref = child.ref;
        if (ref) {
          const el = ref instanceof HTMLElement ? ref : ref.parentElement;
          const parent = el?.parentElement;
          if (el && parent) {
            const currentDisplay = el.style.display;
            el.style.setProperty("display", "none", "!important");
            let computed = getComputedStyle(el);
            const hasFixedWidth = computed?.width.trim().endsWith("px");
            const hasFixedHeight = computed?.height.trim().endsWith("px");
            el.style.display = currentDisplay;
            const parentStyle = getComputedStyle(parent);
            let hasAutoMarginLeft = computed.marginLeft === "auto";
            let hasAutoMarginRight = computed.marginRight === "auto";
            let hasAutoMarginTop = computed.marginTop === "auto";
            let hasAutoMarginBottom = computed.marginBottom === "auto";

            computed = getComputedStyle(el);

            if (["absolute", "fixed"].includes(computed.position!)) {
              setData(child, "position", computed.position!);
            }

            if (hasFixedHeight) {
              setData(child, "heightType", "fixed");
            }
            if (hasFixedWidth) {
              setData(child, "widthType", "fixed");
            }

            const isInline =
              computed.display && computed.display.includes("inline");

            if (isInline) {
              const parentTextAlign = parentStyle.textAlign;
              if (parentTextAlign === "center") {
                hasAutoMarginLeft = true;
                hasAutoMarginRight = true;
              } else if (parentTextAlign === "right") {
                hasAutoMarginLeft = true;
              }

              if (computed.verticalAlign === "middle") {
                hasAutoMarginTop = true;
                hasAutoMarginBottom = true;
              } else if (computed.verticalAlign === "bottom") {
                hasAutoMarginTop = true;
                hasAutoMarginBottom = false;
              }

              setData(child, "widthType", "shrink");
            }
            const parentJustifyContent =
              parentStyle.display === "flex" &&
              ((parentStyle.flexDirection === "row" &&
                parentStyle.justifyContent) ||
                (parentStyle.flexDirection === "column" &&
                  parentStyle.alignItems));

            if (parentJustifyContent === "center") {
              hasAutoMarginLeft = true;
              hasAutoMarginRight = true;
            } else if (
              parentJustifyContent &&
              (parentJustifyContent.includes("end") ||
                parentJustifyContent.includes("right"))
            ) {
              hasAutoMarginLeft = true;
              hasAutoMarginRight = false;
            }

            const parentAlignItems =
              parentStyle.display === "flex" &&
              ((parentStyle.flexDirection === "column" &&
                parentStyle.justifyContent) ||
                (parentStyle.flexDirection === "row" &&
                  parentStyle.alignItems));
            if (parentAlignItems === "center") {
              hasAutoMarginTop = true;
              hasAutoMarginBottom = true;
            } else if (
              parentAlignItems &&
              (parentAlignItems.includes("end") ||
                parentAlignItems.includes("bottom"))
            ) {
              hasAutoMarginTop = true;
              hasAutoMarginBottom = false;
            }

            if (child.type === "TEXT") {
              if (computed.textAlign === "center") {
                hasAutoMarginLeft = true;
                hasAutoMarginRight = true;
              } else if (computed.textAlign === "right") {
                hasAutoMarginLeft = true;
                hasAutoMarginRight = false;
              }
            }

            child.constraints = {
              horizontal:
                hasAutoMarginLeft && hasAutoMarginRight
                  ? "CENTER"
                  : hasAutoMarginLeft
                  ? "MAX"
                  : "SCALE",
              vertical:
                hasAutoMarginBottom && hasAutoMarginTop
                  ? "CENTER"
                  : hasAutoMarginTop
                  ? "MAX"
                  : "MIN",
            };
          }
        } else {
          child.constraints = {
            horizontal: "SCALE",
            vertical: "MIN",
          };
        }
      }
    });
  });
}

export const getBorderRadii = ({
  computedStyle,
  width = parseFloat(computedStyle.width) || 0,
  height = parseFloat(computedStyle.height) || 0,
}: {
  computedStyle: CSSStyleDeclaration;
  width?: number;
  height?: number;
}): Partial<
  Pick<
    RectangleNode,
    | "topLeftRadius"
    | "topRightRadius"
    | "bottomLeftRadius"
    | "bottomRightRadius"
  >
> => {
  const topLeft = cornerRadius(computedStyle.borderTopLeftRadius,width,height);
  const topRight = cornerRadius(computedStyle.borderTopRightRadius,width,height);
  const bottomRight = cornerRadius(computedStyle.borderBottomRightRadius,width,height);
  const bottomLeft = cornerRadius(computedStyle.borderBottomLeftRadius,width,height);

  const borderRadii = {
    ...(topLeft !== undefined ? { topLeftRadius: topLeft } : {}),
    ...(topRight !== undefined ? { topRightRadius: topRight } : {}),
    ...(bottomRight !== undefined ? { bottomRightRadius: bottomRight } : {}),
    ...(bottomLeft !== undefined ? { bottomLeftRadius: bottomLeft } : {}),
  };
  return borderRadii;
};

const sides = ["Top", "Right", "Bottom", "Left"] as const;

type BorderProps = Partial<Pick<RectangleNode,
  "strokes" | "strokeWeight" | "strokeAlign" | "dashPattern" |
  "strokeTopWeight" | "strokeRightWeight" | "strokeBottomWeight" | "strokeLeftWeight">>;

// CSS borders are drawn inside the border box. Same-colored sides map to one
// inside stroke with per-side weights; mixed colors fall back to side strips.
export function getBorders({
  computedStyle,
  rect,
  el,
}: {
  computedStyle: CSSStyleDeclaration;
  rect: Dimensions;
  el?: Element;
}): { props?: BorderProps; layers: WithRef<RectangleNode>[] } {
  const parsed = sides.map((side) => {
    const width = parseFloat((computedStyle as any)["border" + side + "Width"]) || 0;
    const style = (computedStyle as any)["border" + side + "Style"] || "none";
    const color = getRgb((computedStyle as any)["border" + side + "Color"]);
    const visible = width > 0 && style !== "none" && style !== "hidden" && !!color && color.a > 0;
    return { side, width: visible ? width : 0, style, color };
  });
  const visible = parsed.filter((s) => s.width > 0);
  if (!visible.length) return { layers: [] };
  const paint = (c: { r: number; g: number; b: number; a: number }): SolidPaint =>
    ({ type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: c.a });
  const sameColor = visible.every((s) => {
    const a = s.color!, b = visible[0].color!;
    return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) + Math.abs(a.a - b.a) < 0.02;
  });
  if (sameColor) {
    const weight = Math.max(...visible.map((s) => s.width));
    const props: BorderProps = { strokes: [paint(visible[0].color!)], strokeWeight: weight, strokeAlign: "INSIDE" };
    if (parsed.some((s) => s.width !== weight)) {
      props.strokeTopWeight = parsed[0].width;
      props.strokeRightWeight = parsed[1].width;
      props.strokeBottomWeight = parsed[2].width;
      props.strokeLeftWeight = parsed[3].width;
    }
    const style = visible[0].style;
    if (style === "dashed") props.dashPattern = [weight * 3, weight * 3];
    else if (style === "dotted") props.dashPattern = [weight, weight];
    return { props, layers: [] };
  }
  const layers = visible.map((s): WithRef<RectangleNode> => {
    const horizontal = s.side === "Top" || s.side === "Bottom";
    return {
      ref: el,
      type: "RECTANGLE",
      name: "border-" + s.side.toLowerCase(),
      x: s.side === "Right" ? rect.left + rect.width - s.width : rect.left,
      y: s.side === "Bottom" ? rect.top + rect.height - s.width : rect.top,
      width: horizontal ? rect.width : s.width,
      height: horizontal ? s.width : rect.height,
      fills: [paint(s.color!)],
    };
  });
  return { layers };
}

export const getShadowEffects = ({
  computedStyle: { boxShadow },
}: {
  computedStyle: CSSStyleDeclaration;
}): Effect[] | undefined => {
  // CSS lists the top-most shadow first; Figma stacks effects bottom-up.
  const effects = parseShadowList(boxShadow).reverse().map((shadow): Effect => ({
    type: shadow.inset ? "INNER_SHADOW" : "DROP_SHADOW",
    color: shadow.color,
    offset: { x: shadow.offsetX, y: shadow.offsetY },
    radius: shadow.blurRadius,
    spread: shadow.spreadRadius,
    blendMode: "NORMAL",
    visible: true,
  } as Effect));
  return effects.length ? effects : undefined;
};

export const getTextShadowEffects = (textShadow?: string): Effect[] | undefined => {
  const effects = parseShadowList(textShadow).reverse().map((shadow): Effect => ({
    type: "DROP_SHADOW",
    color: shadow.color,
    offset: { x: shadow.offsetX, y: shadow.offsetY },
    radius: shadow.blurRadius,
    blendMode: "NORMAL",
    visible: true,
  } as Effect));
  return effects.length ? effects : undefined;
};

// Figma blur radii are twice the CSS standard deviation.
export function getFilterEffects(computedStyle: CSSStyleDeclaration): Effect[] {
  const effects: Effect[] = [];
  const blur = (value?: string) => {
    const match = (value || "").match(/blur\(\s*([\d.]+)px\s*\)/);
    return match ? Number(match[1]) * 2 : 0;
  };
  const filter = computedStyle.filter || "";
  const layer = blur(filter);
  if (layer > 0) effects.push({ type: "LAYER_BLUR", radius: layer, visible: true } as Effect);
  const backdrop = blur((computedStyle as any).backdropFilter || (computedStyle as any).webkitBackdropFilter);
  if (backdrop > 0) effects.push({ type: "BACKGROUND_BLUR", radius: backdrop, visible: true } as Effect);
  const dropShadows = filter.match(/drop-shadow\((?:[^()]|\([^()]*\))*\)/g) || [];
  for (const shadow of dropShadows) {
    const [parsed] = parseShadowList(shadow.slice("drop-shadow(".length, -1));
    if (parsed) effects.push({ type: "DROP_SHADOW", color: parsed.color, offset: { x: parsed.offsetX, y: parsed.offsetY },
      radius: parsed.blurRadius, spread: 0, blendMode: "NORMAL", visible: true } as Effect);
  }
  return effects;
}

// Color filters have no Figma equivalent; images get them baked in.
export function colorFilter(computedStyle: CSSStyleDeclaration): string {
  const parts = (computedStyle.filter || "").match(/(grayscale|brightness|contrast|sepia|saturate|hue-rotate|invert|opacity)\([^)]*\)/g);
  return parts ? parts.join(" ") : "none";
}

const blendModes: { [key: string]: BlendMode } = {
  multiply: "MULTIPLY", screen: "SCREEN", overlay: "OVERLAY", darken: "DARKEN", lighten: "LIGHTEN",
  "color-dodge": "COLOR_DODGE", "color-burn": "COLOR_BURN", "hard-light": "HARD_LIGHT", "soft-light": "SOFT_LIGHT",
  difference: "DIFFERENCE", exclusion: "EXCLUSION", hue: "HUE", saturation: "SATURATION", color: "COLOR", luminosity: "LUMINOSITY",
};
export const getBlendMode = (computedStyle: CSSStyleDeclaration): BlendMode | undefined =>
  blendModes[(computedStyle as any).mixBlendMode];

export function getOutline({ computedStyle, rect, radii }: {
  computedStyle: CSSStyleDeclaration; rect: Dimensions; radii: { [key: string]: number | undefined };
}): RectangleNode | undefined {
  const width = parseFloat(computedStyle.outlineWidth) || 0;
  const style = computedStyle.outlineStyle;
  const color = getRgb(computedStyle.outlineColor);
  if (!width || !style || style === "none" || !color || color.a <= 0) return;
  const offset = parseFloat(computedStyle.outlineOffset) || 0;
  const layer: any = {
    type: "RECTANGLE",
    name: "outline",
    x: rect.left - offset,
    y: rect.top - offset,
    width: rect.width + offset * 2,
    height: rect.height + offset * 2,
    fills: [],
    strokes: [{ type: "SOLID", color: { r: color.r, g: color.g, b: color.b }, opacity: color.a }],
    strokeWeight: width,
    strokeAlign: "OUTSIDE",
  };
  if (style === "dashed") layer.dashPattern = [width * 3, width * 3];
  else if (style === "dotted") layer.dashPattern = [width, width];
  for (const key of Object.keys(radii)) if (radii[key]) layer[key] = Math.max(0, radii[key]! + offset);
  return layer;
}

const lengthIn = (value: string, size: number) =>
  value.endsWith("%") ? parseFloat(value) * size / 100 : parseFloat(value) || 0;

export type ClipShape =
  | { kind: "inset"; top: number; right: number; bottom: number; left: number; radius?: number }
  | { kind: "svg"; shape: string };

// Basic shapes relative to the border box. Inset (and centered circles on
// square boxes) stay native rectangles; other shapes become SVG geometry.
export function getClipShape(computedStyle: CSSStyleDeclaration, width: number, height: number): ClipShape | undefined {
  const value = (computedStyle as any).clipPath || (computedStyle as any).webkitClipPath || "none";
  if (value === "none" || value.startsWith("url(")) return;
  const fn = value.match(/^(\w+)\((.*)\)/);
  if (!fn) return;
  const [, name, args] = fn;
  if (name === "inset") {
    const [box, round] = args.split(/\s+round\s+/);
    const v = box.trim().split(/\s+/);
    const [t, r = t, b = t, l = r] = v;
    return { kind: "inset", top: lengthIn(t, height), right: lengthIn(r, width), bottom: lengthIn(b, height), left: lengthIn(l, width),
      radius: round ? lengthIn(round.trim().split(/\s+/)[0], Math.min(width, height)) : undefined };
  }
  const position = (at: string | undefined): [number, number] => {
    const [x = "50%", y = "50%"] = (at || "").trim().split(/\s+/).filter(Boolean);
    return [lengthIn(x, width), lengthIn(y, height)];
  };
  if (name === "circle" || name === "ellipse") {
    const [radiiPart, at] = args.split(/\s+at\s+|^at\s+/);
    const [cx, cy] = position(at);
    const radius = (token: string | undefined, size: number, far: number, near: number) =>
      !token || token === "closest-side" ? near : token === "farthest-side" ? far : lengthIn(token, size);
    const tokens = (radiiPart || "").trim().split(/\s+/).filter(Boolean);
    if (name === "circle") {
      const ref = Math.hypot(width, height) / Math.SQRT2;
      const r = radius(tokens[0], ref, Math.max(cx, width - cx, cy, height - cy), Math.min(cx, width - cx, cy, height - cy));
      if (Math.abs(width - height) < 0.5 && Math.abs(cx - width / 2) < 0.5 && Math.abs(cy - height / 2) < 0.5 && r >= width / 2 - 0.5) {
        return { kind: "inset", top: 0, right: 0, bottom: 0, left: 0, radius: width / 2 };
      }
      return { kind: "svg", shape: `<circle cx="${cx}" cy="${cy}" r="${r}"/>` };
    }
    const rx = radius(tokens[0], width, Math.max(cx, width - cx), Math.min(cx, width - cx));
    const ry = radius(tokens[1], height, Math.max(cy, height - cy), Math.min(cy, height - cy));
    return { kind: "svg", shape: `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>` };
  }
  if (name === "polygon") {
    const points = args.replace(/^(nonzero|evenodd)\s*,/, "").split(",").map((pair: string) => {
      const [x, y] = pair.trim().split(/\s+/);
      return lengthIn(x, width) + "," + lengthIn(y, height);
    });
    return { kind: "svg", shape: `<polygon points="${points.join(" ")}"/>` };
  }
  if (name === "path") {
    const d = args.match(/["'](.*)["']/);
    if (d) return { kind: "svg", shape: `<path d="${d[1].replace(/"/g, "&quot;")}"/>` };
  }
}
