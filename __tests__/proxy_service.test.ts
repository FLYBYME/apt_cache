import { HttpProxyService } from '../src/proxy_service';
import { CacheManager } from '../src/cache_manager';

describe('HttpProxyService', () => {
  it('creates handler function', () => {
    const cm = new CacheManager("");
    const service = new HttpProxyService(cm, "");
    const handler = service.createServerHandler();
    expect(typeof handler).toBe('function');
  });
});
