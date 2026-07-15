import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./generated/prisma/client.js";
import { parseMysqlDatabaseUrl } from "./database-url.js";

export function createPrismaClient(connectionString: string): PrismaClient {
  const options = parseMysqlDatabaseUrl(connectionString);
  const adapter = new PrismaMariaDb({
    ...options,
    allowPublicKeyRetrieval: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 5)
  });
  return new PrismaClient({ adapter });
}

export type DatabaseClient = PrismaClient;
