const path = require('path');
const os = require('os');
const fs = require('fs');
const { CacheManager } = require('../cache_manager');

describe('CacheManager', () => {
  test('parses hosts environment correctly', () => {
    const cm = new CacheManager('a.com,10.0.0.1!b.com,10.0.0.2');
    expect(cm.getHostnames()).toEqual({ 'a.com': '10.0.0.1', 'b.com': '10.0.0.2' });
  });

  test('download writes file with correct content length', async () => {
    const tmpDir = path.join(os.tmpdir(), `cache-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const data = 'hello world';
    const server = require('http').createServer((req, resp) => {
      resp.writeHead(200, { 'content-length': Buffer.byteLength(data).toString() });
      resp.end(data);
    }).listen(0); // random port

    const port = (server.address()).port;
    const cm = new CacheManager('');
    const dest = path.join(tmpDir, 'download.txt');
    const options = {
      hostname: '127.0.0.1',
      port,
      path: '/',
      method: 'GET'
    };

    await cm.download(options, dest);

    expect(fs.existsSync(dest)).toBeTruthy();
    const content = fs.readFileSync(dest, 'utf8');
    expect(content).toEqual(data);

    server.close();
  });

  test('concurrent download throws error', async () => {
    const tmpDir = path.join(os.tmpdir(), `cache-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const data = 'x';
    const server = require('http').createServer((req, resp) => {
      resp.writeHead(200, { 'content-length': Buffer.byteLength(data).toString() });
      resp.end(data);
    }).listen(0);

    const port = (server.address()).port;
    const cm = new CacheManager('');
    const dest = path.join(tmpDir, 'file.txt');
    const options = {
      hostname: '127.0.0.1',
      port,
      path: '/',
      method: 'GET'
    };

    const firstPromise = cm.download(options, dest);
    expect(() => { cm.download(options, dest); }).toThrow('Download already in progress for this destination.');
    await firstPromise; // cleanup
    server.close();
  });
});
const os = require('os');
const fs = require('fs');
const { CacheManager } = require('../cache_manager');

describe('CacheManager', () => {
  test('parses hosts environment correctly', () => {
    const cm = new CacheManager('a.com,10.0.0.1!b.com,10.0.0.2');
    expect(cm.getHostnames()).toEqual({ 'a.com': '10.0.0.1', 'b.com': '10.0.0.2' });
  });

  test('download writes file with correct content length', async () => {
    const tmpDir = path.join(os.tmpdir(), `cache-test-${Date.now()}`);
    const data = 'hello world';
    const server = require('http').createServer((req, resp) => {
      resp.writeHead(200, { 'content-length': Buffer.byteLength(data).toString() });
      resp.end(data);
    }).listen(0); // random port

    const port = (server.address()).port;
    const cm = new CacheManager('');
    const dest = path.join(tmpDir, 'download.txt');
    const options = {
      hostname: '127.0.0.1',
      port,
      path: '/',
      method: 'GET'
    };

    await cm.download(options, dest);

    expect(fs.existsSync(dest)).toBeTruthy();
    const content = fs.readFileSync(dest, 'utf8');
    expect(content).toEqual(data);

    server.close();
  });

  test('concurrent download throws error', async () => {
    const tmpDir = path.join(os.tmpdir(), `cache-test-${Date.now()}`);
    const cm = new CacheManager('');
    const dest = path.join(tmpDir, 'file.txt');
    const options = {
      hostname: '127.0.0.1',
      port: 80,
      path: '/',
      method: 'GET'
    };
    const firstPromise = cm.download(options, dest);
    expect(() => { cm.download(options, dest); }).toThrow('Download already in progress for this destination.');
    await firstPromise; // cleanup
  });
});
