import * as React from 'react';
import { renderLocalHtml } from '../functions/local-html';
import { traverseLayers } from '../functions/traverse-layers';
import { getImageFills, processImages } from '../functions/import-images';
import { prepareImportFiles } from '../functions/zip-files';
import { localImportResponse } from '../functions/import-response';

export function LocalHtmlImport() {
  const [busy,setBusy]=React.useState(false),[status,setStatus]=React.useState(''),[error,setError]=React.useState(false);
  const [progress,setProgress]=React.useState(0),[width,setWidth]=React.useState('1920');
  const [rasterizeFonts,setRasterizeFonts]=React.useState(true),[captureStates,setCaptureStates]=React.useState(true),fonts=React.useRef<string[]|undefined>();
  const input=React.useRef<HTMLInputElement>(null),active=React.useRef<string|null>(null),watchdog=React.useRef<number|undefined>();
  const armWatchdog=()=>{
    clearTimeout(watchdog.current);
    watchdog.current=window.setTimeout(()=>{
      if(!active.current)return;
      // Keep the task locked: the sandbox may still be generating the page.
      setError(true);setStatus('处理时间较长，暂未收到新进度。请稍候，或关闭插件结束任务；当前画布不会逐层刷新。');
    },90000);
  };
  React.useEffect(()=>{
    const receive=(event:MessageEvent)=>{
      const fontList=event.data?.pluginMessage;
      if(fontList?.type==='fontList' && Array.isArray(fontList.families)){fonts.current=fontList.families;return;}
      const message=localImportResponse(event.data,active.current);if(!message)return;
      if(message.type==='doneLoading'){
        clearTimeout(watchdog.current);active.current=null;setBusy(false);setProgress(100);
        let text='导入完成：'+(message.pageCount || 1)+' 个页面，'+message.completedLayers+' 个图层。';
        if(message.fontWarnings?.length)text+='\n部分字重使用了可用的替代样式：\n'+message.fontWarnings.join('\n');
        if(message.warnings?.length)text+='\n'+message.warnings.join('\n');
        setStatus(text);
      }else if(message.type==='importFailed'){
        clearTimeout(watchdog.current);active.current=null;setBusy(false);setError(true);setStatus('导入失败：'+message.message);
      }else{
        armWatchdog();setProgress(p=>Math.max(p,message.percent || 50));
        setStatus((message.label || '正在处理……')+(message.totalLayers?' '+message.completedLayers+'/'+message.totalLayers:''));
      }
    };
    window.addEventListener('message',receive);
    parent.postMessage({pluginMessage:{type:'listFonts'}},'*');
    return ()=>{window.removeEventListener('message',receive);clearTimeout(watchdog.current);};
  },[]);

  async function importFiles(files:File[]){
    if(busy || !files.length)return;
    if(files.some(file=>!/\.(html?|zip)$/i.test(file.name))){setError(true);setStatus('请选择 .html、.htm 或 .zip 文件。');return;}
    const viewport=Number(width);
    if(!Number.isInteger(viewport)||viewport<320||viewport>3840){setError(true);setStatus('页面宽度请输入 320–3840 之间的整数。');return;}
    setBusy(true);setError(false);setProgress(0);
    const layers:any[]=[],warnings:string[]=[],failed:string[]=[];
    try{
      const prepared=await prepareImportFiles(files,label=>setStatus(label));
      failed.push(...prepared.errors);
      const pages=prepared.pages;
      for(let index=0;index<pages.length;index++){
        const file=pages[index],prefix='['+(index+1)+'/'+pages.length+'] '+file.name+'：';
        const update=(fraction:number,label:string)=>{
          setProgress(Math.round((index+fraction)/pages.length*50));setStatus(prefix+label);
        };
        try{
          update(0,'正在读取……');
          const html=file.html;
          const result=await renderLocalHtml(html,viewport,{rasterizeMissingFonts:rasterizeFonts,availableFonts:fonts.current,captureScriptStates:captureStates},(fraction,label)=>update(.08+fraction*.57,label));
          const fileName=file.name.replace(/\.html?$/i,'');
          result.layers.forEach((layer:any,index:number)=>{layer.name=result.layers.length>1?fileName+' / '+(layer.name || '页面 '+(index+1)):fileName;});
          const images:any[]=[];
          for(const root of result.layers)await traverseLayers(root,async(layer:any)=>{const fills=getImageFills(layer);if(fills && fills.length)images.push(layer);});
          for(let i=0;i<images.length;i++){
            update(.65+(i/images.length)*.35,'正在处理图片 '+(i+1)+'/'+images.length+'……');
            await processImages(images[i]);
          }
          if(result.missing)result.warnings.push('有 '+result.missing+' 张图片未加载，请检查图片路径。');
          warnings.push(...file.warnings.map(text=>file.name+'：'+text));
          warnings.push(...result.warnings.map(text=>file.name+'：'+text));
          layers.push(...result.layers);update(1,'解析完成');
        }catch(err){failed.push(file.name+'：'+(err instanceof Error?err.message:String(err)));}
      }
      if(!layers.length)throw new Error('所有文件均未能解析。\n'+failed.join('\n'));
      if(failed.length)warnings.push('有 '+failed.length+' 个文件未导入：\n'+failed.join('\n'));
      const requestId='html-'+Date.now()+'-'+Math.random().toString(36).slice(2);active.current=requestId;
      setProgress(50);setStatus('正在生成 '+layers.length+' 个页面，完成后一起放入画布……');armWatchdog();
      parent.postMessage({pluginMessage:{type:'import',localHtml:true,requestId,batch:layers.length>1,data:{layers},warnings}},'*');
    }catch(err){active.current=null;clearTimeout(watchdog.current);setBusy(false);setError(true);setStatus('导入失败：'+(err instanceof Error?err.message:String(err)));}
  }
  return <main style={{padding:24}}>
    <h1 style={{margin:'0 0 6px',fontSize:18,fontWeight:600}}>HTML Canvas</h1>
    <p style={{margin:'0 0 24px',color:'#8b8e97'}}>本地网页，变成可编辑的设计。</p>
    <label style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
      <span>页面宽度 <span style={{color:'#989ba3'}}>px</span></span>
      <input aria-label="页面宽度" type="number" min="320" max="3840" value={width} disabled={busy} onChange={e=>setWidth(e.target.value)} style={{width:104,padding:'7px 10px',border:'1px solid #e2e4e9',borderRadius:6,color:'#383b42',background:'#fff'}}/>
    </label>
    <label style={{display:'flex',alignItems:'center',gap:8,marginBottom:18,fontSize:11,color:'#5c606a'}}>
      <input type="checkbox" checked={rasterizeFonts} disabled={busy} onChange={e=>setRasterizeFonts(e.target.checked)}/>
      <span>缺少网页字体时将文字转为图片（保证外观一致）</span>
    </label>
    <label style={{display:'flex',alignItems:'center',gap:8,marginBottom:18,fontSize:11,color:'#5c606a'}}>
      <input type="checkbox" checked={captureStates} disabled={busy} onChange={e=>setCaptureStates(e.target.checked)}/>
      <span>自动切换脚本驱动的 Tab / 筛选按钮，每个状态导出一个图层</span>
    </label>
    <input ref={input} type="file" multiple accept=".html,.htm,.zip,text/html,application/zip" style={{display:'none'}} onChange={e=>{const files=Array.from(e.target.files || []);e.target.value='';if(files.length)importFiles(files);}}/>
    <button type="button" disabled={busy} onClick={()=>input.current?.click()} style={{width:'100%',padding:'11px 16px',border:0,borderRadius:6,color:'#fff',background:'#3374ed',fontWeight:500}}>{busy?'正在导入…':'选择 HTML / ZIP（可多选）'}</button>
    {(busy || progress>0)&&<div style={{marginTop:22}}>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#8b8e97',marginBottom:7}}><span>{busy?'导入进度':error?'导入中断':'导入完成'}</span><span>{progress}%</span></div>
      <div role="progressbar" aria-label="HTML 导入进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} style={{height:4,background:'#edf0f5',borderRadius:4,overflow:'hidden'}}><div style={{height:'100%',width:progress+'%',background:error?'#d65353':'#3374ed',transition:'width .2s'}}/></div>
    </div>}
    {status&&<p role="status" style={{fontSize:11,whiteSpace:'pre-wrap',overflowWrap:'anywhere',color:error?'#c44343':'#737781',lineHeight:1.8,marginTop:12}}>{status}</p>}
    <p style={{fontSize:11,lineHeight:1.8,color:'#a1a4ad',margin:'22px 0 0',paddingTop:16,borderTop:'1px solid #f0f1f4'}}>HTML 可直接上传，独立 CSS 和图片请一起打包 ZIP。<br/>可展开常见 Tab。请导入可信文件，内嵌脚本会在隔离沙箱中运行。</p>
  </main>;
}
