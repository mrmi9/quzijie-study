import "dotenv/config";
import { spawn } from "node:child_process";
import mariadb from "mariadb";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDatabaseUrl, parseMysqlDatabaseUrl } from "../database-url.js";
import { createPrismaClient } from "../db.js";
import { importQuestions } from "./import-questions.js";

const INITIAL_MIGRATION = "20260715090000_mysql_cloud_init";
const INITIAL_TABLES = [
  "refresh_tokens",
  "question_options",
  "practice_answers",
  "practice_session_questions",
  "wrong_question_records",
  "favorites",
  "exam_drafts",
  "exam_results",
  "exam_questions",
  "practice_sessions",
  "exams",
  "question_versions",
  "questions",
  "chapters",
  "subjects",
  "users"
] as const;

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
    password: options.password,
    allowPublicKeyRetrieval: true
  });
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${options.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await connection.end();
  }
}

async function recoverInterruptedInitialMigration(connectionString: string): Promise<boolean> {
  const options = parseMysqlDatabaseUrl(connectionString);
  const connection = await mariadb.createConnection({
    host: options.host,
    port: options.port,
    user: options.user,
    password: options.password,
    database: options.database,
    allowPublicKeyRetrieval: true
  });

  try {
    const migrationTableRows = await connection.query<Array<{ count: number | string }>>(
      `SELECT COUNT(*) AS count
         FROM information_schema.tables
        WHERE table_schema = ? AND table_name = '_prisma_migrations'`,
      [options.database]
    );
    if (Number(migrationTableRows[0]?.count || 0) === 0) return false;

    const failedRows = await connection.query<Array<{ id: string }>>(
      `SELECT id
         FROM \`_prisma_migrations\`
        WHERE migration_name = ?
          AND finished_at IS NULL
          AND rolled_back_at IS NULL
        LIMIT 1`,
      [INITIAL_MIGRATION]
    );
    if (!failedRows[0]) return false;

    const successfulRows = await connection.query<Array<{ count: number | string }>>(
      `SELECT COUNT(*) AS count
         FROM \`_prisma_migrations\`
        WHERE finished_at IS NOT NULL
          AND rolled_back_at IS NULL`,
    );
    if (Number(successfulRows[0]?.count || 0) > 0) {
      throw new Error("Refusing to recover the interrupted initial migration after a successful migration");
    }

    const placeholders = INITIAL_TABLES.map(() => "?").join(", ");
    const presentRows = await connection.query<Array<{ tableName: string }>>(
      `SELECT table_name AS tableName
         FROM information_schema.tables
        WHERE table_schema = ? AND table_name IN (${placeholders})`,
      [options.database, ...INITIAL_TABLES]
    );
    const presentTables = presentRows.map((row) => row.tableName);
    const nonEmptyTables: string[] = [];
    for (const table of presentTables) {
      const countRows = await connection.query<Array<{ count: number | string }>>(
        `SELECT COUNT(*) AS count FROM \`${table}\``
      );
      if (Number(countRows[0]?.count || 0) > 0) nonEmptyTables.push(table);
    }
    if (nonEmptyTables.length > 0) {
      throw new Error(
        `Refusing to recover the interrupted initial migration because tables contain data: ${nonEmptyTables.join(", ")}`
      );
    }

    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    try {
      for (const table of INITIAL_TABLES) {
        await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
      }
    } finally {
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    }
    await connection.query(
      `UPDATE \`_prisma_migrations\`
          SET rolled_back_at = CURRENT_TIMESTAMP(3),
              logs = CONCAT(COALESCE(logs, ''), ?)
        WHERE id = ?`,
      ["\nAutomatically rolled back after an interrupted empty-database bootstrap.", failedRows[0].id]
    );
    console.warn(`Recovered interrupted empty-database migration ${INITIAL_MIGRATION}.`);
    return true;
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

  // CloudRun starts probing the configured port immediately. Listen before the
  // one-time database bootstrap so a slow migration is not mistaken for a
  // crashed container.
  await import("../server.js");
  console.log("HTTP server started; preparing the cloud database.");

  await ensureDatabase(databaseUrl);
  await recoverInterruptedInitialMigration(databaseUrl);
  await run("npm", ["run", "db:deploy"]);
  await seedEmptyDatabase(databaseUrl);
  console.log("Cloud database bootstrap completed.");
}

main().catch((error) => {
  console.error("CloudRun bootstrap failed", error);
  process.exit(1);
});
