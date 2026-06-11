import * as http from 'http';
import * as fsExtra from 'fs-extra';
import { HttpProxyService } from '../src/proxy_service';
import { CacheManager } from '../src/cache_manager';
import { Readable, Writable } from 'stream';

jest.mock('http');
const mockedHttp = http as jest.Mocked<typeof http>;
jest.mock('fs-extra');
const mockedFs = fsExtra as jest.Mocked<typeof fsExtra>;

function createMockReadable(headers: http.IncomingMessage['headers'], dataChunks?: Buffer[]): Readable {
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
    const req = { url: '/file.deb', headers: { host: 'example.com' } } as any;
    const res = { writeHead: jest.fn(), end: jest.fn() } as any;

    jest.spyOn(cacheManager, 'isDownloading').mockReturnValue(true);

    handler(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(503);
    expect(res.end).toHaveBeenCalledWith('Content is currently being downloaded.');
  });

  test('downloads and serves file when not cached', () => {
    const req = { url: '/file.deb', headers: { host: 'example.com' } } as any;
    const res = { writeHead: jest.fn(), end: jest.fn() } as any;

    jest.spyOn(cacheManager, 'isDownloading').mockReturnValue(false);
    jest.spyOn(cacheManager, 'download').mockResolvedValue();
    jest.spyOn(cacheManager, 'uploadFile').mockImplementation(() => {});

    // First stat call errors -> trigger download
    mockedFs.stat.mockImplementationOnce((p, cb) => {
      cb(new Error('not found'), null as any);
    });
    // After download, second stat returns stats
    mockedFs.stat.mockImplementationOnce((p, cb) => {
      cb(null, { size: 123 } as any);
    });

    handler(req, res);
    expect(cacheManager.download).toHaveBeenCalled();
    expect(cacheManager.uploadFile).toHaveBeenCalled();
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

  test('proxies non-cacheable request', () => {
    const req = { url: '/index.html', headers: { host: 'example.com' } } as any;
    const res = { writeHead: jest.fn(), end: jest.fn() } as any;

    mockedHttp.request.mockImplementation((options, cb) => {
      const response = createMockReadable({ 'content-type': 'text/html' }, [Buffer.from('<html>')]);
      process.nextTick(() => cb(response));
      return { once: jest.fn(), end: jest.fn() } as any;
    });

    handler(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(200, { 'content-type': 'text/html' });
  });
});
