import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as mime from 'mime';
import * as crypto from 'crypto';

/**
 * Custom error class for HTTP related errors.
 */
class HttpError extends Error {
    public statusCode: number;
    constructor(statusCode: number, message: string) {
        super(message);
        this.name = 'HttpError';
        this.statusCode = statusCode; // Assign status code
    }
}

export export export interface Hostnames {
    [key: string]: string;
}

interface DownloadingCallbacks {
    [key: string]: string;
}


    [key: string]: string;
}

interface DownloadingCallbacks {
    [key: string]: Array<(err?: Error | string | null) => void>;
}
    [key: string]: Array<(err?: Error | string | null) => void>;
}

/**
 * Manages file caching, downloading, and serving logic for the application.
 * This module encapsulates the stateful and resource-heavy operations from server.ts.
 */
export class CacheManager {
    private hostnames: Hostnames;
    private downloads: DownloadingCallbacks = {};
    private cacheData: { [key: string]: Buffer } = {};

    constructor(hostsEnv: string) {
        this.hostnames = {} as Hostnames;
        const hosts = hostsEnv || '';
        hosts.split('!').forEach((str: string): void => {
            const parts: string[] = str.split(',');
            const hostname: string = parts[0];
            const ip: string = parts[1];
            if (hostname) {
                this.hostnames[hostname] = ip;
            }
        });
    }

    /**
     * Checks if a destination is currently being downloaded.
     */
    public isDownloading(dest: string): boolean {
        const current: Array<(err?: Error | string | null) => void> | undefined = this.downloads[dest];
        return !!current;
    }

    /**
     * Downloads a file from the given options and saves it to dest, handling concurrency and callbacks.
     */
    public async download(options: http.RequestOptions, dest: string): Promise<void> {
        if (this.isDownloading(dest)) {
            return new Promise<void>((resolve, reject) => {
                this.downloads[dest].push({ resolve, reject });
            });
        }

        // Mark as downloading and prepare callback queue
        this.downloads[dest] = [];
        console.log(`Starting download process for ${path.basename(dest)}`);

        // Ensure destination directory exists
        await fs.promises.mkdir(path.dirname(dest), { recursive: true });
        const fileWriteStream = fs.createWriteStream(dest);

        return new Promise<void>((resolve, reject) => {
            let dataLength = 0;
            const request = http.request(options, (response) => {
                const contentLengthHeader = response.headers["content-length"] as string | undefined;
                const expectedLength = Number(contentLengthHeader || "0");

                // Hash calculation
                const hash = crypto.createHash("sha1").setEncoding("hex");

                response.on("data", (chunk: Buffer) => {
                    dataLength += chunk.length;
                    hash.update(chunk);
                });

                response.on("end", () => {
                    hash.end();
                    fileWriteStream.close((closeErr?: Error | null) => {
                        if (expectedLength !== 0 && expectedLength !== dataLength) {
                            fs.unlink(dest, () => {});
                            this.cleanDownloads(dest, new HttpError(500, "length mismatch after download"));
                            return;
                        }
                        console.log(`file downloaded ${path.basename(dest)} ${expectedLength} = ${dataLength}`);
                        this.cleanDownloads(dest, null);
                        resolve();
                    });
                });

                response.on("error", (err: Error) => {
                    fs.unlink(dest, () => {});
                    this.cleanDownloads(dest, new HttpError(500, "HTTP request error"));
                });

                // Pipe to file after setting up listeners
                response.pipe(fileWriteStream);
            });

            request.on("error", (err: Error) => {
                console.log('http.request general err', err);
                fileWriteStream.end();
                this.cleanDownloads(dest, new HttpError(500, "Connection error"));
            });

            request.end();
        });
    }

    private cleanDownloads(dest: string, err?: Error | null): void {
        const callbacks = this.downloads[dest] || [];
        delete this.downloads[dest];
        if (err) {
            callbacks.forEach(cb => cb(err));
        } else {
            callbacks.forEach(cb => cb());
        }
    }

        return new Promise<void>((resolve, reject) => {
            let dataLength: number = 0;
            
            // In a real scenario, we'd track callbacks if the caller needs to await completion.
            // For now, we simplify this function to return a promise indicating success/failure.

            const request: http.ClientRequest = http.request(options, (response: http.IncomingMessage): void => {
                let contentLengthHeader: string | undefined = response.headers["content-length"];
                const contentLength: number = Number(contentLengthHeader || '0');

                response.on('data', (chunk: Buffer): void => {
                    dataLength += chunk.length;
                }).pipe(fileWriteStream);

                const hash: crypto.Hash = crypto.createHash('sha1');
                hash.setEncoding('hex');

                response.pipe(hash);

                fileWriteStream.on('finish', (): void => {
                    hash.end();
                    fileWriteStream.close((closeErr?: Error | null): void => {
                        if (contentLength !== dataLength) {
                            fs.unlink(dest, () => {}); // Attempt clean up regardless of unlink error
                            reject(new HttpError(500, 'length mismatch after download'));
                        } else {
                            console.log(`file downloaded ${filename} ${contentLength} = ${dataLength}`);
                            resolve();
                        }
                    });
                });

                response.on('error', (err: Error): void => {
                    fs.unlink(dest, () => {});
                    reject(new HttpError(500, 'HTTP request error'));
                });
            });

            request.on('error', (err: Error): void => {
                console.log('http.request general err', err);
                fileWriteStream.end(); // Ensure stream stops if initial connection fails
                reject(new HttpError(500, 'Connection error'));
            });

            request.end();
        });
    }

    /**
     * Uploads a file to the response stream (used for cached files).
     */
    public uploadFile(source: string, stats: fs.Stats, res: http.ServerResponse): void {
        const ext: string = path.extname(source);
        const contentType: string | null = mime.getType(ext);
        res.writeHead(200, {
            "content-length": stats.size,
            "content-type": contentType || 'application/octet-stream'
        });
        fs.createReadStream(source).pipe(res);
    }

    /**
     * Retrieves cached content buffer for InRelease/Release files.
     */
    public getCachedContent(key: string): Buffer | undefined {
        return this.cacheData[key];
    }

    /**
     * Caches incoming resource data temporarily. Clears after a timeout.
     */
    public cacheResource(key: string, buffer: Buffer) {
        this.cacheData[key] = buffer;
        setTimeout(() => {
            delete this.cacheData[key];
        }, 60 * 1000); // 60 seconds timeout
    }

    /**
     * Initializes the necessary hostnames mapping based on environment variable.
     */
    public getHostnames(): Hostnames {
        return this.hostnames;
    }
}