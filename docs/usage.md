# Usage

The following sections provide hands‑on examples for the most common scenarios: starting a local proxy, configuring host mappings, inspecting cached content, and testing in isolation.

## 1. Starting the Proxy Server
Create a small entry script (e.g., `start.ts`).
```ts
import * as http from 'http';
import { CacheManager } from '../src/cache_manager';
import { HttpProxyService } from '../src/proxy_service';

// Environment variable that defines host ↔ IP mapping.
const hostsEnv = process.env.APACHE_HOSTS ?? '';
const cacheMgr = new CacheManager(hostsEnv);
const proxySrv = new HttpProxyService(cacheMgr);

const PORT = Number(process.env.PORT) || 8080;
http.createServer(proxySrv.createServerHandler()).listen(PORT, () => {
  console.log(`🚀 apt_cache listening on port ${PORT}`);
});
```
Run with:
```bash
# Example host mapping: map example.com to its mirror IP.
echo "export APACHE_HOSTS='example.com,198.51.100.42'" >> .env
node --loader ts-node/esm start.ts
```
The server will now proxy requests like `http://localhost:8080/example.com/path/to/file.deb`.

## 2. Configuring Host Mappings
`CacheManager` expects a single string that lists hostname‑IP pairs separated by exclamation points:
```
host1,ip1!host2,ip2!
```
Example for two mirrors:
```bash
export APACHE_HOSTS="mirror1.deb.org,203.0.113.10!mirror2.deb.org,198.51.100.42"
```
The proxy will validate that the requested host exists in this map and return a `404` if it does not.

## 3. Inspecting Cached Content
Files are cached under `./files/<host>/<path>/`. The cache is transient – files older than **60 s** are purged automatically.

You can manually trigger a download or inspect the internal buffer cache:
```ts
const key = 'Release'; // any string identifier used by your application
const buffer = cacheMgr.getCachedContent(key);
if (buffer) {
  console.log('Cached content available in memory');
}
```
For debugging, you can also use the CLI to list files:
```bash
find ./files -type f -printf '%T@ %p\n' | sort -n
```

## 4. Running Tests
The repository ships with Jest tests covering both the `CacheManager` and `HttpProxyService`. They use a local HTTP server that mimics an upstream mirror.
```bash
npm test
```
All tests should pass in isolation; they rely on the mock server defined in `__tests__/proxy_service.test.ts`.

## 5. Advanced Usage: Caching Specific File Types
The proxy only caches files with extensions listed in `cacheExtensions`. If you need to cache additional types, edit `src/proxy_service.ts`:
```ts
const cacheExtensions = ['.deb', '.udeb', '.iso', '.apk', '.tar.xz', '.tar.gz', 'rke_linux-amd64'];
```
Remember that this array is used to decide whether a request should be cached.

---
> **Tip** – Use `DEBUG=apt_cache:*` and the built‑in console logs to trace download progress or errors.
