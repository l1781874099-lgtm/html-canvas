export function dashedCirclePath(cx:number,cy:number,r:number,dashes:number[],offset:number):string {
  if(r<=0 || !dashes.length || dashes.some(x=>x<0))return '';
  if(dashes.length%2)dashes=dashes.concat(dashes);
  const period=dashes.reduce((a,b)=>a+b,0),length=2*Math.PI*r;
  if(!period)return '';
  const point=(distance:number)=>[cx+r*Math.cos(distance/r),cy+r*Math.sin(distance/r)];
  const paths:string[]=[];
  const first=Math.floor((offset-length)/period)-1,last=Math.ceil((offset+length)/period)+1;
  // A tiny repeated dash on a giant circle should not make the import hang.
  if(last-first>2000)return '';
  for(let cycle=first;cycle<=last;cycle++){
    let position=cycle*period-offset;
    for(let i=0;i<dashes.length;i++){
      const start=Math.max(0,position),end=Math.min(length,position+dashes[i]);
      if(i%2===0 && end>start){
        // Splitting at half a turn also handles a full circumference correctly.
        const middle=(start+end)/2;
        const p=point(start),m=point(middle),q=point(end);
        paths.push(`M ${p[0]} ${p[1]} A ${r} ${r} 0 0 1 ${m[0]} ${m[1]} A ${r} ${r} 0 0 1 ${q[0]} ${q[1]}`);
      }
      position+=dashes[i];
    }
  }
  return paths.join(' ');
}
