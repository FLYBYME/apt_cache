import * as http from 'http';
import * as fsExtra from 'fs-extra'; // will be mocked
import { HttpProxyService } from '../src/proxy_service';
import { CacheManager } from '../src/cache_manager';
import { Readable } from 'stream';
import { EventEmitter } from 'events';

// Mock the 'fs-extra' module to provide a mock implementation for stat.
jest.mock('fs-extra', () => ({
  ...jest.requireActual('fs-extra'),
  stat: jest.fn(),
}));
const mockFsExtra = fsExtra as jest.Mocked<typeof import('fs-extra')>;

// Mock the 'http' module; we will use its mocked request method.
jest.mock('http');
const mockedHttp = http as jest.Mocked<typeof import('http')>;

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
      // data listeners are handled by pipe
      return this;
    } else {
      return super.on(event, listener);
    }
  }
  pipe(target: any) {
    this.chunks.forEach(chunk => target.write(chunk));
    target.end();
    return target;
  }
}

function createMockReadable(headers: http.IncomingMessage['headers'], dataChunks?: Buffer[]): Readable {
  const resp = new MockResponse(dataChunks || [], headers);
  return resp as any;
}

describe('HttpProxyService caching logic', () => {
  const hostEnv = 'example.com,127.0.0.1';
  let cacheManager: CacheManager;
  let service: HttpProxyService;
  let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  beforeEach(() => {
    mockedHttp.request.mockReset();
    mockFsExtra.stat.mockClear();
    cacheManager = new CacheManager(hostEnv);
    service = new HttpProxyService(cacheManager);
    handler = service.createServerHandler();
  });

  test('returns 503 when download in progress', () => {
    const req = { url: '/file.deb', headers: { host: 'example.com' } } as any;
    const res = { writeHead: jest.fn(), end: jest.fn() } as any;

    // Mock isDownloading to return true
    jest.spyOn(cacheManager, 'isDownloading').mockReturnValue(true);

    handler(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(503);
    expect(res.end).toHaveBeenCalledWith('Content is currently being downloaded.');
  });

  test('downloads and serves file when not cached', async () => {
    const req = { url: '/file.deb', headers: { host: 'example.com' } } as any;
    const res = { writeHead: jest.fn(), end: jest.fn() } as any;

    // isDownloading returns false
    jest.spyOn(cacheManager, 'isDownloading').mockReturnValue(false);
    // download resolves
    jest.spyOn(cacheManager, 'download').mockResolvedValue();
    // uploadFile is a no-op
    jest.spyOn(cacheManager, 'uploadFile').mockImplementation(() => {});

    // First stat call errors -> trigger download
    mockFsExtra.stat.mockImplementationOnce((p, cb) => {
      cb(new Error('not found'), null as any);
    });
    // After download, second stat returns stats
    mockFsExtra.stat.mockImplementationOnce((p, cb) => {
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
    service = new HttpProxyService(cacheManager);
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