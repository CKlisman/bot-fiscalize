import http from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const contentRoot=path.join(root,process.env.DEMO_DIR||'demo');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.cjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 const file=await realpath(path.resolve(contentRoot,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname)));
 if(!file.startsWith(contentRoot+path.sep))throw Error('Outside content root');
 const bytes=await readFile(file);
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(bytes);
}catch{res.writeHead(404);res.end('Not found');}});
server.listen(Number(process.env.PORT||0),'127.0.0.1',()=>console.log('Demo local: http://127.0.0.1:'+server.address().port));
