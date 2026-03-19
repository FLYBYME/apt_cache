import { IncomingHttpHeaders } from 'http';
import * as path from 'path';
import { config } from './config';

/**
 * Represents a cached HTTP response in memory.
 */
export interface CachedResponse {
  content: Buffer;
  headers: IncomingHttpHeaders;
  statusCode: number;
}

/**
 * Internal structure for cache entries with expiration.
 */
interface CacheEntry {
  response: CachedResponse;
  expiresAt: number;
}

/**
 * Manages in-memory caching of HTTP responses.
 */
export class ResponseCache {
  private store = new Map<string, CacheEntry>();
  private pruneInterval: NodeJS.Timeout | null = null;

  constructor(private defaultTtl: number = config.cacheTtl) {
    this.startPruning();
  }

  /**
   * Retrieves a response from the cache if it exists and has not expired.
   */
  public get(key: string): CachedResponse | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return entry.response;
  }

  /**
   * Stores a response in the cache with a specific or default TTL.
   */
  public set(key: string, response: CachedResponse, ttl?: number): void {
    const expiresAt = Date.now() + (ttl ?? this.defaultTtl);
    this.store.set(key, { response, expiresAt });
  }

  /**
   * Removes an entry from the cache.
   */
  public delete(key: string): void {
    this.store.delete(key);
  }

  /**
   * Starts a background process to prune expired entries.
   */
  private startPruning(): void {
    // Prune every minute
    this.pruneInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store.entries()) {
        if (now > entry.expiresAt) {
          this.store.delete(key);
        }
      }
    }, 60000);
    
    // Ensure the interval doesn't prevent the process from exiting
    if (this.pruneInterval.unref) {
      this.pruneInterval.unref();
    }
  }

  /**
   * Stops the background pruning process.
   */
  public stopPruning(): void {
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = null;
    }
  }
}

/**
 * Determines if a file should be cached on disk based on its extension.
 */
export function shouldCacheOnDisk(filename: string): boolean {
  return config.cacheExtensions.some((ext) => filename.includes(ext));
}

/**
 * Determines if a file should be cached in memory (e.g., frequently updated metadata).
 */
export function shouldCacheInMemory(filename: string): boolean {
  return filename === 'InRelease' || filename === 'Release';
}

/**
 * Structure for cache path information.
 */
export interface CachePathInfo {
  dir: string;
  fullPath: string;
  filename: string;
}

/**
 * Resolves the local file system path for caching a specific host and URL.
 */
export function getCachePath(host: string, urlPath: string): CachePathInfo {
  const urlParts = urlPath.split('?')[0].split('/');
  const filename = urlParts.pop() || '';
  const pathname = urlParts.join('/');
  
  const dir = path.join(config.baseDir, host, pathname);
  const fullPath = path.join(dir, filename);
  
  return { dir, fullPath, filename };
}

// Export a default instance for shared use
export const responseCache = new ResponseCache();
