const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '../../database');
const dbPath = path.join(dbDir, 'revolution_network.db');
const schemaPath = path.join(__dirname, '../../../database/schema-sqlite.sql');

// Créer le dossier database s'il n'existe pas
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log('📁 Created database directory');
}

// Créer la base de données
const db = new Database(dbPath);
console.log('📊 Database file:', dbPath);

// Initialiser le schéma si la base est vide
const initDatabase = () => {
  try {
    // Vérifier si les tables existent
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    
    if (!tableCheck) {
      console.log('📊 Initializing database schema...');
      const schema = fs.readFileSync(schemaPath, 'utf8');
      
      // Exécuter le schéma
      db.exec(schema);
      
      console.log('✅ Database schema initialized');
    } else {
      console.log('✅ Database already initialized');
    }

    // Airdrop columns (idempotent)
    try { db.exec("ALTER TABLE users ADD COLUMN airdrop_score REAL DEFAULT 0"); } catch (e) { /* already exists */ }
    try { db.exec("ALTER TABLE users ADD COLUMN airdrop_allocation REAL DEFAULT 0"); } catch (e) { /* already exists */ }
    try { db.exec("ALTER TABLE users ADD COLUMN last_airdrop_calculation TEXT"); } catch (e) { /* already exists */ }
    try { db.exec("ALTER TABLE users ADD COLUMN is_rank_locked INTEGER DEFAULT 0"); } catch (e) { /* already exists */ }

    // Settings table (withdrawals_enabled)
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('withdrawals_enabled', 'false')`);

    // Admin logs table aligned with backend usage
    db.exec(`
      CREATE TABLE IF NOT EXISTS admin_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        details TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (admin_id) REFERENCES users(id)
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_admin_logs_admin ON admin_logs(admin_id)`);

    // Ensure tasks table exists (idempotent)
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL,
        link_url TEXT,
        reward_points INTEGER DEFAULT 0,
        reward_airdrop_bonus_percent INTEGER DEFAULT 0,
        active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_active ON tasks(active)`);

    // Ensure user_tasks table exists (idempotent)
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        task_id INTEGER NOT NULL,
        status TEXT DEFAULT 'not_started',
        timestamp_click TEXT,
        timestamp_approved TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_tasks_user ON user_tasks(user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_tasks_task ON user_tasks(task_id)`);
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  }
};

// Initialiser au démarrage
initDatabase();

// Configuration pour de meilleures performances
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// Helper pour les requêtes
const query = (sql, params = []) => {
  try {
    const sqlWithPlaceholders = sql.replace(/\$\d+/g, '?');
    console.log('[SQLite] SQL:', sqlWithPlaceholders, 'Params:', params);
    const stmt = db.prepare(sqlWithPlaceholders);
    
    // Si c'est un SELECT ou PRAGMA
    const upperSql = sqlWithPlaceholders.trim().toUpperCase();
    if (upperSql.startsWith('SELECT') || upperSql.startsWith('PRAGMA')) {
      return { rows: stmt.all(...params) };
    }
    
    // Si c'est un INSERT/UPDATE/DELETE
    const result = stmt.run(...params);
    return { 
      rows: [{ id: result.lastInsertRowid }],
      rowCount: result.changes
    };
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

// Helper pour obtenir un client (compatibilité avec pg)
const getClient = () => {
  return {
    query: (sql, params) => query(sql, params),
    release: () => {},
  };
};

module.exports = {
  query,
  getClient,
  db,
  isSQLite: true,
  dialect: 'sqlite'
};
