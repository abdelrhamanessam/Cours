const h=require('http'),fs=require('fs'),p=require('path');
h.createServer((r,s)=>{
  let u=r.url.split('?')[0].replace(/\/$/,'/index.html');
  let f=p.resolve('E:\\New folder',u.slice(1)||'index.html');
  if (!f.startsWith(p.resolve('E:\\New folder'))) { s.writeHead(403); s.end('Forbidden'); return; }
  fs.readFile(f,(e,d)=>{
    if(e){s.writeHead(404);s.end('Not found')}
    else{
      let t='text/html';
      if(f.endsWith('.css'))t='text/css';
      if(f.endsWith('.js'))t='application/javascript';
      s.writeHead(200,{'Content-Type':t});
      s.end(d)
    }
  })
}).listen(3000,()=>console.log('Server running'));
