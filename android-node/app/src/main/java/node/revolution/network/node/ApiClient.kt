package node.revolution.network.node

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class ApiClient(
    private val baseUrl: String,
    private val http: OkHttpClient = OkHttpClient.Builder().build(),
) {

    fun createSession(token: String): CreateSessionResult {
        val req = Request.Builder()
            .url("$baseUrl/api/session/create")
            .post("{}".toRequestBody(JSON))
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer $token")
            .build()

        http.newCall(req).execute().use { res ->
            val bodyStr = res.body?.string().orEmpty()
            val body = bodyStr.ifEmpty { "{}" }
            if (!res.isSuccessful) {
                val msg = runCatching { JSONObject(body).optString("error") }.getOrNull()
                    ?.takeIf { it.isNotBlank() }
                    ?: runCatching { JSONObject(body).optString("message") }.getOrNull()
                    ?.takeIf { it.isNotBlank() }
                    ?: "HTTP ${res.code}"
                return CreateSessionResult.Error(msg)
            }

            val json = JSONObject(body)
            val sessionId = json.optString("sessionId", "").takeIf { it.isNotBlank() }
                ?: return CreateSessionResult.Error("Missing sessionId")
            return CreateSessionResult.Success(sessionId)
        }
    }

    fun endSession(token: String, sessionId: String) {
        val req = Request.Builder()
            .url("$baseUrl/api/session/end/$sessionId")
            .post("{}".toRequestBody(JSON))
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer $token")
            .build()
        http.newCall(req).execute().use { }
    }

    fun submitProof(token: String, challenge: String, nonce: Long, sessionId: String?): SubmitProofResult {
        val payload = JSONObject()
            .put("challenge", challenge)
            .put("nonce", nonce)
            .put("sessionId", sessionId)
            .toString()

        val req = Request.Builder()
            .url("$baseUrl/api/rewards/proof-of-work")
            .post(payload.toRequestBody(JSON))
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer $token")
            .build()

        http.newCall(req).execute().use { res ->
            val bodyStr = res.body?.string().orEmpty()
            val body = bodyStr.ifEmpty { "{}" }
            if (!res.isSuccessful) {
                val msg = runCatching { JSONObject(body).optString("error") }.getOrNull()
                    ?.takeIf { it.isNotBlank() }
                    ?: "Rejected"
                return SubmitProofResult.Error(msg)
            }
            val json = JSONObject(body)
            val ok = json.optBoolean("success", false)
            val pts = json.optInt("points_earned", 0)
            val hash = json.optString("hash", "")
            return if (ok) SubmitProofResult.Success(pts, hash) else SubmitProofResult.Error("Invalid response")
        }
    }

    sealed class CreateSessionResult {
        data class Success(val sessionId: String) : CreateSessionResult()
        data class Error(val message: String) : CreateSessionResult()
    }

    sealed class SubmitProofResult {
        data class Success(val pointsEarned: Int, val hash: String) : SubmitProofResult()
        data class Error(val message: String) : SubmitProofResult()
    }

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()
    }
}
