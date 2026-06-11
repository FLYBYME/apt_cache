import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as mime from 'mime';
import * as crypto from 'crypto';
import { config } from './config';

/**
 * Custom error class for HTTP related errors.
 */
export class HttpError extends Error {
    public statusCode: number;
    constructor(statusCode: number, message: string) {
        super(message);
        this.name = 'HttpError';
        this.statusCode = statusCode;
    }
}

interface Hostnames {
    [key: string]: string;
}

/**
 * Manages file caching, downloading, and serving logic for the application.
 * This module encapsulates the stateful and resource-heavy operations from server.ts.
 */
export class CacheManager {
    private hostnames: Hostnames;
    private downloadingDestinations: Set<string> = new Set();
    private cacheData: { [key: string]: Buffer } = {};
    /**
     * Tracks pending download promises keyed by destination path
     */
    private pendingDownloads: Map<string, Promise<void>> = new Map();

    constructor(hostsEnv: string) {
        this.hostnames = {};
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
        return this.downloadingDestinations.has(dest);
    }

    /**
     * Downloads a file from the given options and saves it to dest, handling concurrency and callbacks.
     */
    public async download(options: http.RequestOptions, dest: string): Promise<void> {
        if (this.isDownloading(dest)) {
            const existing = this.pendingDownloads.get(dest);
            if (existing) {
                return existing;
            }
        }

        // Mark destination as downloading and initiate the download with retry logic
        this.downloadingDestinations.add(dest);

        const downloadPromise = this._attemptDownload(options, dest).finally(() => {
            this.downloadingDestinations.delete(dest);
            this.pendingDownloads.delete(dest);
        });

        this.pendingDownloads.set(dest, downloadPromise);
        return downloadPromise;
    }

    /**
     * Internal method to perform the download with retry logic.
     */
    private async _attemptDownload(options: http.RequestOptions, dest: string): Promise<void> {
        const BASE_DELAY_MS = 200;
        let attempt = 1;
        while (true) {
            try {
                await this._singleAttempt(options, dest);
                return; // success
            } catch (err) {
                if (attempt > config.MAX_RETRIES) {
                    throw err;
                }
                const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1);
                await new Promise(r => setTimeout(r, delayMs));
                attempt++;
            }
        }
    }

    /**
     * Performs a single download attempt without retry logic.
     */
    private async _singleAttempt(options: http.RequestOptions, dest: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const filename: string = path.basename(dest);
            const fileWriteStream: fs.WriteStream = fs.createWriteStream(dest);

            let dataLength: number = 0;

            const request: http.ClientRequest = http.request(options, (response: http.IncomingMessage): void => {
                const contentLengthHeader: string | undefined = response.headers["content-length"];
                const contentLength: number = Number(contentLengthHeader || '0');

                response.on('data', (chunk: Buffer): void => {
                    dataLength += chunk.length;
                }).pipe(fileWriteStream);

                const hash: crypto.Hash = crypto.createHash('sha1');
                hash.setEncoding('hex');

                response.pipe(hash);

                response.once("end", (): void => {
                    hash.end();
                    fileWriteStream.close((closeErr?: Error | null): void => {
                        if (contentLength !== dataLength) {
                            fs.unlink(dest, () => {});
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
                fileWriteStream.end();
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
        const contentType: string | false | null = mime.getType(ext);
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
        }, 60 * 1000);
    }

    /**
     * Initializes the necessary hostnames mapping based on environment variable.
     */
    public getHostnames(): Hostnames {
        return this.hostnames;
    }
}
