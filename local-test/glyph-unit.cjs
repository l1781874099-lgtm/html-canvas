const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
let canvas,drawn;
const style={font:'18px Arial',fontStyle:'normal',fontWeight:'400',fontSize:'18px',fontFamily:'Arial',color:'rgb(120, 130, 150)'};
const ctx={scale(){},measureText(){return {fontBoundingBoxAscent:17,fontBoundingBoxDescent:4};},fillText(text){drawn=text;}};
const doc={createRange(){return {selectNodeContents(){},getBoundingClientRect(){return {left:10,top:20,width:18,height:21};},detach(){}};},
  createElement(){canvas={getContext(){return ctx;},toDataURL(){return 'data:image/png;base64,AQID';}};return canvas;}};
const source=fs.readFileSync(path.join(root,'lib/html-to-figma/helpers/glyphs.ts'),'utf8');const exportsObject={};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:exportsObject,require(){return {document:doc,getComputedStyle(){return style;}};}});
const parentElement={closest(){return null;}};
const arrow=exportsObject.glyphLayer({textContent:'↗',parentElement});
assert.equal(arrow.type,'RECTANGLE');assert.equal(arrow.fills[0].type,'IMAGE');assert.equal(drawn,'↗');
assert.equal(canvas.width,54);assert.equal(canvas.height,63);assert.equal(ctx.font,'18px Arial');
assert.equal(exportsObject.glyphLayer({textContent:'营销活动',parentElement}),undefined);
assert.equal(exportsObject.glyphLayer({textContent:'18.6%',parentElement}),undefined);
assert.equal(exportsObject.glyphLayer({textContent:'¥ 599',parentElement}),undefined);
console.log('PASS glyphs: browser font retained, 3x bitmap, ordinary labels/prices remain text');
