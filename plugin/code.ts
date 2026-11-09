import { fontCandidates } from './functions/font-matching';
import { importLocalCanvas } from './functions/local-canvas-import';
import { settings } from './constants/settings';
figma.showUI(__html__,{width:settings.ui.baseWidth,height:settings.ui.baseHeight});
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

function assign(node:any,data:any){
  for(const key of Object.keys(data)){
    if(['width','height','type','ref','children','svg','data'].includes(key) || data[key]===undefined)continue;
    try{node[key]=data[key];}catch(error){console.warn('Unsupported property: '+key);}
  }
}
figma.ui.onmessage=async(msg:any)=>{
  if(msg.type==='listFonts'){
    const fonts=await figma.listAvailableFontsAsync();
    figma.ui.postMessage({type:'fontList',families:Array.from(new Set(fonts.map(font=>font.fontName.family)))});
    return;
  }
  if(msg.type!=='import' || !msg.localHtml)return;
  await importLocalCanvas(msg,{
    assign,images:processImages,
    font:(layer,fonts)=>getMatchingFont(layer.fontFamily || '',fonts,Number(layer.fontWeight)||400,/italic|oblique/i.test(layer.fontStyle || ''),layer.characters || ''),
  });
};
