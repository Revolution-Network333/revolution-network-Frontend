# 🌐 Revolution Network

**Revolution Network** est un écosystème décentralisé P2P conçu pour le partage de bande passante avec un système de récompenses intégré. Ce projet combine une architecture backend robuste avec une application desktop pour offrir une expérience utilisateur fluide et sécurisée.

---

## 🔍 What is Revolution Network?

Revolution Network est une infrastructure physique décentralisée (**DePIN**) permettant aux utilisateurs de monétiser leur bande passante inutilisée. En transformant chaque appareil connecté en un nœud actif du réseau, nous créons une couche de transport de données distribuée, résiliente et performante.

---

## ⚙️ How it works

Le flux opérationnel du réseau suit un modèle de contribution simple :

`User → Node → Network → Contribution → Rewards (Aether ATH)`

1.  **User** : Installe et configure l'application.
2.  **Node** : L'appareil devient un point de présence sur le réseau.
3.  **Network** : Les ressources sont agrégées pour répondre aux besoins de l'infrastructure.
4.  **Contribution** : La mesure en temps réel de la bande passante partagée.
5.  **Rewards** : Distribution automatique de jetons ATH basée sur la contribution réelle.

---

## 💎 Aether (ATH)

**Aether (ATH)** est le token utilitaire natif de Revolution Network. Il sert de moteur économique à l'écosystème :
- **Récompenses** : Incitation financière pour les opérateurs de nodes en fonction de leur uptime et volume partagé.
- **Gouvernance & Participation** : Accès aux services avancés du réseau et participation active à l'infrastructure.

---

## 🚀 Get Started

Prêt à rejoindre le réseau ?
- **Run a Node** : L'application de minage est actuellement en cours de développement (WIP / Coming Soon).
- **Join Discord** : [Rejoindre notre communauté](https://discord.gg/eadE7uK6ss) pour le support et les échanges.
- **Follow us on X** : Suivez [@revo_network_](https://x.com/revo_network_) pour les dernières annonces officielles.

---

## 🚀 Fonctionnalités Clés

- **Partage P2P (WebRTC) :** Optimisation de la bande passante via des protocoles de communication décentralisés.
- **Système de Récompenses :** Mécanisme intégré pour récompenser les utilisateurs partageant leurs ressources.
- **Sécurité Renforcée :** Authentification JWT, protection contre les attaques par force brute (rate-limit), et en-têtes de sécurité (Helmet).
- **Architecture Multi-couches :** Séparation claire entre le backend, l'application desktop et les scripts utilitaires.
- **Compatibilité Multi-DB :** Support de MySQL (Production) et SQLite (Développement local).

---

## 📁 Structure du Projet

- **`/backend`** : Le cœur du système. API REST Express gérant l'authentification, les transactions, et les tâches.
- **`/desktop-app`** : Application client (Electron/JS) permettant aux utilisateurs de se connecter au réseau.
- **`/src`** : Serveur relais (Proxy) pour faciliter le déploiement sur des plateformes comme Render.
- **`/scripts`** : Outils utilitaires pour la génération d'icônes et la gestion des clés API.

---

## 🛠️ Installation et Configuration

### Prérequis

- Node.js (v18+)
- MySQL (ou SQLite pour le développement local)

### Installation Locale

1.  **Cloner le dépôt :**
    ```bash
    git clone https://github.com/Revolution-Network333/Revolution-Network.git
    cd Revolution-Network
    ```

2.  **Installer les dépendances (Racine et Backend) :**
    ```bash
    npm install
    ```
    *(Le script post-install installera automatiquement les dépendances du dossier `/backend`)*

3.  **Configurer les variables d'environnement :**
    Créez un fichier `.env` dans le dossier `/backend` en vous basant sur `env-example.txt` :
    ```env
    PORT=3000
    MYSQL_URL=your_mysql_url
    JWT_SECRET=your_jwt_secret
    GOOGLE_CLIENT_ID=your_google_id
    ```

4.  **Lancer le serveur :**
    ```bash
    npm start
    ```

---

## ☁️ Déploiement (Render)

Pour déployer sur Render, utilisez les paramètres suivants :

- **Root Directory :** *(Laisser vide)*
- **Build Command :** `npm install`
- **Start Command :** `npm start`

Le serveur relais à la racine s'occupera de lancer automatiquement le backend situé dans le sous-dossier.

---

## 📝 Documentation Supplémentaire

Pour plus de détails sur des modules spécifiques, consultez les fichiers suivants :
- [DOCUMENTATION.md](./DOCUMENTATION.md) : Détails techniques de l'API.
- [QUICKSTART.md](./QUICKSTART.md) : Guide rapide pour les nouveaux développeurs.
- [STATUS.md](./STATUS.md) : État actuel du développement et roadmap.

---

## ⚖️ Licence

Ce projet est sous licence **MIT**. Voir le fichier [LICENSE](./LICENSE) pour plus de détails.

---
*Développé avec ❤️ par l'équipe Revolution Network.*
