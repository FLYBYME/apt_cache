import { CacheManager } from '../src/cache_manager';

describe('CacheManager', () => {
  it('parses host mappings correctly', () => {
    const cm = new CacheManager('example.com,192.168.1.10!another.com,10.0.0.5');
    expect(cm.getHostnames()).toEqual({
      'example.com': '192.168.1.10',
      'another.com': '10.0.0.5'
    });
  });

  it('isDownloading initially false for unknown destination', () => {
    const cm = new CacheManager("");
    expect(cm.isDownloading('/tmp/nonexistent')).toBe(false);
  });
});
