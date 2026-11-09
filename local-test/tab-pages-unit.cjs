const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript'),{DOMParser}=require('linkedom');
const root=path.resolve(__dirname,'..');
function load(file,globals={},deps={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:id=>deps[id],DOMParser,setTimeout,clearTimeout,Map,Set,...globals});return exports;}
const tabs=load('plugin/functions/tab-pages.ts');
const renderer=load('plugin/functions/local-html.ts',{}, {'./tab-pages':tabs,'../../lib/html-to-figma':{}});
function plan(html){return tabs.discoverTabPages(renderer.makeLocalHtmlDocument('<html><head><style>[hidden]{display:none}.tab-panel{display:none}.tab-panel.active{display:grid}</style></head><body>'+html+'</body></html>'));}
function activePanels(p,state){const doc=new DOMParser().parseFromString(p.html,'text/html');tabs.applyTabState(doc,p.groups,state);return {doc,visible:Array.from(doc.querySelectorAll('[data-html-canvas-panel]')).filter(el=>!el.hasAttribute('hidden') && !el.parentElement.closest('[hidden]'))};}
function aria(prefix='p',count=4){return '<nav role="tablist">'+Array.from({length:count},(_,i)=>'<button role="tab" aria-controls="'+prefix+i+'" aria-selected="'+(i===0)+'">'+prefix+'-'+i+'</button>').join('')+'</nav><main>'+Array.from({length:count},(_,i)=>'<section role="tabpanel" id="'+prefix+i+'" '+(i?'hidden':'')+'><h1>Content '+prefix+i+'</h1></section>').join('')+'</main>';}
async function main(){
 const four=plan(aria());assert.equal(four.states.length,4);
 four.states.forEach((state,i)=>{const {doc,visible}=activePanels(four,state);assert.equal(visible.length,1);assert.equal(visible[0].id,'p'+i);assert.equal(doc.querySelector('[aria-selected="true"]').textContent,'p-'+i);});
 const reusedClass=plan(aria().replaceAll('role="tabpanel"','role="tabpanel" class="tab"'));assert.equal(reusedClass.states.length,4);assert.equal(reusedClass.warnings.length,0);
 console.log('PASS ARIA tabs: 4 states, exclusive panel visibility and selected navigation');
 const data=plan('<div class="tabs">'+[1,2,3,4].map(i=>'<button data-tab="view'+i+'">View '+i+'</button>').join('')+'</div>'+[1,2,3,4].map(i=>'<div id="view'+i+'" style="display:'+(i===1?'block':'none')+'">View content '+i+'</div>').join(''));
 assert.equal(data.states.length,4);assert.equal(activePanels(data,data.states[3]).visible[0].id,'view4');
 const handlers=plan([1,2,3,4].map(i=>'<button onclick="showTab(\'screen'+i+'\')">Screen '+i+'</button>').join('')+[1,2,3,4].map(i=>'<div id="screen'+i+'" hidden>Screen content '+i+'</div>').join('')+'<script>throw new Error("must never execute")</script>');
 assert.equal(handlers.states.length,4);assert.ok(!handlers.html.includes('onclick='));assert.ok(!handlers.html.includes('<script'));
 const anchors=plan('<nav class="tabs">'+[1,2,3,4].map(i=>'<a href="#area'+i+'">Area '+i+'</a>').join('')+'</nav>'+[1,2,3,4].map(i=>'<div id="area'+i+'">Text '+i+'</div>').join(''));
 assert.equal(anchors.states.length,4);assert.ok(!anchors.html.includes('href='));
 const radio=plan('<div class="tabs">'+[1,2].map(i=>'<input type="radio" name="view" id="tab'+i+'" '+(i===1?'checked':'')+'><label for="tab'+i+'">Radio '+i+'</label>').join('')+'</div><div id="panel1">Radio one</div><div id="panel2">Radio two</div>');
 assert.equal(radio.states.length,2);assert.equal(radio.states[1].name,'Radio 2');assert.equal(activePanels(radio,radio.states[1]).doc.getElementById('tab2').checked,true);
 console.log('PASS static conventions: data-tab, literal inline handlers, anchor tabs and CSS radio tabs');
 const nested=plan('<div role="tablist"><button role="tab" aria-controls="outer1">Home</button><button role="tab" aria-controls="outer2">Settings</button></div><section id="outer1">'+aria('nested',2)+'</section><section id="outer2">Settings body</section>');
 assert.equal(nested.states.length,3);assert.ok(nested.states.some(state=>state.name==='Home / nested-1'));assert.ok(nested.states.some(state=>state.name==='Settings'));
 for(const state of nested.states){const result=activePanels(nested,state);assert.ok(result.visible.every(el=>!el.closest('[hidden]')));}
 assert.throws(()=>plan(aria('a',6)+aria('b',6)),/32/);
 const simple=plan('<nav><a href="#about">About</a><a href="#contact">Contact</a></nav><section id="about">About body</section><section id="contact">Contact body</section>');
 assert.equal(simple.states.length,1);assert.equal(simple.groups.length,0);
 const broken=plan('<div class="tabs"><button data-tab="missing1">Missing 1</button><button data-tab="missing2">Missing 2</button></div><p>Current content</p>');
 assert.equal(broken.states.length,1);assert.ok(broken.warnings.length);
 console.log('PASS navigation planning: nested tabs, state limit, ordinary anchors untouched, unresolved tabs reported');
 // Exercise the real renderer's multi-document loop. Each capture receives a fresh document.
 const seen=[],frames=[];
 const mockDocument={createElement(){const frame={style:{},setAttribute(k,v){this[k]=v;},remove(){this.removed=true;}};frames.push(frame);return frame;},body:{appendChild(frame){
   const doc=new DOMParser().parseFromString(frame.srcdoc,'text/html');Object.defineProperty(doc,'fonts',{value:{ready:Promise.resolve()}});Object.defineProperty(doc,'images',{value:[]});doc.body.getBoundingClientRect=()=>({width:1440,height:900});
   frame.contentDocument=doc;queueMicrotask(()=>frame.onload());
 }}};
 const mockRenderer=load('plugin/functions/local-html.ts',{document:mockDocument,window:{setTimeout},queueMicrotask},{'./tab-pages':tabs,'../../lib/html-to-figma':{async preloadBackgroundImages(){},htmlToFigma(body,_frames,_time,doc){const visible=Array.from(doc.querySelectorAll('[data-html-canvas-panel]')).filter(el=>!el.hasAttribute('hidden'));assert.equal(visible.length,1);seen.push(visible[0].id);body.setAttribute('data-parser-mutated','yes');return [{type:'FRAME',width:1440,children:[{type:'TEXT',characters:visible[0].textContent}]}];}}});
 const progress=[];const result=await mockRenderer.renderLocalHtml('<html><head></head><body>'+aria()+'</body></html>',1440,{},fraction=>progress.push(fraction));
 assert.equal(result.layers.length,4);assert.equal(result.layers[3].name,'p-3');assert.deepEqual(seen,['p0','p1','p2','p3']);assert.equal(frames.length,4);assert.ok(frames.every(frame=>frame.removed && frame.sandbox==='allow-same-origin'));
 assert.ok(progress.every((value,i)=>!i || value>=progress[i-1]));assert.equal(globalThis.__tabExecuted,undefined);
 const example=tabs.discoverTabPages(renderer.makeLocalHtmlDocument(fs.readFileSync(path.join(root,'examples/four-tabs.html'),'utf8')));
 assert.equal(example.groups.length,1);assert.equal(example.states.length,4);assert.equal(example.warnings.length,0);
 assert.equal(example.states.map(s=>s.name).join(','),'数据总览,订单管理,商品目录,客户管理');
 console.log('PASS supplied demo: one static HTML resolves to the four expected pages');
 console.log('PASS renderer integration: 4 fresh captures, names, cleanup, monotonic progress and script-free sandbox');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
