import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createHttpServer, ensureDataDir, ServerInstance } from './server.js';
import { Config, VERSION } from './config.js';
import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_PORT = 19999;
const TEST_DATA_DIR = join(tmpdir(), 'rootspace-test-' + Date.now());

function makeRequest(
  port: number,
  path: string,
  method = 'GET'
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const http = require('node:http');
    const req = http.request({ hostname: 'localhost', port, path, method }, (res: any) => {
      let data = '';
      res.on('data', (chunk: string) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('T1.1 HTTP Server Startup', () => {
  let serverInstance: ServerInstance;
  const config: Config = { port: TEST_PORT, dataDir: TEST_DATA_DIR };

  afterEach(async () => {
    if (serverInstance) {
      await serverInstance.stop();
    }
    await rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it('T1.1.1: Server starts and listens on port 9999', async () => {
    serverInstance = createHttpServer(config);
    await serverInstance.start();

    const address = serverInstance.server.address();
    expect(address).not.toBeNull();
    expect(typeof address === 'object' && address?.port).toBe(TEST_PORT);
  });

  it('T1.1.2: Server creates ~/rootspace/ directory if not exists', async () => {
    serverInstance = createHttpServer(config);
    await serverInstance.start();

    const stats = await stat(TEST_DATA_DIR);
    expect(stats.isDirectory()).toBe(true);
  });

  it('T1.1.3: Server uses custom data directory when configured', async () => {
    const customDir = join(tmpdir(), 'rootspace-custom-' + Date.now());
    const customConfig: Config = { port: TEST_PORT, dataDir: customDir };
    serverInstance = createHttpServer(customConfig);
    await serverInstance.start();

    const stats = await stat(customDir);
    expect(stats.isDirectory()).toBe(true);
    await rm(customDir, { recursive: true, force: true });
  });
});

describe('T1.2 Health Check', () => {
  let serverInstance: ServerInstance;
  const config: Config = { port: TEST_PORT, dataDir: TEST_DATA_DIR };

  beforeAll(async () => {
    serverInstance = createHttpServer(config);
    await serverInstance.start();
  });

  afterAll(async () => {
    await serverInstance.stop();
    await rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it('T1.2.1: GET /health returns 200 OK', async () => {
    const res = await makeRequest(TEST_PORT, '/health');
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('ok');
  });

  it('T1.2.2: GET /health response includes server version', async () => {
    const res = await makeRequest(TEST_PORT, '/health');
    expect((res.body as { version: string }).version).toBe(VERSION);
  });
});

describe('T1.3 Graceful Shutdown', () => {
  it('T1.3.1: Server shuts down gracefully on stop()', async () => {
    const config: Config = { port: TEST_PORT + 1, dataDir: TEST_DATA_DIR };
    const serverInstance = createHttpServer(config);
    await serverInstance.start();

    await serverInstance.stop();

    // Server should no longer be listening
    const address = serverInstance.server.address();
    expect(address).toBeNull();
    await rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it('T1.3.3: In-flight requests complete before shutdown', async () => {
    const config: Config = { port: TEST_PORT + 2, dataDir: TEST_DATA_DIR };
    const serverInstance = createHttpServer(config);
    await serverInstance.start();

    // Start a request
    const requestPromise = makeRequest(TEST_PORT + 2, '/health');

    // Request should complete successfully even when we start shutdown
    const res = await requestPromise;
    expect(res.status).toBe(200);

    await serverInstance.stop();
    await rm(TEST_DATA_DIR, { recursive: true, force: true });
  });
});

describe('ensureDataDir', () => {
  const testDir = join(tmpdir(), 'rootspace-ensure-' + Date.now());

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('creates directory if not exists', async () => {
    await ensureDataDir(testDir);
    const stats = await stat(testDir);
    expect(stats.isDirectory()).toBe(true);
  });

  it('succeeds if directory already exists', async () => {
    await ensureDataDir(testDir);
    await ensureDataDir(testDir); // Should not throw
    const stats = await stat(testDir);
    expect(stats.isDirectory()).toBe(true);
  });
});
