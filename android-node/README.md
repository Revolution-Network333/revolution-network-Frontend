# Revolution Node (Android)

Android node app (Kotlin + Jetpack Compose) that mirrors the current desktop node behavior:

- Creates a session: `POST /api/session/create`
- Runs Proof-of-Work (SHA-256, difficulty `0000`)
- Submits proofs: `POST /api/rewards/proof-of-work`
- Runs 24/7 via a Foreground Service

## Backend
Default API base URL is hardcoded to:

`https://revolution-backend-sal2.onrender.com`

## Run
1. Open `android-node/` in Android Studio
2. Sync Gradle
3. Run `app`

## Token
For now, paste your JWT token in the app.

(Next step can be adding an in-app login + deep-link like the Electron app.)
