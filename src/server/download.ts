import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as mime from 'mime';
import * as crypto from 'crypto';

import { HttpError } from './error';

interface DownloadingCallbacks {
    [key: string]: Array<(err?: Error | string | null) => void>;
}

const downloading: DownloadingCallbacks = {};

/**
 * Checks if a destination is currently being downloaded.
 */
export function isDownloading(dest: string, cb?: (err?: Error | string | null) => void): boolean {
    const current: Array<(err?: Error | string | null) => void> | undefined = downloading[dest];
    if (current && Array.isArray(current)) {
        if (cb) {
            current.push(cb);
        }
        return true;
    }
    return false;
}

/**
 * Downloads a file from the given options and saves it to dest.
 */
export const download = function (options: http.RequestOptions, dest: string, cb: (err?: Error | string | null) => void): void {

    if (isDownloading(dest, cb)) {
        return;
    }

    downloading[dest] = [];

    const filename: string = path.basename(dest);
    const file: fs.WriteStream = fs.createWriteStream(dest);

    function done(err?: Error | string | null): void {
        const callbacks: Array<(err?: Error | string | null) => void> = downloading[dest] || [];
        for (let i: number = 0; i < callbacks.length; i++) {
            const callback: (err?: Error | string | null) => void = callbacks[i];
            callback(err);
        }
        delete downloading[dest];
        cb(err);
    }

    const request: http.ClientRequest = http.request(options, (response: http.IncomingMessage): void => {
        let dataLength: number = 0;
        const contentLengthHeader: string | undefined = response.headers["content-length"];
        const contentLength: number = Number(contentLengthHeader || '0');

        response.on('data', (chunk: Buffer): void => {
            dataLength += chunk.length;
        }).pipe(file);

        const hash: crypto.Hash = crypto.createHash('sha1');
        hash.setEncoding('hex');

        response.pipe(hash);

        file.on('finish', (): void => {
            hash.end();
            file.close((closeErr?: Error | null): void => {
                if (contentLength !== dataLength) {
                    fs.unlink(dest, (unlinkErr: Error | null) => {});
                    done(new HttpError(500, 'length error'));
                } else {
                    console.log(`file downloaded ${filename} ${contentLength} = ${dataLength}`);
                    done();
                }
            });
        });
    });

    request.on('error', (err: Error): void => {
        console.log('http.request err', err);
        fs.unlink(dest, (unlinkErr: Error | null) => {});
        done(err.message);
    });

    request.end();
};

/**
 * Uploads a file to the response stream.
 */
export const upload = function (source: string, stats: fs.Stats, stream: http.ServerResponse): void {
    const ext: string = path.extname(source);
    const contentType: string | null = mime.getType(ext);
    stream.writeHead(200, {
        "content-length": stats.size,
        "content-type": contentType || 'application/octet-stream'
    });
    const readStream: fs.ReadStream = fs.createReadStream(source);
    readStream.pipe(stream);
};
