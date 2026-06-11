import * as http from 'http';
import * as fs from 'fs';
import { CacheManager, HttpError } from '../src/cache_manager';
import { Readable, Writable } from 'stream';

// Mock the http module to control request/response behavior
jest.mock('http');
const mockedHttp = http as jest.Mocked<typeof http>;

function createMockResponse(headers: http.IncomingMessage['headers'], dataChunks?: Buffer[]): Readable {
    const stream = new Readable({ read() {} });
    (stream as any).headers = headers;
    if (dataChunks) {
        process.nextTick(() => {
            dataChunks.forEach(chunk => stream.push(chunk));
            stream.push(null);
        });
    }
    return stream;
}

function createMockWritable(): Writable & { finished: boolean } {
    const writable = new Writable({ write(chunk, encoding, callback) {
        this.chunks.push(Buffer.from(chunk));
        callback();
    }} as any);
    (writable as any).chunks = [];
    (writable as any).finished = false;
    writable.on('finish', () => { (writable as any).finished = true; });
    return writable as Writable & { finished: boolean };
}

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
    const resp = createMockResponse(responseHeaders, [Buffer.from('abcdef')]);

    mockedHttp.request.mockImplementation((options, cb) => {
      process.nextTick(() => cb(resp));
      const req = new (require('events').EventEmitter)();
            req.end = jest.fn();
            return req;
        }); // request object
    });

    await expect(manager.download({ host: 'localhost' }, dest)).resolves.toBeUndefined();
  });

  test('download fails when content-length mismatch', async () => {
    const dest = '/tmp/file';
    const responseHeaders: http.IncomingMessage['headers'] = { 'content-length': '10' };
    const resp = createMockResponse(responseHeaders, [Buffer.from('abc')]);

    mockedHttp.request.mockImplementation((options, cb) => {
      process.nextTick(() => cb(resp));
      const req = new (require('events').EventEmitter)();
            req.end = jest.fn();
            return req;
        });
    });

    await expect(manager.download({ host: 'localhost' }, dest)).rejects.toThrow(HttpError);
  });

  test('download rejects on HTTP error event', async () => {
    const dest = '/tmp/file';
    mockedHttp.request.mockImplementation((options, cb) => {
      const req = new (require('events').EventEmitter)();
      process.nextTick(() => req.emit('error', new Error('connection failed')));
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

    // Mock read stream
    const readStream = new Readable({ read() {} });
    readStream.pipe = jest.fn(() => resMock);
    (fs as any).createReadStream = jest.fn(() => readStream);

    manager.uploadFile(source, stats, resMock);
    expect(resMock.writeHead).toHaveBeenCalledWith(200, {
      "content-length": 11,
      "content-type": 'text/plain'
    });
    expect(readStream.pipe).toHaveBeenCalledWith(resMock);
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
