export class ConfigManager {
    /**
     * Retrieves the listening port from environment variable `PORT`.
     * Parses it as an integer and falls back to the default value of 9080
     * if unset or invalid. The method is static to keep the API simple
     * for callers that only need read‑only configuration.
     */
    public static getPort(): number {
        const envValue = process.env.PORT;
        const parsed = parseInt(envValue ?? '', 10);
        if (!isNaN(parsed) && parsed > 0) {
            return parsed;
        }
        return 9080; // Default fallback
    }
}
