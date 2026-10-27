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

export function linearGradient(value: string, width: number, height: number): GradientPaint | undefined {
  const match = value.match(/^linear-gradient\((.*)\)$/i);
  if (!match) return;
  const parts = splitCssList(match[1]);
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
  const raw=parts.map(part=>{
    const stop=part.match(/\s+(-?[\d.]+)(%|px)\s*$/);
    const color=getRgb(stop?part.slice(0,stop.index).trim():part);
    return {color, position:stop?Number(stop[1])/(stop[2]==='%'?100:length):undefined};
  });
  if(raw.length<2 || raw.some(s=>!s.color)) return;
  if(raw[0].position===undefined)raw[0].position=0;
  if(raw[raw.length-1].position===undefined)raw[raw.length-1].position=1;
  for(let i=1;i<raw.length;i++)if(raw[i].position===undefined){
    const start=i-1;let end=i;while(raw[end].position===undefined)end++;
    for(let j=i;j<end;j++)raw[j].position=raw[start].position!+(raw[end].position!-raw[start].position!)*(j-start)/(end-start);
    i=end;
  }
  // Inverse transform: a point in normalized layer coordinates maps to its
  // position along the CSS gradient line. Identity means left-to-right.
  const a=dx*width/length,b=dy*height/length,c=-dy*width/length,d=dx*height/length;
  return {type:'GRADIENT_LINEAR',gradientTransform:[[a,b,.5-(a+b)/2],[c,d,.5-(c+d)/2]],
    gradientStops:raw.map(s=>({position:Math.max(0,Math.min(1,s.position!)),color:s.color!}))};
}

export function backgroundPaints(style: CSSStyleDeclaration, width: number, height: number): Paint[] {
  const paints: Paint[]=[];
  const color=getRgb(style.backgroundColor);
  if(color && color.a>0)paints.push({type:'SOLID',color:{r:color.r,g:color.g,b:color.b},opacity:color.a});
  // Multiple CSS background layers are ordered top-first. Figma paints are
  // appended bottom-to-top, so gradients follow the base background color.
  splitCssList(style.backgroundImage || 'none').reverse().forEach(image=>{
    const gradient=linearGradient(image,width,height);if(gradient)paints.push(gradient);
  });
  return paints;
}

export function cornerRadius(value: string, width: number, height: number): number | undefined {
  const token=(value || '').trim().split(/\s+/)[0];
  if(!/^[\d.]+(?:px|%)$/.test(token))return;
  const radius=parseFloat(token)*(token.endsWith('%')?Math.min(width,height)/100:1);
  return Math.min(radius,Math.min(width,height)/2);
}
