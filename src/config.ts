import { z } from 'zod';

/**
 * Zod schema for runtime configuration.
 */
const envSchema = z.object({
    HOSTS: z.string().default(''),
    PROXY_PORT: z.preprocess((val) => {
        const num = parseInt(val as string | undefined ?? '', 10);
        return Number.isNaN(num) ? undefined : num;
    }, z.number().int().positive().default(9080)),
    MAX_RETRIES: z.preprocess((val) => {
        const num = parseInt(val as string | undefined ?? '', 10);
        return Number.isNaN(num) ? undefined : num;
    }, z.number().int().nonnegative().default(3)),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    METRICS_ENABLED: z.preprocess((val) => {
        const str = typeof val === 'string' ? val.toLowerCase() : String(val);
        return str === 'true';
    }, z.boolean().default(false)),
});

export type Config = z.infer<typeof envSchema>;
/**
 * Parsed and validated configuration. This is a singleton exported for the entire application.
 */
export const config: Config = envSchema.parse(process.env);
