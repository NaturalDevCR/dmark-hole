import { initAlerts } from "./alerts/index.js";
import { bootstrapAdmin } from "./api/auth.js";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { initEnrichment } from "./enrich/ip.js";
import { initSmtp, stopSmtp } from "./ingest/smtp.js";
import { logger } from "./lib/logger.js";
import { startScheduler, stopScheduler } from "./scheduler.js";

async function main() {
  db.migrate();
  await bootstrapAdmin();
  initEnrichment();
  initAlerts();

  const app = await buildApp();
  await app.listen({ host: config.host, port: config.port });
  logger.info(`DMARK-Hole ${config.version} listening on http://${config.host}:${config.port} (data: ${config.dataDir})`);

  initSmtp();
  if (!config.disableScheduler) startScheduler();

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, "shutting down");
    stopScheduler();
    await stopSmtp().catch(() => undefined);
    await app.close().catch(() => undefined);
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.fatal({ err }, "failed to start");
  process.exit(1);
});
