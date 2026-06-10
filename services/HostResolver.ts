import { RequestOptions, IncomingMessage, ServerResponse } from 'http';
import * as fs from 'fs';

/**
 * Manages hostname resolution based on environment variables (HOSTS).
 */
export class HostResolver {
    private hostnames: Record<string, string> = {};

    constructor(hostsEnv: string) {
        this.hostnames = {};
        hostsEnv.split('!').forEach((str: string): void => {
            const parts: string[] = str.split(',');
            const hostname: string = parts[0];
            const ip: string = parts[1];
            if (hostname) {
                this.hostnames[hostname] = ip;
            }
        });
    }

    getHostname(hostName: string): string | undefined {
        return this.hostnames[hostName];
    }

    getAllHostnames(): Record<string, string> {
        return this.hostnames;
    }
}