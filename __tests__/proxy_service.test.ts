// @ts-nocheck
import * as http from 'http';
import * as fs from 'fs-extra';
import { HttpProxyService } from '../src/proxy_service';
import { CacheManager } from '../src/cache_manager';
import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import { HttpProxyService } from '../src/proxy_service';
import { CacheManager } from '../src/cache_manager';
import { EventEmitter } from 'events';

jest.mock('http');
const mockedHttp = http as jest.Mocked<typeof http>;
jest.mock('fs-extra');
const mockedFs = fs as jest.Mocked<typeof fs>;

function createMockResponse(headers: http.IncomingMessage['headers'], dataChunks?: Buffer[]): EventEmitter {
    const resp = new EventEmitter();
    (resp as any).headers = headers;
    if (dataChunks) {
        process.nextTick(() => {
            dataChunks.forEach(chunk => resp.emit('data', chunk));
            resp.emit('end');
        });
    }
    // provide pipe method to satisfy _res.pipe(res)
    (resp as any).pipe = jest.fn(() => resp);
    return resp;
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
        const req = new EventEmitter() as any;
        (req as any).url = '/file.deb';
        (req as any).headers = { host: 'example.com' };
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
        const req = new EventEmitter() as any;
        (req as any).url = '/file.deb';
        (req as any).headers = { host: 'example.com' };
        const res = {
            writeHead: jest.fn(),
            end: jest.fn()
        } as any;

        jest.spyOn(cacheManager, 'isDownloading').mockReturnValue(false);
        const mockDownload = jest.spyOn(cacheManager, 'download').mockResolvedValue();

        mockedFs.stat.mockImplementationOnce((path, cb) => {
            cb(new Error('not found'), null as any);
        });
        const fakeStats = { size: 123 } as any;
        mockedFs.stat.mockImplementationOnce((path, cb) => {
            cb(null, fakeStats);
        });

        jest.spyOn(cacheManager, 'uploadFile').mockImplementation(() => {});

        await new Promise<void>(resolve => setTimeout(resolve, 10));
        handler(req as http.IncomingMessage, res as http.ServerResponse);
        expect(mockDownload).toHaveBeenCalled();
    });

    test('serves cached file without download', async () => {
        const req = new EventEmitter() as any;
        (req as any).url = '/file.deb';
        (req as any).headers = { host: 'example.com' };
        const res = {
            writeHead: jest.fn(),
            end: jest.fn()
        } as any;

        jest.spyOn(cacheManager, 'isDownloading').mockReturnValue(false);

        const fakeStats = { size: 456 } as any;
        mockedFs.stat.mockImplementationOnce((path, cb) => {
            cb(null, fakeStats);
        });

        jest.spyOn(cacheManager, 'uploadFile').mockImplementation(() => {});
        await new Promise<void>(resolve => setTimeout(resolve, 10));
        handler(req as http.IncomingMessage, res as http.ServerResponse);
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
        const req = new EventEmitter() as any;
        (req as any).url = '/index.html';
        (req as any).headers = { host: 'example.com' };
        const res = {
            writeHead: jest.fn(),
            end: jest.fn()
        } as any;

        mockedHttp.request.mockImplementation((options, cb) => {
            const resp = createMockResponse({ 'content-type': 'text/html' }, [Buffer.from('<html>')]);
            process.nextTick(() => cb(resp));
            const reqInstance = new EventEmitter() as any;
                    (reqInstance as any).end = jest.fn();
        return reqInstance;
        });

        await new Promise<void>(resolve => setTimeout(resolve, 10));
        handler(req as http.IncomingMessage, res as http.ServerResponse);
        expect(mockedHttp.request).toHaveBeenCalled();
        expect(res.writeHead).toHaveBeenCalledWith(200, { 'content-type': 'text/html' });
    });
});
