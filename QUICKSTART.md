# 🚀 Guide de Démarrage Rapide (Windows)

## ✅ Ce qui est déjà fait

- ✅ Backend Node.js installé
- ✅ SQLite configuré (pas besoin de PostgreSQL pour débuter)
- ✅ Serveur lancé sur http://localhost:3000

## 📝 Étapes pour tester

### 1. Le backend tourne déjà !

Vous devriez voir dans le terminal :
```
🚀 Révolution Network Backend Started!
📡 Server:      http://localhost:3000
```

### 2. Tester l'API avec PowerShell

Créer un utilisateur de test :
```powershell
$body = @{
    email = "test@example.com"
    password = "password123"
    username = "testuser"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/api/auth/register" -Method Post -Body $body -ContentType "application/json"
```

Se connecter :
```powershell
$body = @{
    email = "test@example.com"
    password = "password123"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/login" -Method Post -Body $body -ContentType "application/json"
$token = $response.token
Write-Output "Token: $token"
```

Obtenir le profil :
```powershell
$headers = @{
    Authorization = "Bearer $token"
}

Invoke-RestMethod -Uri "http://localhost:3000/api/user/profile" -Method Get -Headers $headers
```

### 3. Ouvrir le site web

Dans un nouveau terminal PowerShell :
```powershell
cd "C:\Users\mxmpr\Downloads\Révolution Network"
python -m http.server 3001
```

Puis ouvrir : http://localhost:3001

### 4. Installer l'extension Chrome

1. Ouvrir Chrome
2. Aller à `chrome://extensions/`
3. Activer "Mode développeur" (en haut à droite)
4. Cliquer "Charger l'extension non empaquetée"
5. Sélectionner le dossier `chrome-extension`

**⚠️ Important** : Vous devez d'abord créer les icônes pour l'extension.

## 🎨 Créer les icônes de l'extension

Vous avez besoin de 4 icônes PNG dans `chrome-extension/assets/` :

- `icon-16.png` (16x16 pixels)
- `icon-32.png` (32x32 pixels)
- `icon-48.png` (48x48 pixels)
- `icon-128.png` (128x128 pixels)

**Option facile** : Utilisez un générateur d'icône en ligne comme :
- https://favicon.io/
- https://www.favicon-generator.org/

Ou créez-les avec un outil comme Paint.NET, GIMP, Photoshop.

**Suggestion de design** :
- Fond vert (#10b981)
- Lettre "R" blanche au centre
- Style moderne/minimaliste

## 📊 Vérifier que tout fonctionne

### Backend
✅ Serveur tourne sur http://localhost:3000
✅ Health check : http://localhost:3000/health

### Database
✅ Fichier créé : `backend/database/revolution_network.db`
✅ Tables créées automatiquement

### API
Test avec curl (si installé) :
```bash
curl http://localhost:3000/health
```

Devrait retourner :
```json
{"status":"ok","timestamp":"2026-02-09..."}
```

## 🔧 Commandes utiles

### Arrêter le backend
Appuyez sur `Ctrl+C` dans le terminal où tourne `npm start`

### Redémarrer le backend
```powershell
cd "C:\Users\mxmpr\Downloads\Révolution Network\backend"
npm start
```

### Voir les logs en temps réel
Les logs s'affichent directement dans le terminal

### Supprimer la base de données (reset)
```powershell
Remove-Item "C:\Users\mxmpr\Downloads\Révolution Network\backend\database\revolution_network.db"
```
Puis redémarrer le backend (la DB sera recréée)

## 🐛 Problèmes courants

### Port 3000 déjà utilisé
Changez le port dans `.env` :
```
PORT=3001
```

### Extension ne se charge pas
Vérifiez que les icônes existent dans `chrome-extension/assets/`

### CORS errors
Vérifiez que `FRONTEND_URL` dans `.env` correspond à votre URL

## 📱 Tester le P2P

Pour tester le réseau P2P, vous avez besoin de :
1. Au moins 2 comptes utilisateurs
2. L'extension installée sur 2 navigateurs/profils Chrome différents
3. Les deux extensions "Démarrées"

Les connexions P2P se feront automatiquement entre les pairs actifs.

## 🎯 Prochaines étapes

1. ✅ Backend fonctionne
2. ⏳ Créer les icônes de l'extension
3. ⏳ Installer l'extension Chrome
4. ⏳ Tester les connexions P2P
5. ⏳ (Optionnel) Migrer vers PostgreSQL pour production
6. ⏳ (Optionnel) Déployer sur un VPS

## 📖 Documentation complète

Voir [DOCUMENTATION.md](./DOCUMENTATION.md) pour :
- Déploiement production
- Configuration TURN server
- PostgreSQL setup
- Docker deployment

---

**Tout fonctionne avec SQLite pour l'instant !** 🎉

Vous pouvez développer et tester localement sans avoir besoin d'installer PostgreSQL.
