export interface MysqlConnectionOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

function parseAddress(address: string): { host: string; port: number } {
  const separator = address.lastIndexOf(":");
  if (separator <= 0 || separator === address.length - 1) {
    throw new Error("MYSQL_ADDRESS 必须使用 host:port 格式");
  }
  const host = address.slice(0, separator).trim();
  const port = Number(address.slice(separator + 1));
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("MYSQL_ADDRESS 中的主机或端口无效");
  }
  return { host, port };
}

export function resolveDatabaseUrl(source: NodeJS.ProcessEnv = process.env): string {
  if (source.DATABASE_URL) return source.DATABASE_URL;

  const address = source.MYSQL_ADDRESS || "";
  const user = source.MYSQL_USERNAME || "";
  const password = source.MYSQL_PASSWORD || "";
  const database = source.MYSQL_DATABASE || "quzijie";
  if (!address || !user || !password) {
    throw new Error("缺少 DATABASE_URL，或缺少 MYSQL_ADDRESS/MYSQL_USERNAME/MYSQL_PASSWORD");
  }
  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error("MYSQL_DATABASE 只能包含字母、数字和下划线");
  }

  const { host, port } = parseAddress(address);
  return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

export function parseMysqlDatabaseUrl(connectionString: string): MysqlConnectionOptions {
  const url = new URL(connectionString);
  if (url.protocol !== "mysql:") throw new Error("DATABASE_URL 必须使用 mysql:// 协议");
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database || !/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error("DATABASE_URL 中的数据库名无效");
  }
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database
  };
}
