import { PrismaClient } from '@prisma/client';

// A single shared instance — tsx watch mode would otherwise create a new
// client (and a new connection pool) on every hot reload.
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma = global.__prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') global.__prisma = prisma;
