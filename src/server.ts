import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { Config, VERSION } from './config.js';

export interface ServerInstance {
  server: Server;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export async function ensureDataDir(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true });
}

function handleHealth(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', version: VERSION }));
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.url === '/health' && req.method === 'GET') {
    handleHealth(req, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

export function createHttpServer(config: Config): ServerInstance {
  const server = createServer(handleRequest);
  const connections = new Set<import('node:net').Socket>();

  server.on('connection', (socket) => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));
  });

  const start = async (): Promise<void> => {
    await ensureDataDir(config.dataDir);

    return new Promise((resolve, reject) => {
      server.listen(config.port, () => {
        console.log(`RootSpace server listening on port ${config.port}`);
        console.log(`Data directory: ${config.dataDir}`);
        resolve();
      });
      server.once('error', reject);
    });
  };

  const stop = (): Promise<void> => {
    return new Promise((resolve) => {
      // Stop accepting new connections; callback fires when all connections close
      server.close(() => {
        resolve();
      });

      // Force-destroy connections that haven't closed after timeout
      const forceCloseTimeout = setTimeout(() => {
        for (const socket of connections) {
          socket.destroy();
        }
      }, 5000);

      // Clear timeout if server closes gracefully before deadline
      server.once('close', () => clearTimeout(forceCloseTimeout));
    });
  };

  return { server, start, stop };
}
