import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUrl: string;
  }
}

/**
 * Tests need a replica set (transactions). Uses MONGO_TEST_URL when set, e.g.
 *   docker compose up -d mongo
 *   MONGO_TEST_URL='mongodb://localhost:27017/?replicaSet=rs0&directConnection=true' npm test
 * otherwise starts an in-memory replica set via mongodb-memory-server
 * (downloads a mongod binary on first run).
 */
export default async function setup(project: TestProject) {
  const external = process.env.MONGO_TEST_URL;
  if (external) {
    project.provide('mongoUrl', external);
    return;
  }
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  project.provide('mongoUrl', replSet.getUri());
  return async () => {
    await replSet.stop();
  };
}
