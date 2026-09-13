import { PrismaClient } from "@prisma/client"

// Next.js hot-reloads modules in dev, which would otherwise create a new
// PrismaClient (and a new DB connection pool) on every edit. Caching the
// instance on the global object survives the reload.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
}
