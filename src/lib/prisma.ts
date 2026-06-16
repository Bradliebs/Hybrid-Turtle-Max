import { PrismaClient } from '@prisma/client';
import '@/lib/env';

// SHARED SINGLETON across the monorepo.
// Two modules construct Prisma clients (this one + packages/data/src/prisma.ts).
// To guarantee they share one connection pool in production as well as dev,
// we ALWAYS publish via globalThis (not just when NODE_ENV !== 'production').
// Whichever module loads first wins; the other reuses through the `??` check.
// See audit 2026-05-16 (H1) for the bug this fixes.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

globalForPrisma.prisma = prisma;

// SQLite concurrency: WAL allows reads during writes, busy_timeout retries
// instead of failing immediately with SQLITE_BUSY.
// WAL is persistent (stored in DB file), busy_timeout is per-connection.
// These run once per process on first import — errors are non-fatal but
// must be logged. A swallowed busy_timeout failure means this connection
// will throw SQLITE_BUSY immediately on contention instead of waiting 5s.
prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;').catch((err) => {
  console.error('[prisma] PRAGMA journal_mode=WAL failed:', (err as Error).message);
});
prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000;').catch((err) => {
  console.error('[prisma] PRAGMA busy_timeout=5000 failed:', (err as Error).message);
});

export default prisma;
