const {spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const env={...process.env,NODE_ENV:'production'};
if(!String(env.NODE_OPTIONS||'').includes('--openssl-legacy-provider'))env.NODE_OPTIONS=(env.NODE_OPTIONS||'')+' --openssl-legacy-provider';
for(const [entry,args] of [
 ['typescript/lib/tsc.js',[]],
 ['webpack-cli/bin/cli.js',['--config','webpack.parser.config.js','--mode=production']],
 ['webpack-cli/bin/cli.js',['--mode=production']],
]){
 const result=spawnSync(process.execPath,[require.resolve(entry),...args],{cwd:root,env,stdio:'inherit'});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status||1);
}
