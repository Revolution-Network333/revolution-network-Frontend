# 🚀 Révolution Network - Documentation Complète

## 📋 Vue d'ensemble

Révolution Network est une plateforme P2P décentralisée permettant aux utilisateurs de partager leur bande passante et de gagner des points pour un futur airdrop.

### Architecture
- **Frontend**: Site web (HTML/CSS/JS)
- **Backend**: Node.js + Express + Socket.IO
- **Database**: PostgreSQL
- **P2P**: WebRTC (STUN + TURN)
- **Extension**: Chrome Manifest V3

---

## 🛠️ Installation

### Prérequis
- Node.js 18+ 
- PostgreSQL 14+
- Git

### 1. Backend Setup

```bash
cd backend
npm install
```

### 2. Configuration de la base de données

```bash
# Créer la base de données
createdb revolution_network

# Importer le schéma
psql revolution_network < ../database/schema.sql
```

### 3. Configuration des variables d'environnement

Copier `env-example.txt` vers `.env` et modifier les valeurs :

```env
NODE_ENV=production
PORT=3000

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=revolution_network
DB_USER=postgres
DB_PASSWORD=YOUR_PASSWORD

# JWT Secret (GÉNÉRER UN SECRET FORT!)
JWT_SECRET=YOUR_STRONG_SECRET_HERE
JWT_REFRESH_SECRET=YOUR_REFRESH_SECRET_HERE

# WebRTC
TURN_SERVER=turn:your-turn-server.com:3478
TURN_USERNAME=username
TURN_PASSWORD=password
```

### 4. Démarrer le backend

```bash
npm start
# ou pour le développement
npm run dev
```

---

## 🔧 Configuration TURN Server (Coturn)

Le TURN server est **obligatoire** pour que les connexions WebRTC fonctionnent derrière NAT/Firewall.

### Installation sur Ubuntu/Debian

```bash
sudo apt update
sudo apt install coturn

# Éditer la configuration
sudo nano /etc/turnserver.conf
```

### Configuration minimale

```conf
# /etc/turnserver.conf
listening-port=3478
fingerprint
lt-cred-mech
user=username:password
realm=your-domain.com
total-quota=100
stale-nonce=600
cert=/etc/letsencrypt/live/your-domain.com/cert.pem
pkey=/etc/letsencrypt/live/your-domain.com/privkey.pem
no-stdout-log
log-file=/var/log/turnserver.log
```

### Démarrer Coturn

```bash
sudo systemctl enable coturn
sudo systemctl start coturn
sudo systemctl status coturn
```

### Ouvrir les ports (Firewall)

```bash
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 49152:65535/udp  # Range pour les media ports
```

---

## 🌐 Déploiement

### Option 1: VPS (OVH, Scaleway, DigitalOcean)

#### Backend

```bash
# Sur le VPS
git clone https://github.com/your-repo/revolution-network.git
cd revolution-network/backend
npm install --production

# PM2 pour gérer le processus
npm install -g pm2
pm2 start src/server.js --name revolution-backend
pm2 save
pm2 startup
```

#### Nginx reverse proxy

```nginx
server {
    listen 80;
    server_name api.revolution-network.io;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket support
    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

#### Frontend

```bash
# Copier les fichiers du site
scp -r index.html styles.css user@server:/var/www/revolution-network/

# Nginx config pour le site
server {
    listen 80;
    server_name revolution-network.io;
    root /var/www/revolution-network;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

### Option 2: Docker (Recommandé)

#### Backend Dockerfile

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["node", "src/server.js"]
```

#### docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:14-alpine
    environment:
      POSTGRES_DB: revolution_network
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./database/schema.sql:/docker-entrypoint-initdb.d/schema.sql
    ports:
      - "5432:5432"

  backend:
    build: ./backend
    environment:
      NODE_ENV: production
      DB_HOST: postgres
      PORT: 3000
    ports:
      - "3000:3000"
    depends_on:
      - postgres
    restart: unless-stopped

  coturn:
    image: coturn/coturn
    network_mode: host
    volumes:
      - ./turnserver.conf:/etc/coturn/turnserver.conf
    restart: unless-stopped

volumes:
  postgres_data:
```

Démarrer :

```bash
docker-compose up -d
```

---

## 🔐 Sécurité

### 1. HTTPS Obligatoire

WebRTC **nécessite HTTPS** en production. Utiliser Let's Encrypt :

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d revolution-network.io -d api.revolution-network.io
```

### 2. Rate Limiting

Le backend inclut un rate limiting de base. Pour une protection avancée, utiliser **Cloudflare**.

### 3. Environnement Variables

**JAMAIS** commit les secrets dans Git. Toujours utiliser `.env` et l'ajouter à `.gitignore`.

### 4. JWT Secrets

Générer des secrets forts :

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## 🧪 Tests

### Tester l'API

```bash
# Register
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","username":"testuser"}'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Create session (avec token)
curl -X POST http://localhost:3000/api/session/create \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

---

## 📦 Extension Chrome

### Installation en mode développeur

1. Ouvrir Chrome et aller à `chrome://extensions/`
2. Activer "Mode développeur"
3. Cliquer sur "Charger l'extension non empaquetée"
4. Sélectionner le dossier `chrome-extension`

### Publication sur Chrome Web Store

1. Créer un compte développeur Google (5$ one-time fee)
2. Zipper le dossier `chrome-extension`
3. Upload sur https://chrome.google.com/webstore/devconsole
4. Remplir les informations (description, captures d'écran, etc.)
5. Soumettre pour review (1-3 jours)

---

## 📊 Monitoring

### Logs

```bash
# Logs backend (PM2)
pm2 logs revolution-backend

# Logs Coturn
tail -f /var/log/turnserver.log

# Logs PostgreSQL
sudo tail -f /var/log/postgresql/postgresql-14-main.log
```

### Métriques importantes

- Nombre d'utilisateurs connectés
- Sessions actives
- Bande passante totale échangée
- Points distribués par jour
- Taux de connexion réussie WebRTC

---

## 🐛 Troubleshooting

### Les connexions WebRTC échouent

1. Vérifier que TURN est bien configuré
2. Vérifier les ports firewall
3. Tester avec `https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/`

### Erreur "Too many connections"

Augmenter la limite PostgreSQL :

```sql
ALTER SYSTEM SET max_connections = 200;
SELECT pg_reload_conf();
```

### Extension ne se connecte pas

1. Vérifier l'URL de l'API dans `service-worker.js`
2. Vérifier les permissions dans `manifest.json`
3. Recharger l'extension (`chrome://extensions/`)

---

## 📈 Scaling

### Database

- Utiliser **connection pooling** (déjà configuré)
- Indexer les colonnes fréquemment recherchées
- Mettre en cache avec **Redis** pour les stats

### Backend

- Load balancer Nginx devant plusieurs instances Node.js
- Utiliser **PM2 cluster mode**

```bash
pm2 start src/server.js -i max --name revolution-backend
```

### TURN Server

- Limiter le débit par utilisateur
- Utiliser plusieurs TURN servers (load balancing)

---

## 💰 Coûts estimés (pour 1000 utilisateurs actifs)

- **VPS Backend** (4GB RAM): 10-20€/mois
- **VPS TURN** (8GB RAM): 20-40€/mois
- **Database PostgreSQL** (managed): 15-30€/mois
- **Domaine**: 10€/an
- **Bande passante**: Variable selon usage

**Total**: ~50-100€/mois

---

## 📞 Support

Pour toute question, contacter : support@revolution-network.io

---

## 📜 Licence

MIT License - Libre d'utilisation et de modification.
