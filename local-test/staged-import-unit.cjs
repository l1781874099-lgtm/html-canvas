const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');let sequence=0;const all=[],pages=[],messages=[];let visibleTarget;
function detach(n){if(n.parent){const i=n.parent.children.indexOf(n);if(i>=0)n.parent.children.splice(i,1);}}
function node(type){
  const n={id:String(++sequence),type,name:type,x:0,y:0,width:100,height:100,children:[],removed:false,layoutMode:'NONE',layoutPositioning:'AUTO',
    appendChild(child){detach(child);this.children.push(child);child.parent=this;},
    insertChild(i,child){detach(child);this.children.splice(i,0,child);child.parent=this;},
    resize(w,h){this.width=w;this.height=h;},
    remove(){detach(this);this.children.slice().forEach(c=>c.remove());this.removed=true;},
    clone(){const copy=node(this.type);for(const k of Object.keys(this))if(!['id','parent','children','removed'].includes(k) && typeof this[k]!=='function')copy[k]=this[k];this.children.forEach(c=>copy.appendChild(c.clone()));if(this.parent)this.parent.appendChild(copy);return copy;},
    createInstance(){const instance=node('INSTANCE');instance.resize(this.width,this.height);return instance;},
  };all.push(n);return n;
}
visibleTarget=node('PAGE');pages.push(visibleTarget);
const figma={currentPage:visibleTarget,on(){},ui:{postMessage:m=>messages.push(m)},viewport:{scrollAndZoomIntoView(){}},
  listAvailableFontsAsync:async()=>[],createPage(){const p=node('PAGE');pages.push(p);return p;},
  createFrame(){const n=node('FRAME');visibleTarget.appendChild(n);return n;},
  createRectangle(){const n=node('RECTANGLE');visibleTarget.appendChild(n);return n;},
  createText(){const n=node('TEXT');visibleTarget.appendChild(n);return n;},
  group(children,parent,index){
    const positions=children.map(child=>({child,x:child.x+child.parent.x,y:child.y+child.parent.y}));
    const group=node('GROUP');group.x=Math.min(...positions.map(p=>p.x));group.y=Math.min(...positions.map(p=>p.y));
    parent.insertChild(index,group);positions.forEach(p=>{group.appendChild(p.child);p.child.x=p.x-group.x;p.child.y=p.y-group.y;});return group;
  },
  createComponent(){const n=node('COMPONENT');visibleTarget.appendChild(n);return n;},
  combineAsVariants(components,parent){const set=node('COMPONENT_SET');parent.appendChild(set);components.forEach(c=>set.appendChild(c));return set;},
};
const cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(code,{exports,require:id=>load(path.resolve(path.dirname(file),id)+'.ts'),figma,console,setTimeout,clearTimeout,Set,Map});return exports;}
const services={
  assign(n,data){for(const [k,v] of Object.entries(data))if(!['ref','type','children','width','height'].includes(k))n[k]=v;},
  async font(){assert.equal(visibleTarget.children.length,0,'no partial nodes visible during font loading');return {family:'Arial',style:'Bold'};},
  async images(){assert.equal(visibleTarget.children.length,0,'no partial nodes visible during image handling');},
};
async function main(){
  const api=load(path.join(root,'plugin/functions/local-canvas-import.ts'));
  const layers=[{type:'FRAME',name:'main',x:0,y:0,width:600,height:300,children:[
    {type:'FRAME',name:'button',x:20,y:20,width:150,height:40,children:[{type:'TEXT',characters:'购买',x:10,y:10,width:50,height:20,fontSize:18,fontWeight:700,singleLine:true}]},
    {type:'FRAME',name:'clipped',clipsContent:true,width:100,height:50,children:[{type:'RECTANGLE',width:120,height:60}]},
    {type:'FRAME',name:'painted',fills:[{type:'SOLID',color:{r:1,g:1,b:1}}],width:100,height:50,children:[{type:'RECTANGLE',width:10,height:10}]},
    {type:'RECTANGLE',name:'photo',x:20,y:100,width:150,height:100,fills:[]},
  ]}];
  await api.importLocalCanvas({requestId:'staging-test',data:{layers}},services);
  const done=messages.find(m=>m.type==='doneLoading');assert.ok(done,JSON.stringify(messages));
  assert.equal(visibleTarget.children.length,1);
  assert.equal(pages[1].removed,true,'temporary page must be removed after commit');
  assert.equal(visibleTarget.children[0].children[0].type,'GROUP');
  const group=visibleTarget.children[0].children[0];
  assert.equal(group.x+group.children[0].x,30,'grouping retains text x in root');
  assert.equal(group.y+group.children[0].y,30,'grouping retains text y in root');
  assert.equal(visibleTarget.children[0].children[1].type,'FRAME','clipping requires frame');
  assert.equal(visibleTarget.children[0].children[2].type,'FRAME','painted frame is retained');
  assert.equal(visibleTarget.children[0].layoutMode,'NONE','preserve original positioning');
  assert.ok(!all.some(n=>n.type==='COMPONENT' || n.type==='COMPONENT_SET'));
  assert.ok(messages.some(m=>m.type==='importProgress' && m.percent===97));
  console.log('PASS staged import: no partial visible nodes, temporary page cleaned, original layout preserved');
  messages.length=0;
  const previousRight=Math.max(...visibleTarget.children.map(n=>n.x+n.width));
  await api.importLocalCanvas({requestId:'batch-test',batch:true,data:{layers:[
    {type:'FRAME',name:'overview',width:800,height:600},
    {type:'FRAME',name:'settings',width:600,height:700},
  ]}},services);
  const batchDone=messages.find(m=>m.type==='doneLoading');
  assert.equal(batchDone.pageCount,2);
  const imported=visibleTarget.children.slice(-2);
  assert.equal(imported[0].name,'overview');assert.equal(imported[1].name,'settings');
  assert.equal(imported[0].x,previousRight+120);
  assert.equal(imported[1].x,imported[0].x+800+120);
  assert.equal(imported[0].y,0);assert.equal(imported[1].y,0);
  assert.equal(visibleTarget.selection.length,2);
  assert.equal(pages[2].removed,true);
  console.log('PASS batch: filenames, distinct widths, 120px spacing, existing canvas avoided, all roots selected');
  const before=visibleTarget.children.slice();messages.length=0;
  await api.importLocalCanvas({requestId:'fail-test',options:{},data:{layers:[{type:'FRAME',width:100,height:100,children:[{type:'TEXT',characters:'error'}]}]}},{...services,font:async()=>{throw Error('font unavailable');}});
  assert.ok(messages.some(m=>m.type==='importFailed'));
  assert.equal(visibleTarget.children.length,before.length);assert.ok(before.every((n,i)=>visibleTarget.children[i]===n));
  assert.equal(pages[3].removed,true,'failure must remove temporary page');
  console.log('PASS failure rollback: existing canvas unchanged and staging page removed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
