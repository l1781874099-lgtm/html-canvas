const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const progress=[],statuses=[],sent=[],renderOptions=[];let hook=0,listener,fontRequests=0;
const React={createElement(type,props,...children){return {type,props:props || {},children};},useState(initial){const index=hook++;return [initial,value=>{if(index===3)progress.push(value);if(index===1)statuses.push(value);}];},useRef(value){return {current:value};},useEffect(fn){fn();}};
const deps={react:React,
 '../functions/zip-files':{prepareImportFiles:async(files)=>({pages:await Promise.all(files.map(async file=>({name:file.name,html:await file.text(),warnings:[]}))),errors:[]})},
 '../functions/local-html':{renderLocalHtml:async(html,width,options,update)=>{assert.equal(width,1920);renderOptions.push(options);if(html==='bad')throw Error('invalid test page');if(html==='four-tabs')return {layers:['首页','订单','商品','客户'].map(name=>({type:'FRAME',name,width,height:900})),warnings:[],missing:0};update(.4,'layout');return {layers:[{type:'FRAME',width,height:800}],warnings:[],missing:0};}},
 '../functions/traverse-layers':{traverseLayers:async(root,callback)=>callback(root)},
 '../functions/import-images':{getImageFills:()=>[],processImages:async()=>{}},
 '../functions/import-response':{localImportResponse:(data,request)=>data.pluginMessage?.requestId===request?data.pluginMessage:null},
};
const exports_={};const source=fs.readFileSync(path.join(__dirname,'../plugin/components/local-html-import.tsx'),'utf8');
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React}}).outputText,{exports:exports_,require:id=>deps[id],window:{addEventListener(type,fn){listener=fn;},removeEventListener(){},setTimeout(){return 1;}},clearTimeout(){},parent:{postMessage(message){if(message.pluginMessage.type==='listFonts')fontRequests++;else sent.push(message.pluginMessage);}},console,File:class {}});
function find(node,predicate){if(!node || typeof node!=='object')return; if(predicate(node))return node;for(const child of (node.children || []).flat()){const hit=find(child,predicate);if(hit)return hit;}}
async function main(){
 const tree=exports_.LocalHtmlImport(),input=find(tree,n=>n.type==='input' && n.props.type==='file');assert.equal(input.props.multiple,true);
 assert.equal(fontRequests,1,'asks the plugin for available fonts');
 listener({data:{pluginMessage:{type:'fontList',families:['Inter','Roboto']}}});
 const target={files:[{name:'01-home.html',text:async()=>'<h1>Home</h1>'},{name:'02-broken.html',text:async()=> 'bad'},{name:'03-settings.htm',text:async()=>'<h1>Settings</h1>'}],value:'test'};
 input.props.onChange({target});
 for(let i=0;i<30 && !sent.length;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(sent.length,1,'submit all successful pages together');assert.equal(sent[0].batch,true);
 assert.equal(sent[0].data.layers.length,2);assert.equal(sent[0].data.layers[0].name,'01-home');assert.equal(sent[0].data.layers[1].name,'03-settings');
 assert.ok(sent[0].warnings.some(w=>w.includes('02-broken.html')));assert.equal(target.value,'');
 assert.equal(renderOptions[0].rasterizeMissingFonts,true);assert.equal(renderOptions[0].availableFonts.join(),'Inter,Roboto');
 assert.ok(progress.every((p,i)=>!i || p>=progress[i-1]),'overall preparation progress is monotonic');
 listener({data:{pluginMessage:{type:'doneLoading',requestId:sent[0].requestId,pageCount:2,completedLayers:25,warnings:sent[0].warnings}}});
 assert.equal(progress[progress.length-1],100);assert.ok(statuses[statuses.length-1].includes('2 个页面'));
 hook=0;sent.length=0;progress.length=0;statuses.length=0;
 const second=exports_.LocalHtmlImport(),multiInput=find(second,n=>n.type==='input' && n.props.type==='file');
 multiInput.props.onChange({target:{files:[{name:'workspace.html',text:async()=>'four-tabs'}],value:'test'}});
 for(let i=0;i<30 && !sent.length;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(sent.length,1);assert.equal(sent[0].batch,true);assert.equal(sent[0].data.layers.length,4);
 assert.equal(sent[0].data.layers[0].name,'workspace / 首页');assert.equal(sent[0].data.layers[3].name,'workspace / 客户');
 console.log('PASS tab UI: one HTML submits four named pages with batch positioning');
 console.log('PASS batch UI: multi-select, sequential parsing, partial failure report, one submission, aggregate progress and completion');
 console.log('PASS font list: requested once, forwarded with the rasterize option (on by default)');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
