package node.revolution.network.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.StateFlow
import node.revolution.network.node.NodeUiState

@Composable
fun DashboardScreen(
    onStart: () -> Unit,
    onStop: () -> Unit,
    onSaveToken: (String) -> Unit,
    onClearToken: () -> Unit,
    onSignInViaWebsite: () -> Unit,
    stateFlow: StateFlow<NodeUiState>,
) {
    val state by stateFlow.collectAsState()
    var tokenInput by remember { mutableStateOf("") }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(
                        Color(0xFF05060C),
                        Color(0xFF070A1A),
                        Color(0xFF061225),
                    )
                )
            )
            .padding(16.dp)
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            HeaderCard(state)

            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF0B1020)),
                shape = RoundedCornerShape(18.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    Text("Auth Token", fontWeight = FontWeight.SemiBold, color = Color(0xFFE5E7EB))
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = onSignInViaWebsite,
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.secondary)
                    ) {
                        Text("Sign in via website (deeplink)")
                    }
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = tokenInput,
                        onValueChange = { tokenInput = it },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Paste your JWT token here") },
                        singleLine = true
                    )
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(
                            onClick = { if (tokenInput.isNotBlank()) onSaveToken(tokenInput) },
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                        ) {
                            Text("Save")
                        }
                        OutlinedButton(onClick = { onClearToken(); tokenInput = "" }) {
                            Text("Clear")
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "Recommended: use website sign-in to auto-fill via deep link. Paste token is a fallback.",
                        color = Color(0xFF94A3B8)
                    )
                }
            }

            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF0B1020)),
                shape = RoundedCornerShape(18.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(14.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Button(
                        onClick = onStart,
                        enabled = !state.running,
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF22C55E))
                    ) {
                        Text("Start")
                    }
                    Button(
                        onClick = onStop,
                        enabled = state.running,
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEF4444))
                    ) {
                        Text("Stop")
                    }
                    Spacer(Modifier.weight(1f))
                    StatusPill(state.running)
                }
            }

            LogsCard(state.logs)
        }
    }
}

@Composable
private fun HeaderCard(state: NodeUiState) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFF0B1020)),
        shape = RoundedCornerShape(22.dp),
        modifier = Modifier.fillMaxWidth(),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                "Revolution Node",
                fontWeight = FontWeight.Bold,
                color = Color(0xFFE5E7EB)
            )
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                MetricChip("Session", state.sessionId?.take(10)?.plus("…") ?: "-")
                MetricChip("Points", state.sessionPoints.toString())
                MetricChip("Hashrate", "${state.hashrate.toInt()} H/s")
            }
            if (!state.lastServerMessage.isNullOrBlank()) {
                Spacer(Modifier.height(8.dp))
                Text(
                    "Server: ${state.lastServerMessage}",
                    color = Color(0xFF93C5FD)
                )
            }
        }
    }
}

@Composable
private fun MetricChip(label: String, value: String) {
    Column(
        modifier = Modifier
            .clip(RoundedCornerShape(14.dp))
            .background(Color(0xFF0F172A))
            .padding(horizontal = 12.dp, vertical = 8.dp)
    ) {
        Text(label, color = Color(0xFF94A3B8))
        Text(value, color = Color(0xFFE5E7EB), fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun StatusPill(running: Boolean) {
    val bg = if (running) Color(0xFF052E1B) else Color(0xFF2B0A0A)
    val fg = if (running) Color(0xFF34D399) else Color(0xFFFCA5A5)
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(bg)
            .padding(horizontal = 12.dp, vertical = 8.dp)
    ) {
        Text(if (running) "ACTIVE" else "INACTIVE", color = fg, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun LogsCard(logs: List<String>) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFF0B1020)),
        shape = RoundedCornerShape(18.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text("Logs", fontWeight = FontWeight.SemiBold, color = Color(0xFFE5E7EB))
            Spacer(Modifier.height(8.dp))
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(260.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Color(0xFF050814))
                    .padding(10.dp)
            ) {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(logs.takeLast(200)) { line ->
                        Text(line, color = Color(0xFFB6C2D9))
                    }
                }
            }
        }
    }
}
