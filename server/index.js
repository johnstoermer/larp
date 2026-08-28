import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MultiplayerHub } from './multiplayer/Hub.js';

const app = express();
const port = Number(process.env.PORT || 8080);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const server = createServer(app);
const multiplayer = new MultiplayerHub(server);

app.disable('x-powered-by');
app.get('/healthz', (_request, response) => {
  response.type('text/plain').send('ok');
});
app.get('/api/status', (_request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.json(multiplayer.getStats());
});

app.use(
  express.static(root, {
    index: 'index.html',
    setHeaders(response, filePath) {
      if (filePath.endsWith('.html')) {
        response.setHeader('Cache-Control', 'no-cache');
      } else {
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
      response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  }),
);

app.get('*splat', (_request, response) => {
  response.setHeader('Cache-Control', 'no-cache');
  response.sendFile(path.join(root, 'index.html'));
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.listen(port, '0.0.0.0', () => {
  console.log(`LARP listening on ${port}`);
});
