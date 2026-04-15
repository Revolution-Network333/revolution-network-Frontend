package node.revolution.network

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.ContextCompat.startForegroundService
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import node.revolution.network.node.NodeService
import node.revolution.network.node.NodeServiceState
import node.revolution.network.storage.SecurePrefs
import node.revolution.network.update.AppUpdateManager
import node.revolution.network.ui.AppTheme
import node.revolution.network.ui.DashboardScreen

class MainActivity : ComponentActivity() {

    private lateinit var appUpdateManager: AppUpdateManager

    private val requestNotifications = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        appUpdateManager = AppUpdateManager(this)

        if (Build.VERSION.SDK_INT >= 33) {
            val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            if (!granted) requestNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        setContent {
            AppTheme {
                DashboardScreen(
                    onStart = {
                        val intent = Intent(this, NodeService::class.java).apply {
                            action = NodeService.ACTION_START
                        }
                        startForegroundService(this, intent)
                    },
                    onStop = {
                        val intent = Intent(this, NodeService::class.java).apply {
                            action = NodeService.ACTION_STOP
                        }
                        startService(intent)
                    },
                    onSaveToken = { t -> 
                        SecurePrefs(this).setToken(t)
                        // Trigger recomposition to check login state
                        NodeServiceState.log("[TOKEN] Token saved, updating UI")
                    },
                    onClearToken = { SecurePrefs(this).clear() },
                    onSignInViaWebsite = {
                        val url = Uri.parse("https://revolution-network.fr/?desktop=true")
                        startActivity(Intent(Intent.ACTION_VIEW, url))
                    },
                    stateFlow = NodeServiceState.state,
                    context = this
                )
            }
        }

        handleDeepLink(intent)

        lifecycleScope.launch {
            appUpdateManager.checkForUpdates(this@MainActivity)
        }

        lifecycleScope.launch {
            NodeServiceState.events.collectLatest { /* reserved for one-shot events */ }
        }
    }

    override fun onResume() {
        super.onResume()
        appUpdateManager.resumeUpdateCheck(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleDeepLink(intent)
    }

    private fun handleDeepLink(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme != "revolution-network") return
        if (data.host != "auth") return

        val token = data.getQueryParameter("token")?.trim().orEmpty()
        val refreshToken = data.getQueryParameter("refreshToken")?.trim().orEmpty()
        val user = data.getQueryParameter("user")?.trim().orEmpty()

        if (token.isBlank()) {
            NodeServiceState.log("[DEEPLINK] Missing token")
            return
        }

        SecurePrefs(this).setToken(token)
        NodeServiceState.log("[DEEPLINK] Token saved")
        if (refreshToken.isNotBlank()) NodeServiceState.log("[DEEPLINK] Refresh token received")
        if (user.isNotBlank()) NodeServiceState.log("[DEEPLINK] User payload received")
    }
}
