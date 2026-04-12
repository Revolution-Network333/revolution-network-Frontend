package node.revolution.network.ui

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.clickable
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.LaunchedEffect
import node.revolution.network.storage.SecurePrefs
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
    context: android.content.Context
) {
    val state by stateFlow.collectAsState()
    var isLoggedIn: MutableState<Boolean> = remember { mutableStateOf(false) }
    
    // Check if token already exists (from deep link or previous session)
    LaunchedEffect(Unit) {
        val token = SecurePrefs(context).getToken()
        if (token?.isNotBlank() == true) {
            isLoggedIn.value = true
        }
    }
    
    // Watch for token changes
    LaunchedEffect(state) {
        val token = SecurePrefs(context).getToken()
        val shouldBeLoggedIn = token?.isNotBlank() == true
        if (isLoggedIn.value != shouldBeLoggedIn) {
            isLoggedIn.value = shouldBeLoggedIn
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(
                        Color(0xFF0F172A),
                        Color(0xFF1E293B),
                        Color(0xFF334155),
                    )
                )
            )
            .padding(16.dp)
    ) {
        if (!isLoggedIn.value) {
            // Login Screen - Exact Windows match
            LoginScreen(
                onSignInViaWebsite = onSignInViaWebsite,
                onLoginSuccess = { isLoggedIn.value = true }
            )
        } else {
            // Dashboard Screen - Exact Windows match
            WindowsStyleDashboard(
                state = state,
                onStart = onStart,
                onStop = onStop,
                onLogout = { isLoggedIn.value = false },
                context = context
            )
        }
    }
}

@Composable
private fun LoginScreen(
    onSignInViaWebsite: () -> Unit,
    onLoginSuccess: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        // Logo and Title
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(80.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(Color(0xFF1E293B))
                    .padding(8.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    "RN",
                    color = Color(0xFF60A5FA),
                    fontSize = 32.sp,
                    fontWeight = FontWeight.Bold
                )
            }
            
            Text(
                "Revolution Network",
                color = Color.White,
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold
            )
        }
        
        Spacer(Modifier.height(48.dp))
        
        // Login Section
        Card(
            colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B).copy(alpha = 0.8f)),
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text(
                    "Account Sign In",
                    color = Color.White,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )
                
                Button(
                    onClick = {
                        onSignInViaWebsite()
                        onLoginSuccess()
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3B82F6)),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(
                        "Sign in via website",
                        color = Color.White,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        }
    }
}

@Composable
private fun WindowsStyleDashboard(
    state: NodeUiState,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onLogout: () -> Unit,
    context: android.content.Context
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(Color(0xFF1E293B)),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        "RN",
                        color = Color(0xFF60A5FA),
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
                Text(
                    "Revolution Network",
                    color = Color.White,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold
                )
            }
        }
        
        // Status Cards
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Node Status
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B).copy(alpha = 0.8f)),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.weight(1f)
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        "Node Status",
                        color = Color(0xFF94A3B8),
                        fontSize = 12.sp
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(if (state.running) Color(0xFF22C55E) else Color(0xFFEF4444))
                        )
                        Text(
                            if (state.running) "ACTIVE" else "INACTIVE",
                            color = if (state.running) Color(0xFF22C55E) else Color(0xFFEF4444),
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }
            
            // Points
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B).copy(alpha = 0.8f)),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.weight(1f)
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        "Points (Session)",
                        color = Color(0xFF94A3B8),
                        fontSize = 12.sp
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        state.sessionPoints.toString(),
                        color = Color.White,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        "Earned",
                        color = Color(0xFF94A3B8),
                        fontSize = 10.sp
                    )
                }
            }
        }
        
        // Hashrate/Logs
        Card(
            colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B).copy(alpha = 0.8f)),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(16.dp)
            ) {
                Text(
                    "Hashrate / Logs",
                    color = Color.White,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(12.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(200.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(Color(0xFF0F172A))
                        .padding(12.dp)
                ) {
                    LazyColumn(
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        items(state.logs.takeLast(20)) { log ->
                            Text(
                                log,
                                color = Color(0xFF94A3B8),
                                fontSize = 12.sp,
                                fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace
                            )
                        }
                    }
                }
            }
        }
        
        // Control Button
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Button(
                onClick = if (state.running) onStop else onStart,
                modifier = Modifier
                    .size(100.dp)
                    .clip(CircleShape),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (state.running) Color(0xFFEF4444) else Color(0xFF22C55E)
                )
            ) {
                if (state.running) {
                    // Pause icon - two vertical bars
                    Row {
                        Box(
                            modifier = Modifier
                                .width(4.dp)
                                .height(24.dp)
                                .background(Color.White)
                        )
                        Spacer(Modifier.width(8.dp))
                        Box(
                            modifier = Modifier
                                .width(4.dp)
                                .height(24.dp)
                                .background(Color.White)
                        )
                    }
                } else {
                    // Play icon - triangle using text
                    Text(
                        "▶",
                        color = Color.White,
                        fontSize = 32.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
            
            // Footer
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    "Sign out",
                    color = Color(0xFF60A5FA),
                    fontSize = 14.sp,
                    modifier = Modifier.clickable { onLogout() }
                )
                Text(
                    "Web Dashboard >>",
                    color = Color(0xFF60A5FA),
                    fontSize = 14.sp,
                    modifier = Modifier.clickable { 
                        // Open Revolution Network dashboard
                        val intent = android.content.Intent(android.content.Intent.ACTION_VIEW)
                        intent.data = android.net.Uri.parse("https://revolution-network.fr/dashboard")
                        context.startActivity(intent)
                    }
                )
            }
        }
    }
}

@Composable
private fun ModernHeaderCard(state: NodeUiState) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color.Transparent),
        shape = RoundedCornerShape(24.dp),
        modifier = Modifier
            .fillMaxWidth()
            .shadow(
                elevation = 8.dp,
                spotColor = Color(0xFF6366F1).copy(alpha = 0.1f),
                ambientColor = Color(0xFF6366F1).copy(alpha = 0.05f)
            )
            .background(
                Brush.horizontalGradient(
                    listOf(
                        Color(0xFF1E293B).copy(alpha = 0.8f),
                        Color(0xFF334155).copy(alpha = 0.6f)
                    )
                )
            )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        "Revolution Network",
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFFF8FAFC),
                        letterSpacing = 0.5.sp
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Desktop Node",
                        fontSize = 14.sp,
                        color = Color(0xFF94A3B8),
                        fontWeight = FontWeight.Medium
                    )
                }
                ModernStatusPill(state.running)
            }
            
            Spacer(Modifier.height(20.dp))
            
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                ModernMetricChip("Session", state.sessionId?.take(8)?.plus("â¦") ?: "Not connected")
                ModernMetricChip("Points", state.sessionPoints.toString())
                ModernMetricChip("Hashrate", "${state.hashrate.toInt()} H/s")
            }
            
            if (!state.lastServerMessage.isNullOrBlank()) {
                Spacer(Modifier.height(12.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0xFF0F172A).copy(alpha = 0.5f))
                        .padding(12.dp)
                ) {
                    Text(
                        "Server: ${state.lastServerMessage}",
                        color = Color(0xFF60A5FA),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        }
    }
}

@Composable
private fun ModernMetricChip(label: String, value: String) {
    Column(
        modifier = Modifier
            .clip(RoundedCornerShape(16.dp))
            .background(
                Brush.verticalGradient(
                    listOf(
                        Color(0xFF1E293B).copy(alpha = 0.6f),
                        Color(0xFF0F172A).copy(alpha = 0.4f)
                    )
                )
            )
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            label,
            color = Color(0xFF64748B),
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium
        )
        Spacer(Modifier.height(4.dp))
        Text(
            value,
            color = Color(0xFFF1F5F9),
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold
        )
    }
}

@Composable
private fun ModernStatusPill(running: Boolean) {
    val bgGradient = if (running) 
        Brush.horizontalGradient(
            listOf(
                Color(0xFF052E16),
                Color(0xFF064E3B)
            )
        ) else 
        Brush.horizontalGradient(
            listOf(
                Color(0xFF450A0A),
                Color(0xFF7F1D1D)
            )
        )
    val textColor = if (running) Color(0xFF34D399) else Color(0xFFF87171)
    val statusText = if (running) "ACTIVE" else "INACTIVE"
    
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(bgGradient)
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .shadow(
                elevation = 4.dp,
                spotColor = if (running) Color(0xFF34D399) else Color(0xFFEF4444),
                ambientColor = if (running) Color(0xFF34D399).copy(alpha = 0.2f) else Color(0xFFEF4444).copy(alpha = 0.2f)
            )
    ) {
        Text(
            statusText,
            color = textColor,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.sp
        )
    }
}

@Composable
private fun ModernAuthCard(
    tokenInput: String,
    onTokenChange: (String) -> Unit,
    onSignInViaWebsite: () -> Unit,
    onSaveToken: () -> Unit,
    onClearToken: () -> Unit
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color.Transparent),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier
            .fillMaxWidth()
            .shadow(
                elevation = 6.dp,
                spotColor = Color(0xFF8B5CF6).copy(alpha = 0.1f),
                ambientColor = Color(0xFF8B5CF6).copy(alpha = 0.05f)
            )
            .background(
                Brush.verticalGradient(
                    listOf(
                        Color(0xFF1E293B).copy(alpha = 0.7f),
                        Color(0xFF0F172A).copy(alpha = 0.5f)
                    )
                )
            )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp)
        ) {
            Text(
                "Authentication",
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                color = Color(0xFFF8FAFC)
            )
            
            Spacer(Modifier.height(16.dp))
            
            Button(
                onClick = onSignInViaWebsite,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFF6366F1)
                ),
                shape = RoundedCornerShape(12.dp)
            ) {
                Text(
                    "Sign in via Website",
                    color = Color.White,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
            
            Spacer(Modifier.height(16.dp))
            
            Text(
                "Or paste your token manually:",
                color = Color(0xFF94A3B8),
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium
            )
            
            Spacer(Modifier.height(12.dp))
            
            OutlinedTextField(
                value = tokenInput,
                onValueChange = onTokenChange,
                modifier = Modifier.fillMaxWidth(),
                placeholder = { 
                    Text(
                        "Enter your JWT token...", 
                        color = Color(0xFF64748B)
                    ) 
                },
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
                colors = androidx.compose.material3.TextFieldDefaults.colors(
                    focusedTextColor = Color(0xFFF8FAFC),
                    unfocusedTextColor = Color(0xFFF8FAFC),
                    focusedContainerColor = Color(0xFF1E293B).copy(alpha = 0.3f),
                    unfocusedContainerColor = Color(0xFF1E293B).copy(alpha = 0.2f),
                    focusedIndicatorColor = Color(0xFF6366F1),
                    unfocusedIndicatorColor = Color(0xFF475569)
                )
            )
            
            Spacer(Modifier.height(16.dp))
            
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Button(
                    onClick = onSaveToken,
                    modifier = Modifier
                        .weight(1f)
                        .height(44.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFF22C55E)
                    ),
                    shape = RoundedCornerShape(12.dp),
                    enabled = tokenInput.isNotBlank()
                ) {
                    Text(
                        "Save Token",
                        color = Color.White,
                        fontWeight = FontWeight.SemiBold
                    )
                }
                
                OutlinedButton(
                    onClick = onClearToken,
                    modifier = Modifier
                        .weight(1f)
                        .height(44.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = Color(0xFFEF4444)
                    ),
                    border = androidx.compose.foundation.BorderStroke(
                        1.dp, 
                        Color(0xFFEF4444).copy(alpha = 0.5f)
                    )
                ) {
                    Text(
                        "Clear",
                        color = Color(0xFFEF4444),
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        }
    }
}

@Composable
private fun ModernMiningCard(
    isRunning: Boolean,
    onStart: () -> Unit,
    onStop: () -> Unit,
    sessionId: String?,
    points: Int,
    hashrate: Double
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color.Transparent),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier
            .fillMaxWidth()
            .shadow(
                elevation = 6.dp,
                spotColor = Color(0xFF10B981).copy(alpha = 0.1f),
                ambientColor = Color(0xFF10B981).copy(alpha = 0.05f)
            )
            .background(
                Brush.verticalGradient(
                    listOf(
                        Color(0xFF064E3B).copy(alpha = 0.2f),
                        Color(0xFF065F46).copy(alpha = 0.1f)
                    )
                )
            )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "Mining Controls",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFFF8FAFC)
                )
                
                ModernStatusPill(isRunning)
            }
            
            Spacer(Modifier.height(16.dp))
            
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Button(
                    onClick = onStart,
                    modifier = Modifier
                        .weight(1f)
                        .height(48.dp),
                    enabled = !isRunning,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFF22C55E),
                        disabledContainerColor = Color(0xFF374151)
                    ),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text(
                        if (isRunning) "Running..." else "Start Mining",
                        color = Color.White,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
                
                Button(
                    onClick = onStop,
                    modifier = Modifier
                        .weight(1f)
                        .height(48.dp),
                    enabled = isRunning,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFFEF4444),
                        disabledContainerColor = Color(0xFF374151)
                    ),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text(
                        "Stop",
                        color = Color.White,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
            
            if (isRunning) {
                Spacer(Modifier.height(16.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        "Session: ${sessionId?.take(8) ?: "N/A"}",
                        color = Color(0xFF94A3B8),
                        fontSize = 12.sp
                    )
                    Text(
                        "Points: $points",
                        color = Color(0xFF34D399),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        "Hash: ${hashrate.toInt()} H/s",
                        color = Color(0xFF60A5FA),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }
    }
}

@Composable
private fun ModernLogsCard(logs: List<String>) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color.Transparent),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier
            .fillMaxWidth()
            .shadow(
                elevation = 6.dp,
                spotColor = Color(0xFF64748B).copy(alpha = 0.1f),
                ambientColor = Color(0xFF64748B).copy(alpha = 0.05f)
            )
            .background(
                Brush.verticalGradient(
                    listOf(
                        Color(0xFF1E293B).copy(alpha = 0.7f),
                        Color(0xFF0F172A).copy(alpha = 0.5f)
                    )
                )
            )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "Activity Logs",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFFF8FAFC)
                )
                Text(
                    "Last ${logs.size} entries",
                    color = Color(0xFF64748B),
                    fontSize = 12.sp
                )
            }
            
            Spacer(Modifier.height(16.dp))
            
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(300.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(Color(0xFF0F172A).copy(alpha = 0.8f))
                    .padding(16.dp)
            ) {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(logs.takeLast(50)) { log ->
                        Text(
                            log,
                            color = Color(0xFFCBD5E1),
                            fontSize = 13.sp,
                            fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
            }
        }
    }
}
