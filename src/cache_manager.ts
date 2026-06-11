import * as http from 'http';
import * as fse from 'fs-extra';
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
        return this.pendingDownloads.has(dest);
    }

    /**
     * Downloads a file from the given options and saves it to dest, handling concurrency and callbacks.
     */
    public async download(options: http.RequestOptions, dest: string): Promise<void> {
        const existing = this.pendingDownloads.get(dest);
        if (existing) {
            return existing;
        }

        // Mark destination as downloading and initiate the download with retry logic
        const downloadPromise = (async () => {
            try {
                await this._attemptDownload(options, dest);
            } finally {
                this.pendingDownloads.delete(dest);
            }
        })();

        this.pendingDownloads.set(dest, downloadPromise);
        return downloadPromise;
    }

    /**
     * Internal method to perform the download with retry logic.
     */
    private async _attemptDownload(options: http.RequestOptions, dest: string): Promise<void> {
        const BASE_DELAY_MS = 200;
        let retriesLeft = config.MAX_RETRIES;
        while (true) {
            try {
                await this._singleAttempt(options, dest);
                return; // success
            } catch (err) {
                if (retriesLeft === 0) {
                    throw err;
                }
                const delayMs = BASE_DELAY_MS * Math.pow(2, config.MAX_RETRIES - retriesLeft);
                await new Promise(r => setTimeout(r, delayMs));
                retriesLeft--;
            }
        }
    }

    /**
     * Performs a single download attempt without retry logic.
     */
    private async _singleAttempt(options: http.RequestOptions, dest: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const filename: string = path.basename(dest);
            const fileWriteStream: fse.WriteStream = fse.createWriteStream(dest);

            const request: http.ClientRequest = http.request(options, (response: http.IncomingMessage): void => {
                const contentLengthHeader: string | undefined = response.headers["content-length"];
                const contentLength: number = Number(contentLengthHeader || '0');

                let received: number = 0;
                const hash: crypto.Hash = crypto.createHash('sha1');
                hash.setEncoding('hex');

                response.on('data', (chunk: Buffer): void => {
                    received += chunk.length;
                    hash.update(chunk);
                });

                // Pipe to file
                fileWriteStream.on("finish", finalize);
                response.pipe(fileWriteStream);

                let finished = false;
                const finalize = () => {
                    if (finished) return;
                    finished = true;
                    if (received !== contentLength) {
                        fse.unlink(dest, () => {});
                        reject(new HttpError(500, 'length mismatch after download'));
                    } else {
                        console.log(`file downloaded ${filename} ${contentLength} = ${received}`);
                        hash.end();
                        resolve();
                    }
                };
                    if (received !== contentLength) {
                        fse.unlink(dest, () => {});
                        reject(new HttpError(500, 'length mismatch after download'));
                    } else {
                        console.log(`file downloaded ${filename} ${contentLength} = ${received}`);
                        hash.end();
                        resolve();
                    }
                };

                response.once('end', finalize);

                fileWriteStream.on("error", (err: Error): void => {
                    fse.unlink(dest, () => {});
                    reject(new HttpError(500, 'write stream error'));
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
    public uploadFile(source: string, stats: fse.Stats, res: http.ServerResponse): void {
        const ext: string = path.extname(source);
        const contentType: string | false | null = mime.getType(ext);
        res.writeHead(200, {
            "content-length": stats.size,
            "content-type": contentType || 'application/octet-stream'
        });
        fse.createReadStream(source).pipe(res);
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
