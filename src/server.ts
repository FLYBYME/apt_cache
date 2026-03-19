import * as http from 'http';
import * as fs from 'fs';
import * as fse from 'fs-extra';

import { config } from './server/config';
import { handleError } from './server/error';
import { download, upload, isDownloading } from './server/download';
import {
  responseCache,
  shouldCacheOnDisk,
  shouldCacheInMemory,
  getCachePath,
} from './server/cache';

export const proxy: http.Server = http.createServer(
  (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const host: string = req.headers.host || '';
    const urlStr: string = req.url || '';

    const { dir, fullPath, filename } = getCachePath(host, urlStr);

    if (!config.hostnames[host]) {
      res.end(host);
      return;
    }

    const options: http.RequestOptions = {
      hostname: config.hostnames[host],
      port: 80,
      path: req.url,
      method: req.method,
      headers: req.headers,
    };

    if (shouldCacheOnDisk(filename)) {
      const onDownload = (err?: Error | string | null): void => {
        if (err) {
          handleError(err, res);
        } else {
          fs.stat(fullPath, (statErr: Error | null, stats: fs.Stats): void => {
            if (statErr) {
              handleError(statErr, res);
            } else {
              upload(fullPath, stats, res);
            }
          });
        }
      };

      if (isDownloading(fullPath, onDownload)) {
        return;
      }

      fs.stat(fullPath, (statErr: Error | null, stats: fs.Stats): void => {
        if (statErr) {
          fse.ensureDir(dir, (dirErr: Error | null): void => {
            if (dirErr) {
              handleError(dirErr, res);
            } else {
              download(options, fullPath, onDownload);
            }
          });
        } else {
          console.log(`file cached ${filename} ${stats.size}`);
          upload(fullPath, stats, res);
        }
      });
    } else {
      // In-memory caching for specific files (e.g., Release, InRelease)
      if (shouldCacheInMemory(filename)) {
        const cacheKey: string = req.url || '';
        const cached = responseCache.get(cacheKey);
        
        if (cached) {
          res.writeHead(cached.statusCode, cached.headers);
          res.end(cached.content);
          return;
        }

        console.log(`http://${host}${req.url}`);
        const get: http.ClientRequest = http.request(
          options,
          (_res: http.IncomingMessage): void => {
            const statusCode: number = _res.statusCode || 200;
            const bufs: Buffer[] = [];
            
            _res.on('data', (d: Buffer): void => {
              bufs.push(d);
            });
            
            _res.on('end', (): void => {
              const content = Buffer.concat(bufs);
              responseCache.set(cacheKey, {
                content,
                headers: _res.headers,
                statusCode,
              });
              
              if (!res.headersSent) {
                res.writeHead(statusCode, _res.headers);
                res.end(content);
              }
            });
          }
        );

        get.once('error', (err: Error): void => {
          handleError(err, res);
        });
        get.end();
        return;
      }

      // Default proxy behavior without caching
      const get: http.ClientRequest = http.request(
        options,
        (_res: http.IncomingMessage): void => {
          const statusCode: number = _res.statusCode || 200;
          res.writeHead(statusCode, _res.headers);
          _res.pipe(res);
        }
      );

      get.once('error', (err: Error): void => {
        handleError(err, res);
      });
      get.end();
    }
  }
);

proxy.listen(config.port, (): void => {
  console.log(`Proxy listening on port ${config.port}`);
});
