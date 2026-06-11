import { CacheManager } from '../cache_manager';

describe('CacheManager', () => {
  const hostsEnv = 'example.com,192.168.1.10!another.com,127.0.0.1';
  let manager: CacheManager;

  beforeEach(() => {
    manager = new CacheManager(hostsEnv);
  });

  it('should parse hostnames correctly', () => {
    const map = manager.getHostnames();
    expect(map['example.com']).toBe('192.168.1.10');
    expect(map['another.com']).toBe('127.0.0.1');
  });

  it('should not report downloading before any download', () => {
    const dest = '/tmp/testfile';
    expect(manager.isDownloading(dest)).toBe(false);
  });

  // Additional tests to cover cache resource handling
  const os = require('os');

  it('should cache and retrieve content correctly', () => {
    const key = 'test-key';
    const data = Buffer.from('Hello, World!');
    manager.cacheResource(key, data);
    const retrieved = manager.getCachedContent(key);
    expect(retrieved).toEqual(data);
  });
});