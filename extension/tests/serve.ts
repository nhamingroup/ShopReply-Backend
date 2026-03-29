import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const DIST_DIR = path.resolve(__dirname, '../.output/chrome-mv3');

export function createServer(port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // Strip query params for file resolution
      const urlPath = (req.url || '/').split('?')[0];
      const filePath = path.join(DIST_DIR, urlPath === '/' ? 'popup.html' : urlPath);
      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      fs.readFile(filePath, (err, data) => {
        if (err) {
          // Try .html extension fallback
          const htmlFallback = filePath + '.html';
          fs.readFile(htmlFallback, (err2, data2) => {
            if (err2) {
              res.writeHead(404);
              res.end(`Not found: ${urlPath}`);
              return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data2);
          });
          return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });

    server.listen(port, () => resolve(server));
    server.on('error', reject);
  });
}
