// Script d'urgence pour restaurer les GB perdus le lundi
const db = require('./src/config/database');

async function emergencyGBFix() {
  try {
    console.log('=== DEBUT REPARATION URGENCE GB ===');
    
    // 1. Récupérer tous les utilisateurs avec free_gb_remaining = 0
    const users = await db.query(`
      SELECT id, email, free_gb_remaining, free_credits_last_reset 
      FROM users 
      WHERE free_gb_remaining = 0 OR free_gb_remaining IS NULL
    `);
    
    console.log(`Trouve ${users.rows.length} utilisateurs avec 0GB`);
    
    if (users.rows.length === 0) {
      console.log('Aucun utilisateur a reparer');
      return;
    }
    
    // 2. Pour chaque utilisateur, ajouter 3GB
    for (const user of users.rows) {
      const weeklyGB = 3; // 3GB par semaine
      
      await db.query(`
        UPDATE users 
        SET free_gb_remaining = free_gb_remaining + $1,
            free_credits_last_reset = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [weeklyGB, user.id]);
      
      console.log(`+${weeklyGB}GB ajoutes pour utilisateur ${user.id} (${user.email})`);
    }
    
    // 3. Verifier les resultats
    const updatedUsers = await db.query(`
      SELECT id, email, free_gb_remaining 
      FROM users 
      WHERE free_gb_remaining > 0
      ORDER BY free_gb_remaining DESC
    `);
    
    console.log('\n=== RESULTATS APRES REPARATION ===');
    console.log(`Nombre d'utilisateurs avec des GB: ${updatedUsers.rows.length}`);
    
    updatedUsers.rows.forEach(user => {
      console.log(`User ${user.id} (${user.email}): ${user.free_gb_remaining}GB`);
    });
    
    console.log('\n=== REPARATION TERMINEE AVEC SUCCES ===');
    
  } catch (error) {
    console.error('ERREUR pendant la reparation:', error);
  } finally {
    process.exit(0);
  }
}

emergencyGBFix();
