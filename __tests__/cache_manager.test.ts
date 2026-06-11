import * as http from 'http';
import * as fs from 'fs';
import { CacheManager, HttpError } from '../src/cache_manager';
import { EventEmitter } from 'events';

// Mock the http module to control request/response behavior
jest.mock('http');
// @ts-ignore
const mockedHttp: any = (http as any);

function createMockWritable() {
    const stream = new EventEmitter();
    const chunks: Buffer[] = [];
    let finished = false;
    (stream as any).write = jest.fn((chunk: Buffer | string) => {
        if (finished) return false;
        chunks.push(Buffer.from(chunk));
        return true;
    });
    (stream as any).end = jest.fn(() => {
        finished = true;
        stream.emit('finish');
    });
    // close method to match fs.WriteStream API
    (stream as any).close = jest.fn((cb?: () => void) => {
        if (cb) cb();
    });
    return stream as any as fs.WriteStream;
}

// Mock fs.createWriteStream
jest.spyOn(fs, 'createWriteStream').mockImplementation((_path: any, _options?: any) => createMockWritable());

describe('CacheManager', () => {
  const hostsEnv = 'example.com,127.0.0.1!foo.bar,192.168.1.10';
  let manager: CacheManager;

  beforeEach(() => {
    mockedHttp.request.mockReset();
    manager = new CacheManager(hostsEnv);
  });

  test('constructor parses hosts correctly', () => {
    const hostnames = manager.getHostnames();
    expect(hostnames['example.com']).toBe('127.0.0.1');
    expect(hostnames['foo.bar']).toBe('192.168.1.10');
  });

  test('isDownloading returns false initially', () => {
    expect(manager.isDownloading('/tmp/file')).toBe(false);
  });

  test('download succeeds with matching content-length', async () => {
    const dest = '/tmp/file';
    const responseHeaders: http.IncomingMessage['headers'] = { 'content-length': '6' };
    const response = new EventEmitter();
    (response as any).headers = responseHeaders;

    mockedHttp.request.mockImplementation((options: any, cb: any) => {
      process.nextTick(() => cb(response));
      return new EventEmitter() as any;
    });

    // Simulate data emission after response
    const writable = fs.createWriteStream(dest);
    process.nextTick(() => {
      response.emit('data', Buffer.from('abcdef'));
      response.emit('end');
    });

    await expect(manager.download({ host: 'localhost' }, dest)).resolves.toBeUndefined();
  });

  test('download fails when content-length mismatch', async () => {
    const dest = '/tmp/file';
    const responseHeaders: http.IncomingMessage['headers'] = { 'content-length': '10' };
    const response = new EventEmitter();
    (response as any).headers = responseHeaders;

    mockedHttp.request.mockImplementation((options: any, cb: any) => {
      process.nextTick(() => cb(response));
      return new EventEmitter() as any;
    });

    const writable = fs.createWriteStream(dest);
    process.nextTick(() => {
      response.emit('data', Buffer.from('abc'));
      response.emit('end');
    });

    await expect(manager.download({ host: 'localhost' }, dest)).rejects.toThrow(HttpError);
  });

  test('download rejects on HTTP error event', async () => {
    const dest = '/tmp/file';
    mockedHttp.request.mockImplementation((options: any, cb: any) => {
      const req = new EventEmitter() as any;
      process.nextTick(() => {
        req.emit('error', new Error('connection failed'));
      });
      return req;
    });

    await expect(manager.download({ host: 'localhost' }, dest)).rejects.toThrow(HttpError);
  });

  test('uploadFile sets correct headers and streams file', () => {
    const source = '/tmp/file.txt';
    const stats: fs.Stats = { size: 11 } as any;
    const resMock: http.ServerResponse = {
      writeHead: jest.fn(),
      end: jest.fn()
    } as any;

    const readStream = new EventEmitter();
    (readStream as any).pipe = jest.fn(() => resMock);
    jest.spyOn(fs, 'createReadStream').mockImplementation((_path) => readStream as any);

    manager.uploadFile(source, stats, resMock);
    expect(resMock.writeHead).toHaveBeenCalledWith(200, {
      "content-length": 11,
      "content-type": 'text/plain'
    });
    expect((readStream as any).pipe).toHaveBeenCalledWith(resMock);
  });

  test('cacheResource stores buffer and removes after timeout', () => {
    const key = '/tmp/key';
    const buf = Buffer.from('data');
    jest.useFakeTimers();
    manager.cacheResource(key, buf);
    expect(manager.getCachedContent(key)).toEqual(buf);
    jest.advanceTimersByTime(61 * 1000);
    expect(manager.getCachedContent(key)).toBeUndefined();
    jest.useRealTimers();
  });
});
