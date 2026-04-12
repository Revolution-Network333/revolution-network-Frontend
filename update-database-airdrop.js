const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'backend', 'database', 'revolution_network.db');
const db = new sqlite3.Database(dbPath);

console.log('🔧 Mise à jour Airdrop & Admin Panel...');

db.serialize(() => {
  // 1. Ajouter colonnes Airdrop à la table users
  const columns = [
    { name: 'airdrop_score', type: 'REAL DEFAULT 0' },
    { name: 'airdrop_allocation', type: 'REAL DEFAULT 0' },
    { name: 'last_airdrop_calculation', type: 'TEXT' }
  ];

  columns.forEach(col => {
    db.run(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`, (err) => {
      if (err) {
        console.log(`ℹ️ Colonne ${col.name} existe déjà ou erreur:`, err.message);
      } else {
        console.log(`✅ Colonne ${col.name} ajoutée`);
      }
    });
  });

  // 2. Créer table settings (withdrawals_enabled)
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('❌ Erreur table settings:', err);
    else {
        console.log('✅ Table settings vérifiée');
        // Initialiser withdrawals_enabled à false si n'existe pas
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('withdrawals_enabled', 'false')`, (err) => {
            if (!err) console.log('✅ Setting withdrawals_enabled initialisé');
        });
    }
  });

  // 3. Créer table admin_logs
  db.run(`CREATE TABLE IF NOT EXISTS admin_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL,
    action_type TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES users(id)
  )`, (err) => {
    if (err) console.error('❌ Erreur table admin_logs:', err);
    else console.log('✅ Table admin_logs vérifiée');
  });

  // 4. Index pour admin_logs
  db.run(`CREATE INDEX IF NOT EXISTS idx_admin_logs_admin ON admin_logs(admin_id)`, (err) => {
      if(!err) console.log('✅ Index admin_logs créé');
  });

  setTimeout(() => {
    db.close();
    console.log('🏁 Migration terminée');
  }, 2000);
});
