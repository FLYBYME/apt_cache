import * as http from 'http';
import * as fs from 'fs-extra';
import { HttpProxyService } from '../src/proxy_service';
import { CacheManager } from '../src/cache_manager';
import { Readable, Writable } from 'stream';

jest.mock('http');
const mockedHttp = http as jest.Mocked<typeof http>;
jest.mock('fs-extra');
const mockedFs = fs as jest.Mocked<typeof fs>;

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

function createMockWritable(): Writable {
    const writable = new Writable({ write(chunk, encoding, callback) { callback(); }});
    (writable as any).chunks: Buffer[] = [];
    writable.on('finish', () => {} );
    return writable;
}

describe('HttpProxyService caching logic', () => {
  const hostEnv = 'example.com,127.0.0.1';
  let cacheManager: CacheManager;
  let service: HttpProxyService;
  let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  beforeEach(() => {
    mockedHttp.request.mockReset();
    mockedFs.stat.mockReset();
    cacheManager = new CacheManager(hostEnv);
    service = new HttpProxyService(cacheManager, hostEnv);
    handler = service.createServerHandler();
  });

  test('returns 503 when download in progress', () => {
    const req = new (require('events').EventEmitter)() as any;
    req.url = '/file.deb';
    req.headers = { host: 'example.com' };
    const res = {
      writeHead: jest.fn(),
      end: jest.fn()
    } as any;

    jest.spyOn(cacheManager, 'isDownloading').mockReturnValue(true);

    handler(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(503);
    expect(res.end).toHaveBeenCalledWith('Content is currently being downloaded.');
  });

  test('downloads and serves file when not cached', async () => {
    const req = new (require('events').EventEmitter)() as any;
    req.url = '/file.deb';
    req.headers = { host: 'example.com' };
    const res = {
      writeHead: jest.fn(),
      end: jest.fn()
    } as any;

    jest.spyOn(cacheManager, 'isDownloading').mockReturnValue(false);

    // Mock stat to error -> trigger download
    mockedFs.stat.mockImplementationOnce((p, cb) => {
      cb(new Error('not found'), null as any);
    });

    // Mock download to resolve immediately
    const mockDownload = jest.spyOn(cacheManager, 'download').mockResolvedValue();

    // After download, stat returns stats and uploadFile called
    mockedFs.stat.mockImplementationOnce((p, cb) => {
      cb(null, { size: 123 } as any);
    });

    jest.spyOn(cacheManager, 'uploadFile').mockImplementation(() => {});

    // Invoke handler asynchronously to allow promises
    await new Promise<void>(resolve => setImmediate(resolve));
    handler(req, res);
    await new Promise(r => setTimeout(r, 10));
    expect(mockDownload).toHaveBeenCalled();
  });
});

describe('HttpProxyService proxy logic', () => {
  const hostEnv = 'example.com,127.0.0.1';
  let cacheManager: CacheManager;
  let service: HttpProxyService;
  let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  beforeEach(() => {
    mockedHttp.request.mockReset();
    cacheManager = new CacheManager(hostEnv);
    service = new HttpProxyService(cacheManager, hostEnv);
    handler = service.createServerHandler();
  });

  test('proxies non-cacheable request', async () => {
    const req = new (require('events').EventEmitter)() as any;
    req.url = '/index.html';
    req.headers = { host: 'example.com' };
    const res = {
      writeHead: jest.fn(),
      end: jest.fn()
    } as any;

    const reqInstance = new (require('events').EventEmitter)();
            reqInstance.once = jest.fn().mockImplementation((event, cb) => {cb(); return reqInstance;});
            reqInstance.end = jest.fn();
            return reqInstance;
        });
      const resp = createMockResponse({ 'content-type': 'text/html' }, [Buffer.from('<html>')]);
      process.nextTick(() => cb(resp));
      return new (require('events').EventEmitter)();
    });

    handler(req, res);
    await new Promise(r => setImmediate(r));
    expect(res.writeHead).toHaveBeenCalledWith(200, { 'content-type': 'text/html' });
  });
});
