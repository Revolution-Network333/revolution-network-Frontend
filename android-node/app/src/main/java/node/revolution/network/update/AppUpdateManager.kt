package node.revolution.network.update

import android.app.Activity
import android.content.Context
import android.util.Log
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.State
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * App Update Manager for Android
 * Handles In-App Updates API integration
 */
class AppUpdateManager(private val context: Context) {
    
    private val TAG = "AppUpdateManager"
    private val API_URL = "https://revolution-backend-sal2.onrender.com/api/app/version"
    private val CHECK_INTERVAL_HOURS = 6L
    
    private val appUpdateManager: AppUpdateManager = AppUpdateManagerFactory.create(context)
    private var completeTriggered: Boolean = false
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()
    
    // Update state (observable by UI)
    private val _updateState = mutableStateOf(UpdateState())
    val updateState: State<UpdateState> = _updateState
    
    data class UpdateState(
        val checking: Boolean = false,
        val updateAvailable: Boolean = false,
        val updateDownloaded: Boolean = false,
        val forceUpdate: Boolean = false,
        val version: String? = null,
        val changelog: String = "",
        val daysUntilForceUpdate: Int? = null,
        val error: String? = null
    )
    
    /**
     * Check for updates from API and Google Play
     */
    suspend fun checkForUpdates(activity: Activity) = withContext(Dispatchers.IO) {
        try {
            _updateState.value = _updateState.value.copy(checking = true, error = null)
            
            // Get update info from API
            val apiInfo = fetchUpdateInfoFromAPI()
            
            // Check Google Play In-App Updates
            val appUpdateInfoTask = appUpdateManager.appUpdateInfo
            
            appUpdateInfoTask.addOnSuccessListener { appUpdateInfo ->
                val updateAvailability = appUpdateInfo.updateAvailability()
                val isUpdateAvailable = updateAvailability == UpdateAvailability.UPDATE_AVAILABLE
                val isUpdateAllowed = appUpdateInfo.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)
                
                when {
                    apiInfo.forceUpdate -> {
                        // Force update from API - use IMMEDIATE update
                        _updateState.value = _updateState.value.copy(
                            checking = false,
                            updateAvailable = true,
                            forceUpdate = true,
                            version = apiInfo.version,
                            changelog = apiInfo.changelog,
                            daysUntilForceUpdate = apiInfo.daysUntilForceUpdate
                        )
                        
                        if (appUpdateInfo.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) {
                            startImmediateUpdate(activity, appUpdateInfo)
                        }
                    }
                    isUpdateAvailable && isUpdateAllowed -> {
                        // Flexible update available
                        _updateState.value = _updateState.value.copy(
                            checking = false,
                            updateAvailable = true,
                            forceUpdate = false,
                            version = apiInfo.version ?: appUpdateInfo.availableVersionCode().toString(),
                            changelog = apiInfo.changelog
                        )
                        
                        // Start flexible update in background
                        startFlexibleUpdate(activity, appUpdateInfo)
                    }
                    else -> {
                        _updateState.value = _updateState.value.copy(
                            checking = false,
                            updateAvailable = false
                        )
                    }
                }
            }
            
            appUpdateInfoTask.addOnFailureListener { exception ->
                Log.e(TAG, "Failed to check for updates", exception)
                _updateState.value = _updateState.value.copy(
                    checking = false,
                    error = "Failed to check for updates: ${exception.message}"
                )
            }
            
        } catch (e: Exception) {
            Log.e(TAG, "Error checking for updates", e)
            _updateState.value = _updateState.value.copy(
                checking = false,
                error = "Error: ${e.message}"
            )
        }
    }
    
    /**
     * Fetch update info from backend API
     */
    private fun fetchUpdateInfoFromAPI(): UpdateInfo {
        return try {
            val request = Request.Builder()
                .url(API_URL)
                .build()
            
            val response = httpClient.newCall(request).execute()
            
            if (response.isSuccessful) {
                val json = JSONObject(response.body?.string() ?: "{}")
                
                UpdateInfo(
                    version = json.optString("version"),
                    minVersion = json.optString("minVersion"),
                    forceUpdate = json.optBoolean("forceUpdate", false),
                    forceUpdateDate = json.optString("forceUpdateDate").takeIf { it.isNotEmpty() },
                    changelog = json.optString("changelog"),
                    daysUntilForceUpdate = if (json.has("daysUntilForceUpdate") && !json.isNull("daysUntilForceUpdate")) {
                        json.optInt("daysUntilForceUpdate")
                    } else null
                )
            } else {
                UpdateInfo()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to fetch update info from API", e)
            UpdateInfo()
        }
    }
    
    data class UpdateInfo(
        val version: String? = null,
        val minVersion: String? = null,
        val forceUpdate: Boolean = false,
        val forceUpdateDate: String? = null,
        val changelog: String = "",
        val daysUntilForceUpdate: Int? = null
    )
    
    /**
     * Start flexible update (background download)
     */
    private fun startFlexibleUpdate(activity: Activity, appUpdateInfo: com.google.android.play.core.appupdate.AppUpdateInfo) {
        try {
            appUpdateManager.startUpdateFlowForResult(
                appUpdateInfo,
                AppUpdateType.FLEXIBLE,
                activity,
                REQUEST_CODE_FLEXIBLE_UPDATE
            )
            
            // Listen for download completion
            appUpdateManager.registerListener { state ->
                if (state.installStatus() == InstallStatus.DOWNLOADED) {
                    _updateState.value = _updateState.value.copy(updateDownloaded = true)
                    // Show completion notification
                    popupSnackbarForCompleteUpdate()
                    if (!completeTriggered) {
                        completeTriggered = true
                        activity.runOnUiThread {
                            completeUpdate()
                        }
                    }
                }
            }
            
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start flexible update", e)
        }
    }
    
    /**
     * Start immediate update (blocking)
     */
    private fun startImmediateUpdate(activity: Activity, appUpdateInfo: com.google.android.play.core.appupdate.AppUpdateInfo) {
        try {
            appUpdateManager.startUpdateFlowForResult(
                appUpdateInfo,
                AppUpdateType.IMMEDIATE,
                activity,
                REQUEST_CODE_IMMEDIATE_UPDATE
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start immediate update", e)
        }
    }
    
    /**
     * Complete flexible update (install downloaded update)
     */
    fun completeUpdate() {
        appUpdateManager.completeUpdate()
    }
    
    /**
     * Show snackbar for complete update
     */
    private fun popupSnackbarForCompleteUpdate() {
        // This will be called by the UI layer
        Log.i(TAG, "Update downloaded and ready to install")
    }
    
    /**
     * Resume update check (call in onResume)
     */
    fun resumeUpdateCheck(activity: Activity) {
        appUpdateManager.appUpdateInfo.addOnSuccessListener { appUpdateInfo ->
            if (appUpdateInfo.installStatus() == InstallStatus.DOWNLOADED) {
                _updateState.value = _updateState.value.copy(updateDownloaded = true)
                if (!completeTriggered) {
                    completeTriggered = true
                    activity.runOnUiThread {
                        completeUpdate()
                    }
                }
            }
        }
    }
    
    /**
     * Dismiss update notification
     */
    fun dismissUpdate() {
        _updateState.value = _updateState.value.copy(updateAvailable = false)
    }
    
    companion object {
        const val REQUEST_CODE_FLEXIBLE_UPDATE = 1001
        const val REQUEST_CODE_IMMEDIATE_UPDATE = 1002
    }
}
