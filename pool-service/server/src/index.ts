import mongoose from 'mongoose';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { ensureCollections } from './models/index.js';
import { seedChemicals } from './seed/chemicals.js';

async function main() {
  const config = loadConfig();
  await mongoose.connect(config.mongoUrl);
  await ensureCollections();
  const seeded = await seedChemicals();

  const app = await buildApp(config);
  if (seeded) app.log.info(`Seeded ${seeded} chemicals`);

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
