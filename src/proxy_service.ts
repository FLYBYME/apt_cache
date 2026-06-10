import * as http from 'http';
import * as fs from 'fs-extra';
import * as path from 'path';
import { CacheManager, Hostnames } from './cache_manager';

export class HttpProxyService {
    private readonly cacheManager: CacheManager;
    private readonly hostnames: Hostnames;

    constructor(cacheManager: CacheManager, hostsEnv: string) {
        this.cacheManager = cacheManager;
        // The manager already parsed hosts; expose them for quick lookup.
        this.hostnames = this.cacheManager.getHostnames();
        console.log('HttpProxyService initialized.');
    }

    public createServerHandler(): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
        return async (req: http.IncomingMessage, res: http.ServerResponse) => {
            const urlStr = req.url ?? '';
            const parts = urlStr.split('/');
            const filename = parts.pop() || '';
            const pathname = parts.join('/') || '';

            const host = (req.headers.host as string) ?? '';
            const fullPath = path.join('./files', host, pathname, filename);

            if (!this.hostnames[host]) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                return res.end(host);
            }

            const options: http.RequestOptions = {
                hostname: this.hostnames[host],
                port: 80,
                path: req.url,
                method: req.method,
                headers: req.headers
            };

            const cacheExtensions = ['.deb', '.udeb', '.iso', '.apk', '.tar.xz', '.tar.gz', 'rke_linux-amd64'];
            const shouldCache = cacheExtensions.some(ext => filename.includes(ext));

            if (shouldCache) {
                // If a download is already in progress for this file, respond with 503.
                if (this.cacheManager.isDownloading(fullPath)) {
                    res.writeHead(503);
                    return res.end('Content is currently being downloaded.');
                }

                try {
                    const stats = await fs.stat(fullPath); // File exists
                    this.cacheManager.uploadFile(fullPath, stats, res);
                } catch (statErr: any) {
                    // File missing – start download.
                    try {
                        await this.cacheManager.download(options, fullPath);
                        const newStats = await fs.stat(fullPath);
                        this.cacheManager.uploadFile(fullPath, newStats, res);
                    } catch (e: any) {
                        console.error('Failed to cache file:', e.message ?? e);
                        res.writeHead(500);
                        res.end();
                    }
                }
            } else {
                // Non‑cached request – proxy directly.
                const get = http.request(options, (_res: http.IncomingMessage) => {
                    const statusCode = _res.statusCode ?? 200;
                    res.writeHead(statusCode, _res.headers as any);
                    _res.pipe(res);
                });

                get.once('error', () => res.end());
                get.end();
            }
        };
    }
}
