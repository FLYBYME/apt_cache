export interface Config {
  port: number;
  hostnames: Record<string, string>;
  cacheExtensions: string[];
  baseDir: string;
  cacheTtl: number;
}

/**
 * Parses the HOSTS environment variable.
 * Format: hostname,ip!hostname,ip
 */
const parseHostnames = (hostsEnv: string): Record<string, string> => {
  const hostnames: Record<string, string> = {};
  if (!hostsEnv) return hostnames;

  hostsEnv.split('!').forEach((str) => {
    const [hostname, ip] = str.split(',');
    if (hostname) {
      hostnames[hostname] = ip;
    }
  });
  return hostnames;
};

export const config: Config = {
  port: parseInt(process.env.PORT || '9080', 10),
  hostnames: parseHostnames(process.env.HOSTS || ''),
  cacheExtensions: [
    '.deb',
    '.udeb',
    '.iso',
    '.apk',
    '.tar.xz',
    '.tar.gz',
    'rke_linux-amd64',
  ],
  baseDir: process.env.BASE_DIR || './files',
  cacheTtl: parseInt(process.env.CACHE_TTL || '60000', 10),
};
