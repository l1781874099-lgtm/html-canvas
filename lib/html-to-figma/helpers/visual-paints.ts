import { getRgb } from './parsers';

export function splitCssList(value: string): string[] {
  let depth = 0, start = 0;
  const parts: string[] = [];
  for (let i=0;i<value.length;i++) {
    if (value[i] === '(') depth++;
    if (value[i] === ')') depth--;
    if (value[i] === ',' && depth === 0) {parts.push(value.slice(start,i).trim());start=i+1;}
  }
  parts.push(value.slice(start).trim());return parts;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function colorAt(stops: ColorStop[], position: number): RGBA {
  if (position <= stops[0].position) return stops[0].color;
  for (let i = 1; i < stops.length; i++) {
    if (position <= stops[i].position) {
      const a = stops[i - 1], b = stops[i], span = b.position - a.position;
      const t = span > 0 ? (position - a.position) / span : 1;
      return {r: lerp(a.color.r, b.color.r, t), g: lerp(a.color.g, b.color.g, t), b: lerp(a.color.b, b.color.b, t), a: lerp(a.color.a, b.color.a, t)};
    }
  }
  return stops[stops.length - 1].color;
}

// Repeating gradients repeat their stop list over the whole gradient line.
function repeatStops(stops: ColorStop[] | undefined): ColorStop[] | undefined {
  if (!stops) return;
  const first = stops[0].position, period = stops[stops.length - 1].position - first;
  if (!(period > 1e-4)) {
    const color = stops[stops.length - 1].color;
    return [{position: 0, color}, {position: 1, color}];
  }
  if ((1 / period) * stops.length > 4000) return;
  const expanded: ColorStop[] = [];
  for (let k = Math.floor(-first / period); first + k * period <= 1; k++) {
    for (const stop of stops) expanded.push({position: stop.position + k * period, color: stop.color});
  }
  return [
    {position: 0, color: colorAt(expanded, 0)},
    ...expanded.filter(stop => stop.position > 0 && stop.position < 1),
    {position: 1, color: colorAt(expanded, 1)},
  ];
}

export function linearGradient(value: string, width: number, height: number): GradientPaint | undefined {
  const match = value.match(/^(repeating-)?linear-gradient\((.*)\)$/i);
  if (!match) return;
  const repeating = !!match[1];
  const parts = splitCssList(match[2]);
  let angle = 180;
  const direction = parts[0];
  const degree = direction.match(/^(-?[\d.]+)(deg|turn|rad)$/);
  if (degree) {angle=Number(degree[1])*(degree[2]==='turn'?360:degree[2]==='rad'?180/Math.PI:1);parts.shift();}
  else if (/^to /.test(direction)) {
    const dx=direction.includes('right')?1:direction.includes('left')?-1:0;
    const dy=direction.includes('bottom')?1:direction.includes('top')?-1:0;
    angle=Math.atan2(dx,-dy)*180/Math.PI;parts.shift();
  }
  const radians=angle*Math.PI/180, dx=Math.sin(radians), dy=-Math.cos(radians);
  const length=Math.abs(width*dx)+Math.abs(height*dy) || 1;
  const gradientStops=repeating?repeatStops(colorStops(parts,length,false)):colorStops(parts,length);
  if(!gradientStops)return;
  // Inverse transform: a point in normalized layer coordinates maps to its
  // position along the CSS gradient line. Identity means left-to-right.
  const a=dx*width/length,b=dy*height/length,c=-dy*width/length,d=dx*height/length;
  return {type:'GRADIENT_LINEAR',gradientTransform:[[a,b,.5-(a+b)/2],[c,d,.5-(c+d)/2]],gradientStops};
}

function colorStops(parts: string[], length: number, clamp = true): ColorStop[] | undefined {
  const raw: {color: RGBA | null; position?: number}[]=[];
  for(const part of parts){
    // "red 10% 20%" is shorthand for two stops of the same color.
    const stop=part.match(/\s+(-?[\d.]+)(%|px)(?:\s+(-?[\d.]+)(%|px))?\s*$/);
    const color=getRgb(stop?part.slice(0,stop.index).trim():part);
    const position=(value?:string,unit?:string)=>value===undefined?undefined:Number(value)/(unit==='%'?100:length);
    raw.push({color,position:position(stop?.[1],stop?.[2])});
    if(stop && stop[3]!==undefined)raw.push({color,position:position(stop[3],stop[4])});
  }
  if(raw.length<2 || raw.some(s=>!s.color)) return;
  if(raw[0].position===undefined)raw[0].position=0;
  if(raw[raw.length-1].position===undefined)raw[raw.length-1].position=1;
  for(let i=1;i<raw.length;i++)if(raw[i].position===undefined){
    const start=i-1;let end=i;while(raw[end].position===undefined)end++;
    for(let j=i;j<end;j++)raw[j].position=raw[start].position!+(raw[end].position!-raw[start].position!)*(j-start)/(end-start);
    i=end;
  }
  // A stop placed before an earlier one is moved up to it (CSS rule).
  for(let i=1;i<raw.length;i++)raw[i].position=Math.max(raw[i].position!,raw[i-1].position!);
  return raw.map(s=>({position:clamp?Math.max(0,Math.min(1,s.position!)):s.position!,color:s.color!}));
}

function positionValue(token: string, size: number): number | undefined {
  const keyword: {[key:string]:number}={left:0,top:0,center:.5,right:1,bottom:1};
  if(token in keyword)return keyword[token]*size;
  const match=token.match(/^(-?[\d.]+)(%|px)$/);
  if(match)return Number(match[1])*(match[2]==='%'?size/100:1);
}

export function radialGradient(value: string, width: number, height: number): GradientPaint | undefined {
  const match = value.match(/^(repeating-)?radial-gradient\((.*)\)$/i);
  if (!match || width<=0 || height<=0) return;
  const repeating = !!match[1];
  const parts = splitCssList(match[2]);
  let circle=false, extent='farthest-corner', cx=width/2, cy=height/2;
  let explicit: number[] = [];
  const first=parts[0].trim();
  if(!getRgb(first.replace(/\s+-?[\d.]+(%|px)(\s+-?[\d.]+(%|px))?$/,''))){
    parts.shift();
    const [shape,at]=first.split(/\bat\b/).map(s=>s.trim());
    for(const token of (shape || '').split(/\s+/).filter(Boolean)){
      if(token==='circle')circle=true;
      else if(token==='ellipse')circle=false;
      else if(/^(closest|farthest)-(side|corner)$/.test(token))extent=token;
      else {const length=token.match(/^([\d.]+)(px|%)$/);if(length)explicit.push(Number(length[1])*(length[2]==='%'?(explicit.length?height:width)/100:1));}
    }
    if(explicit.length===1)circle=true;
    if(at){
      let tokens=at.split(/\s+/).filter(Boolean);
      if(tokens.length===1)tokens=[tokens[0],'center'];
      if(['top','bottom'].includes(tokens[0]) || ['left','right'].includes(tokens[1]))tokens=[tokens[1],tokens[0]];
      cx=positionValue(tokens[0],width) ?? cx;cy=positionValue(tokens[1],height) ?? cy;
    }
  }
  const sideX=[cx,width-cx].map(Math.abs),sideY=[cy,height-cy].map(Math.abs);
  const corners=[[0,0],[width,0],[0,height],[width,height]].map(([x,y])=>Math.hypot(x-cx,y-cy));
  let rx:number,ry:number;
  if(explicit.length){rx=explicit[0];ry=explicit[1] ?? explicit[0];}
  else if(circle){
    const r=extent==='closest-side'?Math.min(...sideX,...sideY):extent==='farthest-side'?Math.max(...sideX,...sideY):
      extent==='closest-corner'?Math.min(...corners):Math.max(...corners);
    rx=ry=r;
  }else{
    const closest=extent.startsWith('closest');
    rx=closest?Math.min(...sideX):Math.max(...sideX);ry=closest?Math.min(...sideY):Math.max(...sideY);
    if(extent.endsWith('corner')){rx*=Math.SQRT2;ry*=Math.SQRT2;}
  }
  rx=Math.max(rx,1e-3);ry=Math.max(ry,1e-3);
  const gradientStops=repeating?repeatStops(colorStops(parts,rx,false)):colorStops(parts,rx);
  if(!gradientStops)return;
  // Figma's radial gradient space has its center at (0.5, 0.5) and radius 0.5.
  return {type:'GRADIENT_RADIAL',gradientStops,gradientTransform:[
    [width/(2*rx),0,.5-cx/(2*rx)],
    [0,height/(2*ry),.5-cy/(2*ry)],
  ]};
}

const angleDegrees = (value: number, unit: string) =>
  value * (unit === 'turn' ? 360 : unit === 'rad' ? 180 / Math.PI : unit === 'grad' ? 0.9 : 1);
const cssColor = (color: RGBA) =>
  `rgba(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)},${color.a})`;

function invert([[a, b, c], [d, e, f]]: Transform): Transform | undefined {
  const det = a * e - b * d;
  if (Math.abs(det) < 1e-12) return;
  return [[e / det, -b / det, (b * f - c * e) / det], [-d / det, a / det, (c * d - a * f) / det]];
}

// Matrix from Figma's normalized gradient space to layer pixels.
function gradientToPixels(paint: GradientPaint, width: number, height: number): number[] | undefined {
  const inverse = invert(paint.gradientTransform);
  if (!inverse) return;
  return [width * inverse[0][0], height * inverse[1][0], width * inverse[0][1], height * inverse[1][1], width * inverse[0][2], height * inverse[1][2]];
}

// Draws any CSS gradient (including conic) into a canvas box.
export function drawGradient(ctx: CanvasRenderingContext2D, value: string, width: number, height: number): boolean {
  const conic = value.match(/^(repeating-)?conic-gradient\((.*)\)$/i);
  if (conic) {
    if (typeof (ctx as any).createConicGradient !== 'function') return false;
    const parts = splitCssList(conic[2]);
    let from = 0, cx = width / 2, cy = height / 2;
    if (/^(from|at)\b/.test(parts[0])) {
      const head = parts.shift()!;
      const angle = head.match(/from\s+(-?[\d.]+)(deg|turn|rad|grad)/);
      if (angle) from = angleDegrees(Number(angle[1]), angle[2]);
      const at = head.split(/\bat\b/)[1];
      if (at) {
        let tokens = at.trim().split(/\s+/);
        if (tokens.length === 1) tokens = [tokens[0], 'center'];
        if (['top', 'bottom'].includes(tokens[0]) || ['left', 'right'].includes(tokens[1])) tokens = [tokens[1], tokens[0]];
        cx = positionValue(tokens[0], width) ?? cx; cy = positionValue(tokens[1], height) ?? cy;
      }
    }
    const percentParts = parts.map(part => part.replace(/(-?[\d.]+)(deg|turn|rad|grad)\b/g, (_m, n, unit) => angleDegrees(Number(n), unit) / 3.6 + '%'));
    const stops = conic[1] ? repeatStops(colorStops(percentParts, 1, false)) : colorStops(percentParts, 1);
    if (!stops) return false;
    const gradient = (ctx as any).createConicGradient((from - 90) * Math.PI / 180, cx, cy) as CanvasGradient;
    for (const stop of stops) gradient.addColorStop(Math.max(0, Math.min(1, stop.position)), cssColor(stop.color));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    return true;
  }
  const paint = linearGradient(value, width, height) || radialGradient(value, width, height);
  const matrix = paint && gradientToPixels(paint, width, height);
  if (!paint || !matrix) return false;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  ctx.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
  const gradient = paint.type === 'GRADIENT_LINEAR' ? ctx.createLinearGradient(0, .5, 1, .5) : ctx.createRadialGradient(.5, .5, 0, .5, .5, .5);
  for (const stop of paint.gradientStops) gradient.addColorStop(stop.position, cssColor(stop.color));
  ctx.fillStyle = gradient;
  // Fill the layer box expressed in gradient space.
  const [[a, b, c], [d, e, f]] = paint.gradientTransform;
  ctx.beginPath();
  [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([x, y], i) => {
    const gx = a * x + b * y + c, gy = d * x + e * y + f;
    i ? ctx.lineTo(gx, gy) : ctx.moveTo(gx, gy);
  });
  ctx.fill();
  ctx.restore();
  return true;
}

const escapeAttr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// Paints clipped by an SVG shape (used for CSS clip-path).
let svgIds = 0;
export function paintsToSvg(paints: Paint[], width: number, height: number, shape: string): string {
  const id = 'h2f' + (svgIds++).toString(36);
  const defs: string[] = [`<clipPath id="${id}">${shape}</clipPath>`];
  const body: string[] = [];
  paints.forEach((paint, index) => {
    const opacity = paint.opacity ?? 1;
    if (paint.type === 'SOLID') {
      body.push(`<rect width="${width}" height="${height}" fill="${cssColor({...paint.color, a: 1})}" fill-opacity="${opacity}"/>`);
    } else if (paint.type === 'GRADIENT_LINEAR' || paint.type === 'GRADIENT_RADIAL') {
      const matrix = gradientToPixels(paint, width, height);
      if (!matrix) return;
      const stops = paint.gradientStops.map(stop =>
        `<stop offset="${stop.position}" stop-color="${cssColor({...stop.color, a: 1})}" stop-opacity="${stop.color.a}"/>`).join('');
      const attrs = `id="${id}g${index}" gradientUnits="userSpaceOnUse" gradientTransform="matrix(${matrix.join(' ')})"`;
      defs.push(paint.type === 'GRADIENT_LINEAR'
        ? `<linearGradient ${attrs} x1="0" y1=".5" x2="1" y2=".5">${stops}</linearGradient>`
        : `<radialGradient ${attrs} cx=".5" cy=".5" r=".5">${stops}</radialGradient>`);
      body.push(`<rect width="${width}" height="${height}" fill="url(#${id}g${index})" fill-opacity="${opacity}"/>`);
    } else if (paint.type === 'IMAGE' && (paint as any).url) {
      const fit = paint.scaleMode === 'FIT' ? 'xMidYMid meet' : paint.scaleMode === 'FILL' ? 'xMidYMid slice' : 'none';
      body.push(`<image href="${escapeAttr((paint as any).url)}" width="${width}" height="${height}" preserveAspectRatio="${fit}" opacity="${opacity}"/>`);
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${defs.join('')}</defs><g clip-path="url(#${id})">${body.join('')}</g></svg>`;
}

export function backgroundPaints(
  style: CSSStyleDeclaration,
  width: number,
  height: number,
  imageLayer?: (url: string, index: number) => Paint | undefined,
  rasterLayer?: (image: string, index: number) => Paint | undefined
): Paint[] {
  const paints: Paint[]=[];
  const color=getRgb(style.backgroundColor);
  if(color && color.a>0)paints.push({type:'SOLID',color:{r:color.r,g:color.g,b:color.b},opacity:color.a});
  // Multiple CSS background layers are ordered top-first. Figma paints are
  // appended bottom-to-top, so later CSS layers come first.
  const layers=splitCssList(style.backgroundImage || 'none');
  for(let index=layers.length-1;index>=0;index--){
    const image=layers[index];
    const url=image.match(/^url\(\s*['"]?(.*?)['"]?\s*\)$/);
    const paint=url?imageLayer?.(url[1],index):
      rasterLayer?.(image,index) || linearGradient(image,width,height) || radialGradient(image,width,height);
    if(paint)paints.push(paint);
  }
  return paints;
}

export function cornerRadius(value: string, width: number, height: number): number | undefined {
  const token=(value || '').trim().split(/\s+/)[0];
  if(!/^[\d.]+(?:px|%)$/.test(token))return;
  const radius=parseFloat(token)*(token.endsWith('%')?Math.min(width,height)/100:1);
  return Math.min(radius,Math.min(width,height)/2);
}
