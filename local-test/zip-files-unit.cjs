const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {DOMParser}=require('linkedom'),fflate=require('fflate');
const file=path.join(__dirname,'../plugin/functions/zip-files.ts'),exports_={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:exports_,require,DOMParser,TextEncoder,TextDecoder,Uint8Array,Map,Set,console,setTimeout,btoa:s=>Buffer.from(s,'binary').toString('base64')});
const api=exports_,u=fflate.strToU8;
const entries={
 'site/index.html':u('<html><head><link rel="stylesheet" href="css/main.css"></head><body><img src="images/tiny.png"><img srcset="images/tiny.png 1x, images/large.png 2x"><div style="background-image:url(images/tiny.png)">Hello</div></body></html>'),
 'site/pages/about.htm':u('<html><head><link rel="stylesheet" href="../css/main.css"></head><body><img src="../images/tiny.png"><img src="missing.png"><img src="https://example.org/private.png"></body></html>'),
 'site/css/main.css':u('@import "nested/colors.css"; .cover{background:url(../images/tiny.png)} @font-face{font-family:Demo;src:url(../fonts/demo.woff2)}'),
 'site/css/nested/colors.css':u('.nested{background-image:url(../../images/large.png);color:#123456}'),
 'site/images/tiny.png':new Uint8Array([1,2,3]),'site/images/large.png':new Uint8Array([4,5,6]),'site/fonts/demo.woff2':new Uint8Array([7,8,9]),
};
async function main(){
 const zip=fflate.zipSync(entries),archive=api.readArchive(zip);
 assert.equal(archive.size,7);assert.equal(api.normalizeArchivePath('../images/tiny.png','site/pages/about.htm'),'site/images/tiny.png');
 assert.throws(()=>api.normalizeArchivePath('../../escape.png','index.html'));
 const absolute=new Map(archive);absolute.set('site/root.html',u('<html><head></head><body><img src="/images/tiny.png"></body></html>'));assert.ok(api.inlineArchivePage('site/root.html',absolute).html.includes('data:image/png;base64,AQID'));
 const home=api.inlineArchivePage('site/index.html',archive);
 assert.ok(home.html.includes('data:image/png;base64,AQID'));assert.ok(home.html.includes('data:image/png;base64,BAUG'));assert.ok(home.html.includes('data:font/woff2;base64,BwgJ'));
 assert.ok(home.html.includes('#123456'));assert.ok(!home.html.includes('@import'));assert.ok(!home.html.includes('srcset='));assert.equal(home.warnings.length,0);
 const about=api.inlineArchivePage('site/pages/about.htm',archive);assert.ok(about.warnings.some(x=>x.includes('missing.png')));assert.ok(about.warnings.some(x=>x.includes('example.org')));assert.ok(!about.html.includes('src="https://'));
 const cycle=new Map([['index.html',u('<html><head><link rel="stylesheet" href="a.css"></head><body>x</body></html>')],['a.css',u('@import "b.css";')],['b.css',u('@import "a.css";')]]);
 assert.ok(api.inlineArchivePage('index.html',cycle).warnings.some(x=>x.includes('循环')));
 const oldLimit=api.archiveLimits.expanded;api.archiveLimits.expanded=2;assert.throws(()=>api.readArchive(zip));api.archiveLimits.expanded=oldLimit;
 const prepared=await api.prepareImportFiles([{name:'site.zip',arrayBuffer:async()=>zip.buffer.slice(zip.byteOffset,zip.byteOffset+zip.byteLength)},{name:'broken.zip',arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer},{name:'loose.html',text:async()=>'<h1>loose</h1>'}],()=>{});
 assert.equal(prepared.pages.length,3);assert.equal(prepared.errors.length,1);assert.ok(prepared.errors[0].includes('broken.zip'));
 console.log('PASS ZIP: nested pages, CSS imports, image paths, srcset, fonts, missing/external resources, cycles, size limits, corrupt archive isolation');
}
main().catch(error=>{console.error(error);process.exitCode=1;});

