import { CacheManager } from '../src/cache_manager';
import * as http from 'http';
import * as fs from 'fs';
import * as mime from 'mime';
import * as crypto from 'crypto';
import { Readable, Writable } from 'stream';

// Helper to create a mock readable stream for HTTP response
function createMockResponse(dataChunks: Buffer[], headers: http.IncomingHttpHeaders = {}): http.IncomingMessage {
  const res = new Readable({ read() { } }) as any;
  res.headers = headers;
  dataChunks.forEach(chunk => res.push(chunk));
  res.push(null); // EOF
  return res;
}

// Mock implementations for dependencies used by CacheManager
jest.mock('http', () => {
  const actual = jest.requireActual('http');
  return {
    ...actual,
    request: jest.fn((options: http.RequestOptions, callback: (res: http.IncomingMessage) => void): any => {
      // Simulate a successful response with given data
      const mockResponse = createMockResponse([Buffer.from('12345')], { 'content-length': '5' });
      process.nextTick(() => callback(mockResponse));
      return { on: jest.fn(), end: jest.fn() };
    }) as unknown as typeof http.request
  };
});

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  const streams: Record<string, Writable & { written: Buffer[] }> = {};
  return {
    ...actual,
    createWriteStream: jest.fn((path: string) => {
      const ws: Writable & { written: Buffer[] } = new Writable({ write(chunk, _, cb) { streams[path].written.push(chunk); cb(); } });
      streams[path] = ws;
      return ws;
    }),
    unlink: jest.fn((path: string, cb: (err?: NodeJS.ErrnoException | null) => void) => cb(null)),
    createReadStream: jest.fn(() => new Readable({ read() { this.push('filecontent'); this.push(null); } })) as any
  };
});

jest.mock('mime', () => ({ getType: jest.fn((ext: string) => 'application/custom') }));

jest.mock('crypto', () => {
  return {
    createHash: () => ({ setEncoding: () => {}, end: () => {} })
  };
});

describe('CacheManager', () => {
  const hostsEnv = 'example.com,1.2.3.4!foo.bar,5.6.7.8';
  let cm: CacheManager;

  beforeEach(() => {
    jest.useRealTimers();
    cm = new CacheManager(hostsEnv);
  });

  test('parses HOSTS env into hostname map', () => {
    const hostnames = cm.getHostnames();
    expect(hostnames).toEqual({ 'example.com': '1.2.3.4', 'foo.bar': '5.6.7.8' });
  });

  test('isDownloading transitions and prevents duplicate downloads', async () => {
    const dest = '/tmp/testfile';
    expect(cm.isDownloading(dest)).toBe(false);
    const downloadPromise = cm.download({ hostname: '1.2.3.4', port: 80, path: '/', method: 'GET' }, dest);
    // Immediately after initiating, should be downloading
    expect(cm.isDownloading(dest)).toBe(true);
    await downloadPromise;
    expect(cm.isDownloading(dest)).toBe(false);
    await expect(cm.download({ hostname: '1.2.3.4', port: 80, path: '/', method: 'GET' }, dest)).rejects.toThrow('Download already in progress');
  });

  test('cacheResource stores buffer and auto expires after timeout', () => {
    jest.useFakeTimers();
    const key = 'InRelease';
    const buf = Buffer.from('data');
    cm.cacheResource(key, buf);
    expect(cm.getCachedContent(key)).toEqual(buf);
    jest.advanceTimersByTime(60 * 1000 + 1);
    expect(cm.getCachedContent(key)).toBeUndefined();
  });

  test('uploadFile writes correct headers', () => {
    const source = '/tmp/file.txt';
    const stats: any = { size: 1234 };
    const res: any = { writeHead: jest.fn(), end: jest.fn() };
    cm.uploadFile(source, stats as fs.Stats, res);
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      'content-length': 1234,
      'content-type': 'application/custom'
    });
  });

  test('download rejects on request error', async () => {
    jest.spyOn(http, 'request').mockImplementation((options: http.RequestOptions, callback: (res: http.IncomingMessage) => void) => {
      const resMock = createMockResponse([Buffer.from('12345')], { 'content-length': '5' });
      process.nextTick(() => callback(resMock));
      const req = {
        on: (event: string, cb: Function) => {
          if (event === 'error') {
            process.nextTick(() => cb(new Error('Request failed')));
          }
        },
        end: () => {}
      } as any;
      return req;
    });

    await expect(cm.download({ hostname: '1.2.3.4', port: 80, path: '/', method: 'GET' }, '/tmp/errfile')).rejects.toThrow('Request failed');
  });
});
