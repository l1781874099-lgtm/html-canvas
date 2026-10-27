const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{zipSync,strToU8}=require('fflate');
const root=path.resolve(__dirname,'..'),output=path.resolve(process.argv[2] || 'release/html-canvas-release');
fs.mkdirSync(path.join(output,'dist'),{recursive:true});
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const registeredId=manifest.id;
delete manifest.id;
const id=process.env.FIGMA_PLUGIN_ID || (registeredId!=='747985167520967365'?registeredId:undefined);
if(id){if(!/^\d+$/.test(id) || id==='747985167520967365')throw Error('请提供自己注册的新插件 ID');manifest.id=id;}
if(manifest.documentAccess!=='dynamic-page' || manifest.networkAccess.allowedDomains.join(',')!=='none')throw Error('发布配置不符合预期');
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
for(const name of ['code.js','ui.html'])fs.copyFileSync(path.join(root,'dist',name),path.join(output,'dist',name));
fs.copyFileSync(path.join(root,'LICENSE.md'),path.join(output,'LICENSE.md'));
let licenses='# Third-party licenses\n\nOriginal HTML converter: Builder.io figma-html (MIT), see LICENSE.md.\n';
for(const name of ['react','react-dom','scheduler','object-assign','fflate']){
 const dir=path.join(root,'node_modules',name),pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
 const file=fs.readdirSync(dir).find(x=>/^licen[sc]e(?:\.|$)/i.test(x));if(!file)throw Error('缺少许可：'+name);
 licenses+='\n## '+name+' '+pkg.version+'\n\n'+fs.readFileSync(path.join(dir,file),'utf8')+'\n';
}
fs.writeFileSync(path.join(output,'THIRD-PARTY-NOTICES.md'),licenses);
fs.writeFileSync(path.join(output,'README.md'),`# HTML Canvas · 0.1.0-rc.1\n\n发布候选包，尚未上架。\n\n${manifest.id?'已写入新的插件 ID。':'尚未注册新插件 ID：manifest.json 刻意未带 id。请先在 Figma 桌面端创建自己的插件，把分配的 ID 写入，再导入此 manifest。不要复用原项目的 ID。'}\n\n构建当前项目后，重新打开本地开发插件；使用“选择 HTML / ZIP（可多选）”导入附带的三页面测试 ZIP，宽度 1920。\n\nLISTING.md：发布文案与支持邮箱\nPRIVACY.md：实际数据处理行为\nRELEASE-CHECKLIST.md：剩余上架步骤\nTEST-REPORT.md：验证范围与限制\nlisting-assets/：图标和封面\nLICENSE.md / THIRD-PARTY-NOTICES.md：许可声明\n\n无需运行 npm publish。Figma 插件发布必须使用自己的账号与插件 ID，经 Figma 审核后才会公开。\n`);
const combined=fs.readFileSync(path.join(output,'dist/ui.html'),'utf8')+fs.readFileSync(path.join(output,'dist/code.js'),'utf8');
for(const prohibited of ['proxy-api','amplitude','googletagmanager','ai-to-figma-tk43uighdq','getNodeById('])if(combined.includes(prohibited))throw Error('残留旧逻辑：'+prohibited);
for(const required of ['HTML Canvas','选择 HTML / ZIP','ZIP'])if(!combined.includes(required))throw Error('缺少新入口：'+required);
const packed={};let sums='';
function collect(dir,relative=''){
 for(const item of fs.readdirSync(dir,{withFileTypes:true})){
  const rel=relative+item.name,full=path.join(dir,item.name);
  if(item.isDirectory())collect(full,rel+'/');
  else if(item.name!=='SHA256SUMS.txt'){
   const data=fs.readFileSync(full);packed[rel]=data;sums+=crypto.createHash('sha256').update(data).digest('hex')+'  '+rel+'\n';
  }
 }
}
collect(output);fs.writeFileSync(path.join(output,'SHA256SUMS.txt'),sums);packed['SHA256SUMS.txt']=strToU8(sums);
const archive=path.join(path.dirname(output),'html-canvas-0.1.0-rc.1.zip');fs.writeFileSync(archive,zipSync(packed,{level:6}));
console.log('Candidate:',output);console.log('Package:',archive);console.log('ID:',manifest.id || '未注册；没有复用上游 ID');console.log('Bundled files:',Object.keys(packed).length);
