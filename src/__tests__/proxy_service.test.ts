import { CacheManager } from '../cache_manager';
import { HttpProxyService } from '../proxy_service';

describe('HttpProxyService', () => {
  const hostsEnv = 'example.com,192.168.1.10';
  let cache: CacheManager;
  let service: HttpProxyService;

  beforeEach(() => {
    cache = new CacheManager(hostsEnv);
    service = new HttpProxyService(cache, hostsEnv);
  });

  it('should expose the same hostnames as the underlying CacheManager', () => {
    expect((service as any).hostnames).toEqual(cache.getHostnames());
  });
});
