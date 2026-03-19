import * as http from 'http';
import { proxy } from './server';
import { config } from './server/config';
import { responseCache } from './server/cache';
import * as downloadModule from './server/download';
import * as fs from 'fs';
import * as fse from 'fs-extra';
import { EventEmitter } from 'events';

jest.mock('./server/config', () => ({
  config: {
    hostnames: { 'debian.org': '10.0.0.1' },
    port: 9080,
    baseDir: '/tmp/cache',
    cacheExtensions: ['.deb'],
  }
}));

jest.mock('./server/cache');
jest.mock('./server/download');
jest.mock('fs');
jest.mock('fs-extra');
jest.mock('http', () => {
  const original = jest.requireActual('http');
  return {
    ...original,
    request: jest.fn(),
  };
});

describe('Server Integration', () => {
  let mockReq: any;
  let mockRes: any;

  beforeEach(() => {
    mockReq = new EventEmitter();
    mockReq.headers = { host: 'debian.org' };
    mockReq.url = '/debian/pool/main/a/abc.deb';
    mockReq.method = 'GET';

    mockRes = new EventEmitter();
    mockRes.writeHead = jest.fn();
    mockRes.end = jest.fn();
    mockRes.headersSent = false;
    
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    (console.log as jest.Mock).mockRestore();
    (console.error as jest.Mock).mockRestore();
    jest.clearAllMocks();
  });

  afterAll((done) => {
    if (proxy && proxy.listening) {
      proxy.close(done);
    } else {
      done();
    }
  });

  it('should return host if hostname is not in config', () => {
    mockReq.headers.host = 'unknown.org';
    proxy.emit('request', mockReq, mockRes);
    expect(mockRes.end).toHaveBeenCalledWith('unknown.org');
  });

  it('should handle disk cache hit', () => {
    const stats = { size: 1024 } as fs.Stats;
    (fs.stat as unknown as jest.Mock).mockImplementation((path, cb) => cb(null, stats));
    
    proxy.emit('request', mockReq, mockRes);
    
    expect(fs.stat).toHaveBeenCalled();
    expect(downloadModule.upload).toHaveBeenCalled();
  });

  it('should handle disk cache miss and download', () => {
    (fs.stat as unknown as jest.Mock).mockImplementation((path, cb) => cb(new Error('ENOENT')));
    (fse.ensureDir as unknown as jest.Mock).mockImplementation((path, cb) => cb(null));
    
    proxy.emit('request', mockReq, mockRes);
    
    expect(fse.ensureDir).toHaveBeenCalled();
    expect(downloadModule.download).toHaveBeenCalled();
  });

  it('should skip download if already downloading', () => {
    (fs.stat as unknown as jest.Mock).mockImplementation((path, cb) => cb(new Error('ENOENT')));
    (fse.ensureDir as unknown as jest.Mock).mockImplementation((path, cb) => cb(null));
    (downloadModule.isDownloading as jest.Mock).mockReturnValue(true);
    
    proxy.emit('request', mockReq, mockRes);
    
    expect(downloadModule.isDownloading).toHaveBeenCalled();
    expect(fse.ensureDir).not.toHaveBeenCalled();
  });

  it('should handle in-memory cache hit', () => {
    mockReq.url = '/debian/dists/stable/Release';
    const cachedResponse = {
      content: Buffer.from('release content'),
      headers: { 'content-type': 'text/plain' },
      statusCode: 200,
    };
    (responseCache.get as jest.Mock).mockReturnValue(cachedResponse);
    
    proxy.emit('request', mockReq, mockRes);
    
    expect(mockRes.writeHead).toHaveBeenCalledWith(200, cachedResponse.headers);
    expect(mockRes.end).toHaveBeenCalledWith(cachedResponse.content);
  });

  it('should handle in-memory cache miss and fetch', () => {
    mockReq.url = '/debian/dists/stable/Release';
    (responseCache.get as jest.Mock).mockReturnValue(undefined);
    
    const mockClientReq = new EventEmitter() as any;
    mockClientReq.end = jest.fn();
    (http.request as jest.Mock).mockReturnValue(mockClientReq);
    
    proxy.emit('request', mockReq, mockRes);
    
    expect(http.request).toHaveBeenCalled();
    expect(mockClientReq.end).toHaveBeenCalled();
    
    // Simulate http response
    const requestCallback = (http.request as jest.Mock).mock.calls[0][1];
    const mockIncomingMsg = new EventEmitter() as any;
    mockIncomingMsg.statusCode = 200;
    mockIncomingMsg.headers = { 'content-type': 'text/plain' };
    requestCallback(mockIncomingMsg);
    
    mockIncomingMsg.emit('data', Buffer.from('new release content'));
    mockIncomingMsg.emit('end');
    
    expect(responseCache.set).toHaveBeenCalled();
    expect(mockRes.writeHead).toHaveBeenCalledWith(200, mockIncomingMsg.headers);
    expect(mockRes.end).toHaveBeenCalledWith(Buffer.from('new release content'));
  });

  it('should handle default proxy behavior without caching', () => {
    mockReq.url = '/some/other/file.txt'; // not in cacheExtensions or memory cache
    
    const mockClientReq = new EventEmitter() as any;
    mockClientReq.end = jest.fn();
    (http.request as jest.Mock).mockReturnValue(mockClientReq);
    
    proxy.emit('request', mockReq, mockRes);
    
    expect(http.request).toHaveBeenCalled();
    expect(mockClientReq.end).toHaveBeenCalled();
    
    // Simulate http response
    const requestCallback = (http.request as jest.Mock).mock.calls[0][1];
    const mockIncomingMsg = new EventEmitter() as any;
    mockIncomingMsg.statusCode = 200;
    mockIncomingMsg.headers = { 'content-type': 'text/plain' };
    mockIncomingMsg.pipe = jest.fn();
    requestCallback(mockIncomingMsg);
    
    expect(mockRes.writeHead).toHaveBeenCalledWith(200, mockIncomingMsg.headers);
    expect(mockIncomingMsg.pipe).toHaveBeenCalledWith(mockRes);
  });
});
