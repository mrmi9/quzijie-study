import "dotenv/config";
import { defineConfig } from "prisma/config";

function datasourceUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const address = process.env.MYSQL_ADDRESS || "";
  const user = process.env.MYSQL_USERNAME || "";
  const password = process.env.MYSQL_PASSWORD || "";
  const database = process.env.MYSQL_DATABASE || "quzijie";
  if (!address || !user || !password) {
    throw new Error("缺少 DATABASE_URL，或缺少 MYSQL_ADDRESS/MYSQL_USERNAME/MYSQL_PASSWORD");
  }
  return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${address}/${database}`;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: datasourceUrl()
  }
});
