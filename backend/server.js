require('dotenv').config();
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json());

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const dbPath = path.join(__dirname, 'database', 'revolution_network.db');

// Route pour vérifier le token Google et gérer l'utilisateur
app.post('/api/auth/google', async (req, res) => {
    const { token } = req.body;

    try {
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        const userEmail = payload['email'];
        const userName = payload['name'];

        // Ouvrir la base de données
        const db = new sqlite3.Database(dbPath);

        // Vérifier si l'utilisateur existe déjà via son email
        db.get(
            'SELECT * FROM users WHERE email = ?',
            [userEmail],
            async (err, row) => {
                if (err) {
                    console.error("Erreur lors de la recherche de l'utilisateur :", err);
                    return res.status(500).json({ success: false, message: "Erreur serveur" });
                }

                if (!row) {
                    // Générer un username unique
                    const username = userEmail.split('@')[0];

                    // Ajouter l'utilisateur s'il n'existe pas
                    db.run(
                        'INSERT INTO users (email, password_hash, username, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
                        [userEmail, "google_auth", username, "user", 1],
                        (err) => {
                            if (err) {
                                console.error("Erreur lors de l'ajout de l'utilisateur :", err);
                                return res.status(500).json({ success: false, message: "Erreur serveur" });
                            }
                        }
                    );

                    // Récupérer l'ID de l'utilisateur nouvellement créé
                    db.get(
                        'SELECT id FROM users WHERE email = ?',
                        [userEmail],
                        (err, newRow) => {
                            if (err) {
                                console.error("Erreur lors de la récupération de l'ID utilisateur :", err);
                                return res.status(500).json({ success: false, message: "Erreur serveur" });
                            }

                            // Générer un JWT personnalisé
                            const jwtToken = jwt.sign(
                                { userId: newRow.id, email: userEmail },
                                process.env.JWT_SECRET,
                                { expiresIn: process.env.JWT_EXPIRES_IN }
                            );

                            // Retourner le JWT au frontend
                            res.json({
                                success: true,
                                token: jwtToken,
                                user: { id: newRow.id, email: userEmail, name: userName }
                            });
                        }
                    );
                } else {
                    // Mettre à jour last_login si l'utilisateur existe déjà
                    db.run(
                        'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
                        [row.id],
                        (err) => {
                            if (err) {
                                console.error("Erreur lors de la mise à jour de last_login :", err);
                            }
                        }
                    );

                    // Générer un JWT personnalisé
                    const jwtToken = jwt.sign(
                        { userId: row.id, email: userEmail },
                        process.env.JWT_SECRET,
                        { expiresIn: process.env.JWT_EXPIRES_IN }
                    );

                    // Retourner le JWT au frontend
                    res.json({
                        success: true,
                        token: jwtToken,
                        user: { id: row.id, email: userEmail, name: userName }
                    });
                }
            }
        );

        // Fermer la base de données
        db.close();
    } catch (error) {
        console.error("Erreur de vérification du token Google :", error);
        res.status(401).json({ success: false, message: "Token invalide" });
    }
});

// Middleware pour vérifier le JWT
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: "Token manquant" });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: "Token invalide" });
        }

        req.user = user;
        next();
    });
}

// Exemple de route protégée
app.get('/api/protected', authenticateToken, (req, res) => {
    res.json({ success: true, message: "Accès autorisé", user: req.user });
});

// Démarrer le serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});
