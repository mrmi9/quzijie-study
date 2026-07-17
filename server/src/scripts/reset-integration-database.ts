import "dotenv/config";
import mariadb from "mariadb";
import { parseMysqlDatabaseUrl } from "../database-url.js";

async function main(): Promise<void> {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("缺少 TEST_DATABASE_URL");
  const options = parseMysqlDatabaseUrl(databaseUrl);
  if (!options.database.endsWith("_test") || options.database.includes("production") || options.database === "quzijie") {
    throw new Error("集成测试重置只允许名称以 _test 结尾的专用数据库");
  }
  const connection = await mariadb.createConnection({ ...options, allowPublicKeyRetrieval: true });
  try {
    await connection.query("SET FOREIGN_KEY_CHECKS=0");
    const rows = await connection.query<Array<Record<string, string>>>("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
    for (const row of rows) {
      const table = String(Object.values(row)[0] || "");
      if (!table) continue;
      await connection.query(`DROP TABLE \`${table.replaceAll("`", "``")}\``);
    }
  } finally {
    try { await connection.query("SET FOREIGN_KEY_CHECKS=1"); } catch { /* connection may already be unavailable */ }
    await connection.end();
  }
  console.log(`Reset dedicated integration database: ${options.database}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
