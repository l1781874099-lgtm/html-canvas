const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let sequence = 0;
const texts = [], messages = [], loads = [];
function node(type) {
  return {id: String(++sequence), type, children: [], fontSize: 14, removed:false,
    appendChild(child) {if(child.parent){const i=child.parent.children.indexOf(child);if(i>=0)child.parent.children.splice(i,1);}this.children.push(child);child.parent=this;},
    remove(){if(this.parent){const i=this.parent.children.indexOf(this);if(i>=0)this.parent.children.splice(i,1);}this.removed=true;this.children.slice().forEach(c=>c.remove());},
    resize(width,height) {this.width=width;this.height=height;},
    getSharedPluginData() {return '';}, setSharedPluginData() {},
  };
}
const fonts = ['Arial','Microsoft YaHei','Roboto'].flatMap(family => ['Regular','Bold','Italic'].map(style => ({fontName:{family,style}})));
const figma = {currentPage:node('PAGE'), ui:{postMessage: message => messages.push(message)},
  on() {}, showUI() {}, viewport:{scrollAndZoomIntoView() {}},
  listAvailableFontsAsync: async () => fonts,
  loadFontAsync: async font => loads.push({...font}),
  createPage: () => node('PAGE'),
  createFrame: () => node('FRAME'), createRectangle: () => node('RECTANGLE'),
  createText() {const n=node('TEXT');texts.push(n);return n;},
  closePlugin() {throw Error('local import must remain open');},
};
const cache = new Map();
function load(file) {
  file=path.resolve(file);
  if(cache.has(file)) return cache.get(file);
  const exports={};cache.set(file,exports);
  const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(js,{exports,require:id=>load(path.resolve(path.dirname(file),id)+'.ts'),figma,__html__:'',setTimeout,clearTimeout,console,process:{env:{NODE_ENV:'production'}}},{filename:file});
  return exports;
}
async function main() {
  const match=load(path.join(root,'plugin/functions/font-matching.ts'));
  assert.equal(match.fontCandidates('Arial, "Microsoft YaHei"',700,false,'中文标题',fonts)[0].family,'Microsoft YaHei');
  assert.equal(match.fontCandidates('Arial, "Microsoft YaHei"',700,false,'中文标题',fonts)[0].style,'Bold');
  assert.equal(match.fontCandidates('Arial',400,false,'English',fonts)[0].style,'Regular');
  assert.equal(match.fontCandidates('Arial',400,true,'English',fonts)[0].style,'Italic');
  assert.equal(match.fontCandidates('微软雅黑',700,false,'标题',fonts)[0].family,'Microsoft YaHei');
  assert.equal(match.fontCandidates('missing',700,false,'中文',fonts)[0].family,'Microsoft YaHei');
  assert.equal(match.styleWeight('Semi Bold'),600);assert.equal(match.styleWeight('Extra Bold'),800);
  console.log('PASS font matching: CJK fallback, aliases, weight, italic');
  const state=load(path.join(root,'plugin/functions/import-response.ts'));
  assert.equal(state.localImportResponse({pluginMessage:{type:'doneLoading',requestId:'old'}},'new'),null);
  assert.equal(state.localImportResponse({pluginMessage:{type:'doneLoading',requestId:'new'}},'new').type,'doneLoading');
  assert.equal(state.localImportResponse(null,'new'),null);
  console.log('PASS message correlation: completion accepted, stale request rejected');
  load(path.join(root,'plugin/code.ts'));
  const children=Array.from({length:22},(_,i)=>({type:'TEXT',x:0,y:i*30,width:120,height:25,characters:i%2?'正文内容':'粗体标题',fontFamily:'Arial, "Microsoft YaHei"',fontWeight:i%2?400:700,fontSize:20,singleLine:true}));
  await figma.ui.onmessage({type:'import',localHtml:true,requestId:'test-123',data:{layers:[{type:'FRAME',width:1440,height:900,x:0,y:0,children}]}});
  assert.equal(texts.length,22);
  assert.equal(texts[0].fontName.family,'Microsoft YaHei');assert.equal(texts[0].fontName.style,'Bold');
  assert.equal(texts[1].fontName.style,'Regular');assert.equal(texts[0].fontSize,20);
  assert.equal(texts[0].textAutoResize,'WIDTH_AND_HEIGHT');
  assert.equal(loads.length,2,'load each font variant once');
  const done=messages.find(m=>m.type==='doneLoading');
  assert.equal(done.requestId,'test-123');assert.equal(done.completedLayers,23);assert.equal(done.skippedLayers,0);
  assert.ok(messages.some(m=>m.type==='importProgress' && m.requestId==='test-123'));
  console.log('PASS mocked Figma import: 22 texts, distinct weights, size preserved, progress and completion');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
