import { traverseLayers } from './traverse-layers';
import { styleWeight } from './font-matching';

interface Services {
  assign:(node:any,data:any)=>void;
  font:(layer:any,fonts:Font[])=>Promise<FontName>;
  images:(layer:any)=>Promise<any>;
}
let importing=false;
let liveStaging:PageNode | FrameNode | undefined;
figma.on('close',()=>{if(liveStaging && !liveStaging.removed)liveStaging.remove();});

export async function importLocalCanvas(msg:any,services:Services) {
  const send=(data:any)=>figma.ui.postMessage({...data,requestId:msg.requestId});
  if(importing){send({type:'importFailed',message:'已有导入任务正在处理，请稍候。'});return;}
  importing=true;
  const target=figma.currentPage;
  let staging:PageNode | FrameNode | undefined;
  const committed:SceneNode[]=[];
  try{
    const layers=msg.data.layers as any[];
    if(!Array.isArray(layers) || !layers.length)throw new Error('没有可导入的图层');
    let total=0,completed=0;const fontWarnings=new Set<string>();
    for(const layer of layers)await traverseLayers(layer,()=>{total++;});
    send({type:'importProgress',percent:50,completedLayers:0,totalLayers:total,label:'正在准备字体和临时页面……'});
    const fonts=await figma.listAvailableFontsAsync();
    try{staging=figma.createPage();}catch(_error){
      // Some plans limit page creation. An invisible staging frame is the
      // fallback; it receives all nodes before any asynchronous processing.
      staging=figma.createFrame();staging.visible=false;
    }
    liveStaging=staging;staging.name='HTML 导入处理中（临时）';
    const roots:SceneNode[]=[];
    const build=async(layer:any,parent:PageNode | FrameNode,isRoot=false)=>{
      let node:SceneNode | undefined;
      try{
        if(layer.type==='FRAME'||layer.type==='GROUP')node=figma.createFrame();
        else if(layer.type==='SVG')node=figma.createNodeFromSvg(layer.svg);
        else if(layer.type==='TEXT')node=figma.createText();
        else if(layer.type==='RECTANGLE')node=figma.createRectangle();
        if(!node)return;
        // Move a newly-created node off the visible page before the first await.
        parent.appendChild(node);layer.ref=node;
        if(node.type==='TEXT'){
          const font=await services.font(layer,fonts);node.fontName=font;
          if(Math.abs(styleWeight(font.style)-(Number(layer.fontWeight)||400))>100)fontWarnings.add(font.family+': '+layer.fontWeight+' → '+font.style);
          node.textAutoResize='NONE';
        }
        if(node.type==='RECTANGLE')await services.images(layer);
        const props={...layer};
        for(const key of ['fontFamily','fontWeight','fontStyle','singleLine','autoLayout','hoverKey','hoverDefinitionKey'])delete props[key];
        services.assign(node,props);
        if('resize' in node)node.resize(Math.max(1,layer.width || 1),Math.max(1,layer.height || 1));
        if(node.type==='TEXT')node.textAutoResize=layer.singleLine?'WIDTH_AND_HEIGHT':'HEIGHT';
        if(layer.children && node.type==='FRAME')for(const child of layer.children)await build(child,node);
        // Structural HTML wrappers need no fixed-size frame. Group children only
        // after layout is complete, so Figma preserves their absolute positions.
        if(!isRoot && node.type==='FRAME' && node.children.length && canGroup(layer)){
          const frame=node,index=parent.children.indexOf(frame);
          const group=figma.group(frame.children.slice(),parent,index);
          group.name=layer.name && layer.name!=='画框'?layer.name:'组';
          group.opacity=frame.opacity;group.blendMode=frame.blendMode;
          group.visible=frame.visible;group.locked=frame.locked;
          frame.remove();node=group;layer.ref=group;
        }

      }catch(error){
        if(node && !node.removed)node.remove();delete layer.ref;
        throw error;
      }
      completed++;
      if(completed%24===0 || completed===total){
        send({type:'importProgress',percent:50+Math.round(completed/total*37),completedLayers:completed,totalLayers:total,label:'正在临时页面生成图层……'});
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      return node;
    };
    for(const layer of layers){const node=await build(layer,staging,true);if(node)roots.push(node);}
    if(!roots.length)throw new Error('没有生成有效画板');
    send({type:'importProgress',percent:97,completedLayers:completed,totalLayers:total,label:'正在将完成的画板放入当前页面……'});
    if(msg.batch){
      const existing=target.children.filter(node=>node!==staging);
      let left=existing.length?Math.max(...existing.map(node=>node.x+node.width))+120:0;
      for(const root of roots){root.x=left;root.y=0;left+=root.width+120;}
    }
    // One synchronous commit. The visible canvas receives completed roots only.
    for(const root of roots){target.appendChild(root);committed.push(root);}
    staging.remove();staging=undefined;liveStaging=undefined;
    if(figma.currentPage.id===target.id){target.selection=roots;figma.viewport.scrollAndZoomIntoView(roots);}
    send({type:'doneLoading',rootId:roots[0].id,pageCount:roots.length,completedLayers:completed,totalLayers:total,skippedLayers:total-completed,fontWarnings:Array.from(fontWarnings),warnings:msg.warnings || []});
  }catch(error){
    committed.forEach(node=>{if(!node.removed)node.remove();});
    send({type:'importFailed',message:String(error)});
  }finally{
    if(staging && !staging.removed)staging.remove();liveStaging=undefined;importing=false;
  }
}

function canGroup(layer:any):boolean {
  const visible=(items:any)=>Array.isArray(items) && items.some(item=>item.visible!==false && item.opacity!==0);
  return !layer.clipsContent && !layer.isMask && !layer.rotation &&
    (!layer.layoutMode || layer.layoutMode==='NONE') &&
    !visible(layer.fills) && !visible(layer.backgrounds) &&
    !visible(layer.strokes) && !visible(layer.effects);
}
