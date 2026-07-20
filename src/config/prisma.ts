import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { env } from "./env.js";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
}

export const prisma = global.__prisma || createPrismaClient();

if (env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}

export default prisma;