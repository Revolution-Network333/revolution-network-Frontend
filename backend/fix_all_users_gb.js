// Script pour ajouter 3GB a tous les utilisateurs via API admin
const http = require('http');
const https = require('https');

// Configuration
const BASE_URL = 'http://localhost:10000'; // Backend local
const ADMIN_TOKEN = 'votre_admin_token_ici'; // A remplacer

async function makeRequest(path, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    
    const options = {
      hostname: 'localhost',
      port: 10000,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': `Bearer ${ADMIN_TOKEN}`
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const result = JSON.parse(responseData);
          resolve(result);
        } catch (e) {
          resolve(responseData);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

async function fixAllUsers() {
  try {
    console.log('=== DEBUT REPARATION GB POUR TOUS LES UTILISATEURS ===');
    
    // Récupérer tous les utilisateurs depuis l'API admin
    const usersResponse = await makeRequest('/api/admin/users', {});
    
    if (!usersResponse.users || !Array.isArray(usersResponse.users)) {
      console.error('Erreur: impossible de récupérer la liste des utilisateurs');
      console.log('Response:', usersResponse);
      return;
    }
    
    console.log(`Trouvé ${usersResponse.users.length} utilisateurs`);
    
    // Pour chaque utilisateur, ajouter 3GB
    for (const user of usersResponse.users) {
      const userId = user.id;
      const userEmail = user.email || 'unknown';
      
      try {
        const result = await makeRequest('/api/admin/users/' + userId + '/bonus', {
          type: 'points_api',
          qty: 3 // 3GB
        });
        
        console.log(`+3GB ajoutés pour utilisateur ${userId} (${userEmail}) - Result:`, result);
        
        // Pause pour éviter de surcharger l'API
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`Erreur pour utilisateur ${userId}:`, error.message);
      }
    }
    
    console.log('\n=== REPARATION TERMINEE ===');
    console.log('Tous les utilisateurs devraient maintenant avoir 3GB supplémentaires');
    
  } catch (error) {
    console.error('Erreur générale:', error);
  }
}

// Instructions pour l'utilisateur
console.log(`
=== INSTRUCTIONS POUR UTILISER CE SCRIPT ===

1. Démarrer le backend local: npm start
2. Récupérer un token admin depuis l'interface admin
3. Modifier la variable ADMIN_TOKEN dans ce script
4. Lancer: node fix_all_users_gb.js

Ce script va ajouter 3GB à tous les utilisateurs existants.
`);

fix_allUsers();
