const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..');const output={};
const code=ts.transpileModule(fs.readFileSync(path.join(root,'lib/html-to-figma/helpers/image-layout.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
vm.runInNewContext(code,{exports:output});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
// Test fixture: 240×220 SVG placed in a wide, 130px-high product card.
let p=output.imagePlacement(240,220,210,130,'cover');
near(p.width,210);near(p.height,192.5);near(p.x,0);near(p.y,-31.25);
p=output.imagePlacement(240,220,210,130,'contain');
near(p.width,240*130/220);near(p.height,130);near(p.y,0);near(p.x,(210-p.width)/2);
p=output.imagePlacement(240,220,210,130,'cover','50% 0%');near(p.y,0);
p=output.imagePlacement(240,220,210,130,'cover','50% 100%');near(p.y,-62.5);
p=output.imagePlacement(240,220,210,130,'fill');near(p.width,210);near(p.height,130);
p=output.imagePlacement(40,20,210,130,'scale-down');near(p.width,40);near(p.height,20);
console.log('PASS image layout: product cover crop, contain, top/bottom position, fill, scale-down');

// Run the actual image-paint helper with a Canvas double and SVG image input.
const imageExports={};let drawn;
class HTMLImageElement {}
const el=new HTMLImageElement();Object.assign(el,{complete:true,naturalWidth:240,naturalHeight:220,currentSrc:'data:image/svg+xml;base64,PHN2Zy8+',getBoundingClientRect(){return {width:210,height:130};}});
const canvas={getContext(){return {scale(){},drawImage(...args){drawn=args;}};},toDataURL(){return 'data:image/png;base64,AQID';}};
const imageCode=ts.transpileModule(fs.readFileSync(path.join(root,'lib/html-to-figma/helpers/image.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
vm.runInNewContext(imageCode,{exports:imageExports,console,require(id){return id.endsWith('image-layout')?output:{HTMLImageElement,SVGSVGElement:class {},HTMLVideoElement:class {},document:{createElement(){return canvas;}}};}});
const paint=imageExports.getImagePaintWithUrl({el,computedStyle:{width:'210px',height:'130px',objectFit:'cover',objectPosition:'50% 50%'}});
assert.equal(paint.type,'IMAGE');assert.equal(paint.scaleMode,'FILL');assert.ok(paint.url.startsWith('data:image/png'));
near(drawn[2],-31.25);near(drawn[4],192.5);assert.equal(canvas.width,630);assert.equal(canvas.height,390);
console.log('PASS SVG image: browser crop baked into high-density paint instead of vector stretching');
