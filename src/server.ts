import { startServer } from './http-handler.js';
import { env } from './config/env.js';

/**
 * Main server entry point.
 */
async function main(): Promise<void> {
  console.log('GitHub AI Agent — starting up...\n');
  console.log(`  Server port:  ${env.port}\n`);

  startServer(env.port);
}

main().catch((err: unknown) => {
  console.error('❌ Startup failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});