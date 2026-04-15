# Mobile Update Service

Ce dossier contient les services de mise à jour automatique pour les applications mobiles Revolution Network.

## Architecture

### Android (Native Kotlin)
- **Localisation**: `android-node/app/src/main/java/node/revolution/network/update/`
- **API utilisée**: Google Play In-App Updates API
- **Types de mises à jour**:
  - **Flexible**: Téléchargement en arrière-plan, installation à la demande
  - **Immédiate**: Blocage de l'interface jusqu'à mise à jour

### iOS (Documentation pour implémentation future)
- **API recommandée**: App Store Connect + iTunes Lookup API
- **Contraintes Apple**:
  - Pas de mise à jour silencieuse hors App Store (interdit par les guidelines)
  - Doit rediriger vers l'App Store pour mise à jour
  - Peut utiliser `SKStoreReviewController` ou lien direct App Store

## Configuration Backend

L'endpoint `/api/app/version` retourne:

```json
{
  "version": "1.2.0",
  "minVersion": "1.1.0",
  "forceUpdate": false,
  "forceUpdateDate": "2024-02-15",
  "changelog": "Nouveautés...",
  "downloadUrlAndroid": "https://play.google.com/store/apps/details?id=node.revolution.network",
  "downloadUrlIOS": "https://apps.apple.com/app/revolution-network/idXXXXXXXXXX"
}
```

## Flux de mise à jour

### Android - Flexible Update
1. App démarre → vérifie version via API
2. Si update dispo → affiche bannière discrète
3. Téléchargement silencieux en arrière-plan
4. Notification "Prêt à installer" quand terminé
5. Utilisateur redémarre l'app pour installer

### Android - Immediate Update (Force)
1. API retourne `forceUpdate: true`
2. Écran bloqué natif Google Play s'affiche
3. Impossible d'utiliser l'app sans mise à jour
4. Installation immédiate après téléchargement

### iOS - Standard Update
1. App vérifie version via iTunes Lookup API
2. Si version App Store > version locale:
   - `forceUpdate=true`: Modal bloquante → redirection App Store
   - `forceUpdate=false`: Bannière discrète → ouvre App Store au tap

## Utilisation dans MainActivity

```kotlin
import node.revolution.network.update.AppUpdateManager
import node.revolution.network.ui.update.UpdateHandler

class MainActivity : ComponentActivity() {
    private lateinit var updateManager: AppUpdateManager
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        updateManager = AppUpdateManager(this)
        
        setContent {
            RevolutionNetworkTheme {
                Column {
                    // Gère toute la UI de mise à jour
                    UpdateHandler(
                        updateManager = updateManager,
                        onDownload = { /* Optionnel */ },
                        onInstall = { /* Optionnel */ },
                        onDismiss = { /* Optionnel */ }
                    )
                    
                    // Reste de l'app...
                }
            }
        }
        
        // Vérifie les mises à jour au démarrage
        lifecycleScope.launch {
            delay(5000) // Attendre 5s après démarrage
            updateManager.checkForUpdates(this@MainActivity)
        }
    }
    
    override fun onResume() {
        super.onResume()
        // Vérifie si une mise à jour a été téléchargée
        updateManager.resumeUpdateCheck(this)
    }
    
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        // Gère le résultat des dialogues de mise à jour
        if (requestCode == AppUpdateManager.REQUEST_CODE_FLEXIBLE_UPDATE ||
            requestCode == AppUpdateManager.REQUEST_CODE_IMMEDIATE_UPDATE) {
            if (resultCode != RESULT_OK) {
                // L'utilisateur a annulé la mise à jour
                updateManager.dismissUpdate()
            }
        }
    }
}
```

## Dépendances Gradle

```kotlin
dependencies {
    // Google Play In-App Updates
    implementation("com.google.android.play:app-update-ktx:2.1.0")
    
    // Coroutines pour les appels async
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    
    // HTTP client
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
```

## Configuration côté serveur

Les paramètres de version sont stockés dans `system_config`:

```sql
INSERT INTO system_config (key, value) VALUES
('app_version', '1.2.0'),
('app_min_version', '1.1.0'),
('app_force_update', 'false'),
('app_force_update_date', '2024-02-15'),
('app_changelog', 'Nouveau système de minage + corrections'),
('app_download_android', 'https://play.google.com/store/apps/details?id=node.revolution.network'),
('app_download_ios', 'https://apps.apple.com/app/revolution-network/idXXXXXXXXXX');
```

## Notifications pré-update

Le service backend `updateNotifications.js` envoie automatiquement:
- **J-3**: "Mise à jour obligatoire dans 3 jours"
- **J-2**: "Mise à jour obligatoire dans 2 jours"
- **J-1**: "Dernière chance — mise à jour demain"
- **J-0**: Blocage complet + installation forcée

## Sécurité

- Vérification du checksum des fichiers téléchargés
- Anti-downgrade (refuse les versions < minVersion)
- Signature des mises à jour via Google Play/App Store
- Timeout de 60s sur les requêtes API

## Tests

### Scénarios à tester:
1. ✅ Première installation (pas de mise à jour)
2. ✅ Mise à jour flexible disponible
3. ✅ Mise à jour forcée (forceUpdate=true)
4. ✅ Hors ligne (app démarre normalement)
5. ✅ Échec téléchargement (retry automatique)
6. ✅ Utilisateur annule mise à jour flexible
