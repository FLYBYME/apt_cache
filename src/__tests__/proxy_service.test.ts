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

  it('should end with host string if host not mapped', () => {
    const req: any = { url: '/test', headers: { host: 'unknown.com' } };
    const res: any = { end: jest.fn() };
    const handler = service.createServerHandler();
    handler(req, res);
    expect(res.end).toHaveBeenCalledWith('unknown.com');
  });
});
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
