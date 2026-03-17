import { createReadStream, createWriteStream, Stats } from 'fs';
import { stat } from 'fs/promises';
import { Readable, Writable } from 'stream';
import { createServer as createHttpServer } from 'http';
import { DownloadOptions, UploadOptions } from './types/index.js';
import { handleError } from './error-handler.js';

/**
 * Download a file from a URL to a destination path.
 *
 * @param {DownloadOptions} options - The options for downloading.
 * @param {string} dest - The destination path to save the file.
 * @returns {Promise<Stats>} A promise that resolves to the file stats.
 */
export async function downloadFile(options: DownloadOptions, dest: string): Promise<Stats> {
  try {
    const response = await fetch(options.url, {
      headers: options.headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const fileStream = createWriteStream(dest);
    const reader = response.body.getReader();

    const writable = new Writable({
      write(chunk, encoding, callback) {
        fileStream.write(chunk, encoding, callback);
      },
      final(callback) {
        fileStream.end(callback);
      },
    });

    const readable = new Readable({
      async read() {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
        } else {
          this.push(Buffer.from(value));
        }
      },
    });

    return await new Promise<Stats>((resolve, reject) => {
      readable.pipe(writable);
      writable.on('finish', async () => {
        try {
          const stats = await stat(dest);
          resolve(stats);
        } catch (err) {
          const typedError = handleError(err instanceof Error ? err : new Error(String(err)));
          reject(typedError);
        }
      });
      writable.on('error', (err) => {
        const typedError = handleError(err);
        reject(typedError);
      });
      readable.on('error', (err) => {
        const typedError = handleError(err);
        reject(typedError);
      });
    });
  } catch (err) {
    throw handleError(err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Upload a file from a source path to a URL.
 *
 * @param {UploadOptions} options - The options for uploading.
 * @param {string} src - The source path of the file to upload.
 * @returns {Promise<void>} A promise that resolves when the upload is complete.
 */
export async function uploadFile(options: UploadOptions, src: string): Promise<void> {
  try {
    const fileStats = await stat(src);
    const fileStream = createReadStream(src);

    const response = await fetch(options.url, {
      method: 'POST',
      headers: {
        ...options.headers,
        'Content-Length': fileStats.size.toString(),
      },
      body: fileStream as any,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload file: ${response.statusText}`);
    }
  } catch (err) {
    throw handleError(err instanceof Error ? err : new Error(String(err)));
  }
}