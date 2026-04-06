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

// --- SQL HELPERS (Global Scope) ---

const translatePgParamsToMySql = (sql, params) => {
  let s = String(sql || '');
  const p = [...(params || [])];
  const matches = s.match(/\$\d+/g) || [];
  if (matches.length === 0) return { sql: s, params: p };

  const paramMap = new Map();
  matches.forEach(m => {
    const idx = parseInt(m.slice(1)) - 1;
    if (idx >= 0 && idx < p.length) {
      paramMap.set(m, p[idx]);
    }
  });

  const newParams = [];
  const translatedSql = s.replace(/\$\d+/g, (match) => {
    const val = paramMap.get(match);
    newParams.push(val);
    return '?';
  });

  return { sql: translatedSql, params: newParams };
};

const rewriteForMySql = (sql) => {
  let s = String(sql || '');
  const retMatch = s.match(/\s+RETURNING\s+([\s\S]+)$/i);
  if (retMatch) s = s.slice(0, retMatch.index).trim();

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
  s = s.replace(/EXTRACT\s*\(\s*EPOCH\s+FROM\s*([^)]+)\)/gi, 'UNIX_TIMESTAMP($1)');

  s = s.replace(/\b(rank|key|value)\b/gi, (...args) => {
    const match = args[0];
    const str = args[args.length - 1];
    const offset = args[args.length - 2];
    if (typeof str !== 'string') return match;
    const prev = str[offset - 1];
    const next = str[offset + match.length];
    if (prev === '`' || next === '`') return match;
    const before = str.slice(Math.max(0, offset - 20), offset).toUpperCase();
    if (match.toLowerCase() === 'key' && (before.includes('PRIMARY') || before.includes('UNIQUE') || before.includes('FOREIGN'))) {
      return match;
    }
    return '`' + match + '`';
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
  s = s.replace(/INTERVAL\s+'(\d+)\s+minutes?'/gi, 'INTERVAL $1 MINUTE');
  s = s.replace(/INTERVAL\s+'(\d+)\s+hours?'/gi, 'INTERVAL $1 HOUR');
  s = s.replace(/INTERVAL\s+'(\d+)\s+seconds?'/gi, 'INTERVAL $1 SECOND');

  // Fix: handle trailing single quote if left by the above regexes (PostgreSQL syntax is INTERVAL '5 minutes')
  s = s.replace(/INTERVAL\s+(\d+)\s+(DAY|WEEK|MONTH|YEAR|MINUTE|HOUR|SECOND)'/gi, 'INTERVAL $1 $2');
  
  s = s.replace(/\bJSONB\b/gi, 'JSON');
  s = s.replace(/\bSERIAL\b/gi, 'BIGINT UNSIGNED AUTO_INCREMENT');
  s = s.replace(/\bTIMESTAMP\b/gi, 'DATETIME');
  
  // MySQL doesn't allow DEFAULT on TEXT/BLOB/JSON columns. Convert to VARCHAR(255) if it has a default.
  s = s.replace(/\bTEXT\s+DEFAULT\s+(['"][^'"]*['"])/gi, 'VARCHAR(255) DEFAULT $1');

  if (/\bON\s+CONFLICT\b/i.test(s)) {
    const doNothing = s.match(/\bON\s+CONFLICT\b[\s\S]*?\bDO\s+NOTHING\b/i);
    if (doNothing && /^\s*INSERT\b/i.test(s)) {
      s = s.replace(/\bON\s+CONFLICT\b[\s\S]*?\bDO\s+NOTHING\b/i, '');
      s = s.replace(/^\s*INSERT\s+INTO\b/i, 'INSERT IGNORE INTO');
    } else {
      const doUpdate = s.match(/\bON\s+CONFLICT\b[\s\S]*?\bDO\s+UPDATE\s+SET\b/i);
      if (doUpdate && /^\s*INSERT\b/i.test(s)) {
        s = s.replace(/\bON\s+CONFLICT\b\s*(\([^)]+\))?\s*\bDO\s+UPDATE\s+SET\b/i, 'ON DUPLICATE KEY UPDATE')
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

const simulateQuery = async (executor, sql, params = []) => {
  let returningInfo = parseReturning(sql);
  if (!returningInfo) {
    const upper = String(sql || '').toUpperCase();
    const retIdx = upper.lastIndexOf(' RETURNING ');
    if (retIdx !== -1) {
      returningInfo = {
        returning: String(sql).slice(retIdx + 11).trim(),
        baseSql: String(sql).slice(0, retIdx).trim()
      };
    }
  }

  if (returningInfo) {
    const { baseSql, returning } = returningInfo;
    const cols = returning === '*' ? '*' : returning;
    
    if (/^\s*INSERT\b/i.test(baseSql)) {
      const tableMatch = baseSql.match(/^\s*INSERT\s+INTO\s+([`"\w.]+)/i);
      const table = tableMatch ? tableMatch[1] : null;
      const { sql: translatedSql, params: translatedParams } = translatePgParamsToMySql(baseSql, params);
      const normalized = rewriteForMySql(translatedSql);
      const [result] = await executor.query(normalized, translatedParams);
      const insertId = result?.insertId;
      if (!table || !insertId) return { rows: [{ id: insertId }], rowCount: result?.affectedRows || 0 };
      if (cols.trim().toLowerCase() === 'id') return { rows: [{ id: insertId }], rowCount: 1 };
      const selSql = rewriteForMySql(`SELECT ${cols} FROM ${table} WHERE id = ?`);
      const [rows] = await executor.query(selSql, [insertId]);
      return { rows: rows || [], rowCount: Array.isArray(rows) ? rows.length : 0 };
    }
    
    if (/^\s*UPDATE\b/i.test(baseSql)) {
      const tableMatch = baseSql.match(/^\s*UPDATE\s+([`"\w.]+)/i);
      const table = tableMatch ? tableMatch[1] : null;
      const whereClause = extractWhereForReturning(baseSql);
      const { sql: translatedSql, params: translatedParams } = translatePgParamsToMySql(baseSql, params);
      const normalized = rewriteForMySql(translatedSql);
      const [result] = await executor.query(normalized, translatedParams);
      if (!table || !whereClause) return { rows: [], rowCount: result?.affectedRows || 0 };
      const whereParamValues = getParamValuesForClause(whereClause, params);
      const { sql: selSql, params: selParams } = translatePgParamsToMySql(`SELECT ${cols} FROM ${table} WHERE ${whereClause}`, whereParamValues);
      const normalizedSel = rewriteForMySql(selSql);
      const [rows] = await executor.query(normalizedSel, selParams);
      return { rows: rows || [], rowCount: Array.isArray(rows) ? rows.length : 0 };
    }

    if (/^\s*DELETE\b/i.test(baseSql)) {
      const tableMatch = baseSql.match(/^\s*DELETE\s+FROM\s+([`"\w.]+)/i);
      const table = tableMatch ? tableMatch[1] : null;
      const whereClause = extractWhereForReturning(baseSql);
      if (table && whereClause) {
        const whereParamValues = getParamValuesForClause(whereClause, params);
        const { sql: selSql, params: selParams } = translatePgParamsToMySql(`SELECT ${cols} FROM ${table} WHERE ${whereClause}`, whereParamValues);
        const normalizedSel = rewriteForMySql(selSql);
        const [rowsToReturn] = await executor.query(normalizedSel, selParams);
        const { sql: translatedSql, params: translatedParams } = translatePgParamsToMySql(baseSql, params);
        const normalized = rewriteForMySql(translatedSql);
        const [result] = await executor.query(normalized, translatedParams);
        return { rows: rowsToReturn || [], rowCount: result?.affectedRows || 0 };
      }
    }
  }

  const { sql: translatedSql, params: translatedParams } = translatePgParamsToMySql(sql, params);
  const normalized = rewriteForMySql(translatedSql);
  try {
    const [rowsOrResult] = await executor.query(normalized, translatedParams);
    if (Array.isArray(rowsOrResult)) return { rows: rowsOrResult, rowCount: rowsOrResult.length };
    return { rows: rowsOrResult?.insertId ? [{ id: rowsOrResult.insertId }] : [], rowCount: rowsOrResult?.affectedRows || 0 };
  } catch (err) {
    if (err.errno === 1060 || err.errno === 1061) return { rows: [], rowCount: 0 };
    throw err;
  }
};

// --- DATABASE INITIALIZATION ---

let db;

function shouldUseMySql() {
  if (envDialect === 'mysql') return true;
  if (mysqlUrl) return true;
  if (String(connectionString || '').toLowerCase().startsWith('mysql://')) return true;
  if (process.env.MYSQL_HOST || process.env.MYSQL_USER || process.env.MYSQL_DATABASE) return true;
  return false;
}

if (sqliteForced || (!connectionString && !shouldUseMySql())) {
  console.log('🗄️  Using SQLite database');
  db = require('./database-sqlite');
} else if (shouldUseMySql()) {
  console.log('🗄️  Using MySQL database');
  const mysql = require('mysql2/promise');

  const resolveMySqlConfig = () => {
    const urlToUse = mysqlUrl || connectionString;
    if (urlToUse.toLowerCase().startsWith('mysql://')) {
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
  const pool = mysql.createPool({
    ...mysqlCfg,
    ssl: mysqlCfg.ssl ? { rejectUnauthorized: false } : undefined,
    waitForConnections: true,
    connectionLimit: Number.parseInt(process.env.MYSQL_POOL_MAX || '10', 10),
    queueLimit: 0,
    enableKeepAlive: true,
  });

  db = {
    query: (sql, params) => simulateQuery(pool, sql, params),
    getClient: async () => {
      const conn = await pool.getConnection();
      return {
        query: (sql, params) => simulateQuery(conn, sql, params),
        release: () => conn.release(),
      };
    },
    pool,
    isMySQL: true,
    dialect: 'mysql',
  };
} else {
  console.log('🗄️  Using PostgreSQL database');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  db = {
    query: (text, params) => pool.query(text, params),
    getClient: () => pool.connect(),
    pool,
    isPostgres: true,
    dialect: 'postgres',
  };
}

module.exports = db;
