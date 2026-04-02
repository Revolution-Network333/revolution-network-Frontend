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
      s = s.replace(/EXTRACT\s*\(\s*EPOCH\s+FROM\s*\(([^)]+)\s*-\s*([^)]+)\)\)/gi, 'TIMESTAMPDIFF(SECOND, $2, $1)');
      s = s.replace(/EXTRACT\s*\(\s*EPOCH\s+FROM\s*([^)]+)\)/gi, 'UNIX_TIMESTAMP($1)'); // Fallback for simple cases if needed

      // MySQL reserved keywords and PostgreSQL specific syntax
      s = s.replace(/(\b)rank(\b)/gi, (m, p1, p2, offset, str) => {
        const prev = str[offset - 1];
        const next = str[offset + m.length];
        if (prev === '`' && next === '`') return m;
        return '`rank`';
      });
      s = s.replace(/to_char\(([^,]+)::date,\s*'YYYY-MM-DD'\)/gi, 'DATE_FORMAT($1, "%Y-%m-%d")');
      s = s.replace(/to_char\(([^,]+),\s*'YYYY-MM-DD'\)/gi, 'DATE_FORMAT($1, "%Y-%m-%d")');
      s = s.replace(/to_char\(date_trunc\('year',\s*([^)]+)\),\s*'YYYY'\)/gi, 'DATE_FORMAT($1, "%Y")');
      s = s.replace(/to_char\(date_trunc\('month',\s*([^)]+)\),\s*'YYYY-MM'\)/gi, 'DATE_FORMAT($1, "%Y-%m")');
      s = s.replace(/to_char\(date_trunc\('week',\s*([^)]+)\),\s*'IYYY-"W"IW'\)/gi, 'DATE_FORMAT($1, "%x-W%v")');
      s = s.replace(/date_trunc\('year',\s*([^)]+)\)/gi, 'STR_TO_DATE(DATE_FORMAT($1, "%Y-01-01"), "%Y-%m-%d")');
      s = s.replace(/date_trunc\('month',\s*([^)]+)\)/gi, 'STR_TO_DATE(DATE_FORMAT($1, "%Y-%m-01"), "%Y-%m-%d")');
      s = s.replace(/date_trunc\('week',\s*([^)]+)\)/gi, 'STR_TO_DATE(DATE_FORMAT($1, "%x%v1"), "%x%v%w")');
      s = s.replace(/([^(\s]+)::date\b/gi, 'DATE($1)');
      s = s.replace(/::date\b/gi, '');
      s = s.replace(/\bCURRENT_DATE\b/gi, 'CURDATE()');
      s = s.replace(/\bCURRENT_TIMESTAMP\b/gi, 'NOW()');
      s = s.replace(/INTERVAL\s+'(\d+)\s+days?'/gi, 'INTERVAL $1 DAY');
      s = s.replace(/INTERVAL\s+'(\d+)\s+weeks?'/gi, 'INTERVAL $1 WEEK');
      s = s.replace(/INTERVAL\s+'(\d+)\s+months?'/gi, 'INTERVAL $1 MONTH');
      s = s.replace(/INTERVAL\s+'(\d+)\s+years?'/gi, 'INTERVAL $1 YEAR');
      s = s.replace(/DATE\(([^)]+)\)\s*=\s*p_date/gi, 'DATE($1) = p_date'); // Ensure DATE() is used for MySQL if needed, but p_date might be a param.
      
      // PostgreSQL specific types
      s = s.replace(/\bJSONB\b/gi, 'JSON');
      s = s.replace(/\bSERIAL\b/gi, 'BIGINT UNSIGNED AUTO_INCREMENT');
      s = s.replace(/\bTIMESTAMP\b/gi, 'DATETIME');

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

        if (/^\s*DELETE\b/i.test(baseSql)) {
          const tableMatch = baseSql.match(/^\s*DELETE\s+FROM\s+([`"\w.]+)/i);
          const table = tableMatch ? tableMatch[1] : null;
          const whereClausePg = extractWhereForReturning(baseSql);
          const whereParams = whereClausePg ? getParamValuesForClause(whereClausePg, params) : [];
          const whereClauseMySql = whereClausePg ? rewriteForMySql(translatePgParamsToMySql(whereClausePg)) : null;

          const normalized = rewriteForMySql(translatePgParamsToMySql(baseSql));
          const [result] = await pool.query(normalized, params);

          const rowCount = result?.affectedRows || 0;
          if (rowCount === 0) return { rows: [], rowCount: 0 };

          // For DELETE ... RETURNING, we cannot select after delete.
          // However, if we're only returning 'id', we might have it in params if it was a 'WHERE id = ?'
          // For simplicity, if we are returning 'id' and it was a direct ID delete, we can mock it.
          // Otherwise, we just return empty rows but with correct rowCount.
          if (returning.toLowerCase() === 'id' && whereClauseMySql && whereClauseMySql.includes('id = ?')) {
             // Find the index of 'id = ?' in whereClauseMySql to get the correct param
             const parts = whereClauseMySql.split(/\bAND\b/i);
             const idPartIdx = parts.findIndex(p => p.toLowerCase().includes('id = ?'));
             if (idPartIdx !== -1 && whereParams[idPartIdx] !== undefined) {
                return { rows: [{ id: whereParams[idPartIdx] }], rowCount };
             }
          }
          return { rows: [], rowCount };
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
