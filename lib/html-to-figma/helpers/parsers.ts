export interface Unit {
  unit: "PIXELS";
  value: number;
}

export const parseUnits = (str?: string | null): null | Unit => {
  if (!str) {
    return null;
  }
  const match = str.match(/([\d\.]+)px/);
  const val = match?.[1];
  if (val) {
    return {
      unit: "PIXELS",
      value: parseFloat(val),
    };
  }
  return null;
};

export function getRgb(colorString?: string | null) {
  if (!colorString) {
    return null;
  }
  const value=colorString.trim().toLowerCase();
  const named: {[key:string]:string}={transparent:'#00000000',black:'#000000',white:'#ffffff',red:'#ff0000',blue:'#0000ff',green:'#008000'};
  const hex=(named[value] || value).match(/^#([\da-f]{3,8})$/i);
  if(hex){
    let h=hex[1];if(h.length===3 || h.length===4)h=h.split('').map(c=>c+c).join('');
    if(h.length===6 || h.length===8)return {r:parseInt(h.slice(0,2),16)/255,g:parseInt(h.slice(2,4),16)/255,b:parseInt(h.slice(4,6),16)/255,a:h.length===8?parseInt(h.slice(6,8),16)/255:1};
  }
  const rgb=value.match(/^rgba?\((.*)\)$/);
  if(rgb){
    const components=rgb[1].replace(/,/g,' ').replace(/\//g,' ').trim().split(/\s+/);
    if(components.length<3)return null;
    const channel=(s:string)=>Math.max(0,Math.min(1,parseFloat(s)/(s.endsWith('%')?100:255)));
    const alpha=components[3]===undefined?1:parseFloat(components[3])/(components[3].endsWith('%')?100:1);
    if(components.every(v=>Number.isFinite(parseFloat(v))))return {r:channel(components[0]),g:channel(components[1]),b:channel(components[2]),a:Math.max(0,Math.min(1,alpha))};
  }
  return null;
}

interface ParsedBoxShadow {
  inset: boolean;
  offsetX: number;
  offsetY: number;
  blurRadius: number;
  spreadRadius: number;
  color: string;
}
const LENGTH_REG = /^[0-9]+[a-zA-Z%]+?$/;
const toNum = (v: string): number => {
  // if (!/px$/.test(v) && v !== '0') return v;
  if (!/px$/.test(v) && v !== "0") return 0;
  const n = parseFloat(v);
  // return !isNaN(n) ? n : v;
  return !isNaN(n) ? n : 0;
};
const isLength = (v: string) => v === "0" || LENGTH_REG.test(v);
export const parseBoxShadowStr = (str: string): ParsedBoxShadow => {
  // TODO: this is broken for multiple box shadows
  if (str.startsWith("rgb")) {
    // Werid computed style thing that puts the color in the front not back
    const colorMatch = str.match(/(rgba?\(.+?\))(.+)/);
    if (colorMatch) {
      str = (colorMatch[2] + " " + colorMatch[1]).trim();
    }
  }

  const PARTS_REG = /\s(?![^(]*\))/;
  const parts = str.split(PARTS_REG);
  const inset = parts.includes("inset");
  const last = parts.slice(-1)[0];
  const color = !isLength(last) ? last : "rgba(0, 0, 0, 1)";

  const nums = parts
    .filter((n) => n !== "inset")
    .filter((n) => n !== color)
    .map(toNum);

  const [offsetX, offsetY, blurRadius, spreadRadius] = nums;

  return {
    inset,
    offsetX,
    offsetY,
    blurRadius,
    spreadRadius,
    color,
  };
};
