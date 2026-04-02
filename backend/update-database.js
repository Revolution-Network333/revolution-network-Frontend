const sqlite3 = require('./backend/node_modules/sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'backend', 'database', 'revolution_network.db');
const db = new sqlite3.Database(dbPath);

console.log('🔧 Mise à jour de la base de données...');

db.serialize(() => {
  // Ajouter la colonne solana_address
  db.run("ALTER TABLE users ADD COLUMN solana_address TEXT", (err) => {
    if (err) {
      console.log('ℹ️ Colonne solana_address existe déjà ou erreur:', err.message);
    } else {
      console.log('✅ Colonne solana_address ajoutée');
    }
  });

  // Ajouter la colonne profile_picture_url
  db.run("ALTER TABLE users ADD COLUMN profile_picture_url TEXT", (err) => {
    if (err) {
      console.log('ℹ️ Colonne profile_picture_url existe déjà ou erreur:', err.message);
    } else {
      console.log('✅ Colonne profile_picture_url ajoutée');
    }
  });

  // Réinitialiser tous les points à 0
  db.run("UPDATE users SET total_points = 0", (err) => {
    if (err) {
      console.error('❌ Erreur lors de la réinitialisation des points:', err);
    } else {
      console.log('✅ Tous les points ont été réinitialisés à 0');
    }
  });

  // Vérifier les résultats
  setTimeout(() => {
    db.all("SELECT id, username, email, total_points, solana_address, profile_picture_url FROM users", (err, rows) => {
      if (err) {
        console.error('❌ Erreur lors de la vérification:', err);
      } else {
        console.log('📊 Utilisateurs après mise à jour:');
        rows.forEach(user => {
          console.log(`  - ${user.username}: ${user.total_points} points`);
          console.log(`    Solana: ${user.solana_address || 'non défini'}`);
          console.log(`    Avatar: ${user.profile_picture_url || 'non défini'}`);
        });
      }
      db.close();
      console.log('✅ Mise à jour terminée');
    });
  }, 1000);
});