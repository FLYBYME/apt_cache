import { isDownloading, upload, download } from './download';
import * as fs from 'fs';
import * as http from 'http';
import * as mime from 'mime';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';

jest.mock('fs');
jest.mock('mime');
jest.mock('http');
jest.mock('crypto');

describe('Download Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isDownloading', () => {
    it('should return false if not downloading', () => {
      expect(isDownloading('some-file')).toBe(false);
    });

    it('should return true and queue callback if downloading', () => {
      const dest = 'concurrent-file';
      const cb1 = jest.fn();
      const cb2 = jest.fn();
      
      // Manually trigger download start (tricky because downloading is internal)
      // Instead, we call download which sets it up
      const mockReq = new EventEmitter() as any;
      mockReq.end = jest.fn();
      (http.request as jest.Mock).mockReturnValue(mockReq);
      (fs.createWriteStream as jest.Mock).mockReturnValue(new EventEmitter());

      download({}, dest, cb1);
      
      expect(isDownloading(dest, cb2)).toBe(true);
      // cb2 should be in the queue but not called yet
      expect(cb2).not.toHaveBeenCalled();
    });

    it('should handle isDownloading call without callback', () => {
      const dest = 'concurrent-file-no-cb';
      const mockReq = new EventEmitter() as any;
      mockReq.end = jest.fn();
      (http.request as jest.Mock).mockReturnValue(mockReq);
      (fs.createWriteStream as jest.Mock).mockReturnValue(new EventEmitter());

      download({}, dest, jest.fn());
      
      expect(isDownloading(dest)).toBe(true);
    });
  });

  describe('upload', () => {
    let mockResponse: any;
    let mockReadStream: any;

    beforeEach(() => {
      mockReadStream = {
        pipe: jest.fn(),
      };
      (fs.createReadStream as jest.Mock).mockReturnValue(mockReadStream);
      (mime.getType as jest.Mock).mockReturnValue('application/debian');

      mockResponse = {
        writeHead: jest.fn(),
      };
    });

    it('should upload a file with correct headers', () => {
      const source = 'test.deb';
      const stats = { size: 1024 } as fs.Stats;

      upload(source, stats, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'content-length': 1024,
        'content-type': 'application/debian',
      });
      expect(fs.createReadStream).toHaveBeenCalledWith(source);
      expect(mockReadStream.pipe).toHaveBeenCalledWith(mockResponse);
    });

    it('should default to application/octet-stream if mime.getType returns null', () => {
      (mime.getType as jest.Mock).mockReturnValue(null);
      const source = 'test.unknown';
      const stats = { size: 512 } as fs.Stats;

      upload(source, stats, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'content-length': 512,
        'content-type': 'application/octet-stream',
      });
    });
  });

  describe('download', () => {
    let mockReq: any;
    let mockRes: any;
    let mockFile: any;
    let mockHash: any;

    beforeEach(() => {
      mockReq = new EventEmitter();
      mockReq.end = jest.fn();
      (http.request as jest.Mock).mockReturnValue(mockReq);

      mockRes = new EventEmitter();
      mockRes.headers = { 'content-length': '100' };
      mockRes.pipe = jest.fn().mockReturnValue(mockRes);

      mockFile = new EventEmitter();
      mockFile.close = jest.fn((cb) => cb());
      (fs.createWriteStream as jest.Mock).mockReturnValue(mockFile);

      mockHash = {
        setEncoding: jest.fn(),
        end: jest.fn(),
      };
      (crypto.createHash as jest.Mock).mockReturnValue(mockHash);
      
      jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      (console.log as jest.Mock).mockRestore();
      jest.clearAllMocks();
    });

    it('should download a file successfully', (done) => {
      const dest = 'success.deb';
      const cb = (err?: any) => {
        expect(err).toBeUndefined();
        done();
      };

      download({}, dest, cb);

      // Simulate http response
      const requestCallback = (http.request as jest.Mock).mock.calls[0][1];
      requestCallback(mockRes);

      // Simulate data chunks
      mockRes.emit('data', Buffer.alloc(100));
      
      // Simulate file finish
      mockFile.emit('finish');
    });

    it('should handle length mismatch error', (done) => {
      const dest = 'error.deb';
      const cb = (err?: any) => {
        expect(err).toBeDefined();
        expect(err.message).toBe('length error');
        expect(fs.unlink).toHaveBeenCalledWith(dest, expect.any(Function));
        
        // Also verify the unlink callback doesn't throw
        const unlinkCb = (fs.unlink as unknown as jest.Mock).mock.calls[0][1];
        expect(() => unlinkCb(new Error('unlink error'))).not.toThrow();
        
        done();
      };

      download({}, dest, cb);

      const requestCallback = (http.request as jest.Mock).mock.calls[0][1];
      requestCallback(mockRes);

      // Simulate wrong data length
      mockRes.emit('data', Buffer.alloc(50));
      
      mockFile.emit('finish');
    });

    it('should handle request error', (done) => {
      const dest = 'req-error.deb';
      const cb = (err?: any) => {
        expect(err).toBe('Connection failed');
        expect(fs.unlink).toHaveBeenCalledWith(dest, expect.any(Function));
        done();
      };

      download({}, dest, cb);

      mockReq.emit('error', new Error('Connection failed'));
    });
  });
});
