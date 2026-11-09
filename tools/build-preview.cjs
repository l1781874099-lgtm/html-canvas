const {spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const env={...process.env};
if(!String(env.NODE_OPTIONS||'').includes('--openssl-legacy-provider'))env.NODE_OPTIONS=(env.NODE_OPTIONS||'')+' --openssl-legacy-provider';
const result=spawnSync(process.execPath,[require.resolve('webpack-cli/bin/cli.js'),'--config','local-test/webpack.preview.js'],{cwd:root,env,stdio:'inherit'});
if(result.error)throw result.error;
process.exit(result.status||0);
