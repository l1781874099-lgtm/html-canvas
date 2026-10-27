import { fontCandidates, normalizeFontFamily, styleWeight } from "./functions/font-matching";
import { importLocalCanvas } from './functions/local-canvas-import';
import { traverseLayers } from "./functions/traverse-layers";
import { settings } from "./constants/settings";
import { fastClone } from "./functions/fast-clone";
import { getLayout, hasChildren, isGroupNode } from "../lib/helpers";

const allPropertyNames = [
  "id",
  "width",
  "height",
  "currentPage",
  "cancel",
  "origin",
  "onmessage",
  "center",
  "zoom",
  "fontName",
  "name",
  "visible",
  "locked",
  "constraints",
  "relativeTransform",
  "x",
  "y",
  "rotation",
  "constrainProportions",
  "layoutAlign",
  "layoutGrow",
  "opacity",
  "blendMode",
  "isMask",
  "effects",
  "effectStyleId",
  "expanded",
  "backgrounds",
  "backgroundStyleId",
  "fills",
  "strokes",
  "strokeWeight",
  "strokeMiterLimit",
  "strokeAlign",
  "strokeCap",
  "strokeJoin",
  "dashPattern",
  "fillStyleId",
  "strokeStyleId",
  "cornerRadius",
  "cornerSmoothing",
  "topLeftRadius",
  "topRightRadius",
  "bottomLeftRadius",
  "bottomRightRadius",
  "exportSettings",
  "overflowDirection",
  "numberOfFixedChildren",
  "description",
  "layoutMode",
  "primaryAxisSizingMode",
  "counterAxisSizingMode",
  "primaryAxisAlignItems",
  "counterAxisAlignItems",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "paddingBottom",
  "itemSpacing",
  "layoutGrids",
  "gridStyleId",
  "clipsContent",
  "guides",
  "guides",
  "selection",
  "selectedTextRange",
  "backgrounds",
  "arcData",
  "pointCount",
  "pointCount",
  "innerRadius",
  "vectorNetwork",
  "vectorPaths",
  "handleMirroring",
  "textAlignHorizontal",
  "textAlignVertical",
  "textAutoResize",
  "paragraphIndent",
  "paragraphSpacing",
  "autoRename",
  "textStyleId",
  "fontSize",
  "fontName",
  "textCase",
  "textDecoration",
  "letterSpacing",
  "lineHeight",
  "characters",
  "mainComponent",
  "scaleFactor",
  "booleanOperation",
  "expanded",
  "name",
  "type",
  "paints",
  "type",
  "fontSize",
  "textDecoration",
  "fontName",
  "letterSpacing",
  "lineHeight",
  "paragraphIndent",
  "paragraphSpacing",
  "textCase",
  "type",
  "effects",
  "type",
  "layoutGrids",
  "absoluteRenderBounds",
];

// The Figma nodes are hard to inspect at a glance because almost all properties are non enumerable
// getters. This removes that wrapping for easier inspecting
const cloneObject = (obj: any, valuesSet = new Set()) => {
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  const newObj: any = Array.isArray(obj) ? [] : {};

  for (const property of allPropertyNames) {
    const value = obj[property];
    if (value !== undefined && typeof value !== "symbol") {
      newObj[property] = obj[property];
    }
  }

  return newObj;
};

async function postSelection() {
  figma.ui.postMessage({
    type: "selectionChange",
    elements: fastClone(
      await Promise.all(
        figma.currentPage.selection.map((el) =>
          serialize(el as any, {
            // TODO: only need one level deep......
            withChildren: true,
          })
        )
      )
    ),
  });
}

let localImportActive = false;
figma.on("selectionchange", async () => {
  if(localImportActive)return;
  postSelection();
});

// This shows the HTML page in "ui.html".
figma.showUI(__html__, {
  width: settings.ui.baseWidth,
  height: settings.ui.baseHeight,
});
async function processImages(layer: RectangleNode | TextNode) {
  const images = getImageFills(layer);
  return (
    images &&
    Promise.all(
      images.map(async (image: any) => {
        if (image?.intArr) {
          image.imageHash = await figma.createImage(image.intArr).hash;
          delete image.intArr;
        }
      })
    )
  );
}

function getImageFills(layer: RectangleNode | TextNode) {
  const images =
    Array.isArray(layer.fills) &&
    layer.fills.filter((item) => item.type === "IMAGE");
  return images;
}

const defaultFont = { family: "Roboto", style: "Regular" };
const fontCache: {[key: string]: Promise<FontName>} = {};
const loadedFonts: {[key: string]: Promise<void>} = {};
function loadFont(font: FontName): Promise<void> {
  const key = JSON.stringify(font);
  if (!loadedFonts[key]) {
    loadedFonts[key] = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('加载字体超时：' + font.family + ' / ' + font.style)), 8000);
      figma.loadFontAsync(font).then(() => {clearTimeout(timer);resolve();}, error => {clearTimeout(timer);reject(error);});
    });
  }
  return loadedFonts[key];
}
function getMatchingFont(fontStr: string, availableFonts: Font[], weight = 400, italic = false, characters = ''): Promise<FontName> {
  const key = JSON.stringify([fontStr, weight, italic, /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(characters)]);
  if (!fontCache[key]) fontCache[key] = (async () => {
    const candidates = fontCandidates(fontStr, weight, italic, characters, availableFonts);
    const families = new Set<string>();
    let attempted = 0;
    for (const font of candidates) {
      // Try the best variant of up to four families; don't wait on every weight
      // of a missing font family before trying an installed fallback.
      if (families.has(font.family)) continue;
      families.add(font.family);
      if (attempted++ >= 4) break;
      try { await loadFont(font); return font; } catch (error) { console.warn(error); }
    }
    throw new Error('没有可用字体，请确认 Figma 可以读取本机字体。');
  })();
  return fontCache[key];
}

async function serialize(
  element: any,
  options: {
    withImages?: boolean;
    withChildren?: boolean;
    // TODO
    withVectorsExported?: boolean;
  } = {}
): Promise<any> {
  let fills = (element.fills && (fastClone(element.fills) as Paint[])) || [];
  if (options.withImages && fills.length) {
    for (const fill of fills) {
      if (fill.type === "IMAGE" && fill.imageHash) {
        const image = figma.getImageByHash(fill.imageHash);
        if (!image) continue;
        try {
          const bytes = await image.getBytesAsync();
          (fill as any).intArr = bytes;
        } catch (err) {
          console.warn("Could not get image for layer", element, fill, err);
        }
      }
    }
  }

  // TODO: May have bg...
  const isSvg =
    (hasChildren(element) &&
      element.children.every((item) => item.type === "VECTOR")) ||
    element.type === "VECTOR";

  if (
    options.withImages &&
    // options.withVectorsExported !== false &&
    isSvg
  ) {
    const image = await element.exportAsync({
      // TODO: use SVG for SVGs
      format: "PNG",
      constraint: {
        type: "SCALE",
        value: 2,
      },
    });
    fills = [
      {
        type: "IMAGE",
        visible: true,
        scaleMode: "FIT",
        ...({ intArr: image } as any),
      },
    ];
  }
  const cssProps = await element.getCSSAsync();

  // TODO: better way to enumerate everything, including getters, that is not function
  return {
    ...cloneObject(element),
    cssProps,
    fills,
    type: element.type === "VECTOR" ? "RECTANGLE" : element.type,
    data: JSON.parse(element.getSharedPluginData("builder", "data") || "{}"),
    children:
      (options.withChildren &&
        element.children &&
        !isSvg &&
        (await Promise.all(
          element.children
            .filter((child: SceneNode) => child.visible)
            .map((child: any) => serialize(child as any, options))
        ))) ||
      undefined,
  };
}

type AnyStringMap = { [key: string]: any };

function assign(a: BaseNode & AnyStringMap, b: AnyStringMap) {
  for (const key in b) {
    const value = b[key];
    if (key === "data" && value && typeof value === "object") {
      const currentData =
        JSON.parse(a.getSharedPluginData("builder", "data") || "{}") || {};
      const newData = value;
      const mergedData = Object.assign({}, currentData, newData);
      // TODO merge plugin data
      a.setSharedPluginData("builder", "data", JSON.stringify(mergedData));
    } else if (
      typeof value != "undefined" &&
      ["width", "height", "type", "ref", "children", "svg"].indexOf(key) === -1
    ) {
      try {
        a[key] = b[key];
      } catch (err) {
        console.warn(`Assign error for property "${key}"`, a, b, err);
      }
    }
  }
}

const isImportErrorsKey = "isImportErrors";

function clearAllErrors() {
  figma.currentPage.children.forEach((el) => {
    if (el.getPluginData(isImportErrorsKey) === "true") {
      el.remove();
    }
  });
}

const importableLayerTypes = new Set<NodeType>([
  "RECTANGLE",
  "FRAME",
  "TEXT",
  "COMPONENT",
  "LINE",
  "INSTANCE",
]);

const isNotImportable = (node: SceneNode) =>
  // Don't show warnings for invisble nodes, we don't import them
  !node.visible
    ? false
    : ((node as FrameNode | GroupNode).children &&
        getLayout(node) === "unknown") ||
      !importableLayerTypes.has(node.type);

const getAbsolutePositionRelativeToArtboard = (node: SceneNode) => {
  if (
    typeof node.x !== "number" ||
    !node.parent ||
    ["PAGE", "DOCUMENT"].includes(node.type)
  ) {
    return { x: 0, y: 0 };
  }
  const position = {
    x: node.x,
    y: node.y,
  };

  if (["PAGE", "DOCUMENT"].includes(node.parent.type)) {
    return position;
  }

  let parent: SceneNode | null = node;
  while ((parent = parent.parent as SceneNode | null)) {
    if (!isGroupNode(parent) && typeof parent.x === "number") {
      position.x += parent.x;
      position.y += parent.y;
    }
    // This is the end
    if (["PAGE", "DOCUMENT"].includes(parent.parent!?.type)) {
      break;
    }
  }

  return position;
};

const getAbsolutePositionRelativeToRootLayer = (
  node: SceneNode,
  rootPosition: { x: number; y: number }
) => {
  const nodeAbsolutePosition = getAbsolutePositionRelativeToArtboard(node);
  return {
    x: nodeAbsolutePosition.x - rootPosition.x,
    y: nodeAbsolutePosition.y - rootPosition.y,
  };
};

const hasInvisibleParent = (node: SceneNode): boolean => {
  let parent: SceneNode | null = node;
  do {
    if (parent.visible === false) {
      return true;
    }
  } while ((parent = parent.parent as SceneNode | null));

  return false;
};

// Returns true if valid
async function checkIfCanGetCode() {
  clearAllErrors();
  const selected = figma.currentPage.selection[0];
  if (!selected) {
    return false;
  }

  const invalidLayers: SceneNode[] = [];

  await traverseLayers(selected, (node: SceneNode) => {
    if (!hasInvisibleParent(node) && isNotImportable(node)) {
      invalidLayers.push(node);
    }
  });

  if (invalidLayers.length) {
    const errorFrame = figma.createFrame();
    errorFrame.name = "代码导出错误提示（可删除）";
    const absolutePosition = getAbsolutePositionRelativeToArtboard(selected);
    errorFrame.x = absolutePosition.x;
    errorFrame.y = absolutePosition.y;
    errorFrame.fills = [];
    errorFrame.resize(selected.width || 1, selected.height || 1);
    errorFrame.setPluginData(isImportErrorsKey, "true");

    for (const invalidLayer of invalidLayers) {
      const errorLayer = figma.createRectangle();
      errorLayer.setPluginData(isImportErrorsKey, "true");
      if (invalidLayer.type === "VECTOR") {
        errorLayer.name = `"${invalidLayer.name}" needs to be a rasterized image`;
      } else {
        errorLayer.name = `"${invalidLayer.name}" needs to use autolayout`;
      }
      const { x, y } = getAbsolutePositionRelativeToRootLayer(
        invalidLayer,
        absolutePosition
      );
      errorLayer.x = x;
      errorLayer.y = y;
      errorLayer.fills = [];
      errorLayer.resize(invalidLayer.width || 1, invalidLayer.height || 1);

      errorLayer.strokeWeight = 4;
      errorLayer.strokes = [
        {
          type: "SOLID",
          visible: true,
          opacity: 1,
          blendMode: "NORMAL",
          color: {
            r: 1,
            g: 0,
            b: 0,
          },
        },
      ];
      errorFrame.appendChild(errorLayer);
    }
  }

  return !invalidLayers.length;
}

// Calls to "parent.postMessage" from within the HTML page will trigger this
// callback. The callback will be passed the "pluginMessage" property of the
// posted message.
figma.ui.onmessage = async (msg) => {
  if (msg.type === "resize") {
    figma.ui.resize(msg.width, msg.height);
  }

  if (msg.type === "getStorage") {
    const data = await figma.clientStorage.getAsync("data");
    figma.ui.postMessage({
      type: "storage",
      data,
    });
  }
  if (msg.type === "init") {
    postSelection();
  }
  if (msg.type === "setStorage") {
    const data = msg.data;
    figma.clientStorage.setAsync("data", data);
  }

  if (msg.type === "checkIfCanGetCode") {
    const canGet = await checkIfCanGetCode();
    figma.ui.postMessage({
      type: "canGetCode",
      value: canGet,
    });
  }

  if (msg.type === "getSelectionWithImages") {
    figma.ui.postMessage({
      type: "selectionWithImages",
      elements: await Promise.all(
        figma.currentPage.selection.map((el) =>
          serialize(el as any, {
            withChildren: true,
            withImages: true,
          })
        )
      ),
    });
  }

  if (msg.type === "updateElements") {
    const elements = msg.elements;
    for (const element of elements) {
      const el = figma.getNodeById(element.id);
      if (el) {
        assign(el as any, element);
      }
    }
  }
  if (msg.type === "clearErrors") {
    clearAllErrors();
  }

  if (msg.type === "import") {
    if(msg.localHtml){
      localImportActive=true;
      try{
        await importLocalCanvas(msg,{
          assign,
          images:processImages,
          font:(layer,fonts)=>getMatchingFont(layer.fontFamily || 'Roboto',fonts,Number(layer.fontWeight)||400,/italic|oblique/.test(layer.fontStyle || ''),layer.characters || ''),
        });
      }finally{localImportActive=false;}
      return;
    }
    try {
    let skippedLayers = 0;
    const availableFonts = await figma.listAvailableFontsAsync();
    const fontWarnings = new Set<string>();
    let completedLayers = 0;
    const { data } = msg;
    const { layers } = data;
    const rects: SceneNode[] = [];
    let baseFrame: PageNode | FrameNode = figma.currentPage;
    // TS bug? TS is implying that frameRoot is PageNode and ignoring the type declaration
    // and the reassignment unless I force it to treat baseFrame as any
    let frameRoot: PageNode | FrameNode = baseFrame as any;
    for (const rootLayer of layers) {
      await traverseLayers(rootLayer, async (layer: any, parent) => {
        try {
          if (layer.type === "FRAME" || layer.type === "GROUP") {
            const frame = figma.createFrame();
            frame.x = layer.x;
            frame.y = layer.y;
            frame.resize(layer.width || 1, layer.height || 1);
            assign(frame, layer);
            rects.push(frame);
            ((parent && (parent as any).ref) || baseFrame).appendChild(frame);
            layer.ref = frame;
            if (!parent) {
              frameRoot = frame;
              baseFrame = frame;
            }
            // baseFrame = frame;
          } else if (layer.type === "SVG") {
            const node = figma.createNodeFromSvg(layer.svg);
            node.x = layer.x;
            node.y = layer.y;
            node.resize(layer.width || 1, layer.height || 1);
            layer.ref = node;
            rects.push(node);
            assign(node, layer);
            ((parent && (parent as any).ref) || baseFrame).appendChild(node);
          } else if (layer.type === "RECTANGLE") {
            const rect = figma.createRectangle();
            const imageFills = getImageFills(layer);
            if (imageFills) {
              await processImages(layer);
              if (imageFills.length && msg.blurImages) {
                (layer as RectangleNode).effects = [
                  {
                    type: "LAYER_BLUR",
                    visible: true,
                    radius: 13,
                  },
                ];
                (layer as RectangleNode).name = "示例图片";
              }
            }
            assign(rect, layer);
            rect.resize(layer.width || 1, layer.height || 1);
            rects.push(rect);
            layer.ref = rect;
            ((parent && (parent as any).ref) || baseFrame).appendChild(rect);
          } else if (layer.type == "TEXT") {
            const text = figma.createText();
            const weight = Number(layer.fontWeight) || 400;
            const italic = /italic|oblique/.test(layer.fontStyle || '');
            const font = await getMatchingFont(layer.fontFamily || 'Roboto', availableFonts, weight, italic, layer.characters || '');
            text.fontName = font;
            if (Math.abs(styleWeight(font.style) - weight) > 100) fontWarnings.add(font.family + ': ' + weight + ' → ' + font.style);
            const textProperties = {...layer};
            delete textProperties.fontFamily;
            delete textProperties.fontWeight;
            delete textProperties.fontStyle;
            delete textProperties.singleLine;
            // Preserve the CSS size. The old import loop shrank fonts to hide
            // fallback-metric differences, changing both size and appearance.
            text.textAutoResize = 'NONE';
            assign(text, textProperties);
            layer.ref = text;
            text.resize(Math.max(1, layer.width || 1), Math.max(1, layer.height || 1));
            text.textAutoResize = layer.singleLine ? 'WIDTH_AND_HEIGHT' : 'HEIGHT';
            rects.push(text);
            ((parent && (parent as any).ref) || baseFrame).appendChild(text);
          }
        } catch (err) {
          skippedLayers++;
          console.warn("Error on layer:", layer, err);
        }
        completedLayers++;
        if (msg.localHtml && completedLayers % 20 === 0) {
          figma.ui.postMessage({type: 'importProgress', requestId: msg.requestId, completedLayers});
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      });
    }
    if (frameRoot.type === "FRAME") {
      figma.currentPage.selection = [frameRoot];
    }

    figma.ui.postMessage({
      type: "doneLoading",
      requestId: msg.requestId,
      rootId: frameRoot.id,
      skippedLayers,
      completedLayers,
      fontWarnings: Array.from(fontWarnings),
    });

    figma.viewport.scrollAndZoomIntoView([frameRoot]);

    if (process.env.NODE_ENV !== "development" && !msg.localHtml) {
      figma.closePlugin();
    }
    } catch (error) {
      figma.ui.postMessage({ type: 'importFailed', requestId: msg.requestId, message: String(error) });
    }
  }

  // Make sure to close the plugin when you're done. Otherwise the plugin will
  // keep running, which shows the cancel button at the bottom of the screen.
};
