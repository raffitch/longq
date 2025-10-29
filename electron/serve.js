const http = require('http');
const fs = require('fs');
const path = require('path');
const mime = require('mime');

function createStaticServer(root) {
  return http.createServer((req, res) => {
    const url = decodeURI(req.url.split('?')[0]);
    let filePath = path.join(root, url);
    if (url.endsWith('/')) {
      filePath = path.join(root, 'index.html');
    }
    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        if (!path.extname(filePath)) {
          const fallback = path.join(root, 'index.html');
          fs.createReadStream(fallback).pipe(res);
          return;
        }
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': mime.getType(filePath) || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
  });
}

module.exports = { createStaticServer };
