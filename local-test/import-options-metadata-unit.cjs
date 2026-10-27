const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function moduleAt(file,dependencies={}){const exports={};const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;vm.runInNewContext(code,{exports,require:id=>dependencies[id],setTimeout,clearTimeout,console});return exports;}
class Element {
  constructor(tag,attrs={},style={}){this.tagName=tag;this.attrs=attrs;this.style=style;}
  getAttribute(k){return this.attrs[k]||null;}setAttribute(k,v){this.attrs[k]=v;}getBoundingClientRect(){return {width:100,height:40};}
}
async function main(){
  const metadata=moduleAt('lib/html-to-figma/helpers/import-metadata.ts',{'../environment':{Element,getComputedStyle:el=>el.style}});
  const button=new Element('BUTTON',{id:'buy',class:'primary rounded'});
  assert.equal(metadata.htmlName(button),'button#buy.primary.rounded');
  const row=new Element('DIV',{class:'row'},{display:'flex',flexWrap:'nowrap',flexDirection:'row',paddingLeft:'10px',paddingRight:'10px',paddingTop:'8px',paddingBottom:'8px',columnGap:'12px',justifyContent:'start',alignItems:'center'});
  const a=new Element('SPAN',{}, {position:'static'}),b=new Element('SPAN',{}, {position:'static'});
  const layer={type:'FRAME',ref:row,children:[{type:'RECTANGLE',ref:row},{type:'TEXT',ref:{parentElement:a},characters:'一'},{type:'TEXT',ref:{parentElement:b},characters:'二'}]};
  metadata.addImportMetadata([layer],{autoLayout:true,htmlNames:true});
  assert.equal(layer.name,'div.row');assert.equal(layer.autoLayout.flow.join(','),'1,2');assert.equal(layer.autoLayout.gap,12);
  console.log('PASS HTML names and flex metadata: tag/id/classes, background excluded from flow');
  const hover=moduleAt('plugin/functions/hover-capture.ts');
  assert.equal(hover.hoverSelector('.card:hover h2'),'.card[data-local-hover="true"] h2');
  let sheet='';const card=new Element('DIV');
  const rule={selectorText:'.card:hover h2',style:{cssText:'color: purple;'}};
  const doc={styleSheets:[{cssRules:[{cssText:'@media (min-width: 900px) {}',cssRules:[rule]}]}],querySelectorAll:s=>s==='.card'?[card]:[],createElement:()=>({textContent:''}),head:{appendChild:s=>{sheet=s.textContent;}}};
  const prepared=hover.prepareHoverCapture(doc);assert.equal(prepared.elements.length,1);assert.ok(sheet.includes('@media (min-width: 900px){'));assert.ok(sheet.includes('[data-local-hover="true"]'));assert.equal(card.getAttribute('data-local-hover-key'),'hover-0');
  console.log('PASS CSS hover: target discovery, rewritten selector, media condition preserved');
  const attrs={srcset:'/small.png 1x, /large.png 2x'};
  const image={src:'/small.png',getAttribute:k=>attrs[k]||null,removeAttribute:k=>delete attrs[k],setAttribute:(k,v)=>attrs[k]=v,decode:async()=>{}};
  await hover.upgradeImageSources({images:[image]});assert.equal(image.src,'/large.png');
  const attrs2={'data-full-src':'/broken.png'};
  const broken={src:'/original.png',getAttribute:k=>attrs2[k]||null,removeAttribute:k=>delete attrs2[k],setAttribute:(k,v)=>attrs2[k]=v,decode(){return this.src==='/broken.png'?Promise.reject(Error('missing')):Promise.resolve();}};
  await hover.upgradeImageSources({images:[broken]});assert.equal(broken.src,'/original.png');
  console.log('PASS high-resolution source: largest srcset chosen, failed original restored');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
