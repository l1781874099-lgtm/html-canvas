export function autoLayoutPlan(layer:any) {
  const spec=layer.autoLayout;if(!spec || !Array.isArray(layer.children))return null;
  const children=spec.flow.map((i:number)=>layer.children[i]);
  if(!children.length || children.some((c:any)=>!c))return null;
  const horizontal=spec.horizontal;
  const axis=horizontal?'x':'y',main=horizontal?'width':'height',cross=horizontal?'height':'width',crossAxis=horizontal?'y':'x';
  const start=horizontal?spec.paddingLeft:spec.paddingTop,end=horizontal?spec.paddingRight:spec.paddingBottom;
  const crossStart=horizontal?spec.paddingTop:spec.paddingLeft,crossEnd=horizontal?spec.paddingBottom:spec.paddingRight;
  const inner=layer[main]-start-end,crossInner=layer[cross]-crossStart-crossEnd;
  const sum=children.reduce((n:number,c:any)=>n+c[main],0);
  let gap=spec.gap;
  if(spec.justify==='space-between' && children.length>1)gap=(inner-sum)/(children.length-1);
  if(gap<0 || !Number.isFinite(gap))return null;
  const free=inner-sum-gap*(children.length-1);
  let cursor=start+(spec.justify==='center'?free/2:['end','flex-end'].includes(spec.justify)?free:0);
  for(const child of children){
    const expectedCross=crossStart+(spec.align==='center'?(crossInner-child[cross])/2:['end','flex-end'].includes(spec.align)?crossInner-child[cross]:0);
    if(!Number.isFinite(child[axis]) || Math.abs(child[axis]-cursor)>2 || Math.abs(child[crossAxis]-expectedCross)>2)return null;
    cursor+=child[main]+gap;
  }
  return {layoutMode:horizontal?'HORIZONTAL':'VERTICAL',
    primaryAxisSizingMode:'FIXED',counterAxisSizingMode:'FIXED',
    primaryAxisAlignItems:spec.justify==='space-between'?'SPACE_BETWEEN':spec.justify==='center'?'CENTER':['end','flex-end'].includes(spec.justify)?'MAX':'MIN',
    counterAxisAlignItems:spec.align==='center'?'CENTER':['end','flex-end'].includes(spec.align)?'MAX':'MIN',
    paddingLeft:spec.paddingLeft,paddingRight:spec.paddingRight,paddingTop:spec.paddingTop,paddingBottom:spec.paddingBottom,itemSpacing:gap};
}

export function applyAutoLayouts(layers:any[]) {
  let applied=0,skipped=0;
  const visit=(layer:any)=>{
    (layer.children || []).forEach(visit);
    if(!layer.autoLayout)return;
    const frame=layer.ref;
    const plan=autoLayoutPlan(layer);
    if(!plan || !frame || frame.removed || !['FRAME','COMPONENT'].includes(frame.type) || !('layoutMode' in frame)){skipped++;return;}
    const flow=new Set(layer.autoLayout.flow);
    const saved=frame.children.map((n:SceneNode)=>({node:n,x:n.x,y:n.y,width:n.width,height:n.height}));
    try{
      Object.assign(frame,plan);
      frame.children.forEach((n:SceneNode)=>{if('layoutPositioning' in n)n.layoutPositioning='ABSOLUTE';});
      // Enabling layout can immediately move background rectangles. Restore
      // their snapshot positions before opting the real flow children back in.
      saved.forEach((s:any)=>{s.node.x=s.x;s.node.y=s.y;s.node.resize(s.width,s.height);});
      (layer.children || []).forEach((child:any,i:number)=>{
        const n=child.ref;
        if(!n || n.parent!==frame)return;
        if(flow.has(i)){n.layoutPositioning='AUTO';n.layoutGrow=0;n.layoutAlign='INHERIT';}
      });
      const shifted=saved.some((old:any)=>Math.abs(old.node.x-old.x)>3 || Math.abs(old.node.y-old.y)>3 || Math.abs(old.node.width-old.width)>3 || Math.abs(old.node.height-old.height)>3);
      if(shifted)throw new Error('layout changed');
      applied++;
    }catch(_error){
      frame.layoutMode='NONE';
      saved.forEach((s:any)=>{s.node.x=s.x;s.node.y=s.y;s.node.resize(s.width,s.height);});
      skipped++;
    }
  };
  layers.forEach(visit);return {applied,skipped};
}
