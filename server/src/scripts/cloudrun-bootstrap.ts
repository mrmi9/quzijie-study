import "dotenv/config";
import { spawn } from "node:child_process";
import mariadb from "mariadb";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDatabaseUrl, parseMysqlDatabaseUrl } from "../database-url.js";
import { createPrismaClient } from "../db.js";
import { importQuestions } from "./import-questions.js";

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} 执行失败（code=${code}, signal=${signal || "none"}）`));
    });
  });
}

async function ensureDatabase(connectionString: string): Promise<void> {
  const options = parseMysqlDatabaseUrl(connectionString);
  const connection = await mariadb.createConnection({
    host: options.host,
    port: options.port,
    user: options.user,
    password: options.password
  });
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${options.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await connection.end();
  }
}

async function seedEmptyDatabase(connectionString: string): Promise<void> {
  if (process.env.QUIZIJIE_SEED_ON_EMPTY === "false") return;
  const prisma = createPrismaClient(connectionString);
  try {
    if (await prisma.question.count() > 0) return;
    const contentDirectory = process.env.QUESTION_CONTENT_DIR
      ? resolve(process.env.QUESTION_CONTENT_DIR).replaceAll("\\", "/")
      : fileURLToPath(new URL("../../../../content", import.meta.url)).replaceAll("\\", "/");
    const count = await importQuestions(prisma, contentDirectory);
    console.log(`Seeded ${count} questions into the empty cloud database.`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const databaseUrl = resolveDatabaseUrl(process.env);
  process.env.DATABASE_URL = databaseUrl;
  await ensureDatabase(databaseUrl);
  await run("npm", ["run", "db:deploy"]);
  await seedEmptyDatabase(databaseUrl);
  await import("../server.js");
}

main().catch((error) => {
  console.error("CloudRun bootstrap failed", error);
  process.exitCode = 1;
});
