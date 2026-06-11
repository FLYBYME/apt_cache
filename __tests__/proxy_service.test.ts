import { HttpProxyService } from '../src/proxy_service';
import { CacheManager } from '../src/cache_manager';
import * as http from 'http';
import * as fs from 'fs-extra';

// Simple mock for request and response objects
function createReq(headers: any, url = '/path/file.deb', method = 'GET') {
  return { headers, url, method } as unknown as http.IncomingMessage;
}
function createRes() {
  const res: any = {};
  res.writeHead = jest.fn();
  res.end = jest.fn();
  return res;
}

jest.mock('fs-extra', () => {
  const actual = jest.requireActual('fs-extra');
  return {
    ...actual,
    stat: jest.fn()
  };
});

describe('HttpProxyService', () => {
  const hostsEnv = 'example.com,1.2.3.4!foo.bar,5.6.7.8';
  let cacheMgr: CacheManager;
  let proxySrv: HttpProxyService;

  beforeEach(() => {
    cacheMgr = new CacheManager(hostsEnv);
    proxySrv = new HttpProxyService(cacheMgr, hostsEnv);
  });

  test('ends response with host string when host not in mapping', () => {
    const req = createReq({ host: 'unknown.com' }, '/any/file');
    const res = createRes();
    const handler = proxySrv.createServerHandler();
    handler(req, res);
    expect(res.end).toHaveBeenCalledWith('unknown.com');
  });

  test('serves cached file when stat succeeds and shouldCache is true', done => {
    // Arrange
    const req = createReq({ host: 'example.com' }, '/folder/file.deb');
    const res = createRes();
    const statsMock = { size: 456 } as any;
    (fs.stat as jest.Mock).mockImplementation((_path, cb) => cb(null, statsMock));

    // Spy on cacheMgr.uploadFile to ensure it's called
    const uploadSpy = jest.spyOn(cacheMgr as any, 'uploadFile').mockImplementation(() => {});

    const handler = proxySrv.createServerHandler();
    handler(req, res);

    setImmediate(() => {
      expect(uploadSpy).toHaveBeenCalledWith(expect.any(String), statsMock, res);
      done();
    });
  });

  test('returns 503 if download already in progress', () => {
    const req = createReq({ host: 'example.com' }, '/folder/file.deb');
    const res = createRes();
    jest.spyOn(cacheMgr as any, 'isDownloading').mockReturnValue(true);

    const handler = proxySrv.createServerHandler();
    handler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(503);
    expect(res.end).toHaveBeenCalledWith('Content is currently being downloaded.');
  });
});
