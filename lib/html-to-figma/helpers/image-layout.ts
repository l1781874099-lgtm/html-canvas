function position(value: string, freeSpace: number): number {
  if(value==='left'||value==='top')return 0;
  if(value==='right'||value==='bottom')return freeSpace;
  if(value==='center')return freeSpace/2;
  const number=parseFloat(value);
  if(!Number.isFinite(number))return freeSpace/2;
  return value.endsWith('%')?freeSpace*number/100:number;
}

export function imagePlacement(sourceWidth:number,sourceHeight:number,width:number,height:number,fit:string,objectPosition='50% 50%') {
  let sx=width/sourceWidth,sy=height/sourceHeight;
  if(fit==='contain'){sx=sy=Math.min(sx,sy);}
  else if(fit==='cover'){sx=sy=Math.max(sx,sy);}
  else if(fit==='none'){sx=sy=1;}
  else if(fit==='scale-down'){sx=sy=Math.min(1,sx,sy);}
  const dw=sourceWidth*sx,dh=sourceHeight*sy;
  const parts=objectPosition.trim().split(/\s+/);
  return {x:position(parts[0] || '50%',width-dw),y:position(parts[1] || '50%',height-dh),width:dw,height:dh};
}
