# API Reference

The following tables provide a concise view of the public surface area exposed by `apt_cache`.

## CacheManager
| Signature | Description |
|-----------|-------------|
| `constructor(hostsEnv: string)` | Creates a new manager. `hostsEnv` is a string of `hostname,ip!` pairs that map domain names to upstream mirror IP addresses. |
| `download(options: http.RequestOptions, dest: string): Promise<void>` | Downloads the requested resource from the upstream mirror into `dest`. Handles retry logic and concurrent requests; if a download for `dest` is already in progress, returns the existing promise. |
| `uploadFile(source: string, stats: fs.Stats, res: http.ServerResponse): void` | Streams the file located at `source` to the response stream using the correct MIME type. |
| `getCachedContent(key: string): Buffer | undefined` | Retrieves an in‑memory cache entry identified by `key`. Used primarily for lightweight Release/Release‑sig caching. |
| `cacheResource(key: string, buffer: Buffer): void` | Stores a buffer temporarily in the internal cache and schedules automatic eviction after 60 s. |
| `isDownloading(dest: string): boolean` | Returns whether `dest` is currently being fetched from upstream. |
| `getHostnames(): { [hostname: string]: string }` | Returns the mapping of hostnames to IP addresses created during construction. |

## HttpProxyService
| Signature | Description |
|-----------|-------------|
| `constructor(cacheManager: CacheManager)` | Instantiates a new proxy service with the provided cache manager. |
| `createServerHandler(): (req: http.IncomingMessage, res: http.ServerResponse) => void` | Produces an Express‑style request handler that performs caching logic and forwards requests to upstream mirrors. The returned function can be passed directly to `http.createServer`. |

### Internal Notes
- File caching is performed under the `./files/` directory, mirroring the host/path structure of incoming requests.
- Supported cacheable extensions are: `.deb`, `.udeb`, `.iso`, `.apk`, `.tar.xz`, `.tar.gz`, and `rke_linux-amd64` (without a leading dot).
- All network errors surface as HTTP 500 responses. If the requested host is not mapped, the server returns HTTP 404.

---
> For the full source of each class, see the TypeScript files in the `src/` directory.
