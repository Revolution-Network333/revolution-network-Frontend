let connectionString = (process.env.DATABASE_URL || '').trim();
if (/^DATABASE_URL\s*=/i.test(connectionString)) connectionString = connectionString.replace(/^DATABASE_URL\s*=\s*/i, '');
if ((connectionString.startsWith('"') && connectionString.endsWith('"')) || (connectionString.startsWith("'") && connectionString.endsWith("'"))) {
  connectionString = connectionString.slice(1, -1).trim();
}

const sqliteForced = process.env.USE_SQLITE === 'true';
const envDialect = String(process.env.DB_DIALECT || '').trim().toLowerCase();
let mysqlUrl = String(process.env.MYSQL_URL || process.env.MYSQL_DATABASE_URL || '').trim();
if (/^MYSQL_URL\s*=/i.test(mysqlUrl)) mysqlUrl = mysqlUrl.replace(/^MYSQL_URL\s*=\s*/i, '').trim();
if ((mysqlUrl.startsWith('"') && mysqlUrl.endsWith('"')) || (mysqlUrl.startsWith("'") && mysqlUrl.endsWith("'"))) {
  mysqlUrl = mysqlUrl.slice(1, -1).trim();
}

let db;

function isMySqlConnectionString(s) {
  const v = String(s || '').trim().toLowerCase();
  return v.startsWith('mysql://') || v.startsWith('mariadb://');
}

function shouldUseMySql() {
  if (envDialect === 'mysql') return true;
  if (mysqlUrl) return true;
  if (isMySqlConnectionString(connectionString)) return true;
  if (process.env.MYSQL_HOST || process.env.MYSQL_USER || process.env.MYSQL_DATABASE) return true;
  return false;
}

if (sqliteForced || (!connectionString && !shouldUseMySql())) {
  console.log('🗄️  Using SQLite database');
  db = require('./database-sqlite');
  db.isSQLite = true;
  db.isPostgres = false;
  db.isMySQL = false;
  db.dialect = 'sqlite';
} else {
  if (shouldUseMySql()) {
    console.log('🗄️  Using MySQL database');
    const mysql = require('mysql2/promise');

    const resolveMySqlConfig = () => {
      const urlToUse = mysqlUrl || connectionString;
      if (isMySqlConnectionString(urlToUse)) {
        const u = new URL(urlToUse);
        return {
          host: u.hostname,
          port: u.port ? Number.parseInt(u.port, 10) : 3306,
          user: decodeURIComponent(u.username || ''),
          password: decodeURIComponent(u.password || ''),
          database: (u.pathname || '').replace(/^\//, ''),
          ssl: (u.searchParams.get('ssl') || u.searchParams.get('sslmode') || '').toLowerCase(),
        };
      }
      return {
        host: process.env.MYSQL_HOST,
        port: Number.parseInt(process.env.MYSQL_PORT || '3306', 10),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        ssl: String(process.env.MYSQL_SSLMODE || process.env.MYSQL_SSL || '').toLowerCase(),
      };
    };

    const mysqlCfg = resolveMySqlConfig();
    const sslMode = mysqlCfg.ssl;
    const ssl =
      sslMode === 'disable' || sslMode === 'false' || sslMode === '0'
        ? undefined
        : sslMode
          ? { rejectUnauthorized: false }
          : undefined;

    const pool = mysql.createPool({
      host: mysqlCfg.host,
      port: mysqlCfg.port,
      user: mysqlCfg.user,
      password: mysqlCfg.password,
      database: mysqlCfg.database,
      ssl,
      waitForConnections: true,
      connectionLimit: Number.parseInt(process.env.MYSQL_POOL_MAX || '10', 10),
      queueLimit: 0,
      enableKeepAlive: true,
    });

    const translatePgParamsToMySql = (sql) => String(sql || '').replace(/\$\d+/g, '?');

    const rewriteForMySql = (sql) => {
      let s = String(sql || '');
      s = s.replace(/^\s*BEGIN\s*;?\s*$/i, 'START TRANSACTION');
      s = s.replace(/\bALTER\s+TABLE\s+IF\s+EXISTS\s+/gi, 'ALTER TABLE ');
      s = s.replace(/\bCREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+/gi, 'CREATE UNIQUE INDEX ');
      s = s.replace(/\bCREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+/gi, 'CREATE INDEX ');
      s = s.replace(/\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+/gi, 'ADD COLUMN ');
      s = s.replace(/\bCOUNT\(\*\)::int\b/gi, 'CAST(COUNT(*) AS SIGNED)');
      s = s.replace(/::int\b/gi, '');
      s = s.replace(/metadata::json->>'campaign_id'/gi, "JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.campaign_id'))");
      s = s.replace(/EXTRACT\s*\(\s*DAY\s+FROM\s*\(\s*NOW\(\)\s*-\s*([^)]+)\)\s*\)/gi, 'TIMESTAMPDIFF(DAY, $1, NOW())');

      if (/\bON\s+CONFLICT\b/i.test(s)) {
        const doNothing = s.match(/\bON\s+CONFLICT\b[\s\S]*?\bDO\s+NOTHING\b/i);
        if (doNothing && /^\s*INSERT\b/i.test(s)) {
          s = s.replace(/\bON\s+CONFLICT\b[\s\S]*?\bDO\s+NOTHING\b/i, '');
          s = s.replace(/^\s*INSERT\s+INTO\b/i, 'INSERT IGNORE INTO');
        } else {
          const doUpdate = s.match(/\bON\s+CONFLICT\b[\s\S]*?\bDO\s+UPDATE\s+SET\b/i);
          if (doUpdate && /^\s*INSERT\b/i.test(s)) {
            s = s
              .replace(/\bON\s+CONFLICT\b\s*(\([^)]+\))?\s*\bDO\s+UPDATE\s+SET\b/i, 'ON DUPLICATE KEY UPDATE')
              .replace(/\bEXCLUDED\.(\w+)\b/gi, 'VALUES($1)');
          }
        }
      }

      return s;
    };

    const parseReturning = (sql) => {
      const m = String(sql || '').match(/\s+RETURNING\s+([\s\S]+)$/i);
      if (!m) return null;
      return { returning: m[1].trim(), baseSql: String(sql).slice(0, m.index).trim() };
    };

    const extractWhereForReturning = (sqlNoReturning) => {
      const upper = sqlNoReturning.toUpperCase();
      const whereIdx = upper.lastIndexOf(' WHERE ');
      if (whereIdx === -1) return null;
      return sqlNoReturning.slice(whereIdx + 7).trim();
    };

    const getParamValuesForClause = (clauseSql, params) => {
      const nums = String(clauseSql || '').match(/\$(\d+)/g) || [];
      return nums.map((t) => {
        const n = Number.parseInt(t.slice(1), 10);
        return params[n - 1];
      });
    };

    const query = async (sql, params = []) => {
      const returningInfo = parseReturning(sql);
      if (returningInfo) {
        const baseSql = returningInfo.baseSql;
        const returning = returningInfo.returning;
        if (/^\s*INSERT\b/i.test(baseSql)) {
          const tableMatch = baseSql.match(/^\s*INSERT\s+INTO\s+([`"\w.]+)/i);
          const table = tableMatch ? tableMatch[1] : null;
          const normalized = rewriteForMySql(translatePgParamsToMySql(baseSql));
          const [result] = await pool.query(normalized, params);
          const insertId = result && typeof result.insertId === 'number' ? result.insertId : null;
          if (!table || !insertId) {
            return { rows: [{ id: insertId }], rowCount: result?.affectedRows || 0 };
          }
          const cols = returning === '*' ? '*' : returning;
          if (cols.trim().toLowerCase() === 'id') {
            return { rows: [{ id: insertId }], rowCount: 1 };
          }
          const [rows] = await pool.query(`SELECT ${cols} FROM ${table} WHERE id = ?`, [insertId]);
          return { rows: rows || [], rowCount: Array.isArray(rows) ? rows.length : 0 };
        }

        if (/^\s*UPDATE\b/i.test(baseSql)) {
          const tableMatch = baseSql.match(/^\s*UPDATE\s+([`"\w.]+)/i);
          const table = tableMatch ? tableMatch[1] : null;
          const whereClausePg = extractWhereForReturning(baseSql);
          const whereParams = whereClausePg ? getParamValuesForClause(whereClausePg, params) : [];
          const whereClauseMySql = whereClausePg ? rewriteForMySql(translatePgParamsToMySql(whereClausePg)) : null;

          const normalized = rewriteForMySql(translatePgParamsToMySql(baseSql));
          const [result] = await pool.query(normalized, params);

          if (!table || !whereClauseMySql) {
            return { rows: [], rowCount: result?.affectedRows || 0 };
          }
          const cols = returning === '*' ? '*' : returning;
          const [rows] = await pool.query(`SELECT ${cols} FROM ${table} WHERE ${whereClauseMySql}`, whereParams);
          return { rows: rows || [], rowCount: Array.isArray(rows) ? rows.length : 0 };
        }
      }

      const normalized = rewriteForMySql(translatePgParamsToMySql(sql));
      try {
        const [rowsOrResult] = await pool.query(normalized, params);
        if (Array.isArray(rowsOrResult)) return { rows: rowsOrResult, rowCount: rowsOrResult.length };
        const rowCount = typeof rowsOrResult?.affectedRows === 'number' ? rowsOrResult.affectedRows : 0;
        const insertId = typeof rowsOrResult?.insertId === 'number' ? rowsOrResult.insertId : undefined;
        return { rows: insertId ? [{ id: insertId }] : [], rowCount };
      } catch (err) {
        const code = String(err?.code || '');
        const errno = Number(err?.errno || 0);
        if (code === 'ER_DUP_FIELDNAME' || errno === 1060) {
          if (/^\s*ALTER\s+TABLE\b/i.test(normalized) && /\bADD\s+COLUMN\b/i.test(normalized)) {
            return { rows: [], rowCount: 0 };
          }
        }
        if (code === 'ER_DUP_KEYNAME' || errno === 1061) {
          if (/^\s*CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(normalized)) {
            return { rows: [], rowCount: 0 };
          }
        }
        throw err;
      }
    };

    const getClient = async () => {
      const conn = await pool.getConnection();
      return {
        query: async (sql, params) => {
          const normalized = rewriteForMySql(translatePgParamsToMySql(sql));
          const [rowsOrResult] = await conn.query(normalized, params || []);
          if (Array.isArray(rowsOrResult)) return { rows: rowsOrResult, rowCount: rowsOrResult.length };
          const rowCount = typeof rowsOrResult?.affectedRows === 'number' ? rowsOrResult.affectedRows : 0;
          const insertId = typeof rowsOrResult?.insertId === 'number' ? rowsOrResult.insertId : undefined;
          return { rows: insertId ? [{ id: insertId }] : [], rowCount };
        },
        release: () => conn.release(),
      };
    };

    db = {
      query,
      getClient,
      pool,
      isSQLite: false,
      isPostgres: false,
      isMySQL: true,
      dialect: 'mysql',
    };
  } else {
    console.log('🗄️  Using PostgreSQL database');
    const { Pool } = require('pg');
    let ssl = { rejectUnauthorized: false };
    try {
      const u = new URL(connectionString);
      console.log(`🗄️  PG target: ${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname || ''}`);
      const sslmode = (u.searchParams.get('sslmode') || '').toLowerCase();
      if (sslmode === 'disable' || sslmode === 'allow') ssl = false;
      if (sslmode === 'no-verify') ssl = { rejectUnauthorized: false };
    } catch {}
    const envSslMode = (process.env.PGSSLMODE || '').toLowerCase();
    if (envSslMode === 'disable' || envSslMode === 'allow') ssl = false;

    const pool = new Pool({
      connectionString,
      ssl,
      keepAlive: true,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      max: Number.parseInt(process.env.PG_POOL_MAX || '10', 10),
    });
    pool.on('connect', () => {
      console.log('✅ Database connected');
    });
    pool.on('error', (err) => {
      console.error('❌ Database pool error:', err);
    });
    db = {
      query: (text, params) => pool.query(text, params),
      getClient: () => pool.connect(),
      pool,
      isSQLite: false,
      isPostgres: true,
      isMySQL: false,
      dialect: 'postgres',
    };
  }
}

module.exports = db;
