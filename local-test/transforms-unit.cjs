// CSS transforms are measured in layout space, then mapped onto layers.
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');const ts=require('typescript');
const root=path.resolve(__dirname,'..');const styles=new Map();
const environment={getComputedStyle:el=>styles.get(el)};
const modules=new Map();
function load(file){
  file=path.resolve(file);if(modules.has(file))return modules.get(file);
  const exports={};modules.set(file,exports);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(code,{exports,require:id=>id==='../environment'?environment:load(path.resolve(path.dirname(file),id)+'.ts'),console});return exports;
}
const near=(a,b,message)=>assert.ok(Math.abs(a-b)<1e-6,`${message || ''} ${a} != ${b}`);
const transforms=load(path.join(root,'lib/html-to-figma/helpers/transforms.ts'));

function element(tag,rect,style,parent=null){
  const inline={};
  const el={tagName:tag.toUpperCase(),namespaceURI:'http://www.w3.org/1999/xhtml',parentElement:parent,children:[],
    style:{setProperty(name,value){inline[name]=value;}},inline,getBoundingClientRect:()=>rect};
  styles.set(el,{display:'block',transform:'none',translate:'none',rotate:'none',scale:'none',transformOrigin:`${rect.width/2}px ${rect.height/2}px`,...style});
  if(parent)parent.children.push(el);
  return el;
}
const page=element('body',{left:0,top:0,width:800,height:600},{});
const all=[];page.querySelectorAll=()=>all;
const rotated=element('div',{left:100,top:100,width:100,height:50},{transform:'matrix(0, 1, -1, 0, 0, 0)'},page);
const child=element('span',{left:110,top:110,width:20,height:10},{},rotated);
const moved=element('div',{left:300,top:0,width:40,height:40},{transform:'matrix(1, 0, 0, 1, 10, 20)'},page);
const skewed=element('div',{left:0,top:300,width:100,height:40},{transform:'matrix(1, 0, -0.267949, 1, 0, 0)'},page);
const hidden=element('div',{left:0,top:400,width:40,height:40},{transform:'matrix(0, 0, 0, 0, 0, 0)'},page);
const inline=element('span',{left:0,top:500,width:40,height:20},{display:'inline',transform:'matrix(2, 0, 0, 2, 0, 0)'},page);
all.push(rotated,child,moved,skewed,hidden,inline);
transforms.captureTransforms(page);

assert.equal(rotated.inline.transform,'none');assert.equal(rotated.inline['will-change'],'transform');
assert.equal(transforms.isTransformed(inline),false,'inline boxes ignore transforms');
assert.equal(inline.inline.transform,undefined);

// 90° about the center of a 100×50 box at (100,100): center (150,125).
const box={type:'RECTANGLE',x:100,y:100,width:100,height:50,topLeftRadius:4};
assert.equal(transforms.placeLayer(box,rotated),true);
near(box.x,175,'x');near(box.y,75,'y');near(box.width,100);near(box._rotation,Math.PI/2);
const bounds=transforms.boundsOf(box);near(bounds.x,125);near(bounds.y,75);near(bounds.width,50);near(bounds.height,100);
// Children inherit the parent's matrix.
const text={type:'TEXT',x:110,y:110,width:20,height:10,fontSize:12};
transforms.placeLayer(text,child);near(text._rotation,Math.PI/2);near(text.x,165);near(text.y,85);
transforms.finalizeTransforms(box);
near(box.relativeTransform[0][0],0);near(box.relativeTransform[1][0],1);near(box.relativeTransform[0][1],-1);
assert.equal(box._rotation,undefined);assert.equal(box._bbox,undefined);
console.log('PASS transforms: rotation about origin, inherited by descendants, relativeTransform, bounds');

const translated={type:'RECTANGLE',x:300,y:0,width:40,height:40};
transforms.placeLayer(translated,moved);near(translated.x,310);near(translated.y,20);assert.equal(translated._rotation,undefined);
assert.equal(transforms.placeLayer({type:'RECTANGLE',x:0,y:400,width:40,height:40},hidden),false,'scale(0) drops the layer');
const sheared={type:'RECTANGLE',x:0,y:300,width:100,height:40,fills:[{type:'SOLID',color:{r:1,g:0,b:0},opacity:1}]};
transforms.placeLayer(sheared,skewed);
assert.equal(sheared.type,'SVG');assert.ok(sheared.svg.includes('<g transform="matrix(1 0 -0.267949 1'));assert.equal(sheared.fills,undefined);
near(sheared.width,100+40*0.267949,'skew bounds');
console.log('PASS transforms: translation, collapsed scale, skew baked into SVG, inline boxes untouched');

const scaled=element('div',{left:0,top:0,width:100,height:100},{transform:'matrix(2, 0, 0, 2, 0, 0)',transformOrigin:'0px 0px'},page);
all.length=0;all.push(scaled);transforms.captureTransforms(page);
const big={type:'TEXT',x:0,y:0,width:100,height:20,fontSize:10,lineHeight:{unit:'PIXELS',value:14},effects:[{type:'DROP_SHADOW',radius:4,offset:{x:1,y:2},spread:0}]};
transforms.placeLayer(big,scaled);
near(big.width,200);near(big.fontSize,20);near(big.lineHeight.value,28);near(big.effects[0].radius,8);near(big.effects[0].offset.y,4);
assert.equal(big._rotation,undefined);
console.log('PASS transforms: scale resizes text, line height and effects');
