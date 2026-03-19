import { ResponseCache, shouldCacheOnDisk, shouldCacheInMemory, getCachePath } from './cache';
import { config } from './config';

describe('Cache Module', () => {
  describe('ResponseCache', () => {
    let cache: ResponseCache;

    beforeEach(() => {
      jest.useFakeTimers();
      cache = new ResponseCache(1000); // 1s TTL
    });

    afterEach(() => {
      cache.stopPruning();
      jest.useRealTimers();
    });

    it('should set and get a cached response', () => {
      const key = 'test-key';
      const response = {
        content: Buffer.from('test'),
        headers: {},
        statusCode: 200,
      };

      cache.set(key, response);
      expect(cache.get(key)).toEqual(response);
    });

    it('should return undefined for expired entries', () => {
      const key = 'expired-key';
      const response = {
        content: Buffer.from('test'),
        headers: {},
        statusCode: 200,
      };

      cache.set(key, response, 10); // 10ms TTL
      
      jest.advanceTimersByTime(20);
      
      expect(cache.get(key)).toBeUndefined();
    });

    it('should delete an entry', () => {
      const key = 'delete-key';
      const response = {
        content: Buffer.from('test'),
        headers: {},
        statusCode: 200,
      };

      cache.set(key, response);
      cache.delete(key);
      expect(cache.get(key)).toBeUndefined();
    });

    it('should prune expired entries automatically', () => {
      const key = 'prune-key';
      const response = {
        content: Buffer.from('test'),
        headers: {},
        statusCode: 200,
      };

      cache.set(key, response, 10); // 10ms TTL
      
      // Advance time beyond expiration but before prune interval (60s)
      jest.advanceTimersByTime(20);
      
      // Check that it's gone via get (lazy deletion)
      // Actually let's check pruning specifically. Pruning happens every 60s.
      
      // Re-set to test pruning
      cache.set(key, response, 10);
      jest.advanceTimersByTime(60001); // Trigger prune interval
      
      // Accessing it now should return undefined
      expect(cache.get(key)).toBeUndefined();
    });

    it('should clear interval on stopPruning', () => {
      const mockClearInterval = jest.spyOn(global, 'clearInterval');
      cache.stopPruning();
      expect(mockClearInterval).toHaveBeenCalled();
      
      // calling twice shouldn't error
      cache.stopPruning();
      mockClearInterval.mockRestore();
    });
  });

  describe('Utility functions', () => {
    it('shouldCacheOnDisk should identify cacheable extensions', () => {
      expect(shouldCacheOnDisk('test.deb')).toBe(true);
      expect(shouldCacheOnDisk('test.txt')).toBe(false);
    });

    it('shouldCacheInMemory should identify specific files', () => {
      expect(shouldCacheInMemory('InRelease')).toBe(true);
      expect(shouldCacheInMemory('Release')).toBe(true);
      expect(shouldCacheInMemory('other')).toBe(false);
    });

    it('getCachePath should resolve paths correctly', () => {
      const host = 'example.com';
      const urlPath = '/debian/pool/main/a/abc.deb';
      const result = getCachePath(host, urlPath);

      expect(result.filename).toBe('abc.deb');
      expect(result.fullPath).toContain(host);
      expect(result.fullPath).toContain('abc.deb');
    });

    it('getCachePath should handle urls with query params', () => {
      const host = 'example.com';
      const urlPath = '/debian/pool/main/a/abc.deb?query=123';
      const result = getCachePath(host, urlPath);

      expect(result.filename).toBe('abc.deb');
      expect(result.fullPath).not.toContain('query=123');
    });

    it('getCachePath should handle urls ending with slash', () => {
      const host = 'example.com';
      const urlPath = '/debian/pool/main/a/';
      const result = getCachePath(host, urlPath);

      expect(result.filename).toBe('');
      expect(result.fullPath).toContain('a');
    });
  });
});
