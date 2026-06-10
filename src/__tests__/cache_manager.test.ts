import * as path from 'path';
import * as os from 'os';
import { CacheManager } from '../cache_manager';

describe('CacheManager', () => {
  test('parses hosts environment correctly', () => {
    const cm = new CacheManager('a.com,10.0.0.1!b.com,10.0.0.2');
    expect(cm.getHostnames()).toEqual({ 'a.com': '10.0.0.1', 'b.com': '10.0.0.2' });
  });

  test('download writes file with correct content length', async () => {
    const tmpDir = await new Promise<string>((res) => {
      const dir = path.join(os.tmpdir(), `cache-test-${Date.now()}`);
      res(dir);
    });
    // Simple HTTP server serving a small payload
    const data = 'hello world';
    const server = require('http').createServer((req: any, resp: any) => {
      resp.writeHead(200, { 'content-length': Buffer.byteLength(data).toString() });
      resp.end(data);
    }).listen(0); // random port

    const port = (server.address() as any).port;
    const cm = new CacheManager('');
    const dest = path.join(tmpDir, 'download.txt');
    const options: any = {
      hostname: '127.0.0.1',
      port,
      path: '/',
      method: 'GET'
    };

    await cm.download(options as any, dest);

    const fs = require('fs');
    expect(fs.existsSync(dest)).toBeTruthy();
    const content = fs.readFileSync(dest, 'utf8');
    expect(content).toEqual(data);

    server.close();
  });

  test('concurrent download throws error', async () => {
    const tmpDir = path.join(os.tmpdir(), `cache-test-${Date.now()}`);
    const cm = new CacheManager('');
    const dest = path.join(tmpDir, 'file.txt');
    // First call - start but don't await to allow second call to see in-progress
    const options: any = {
      hostname: '127.0.0.1',
      port: 80,
      path: '/',
      method: 'GET'
    };
    const firstPromise = cm.download(options as any, dest);
    // Second call should throw synchronously
    expect(() => {
      cm.download(options as any, dest); // second attempt
    }).toThrow('Download already in progress for this destination.');
    await firstPromise; // clean up
  });
});
