package node.revolution.network.node

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import node.revolution.network.R
import node.revolution.network.storage.SecurePrefs
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.max

class NodeService : Service() {

    private val serviceJob = Job()
    private val scope = CoroutineScope(Dispatchers.Default + serviceJob)

    private val api = ApiClient(BASE_URL)

    private var miningJob: Job? = null
    private val hashCounter = AtomicLong(0)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startNode()
            ACTION_STOP -> stopNode()
        }
        return START_STICKY
    }

    private fun startNode() {
        if (miningJob?.isActive == true) return

        ensureChannel()
        startForeground(NOTIF_ID, buildNotification("Starting…", running = true))

        NodeServiceState.setState { it.copy(running = true, lastServerMessage = null) }
        NodeServiceState.log("[SYSTEM] Foreground service started")

        miningJob = scope.launch {
            val prefs = SecurePrefs(applicationContext)
            val token = prefs.getToken()
            if (token.isNullOrBlank()) {
                NodeServiceState.log("[ERROR] Missing token. Sign in on website then paste token.")
                NodeServiceState.setState { it.copy(running = false) }
                stopForeground(STOP_FOREGROUND_DETACH)
                stopSelf()
                return@launch
            }

            val sessionId = when (val created = api.createSession(token.trim())) {
                is ApiClient.CreateSessionResult.Success -> created.sessionId
                is ApiClient.CreateSessionResult.Error -> {
                    NodeServiceState.log("[ERROR] createSession failed: ${created.message}")
                    NodeServiceState.setState { it.copy(running = false, lastServerMessage = created.message) }
                    stopForeground(STOP_FOREGROUND_DETACH)
                    stopSelf()
                    return@launch
                }
            }

            NodeServiceState.log("[SYSTEM] Session active: $sessionId")
            NodeServiceState.setState { it.copy(sessionId = sessionId, sessionPoints = 0) }

            val challengeBase = "revolution_network_challenge_"
            var challenge = challengeBase + System.currentTimeMillis()
            var nonce = 0L

            var points = 0
            var lastRateTs = System.currentTimeMillis()
            var lastRateCount = 0L

            while (isActive) {
                try {
                    val attempt = "$challenge:$nonce"
                    val hash = sha256Hex(attempt)
                    val c = hashCounter.incrementAndGet()

                    // difficulty: startsWith("0000") like desktop
                    if (hash.startsWith("0000")) {
                        NodeServiceState.log("[POW] Proof found: ${hash.take(8)}…")

                        when (val proof = api.submitProof(token, challenge, nonce, sessionId)) {
                            is ApiClient.SubmitProofResult.Success -> {
                                points += max(0, proof.pointsEarned)
                                NodeServiceState.setState { it.copy(sessionPoints = points, lastServerMessage = "Accepted") }
                                NodeServiceState.log("[SERVER] Accepted +${proof.pointsEarned} pts")
                                challenge = challengeBase + System.currentTimeMillis()
                                nonce = 0L
                                delay(1000)
                            }
                            is ApiClient.SubmitProofResult.Error -> {
                                NodeServiceState.log("[SERVER] Rejected: ${proof.message}")
                                NodeServiceState.setState { it.copy(lastServerMessage = proof.message) }
                                // new challenge to avoid getting stuck
                                challenge = challengeBase + System.currentTimeMillis()
                                nonce = 0L
                                delay(1500)
                            }
                        }
                    } else {
                        nonce++
                        // Yield a bit to reduce battery impact
                        if (nonce % 25_000L == 0L) delay(1)
                    }

                    val now = System.currentTimeMillis()
                    if (now - lastRateTs >= 1500) {
                        val delta = c - lastRateCount
                        val seconds = (now - lastRateTs) / 1000.0
                        val rate = if (seconds <= 0) 0.0 else (delta / seconds)
                        NodeServiceState.setState { it.copy(hashrate = rate) }
                        updateForeground(points, rate)
                        lastRateTs = now
                        lastRateCount = c
                    }

                } catch (e: Exception) {
                    NodeServiceState.log("[ERROR] Mining loop: ${e.message ?: e.javaClass.simpleName}")
                    delay(5000)
                }
            }
        }
    }

    private fun stopNode() {
        NodeServiceState.log("[SYSTEM] Stopping…")
        miningJob?.cancel()
        miningJob = null

        scope.launch {
            val prefs = SecurePrefs(applicationContext)
            val token = prefs.getToken()
            val sessionId = NodeServiceState.state.value.sessionId
            if (!token.isNullOrBlank() && !sessionId.isNullOrBlank()) {
                runCatching { api.endSession(token.trim(), sessionId) }
            }
        }

        NodeServiceState.setState { NodeUiState(running = false) }
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun updateForeground(points: Int, rate: Double) {
        val text = "ACTIVE • ${points} pts • ${rate.toInt()} H/s"
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIF_ID, buildNotification(text, running = true))
    }

    private fun buildNotification(text: String, running: Boolean): Notification {
        val title = if (running) "Revolution Node" else "Revolution Node (Stopped)"
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(running)
            .setOnlyAlertOnce(true)
            .build()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val existing = nm.getNotificationChannel(CHANNEL_ID)
        if (existing != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Revolution Node",
            NotificationManager.IMPORTANCE_LOW
        )
        nm.createNotificationChannel(channel)
    }

    override fun onDestroy() {
        miningJob?.cancel()
        serviceJob.cancel()
        super.onDestroy()
    }

    private fun sha256Hex(input: String): String {
        val md = MessageDigest.getInstance("SHA-256")
        val bytes = md.digest(input.toByteArray(Charsets.UTF_8))
        val sb = StringBuilder(bytes.size * 2)
        for (b in bytes) sb.append(String.format("%02x", b))
        return sb.toString()
    }

    companion object {
        const val ACTION_START = "node.revolution.network.action.START"
        const val ACTION_STOP = "node.revolution.network.action.STOP"

        private const val CHANNEL_ID = "revolution_node"
        private const val NOTIF_ID = 1001

        private const val BASE_URL = "https://revolution-backend-sal2.onrender.com"
    }
}
