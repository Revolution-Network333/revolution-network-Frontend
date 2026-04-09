# 🌐 Revolution Network

**Revolution Network** is a decentralized P2P ecosystem designed for bandwidth sharing with an integrated rewards system. This project combines a robust backend architecture with a desktop application to provide a smooth and secure user experience.

---

## 🔍 What is Revolution Network?

Revolution Network is a Decentralized Physical Infrastructure Network (**DePIN**) that allows users to monetize their unused bandwidth. By transforming every connected device into an active network node, we create a distributed, resilient, and high-performance data transport layer.

---

## ⚙️ How it works

The network operational flow follows a simple contribution model:

`User → Node → Network → Contribution → Rewards (Aether ATH)`

1.  **User**: Installs and configures the application.
2.  **Node**: The device becomes a point of presence on the network.
3.  **Network**: Resources are aggregated to meet infrastructure needs.
4.  **Contribution**: Real-time measurement of shared bandwidth.
5.  **Rewards**: Automatic distribution of ATH tokens based on actual contribution.

---

## 💎 Aether (ATH)

**Aether (ATH)** is the native utility token of Revolution Network. It serves as the economic engine for the ecosystem:
- **Rewards**: Financial incentive for node operators based on their uptime and shared volume.
- **Governance & Participation**: Access to advanced network services and active participation in the infrastructure.

---

## 🚀 Get Started

Ready to join the network?
- **Run a Node**: The mining application is currently under development (WIP / Coming Soon).
- **Join Discord**: [Join our community](https://discord.gg/eadE7uK6ss) for support and discussions.
- **Follow us on X**: Follow [@revo_network_](https://x.com/revo_network_) for the latest official announcements.

---

## 🚀 Key Features

- **P2P Sharing (WebRTC):** Bandwidth optimization via decentralized communication protocols.
- **Rewards System:** Integrated mechanism to reward users sharing their resources.
- **Enhanced Security:** JWT authentication, rate-limiting protection, and security headers (Helmet).
- **Multi-layer Architecture:** Clear separation between backend, desktop application, and utility scripts.
- **Multi-DB Compatibility:** Support for MySQL (Production) and SQLite (Local development).

---

## 📁 Project Structure

- **`/backend`**: The core of the system. Express REST API handling authentication, transactions, and tasks.
- **`/desktop-app`**: Client application (Electron/JS) allowing users to connect to the network.
- **`/src`**: Relay server (Proxy) to facilitate deployment on platforms like Render.
- **`/scripts`**: Utility tools for icon generation and API key management.

---

## 🛠️ Installation and Configuration

### Prerequisites

- Node.js (v18+)
- MySQL (or SQLite for local development)

### Local Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Revolution-Network333/Revolution-Network.git
    cd Revolution-Network
    ```

2.  **Install dependencies (Root and Backend):**
    ```bash
    npm install
    ```
    *(The post-install script will automatically install dependencies in the `/backend` folder)*

3.  **Configure environment variables:**
    Create a `.env` file in the `/backend` folder based on `env-example.txt`:
    ```env
    PORT=3000
    MYSQL_URL=your_mysql_url
    JWT_SECRET=your_jwt_secret
    GOOGLE_CLIENT_ID=your_google_id
    ```

4.  **Start the server:**
    ```bash
    npm start
    ```

---

## ☁️ Deployment (Render)

To deploy on Render, use the following settings:

- **Root Directory:** *(Leave empty)*
- **Build Command:** `npm install`
- **Start Command:** `npm start`

The relay server at the root will automatically launch the backend located in the sub-folder.

---

## 📝 Additional Documentation

For more details on specific modules, refer to the following files:
- [DOCUMENTATION.md](./DOCUMENTATION.md): API technical details.
- [QUICKSTART.md](./QUICKSTART.md): Quick start guide for new developers.
- [STATUS.md](./STATUS.md): Current development status and roadmap.

---

## ⚖️ License

This project is licensed under the **MIT** License. See the [LICENSE](./LICENSE) file for more details.

---
*Developed with ❤️ by the Revolution Network team.*
