import * as http from 'http';
import * as fs from 'fs'; // will be mocked
import { CacheManager, HttpError } from '../src/cache_manager';
import { Readable, Writable } from 'stream';
import { EventEmitter } from 'events';

// Mock the entire 'fs' module to provide custom implementations for methods used by CacheManager.
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  createWriteStream: jest.fn(),
  unlink: jest.fn(),
  createReadStream: jest.fn()
}));
const mockFs = fs as jest.Mocked<typeof import('fs')>;

// A simple in-memory writable stream that records chunks and emits finish.
function createMockWritable(): Writable {
  const writable = new Writable({ write(chunk, encoding, callback) { (this as any).chunks.push(Buffer.from(chunk)); callback(); } });
  (writable as any).chunks = [];
  // Provide close method expected by CacheManager
  (writable as any).close = (cb: (err?: Error | null)=>() => void) => { cb(); };
  writable.on('finish', () => { (writable as any).finished = true; });
  return writable;
}

// Custom response class to handle piping and data listeners.
class MockResponse extends EventEmitter {
  chunks: Buffer[];
  headers: any;
  constructor(chunks: Buffer[], headers?: any) {
    super();
    this.chunks = chunks || [];
    if (headers) this.headers = headers;
  }
  on(event: string, listener: any): this {
    if (event === 'data') {
      this.chunks.forEach(chunk => listener(chunk));
      return this;
    } else {
      return super.on(event, listener);
    }
  }
  pipe(target: any) {
    this.chunks.forEach(chunk => target.write(chunk));
    target.end();
    // Emit end to signal completion for tests
    process.nextTick(() => this.emit('end'));
    return target;
  }
}

function createMockReadable(headers: http.IncomingMessage['headers'], dataChunks?: Buffer[]): Readable {
  const resp = new MockResponse(dataChunks || [], headers);
  return resp as any;
}

// Mock the 'http' module; we will use its mocked request method.
jest.mock('http');
const mockedHttp = http as jest.Mocked<typeof import('http')>;

describe('CacheManager', () => {
  const hostsEnv = 'example.com,127.0.0.1!foo.bar,192.168.1.10';
  let manager: CacheManager;

  beforeEach(() => {
    mockedHttp.request.mockReset();
    mockFs.createWriteStream.mockClear();
    mockFs.unlink.mockClear();
    mockFs.createReadStream.mockClear();
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
    const headers: http.IncomingMessage['headers'] = { 'content-length': '6' };
    const response = createMockReadable(headers, [Buffer.from('abcdef')]);

    mockedHttp.request.mockImplementation((options, cb) => {
      const req = new (require('events').EventEmitter)();
      process.nextTick(() => cb(response));
      // end method needed by download()
      (req as any).end = jest.fn();
      return req as any;
    });

    // Stub file write stream and unlink
    const mockWriteStream = createMockWritable();
    mockFs.createWriteStream.mockReturnValue(mockWriteStream as any);
    const unlinkSpy = jest.fn();
    mockFs.unlink.mockImplementation(unlinkSpy as any);

    await expect(manager.download({ host: 'localhost' } as any, dest)).resolves.toBeUndefined();
    expect((mockWriteStream as any).finished).toBe(true);
    expect(unlinkSpy).not.toHaveBeenCalled();
  });

  test('download fails when content-length mismatch', async () => {
    const dest = '/tmp/file';
    const headers: http.IncomingMessage['headers'] = { 'content-length': '10' };
    const response = createMockReadable(headers, [Buffer.from('abc')]);

    mockedHttp.request.mockImplementation((options, cb) => {
      const req = new (require('events').EventEmitter)();
      process.nextTick(() => cb(response));
      // end method needed by download()
      (req as any).end = jest.fn();
      return req as any;
    });

    mockFs.createWriteStream.mockReturnValue(createMockWritable() as any);
    const unlinkSpy = jest.fn();
    mockFs.unlink.mockImplementation(unlinkSpy as any);

    await expect(manager.download({ host: 'localhost' } as any, dest)).rejects.toThrow(HttpError);
    expect(unlinkSpy).toHaveBeenCalled();
  });

  test('download rejects on HTTP error event', async () => {
    const dest = '/tmp/file';

    mockedHttp.request.mockImplementation((options, cb) => {
      const req = new (require('events').EventEmitter)();
      process.nextTick(() => req.emit('error', new Error('connection failed')));
      // end method needed by download()
      (req as any).end = jest.fn();
      return req as any;
    });

    // Provide a mock write stream to avoid errors on fileWriteStream.end()
    mockFs.createWriteStream.mockReturnValue(createMockWritable() as any);

    await expect(manager.download({ host: 'localhost' } as any, dest)).rejects.toThrow(HttpError);
  });

  test('uploadFile sets correct headers and streams file', () => {
    const source = '/tmp/file.txt';
    const stats: fs.Stats = { size: 11 } as any;
    const resMock: http.ServerResponse = {
      writeHead: jest.fn(),
      end: jest.fn()
    } as any;

    // Mock read stream that pipes to response
    const readStream = new Readable({ read() {} });
    (readStream as any).pipe = jest.fn(() => resMock);
    mockFs.createReadStream.mockReturnValue(readStream as any);

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