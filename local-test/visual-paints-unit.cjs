const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');const ts=require('typescript');
const root=path.resolve(__dirname,'..');const modules=new Map();
function load(file){
  file=path.resolve(file);if(modules.has(file))return modules.get(file);
  const exports={};modules.set(file,exports);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(code,{exports,require:id=>load(path.resolve(path.dirname(file),id)+'.ts'),console});return exports;
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const paints=load(path.join(root,'lib/html-to-figma/helpers/visual-paints.ts'));
const colors=load(path.join(root,'lib/html-to-figma/helpers/parsers.ts'));
const arcs=load(path.join(root,'lib/html-to-figma/helpers/dashed-circle.ts'));
near(colors.getRgb('rgb(245, 247, 251)').r,245/255);
near(colors.getRgb('rgb(100% 0% 0% / 25%)').a,.25);
near(colors.getRgb('#abc').g,187/255);
assert.equal(colors.getRgb('rgba(0, 0, 0, 0)').a,0);
console.log('PASS colors: legacy RGB, modern RGB, hex, transparent');
const background=paints.backgroundPaints({backgroundColor:'rgb(245, 247, 251)',backgroundImage:'none'},1440,1100);
assert.equal(background.length,1);near(background[0].color.b,251/255);
const banner=paints.backgroundPaints({backgroundColor:'rgba(0, 0, 0, 0)',backgroundImage:'linear-gradient(110deg, rgb(232, 225, 255), rgb(241, 236, 255) 56%, rgb(227, 243, 243))'},1000,150);
assert.equal(banner.length,1);assert.equal(banner[0].type,'GRADIENT_LINEAR');assert.equal(banner[0].gradientStops.length,3);near(banner[0].gradientStops[1].position,.56);
const horizontal=paints.linearGradient('linear-gradient(90deg, #000000, #ffffff)',1000,150);
near(horizontal.gradientTransform[0][0],1);near(horizontal.gradientTransform[0][1],0);near(horizontal.gradientTransform[0][2],0);
const vertical=paints.linearGradient('linear-gradient(to bottom, #000, #fff)',1000,150);
near(vertical.gradientTransform[0][0],0);near(vertical.gradientTransform[0][1],1);near(vertical.gradientTransform[0][2],0);
console.log('PASS backgrounds: page color, three-stop banner gradient, horizontal/vertical direction');
near(paints.cornerRadius('50%',38,38),19);near(paints.cornerRadius('50%',7,7),3.5);near(paints.cornerRadius('12px',50,50),12);
console.log('PASS roundness: avatar, legend dot, pixel corner radius');
for(const [length,offset] of [[187,0],[110,-190],[70,-303]]){
  const p=arcs.dashedCirclePath(80,80,60,[length,377],offset);
  assert.equal((p.match(/M /g)||[]).length,1,'one continuous color segment');
  assert.equal((p.match(/ A /g)||[]).length,2,'two half-arcs, not a repeated dashed ring');
  const start=p.match(/^M ([^ ]+) ([^ ]+)/);near(Number(start[1]),80+60*Math.cos(-offset/60));near(Number(start[2]),80+60*Math.sin(-offset/60));
}
assert.equal(arcs.dashedCirclePath(0,0,60,[0,0],0),'');
console.log('PASS donut: each color is one arc and preserves its offset');
