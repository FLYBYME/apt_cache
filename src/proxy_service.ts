import * as http from 'http';
import * as fs from 'fs-extra';
import * as path from 'path';
import { CacheManager } from './cache_manager';

/**
 * Handles the core HTTP proxying and routing logic, depending on a cache manager.
 * This class isolates the complex request processing (Business Logic) from server setup.
 */
export class HttpProxyService {
    private cacheManager: CacheManager;
    private readonly hostnames: { [key: string]: string }; // will be populated from CacheManager


    constructor(cacheManager: CacheManager, hostsEnv: string) {
        this.cacheManager = cacheManager;
        // Re-populate hostnames locally or rely on the manager to provide them
        this.hostnames = this.cacheManager.getHostnames();
        console.log('HttpProxyService initialized.');
    }

    public createServerHandler(): (req: http.IncomingMessage, res: http.ServerResponse) => void {
        return (req: http.IncomingMessage, res: http.ServerResponse) => {
            const urlStr: string = req.url || '';
            const pathnameParts: string[] = urlStr.split('/');
            const filename: string = pathnameParts.pop() || '';
            const pathname: string = pathnameParts.join('/');

            // Construct file path based on host header, assuming general structure remains the same
            const host: string = req.headers.host || '';
            const dir: string = path.join('./files', host, pathname); // Note: Initializing directory might be necessary here if it's not guaranteed by caller
            const fullPath: string = path.join('./files', host, pathname, filename);

            if (!this.hostnames[host]) {
                res.end(host);
                return;
            }

            const options: http.RequestOptions = {
                hostname: this.hostnames[host],
                port: 80,
                path: req.url,
                method: req.method,
                headers: req.headers
            };

            const cacheExtensions: string[] = ['.deb', '.udeb', '.iso', '.apk', '.tar.xz', '.tar.gz', 'rke_linux-amd64'];
            const shouldCache: boolean = cacheExtensions.some((v: string): boolean => filename.includes(v));

            if (shouldCache) {
                // --- Caching/Download Logic Section ---
                const onDownload = async () => {
                    try {
                        await this.cacheManager.download(options, fullPath);
                        // Success: File is available locally now
                        fs.stat(fullPath, (statErr: Error | null, stats: fs.Stats): void => {
                            if (statErr) {
                                res.writeHead(500);
                                res.end();
                            } else {
                                this.cacheManager['uploadFile'](fullPath, stats, res);
                            }
                        });
                    } catch (e: any) {
                        console.error('Failed to cache file:', e.message);
                        res.writeHead(500);
                        res.end();
                    }
                };

                if (this.cacheManager.isDownloading(fullPath)) {
                    // Logic for handling concurrent download attempts would require callbacks/Promises resolution outside the scope of a simple handler signature, 
                    // but for now, we rely on the manager checking state before proceeding.
                    res.writeHead(503);
                    return res.end('Content is currently being downloaded.');
                }

                fs.stat(fullPath, (statErr: Error | null, stats: fs.Stats): void => {
                    if (statErr) {
                        // Directory/File does not exist, initiate download process
                        this.cacheManager['download'](options, fullPath).then(() => onDownload()).catch((e: any) => console.error('Download failed:', e));

                    } else {
                        // File exists and is cached
                        console.log(`file cached ${filename}`);
                        this.cacheManager['uploadFile'](fullPath, stats, res);
                    }
                });
            } else {
                // --- Proxying Logic Section (Non-cached files) ---

                if (false && (filename === 'InRelease' || filename === 'Release')) {
                    const cacheKey: string = req.url || '';
                    const buf: Buffer | undefined = this.cacheManager.getCachedContent(cacheKey);
                    if (buf) {
                        res.writeHead(200, {'content-length': buf!.length});

                        res.end(buf);
                        return;
                    }

                    console.log(`http://${host}${req.url}`);
                    const get: http.ClientRequest = http.request(options, (_res: http.IncomingMessage): void => {
                        const statusCode: number = _res.statusCode || 200;
                        res.writeHead(statusCode, _res.headers);
                        _res.pipe(res);
                        const bufs: Buffer[] = [];
                        _res.on('data', (d: Buffer): void => { bufs.push(d); });
                        _res.on('end', (): void => {
                            this.cacheManager['cacheResource'](cacheKey, Buffer.concat(bufs));
                        });
                    });
                    get.once('error', (): void => {
                        res.end();
                    });
                    get.end();
                    return;
                }

                // Standard proxy request
                const get: http.ClientRequest = http.request(options, (_res: http.IncomingMessage): void => {
                    const statusCode: number = _res.statusCode || 200;
                    res.writeHead(statusCode, _res.headers);
                    _res.pipe(res);
                });
                get.once('error', (): void => {
                    res.end();
                });
                get.end();
            }
        };
    }
}