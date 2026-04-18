package node.revolution.network.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.flow.StateFlow
import node.revolution.network.node.NodeUiState
import node.revolution.network.storage.SecurePrefs

// ── Palette exacte app desktop ───────────────────────────────────────────────
private val BgDeep     = Color(0xFF050505)
private val BgCard     = Color(0x08FFFFFF)
private val BorderCard = Color(0xFF222222)
private val GreenNeon  = Color(0xFF00FF9D)
private val CyanNeon   = Color(0xFF00F3FF)
private val RedNeon    = Color(0xFFFF4444)
private val TextPrim   = Color(0xFFE0E0E0)
private val TextMuted  = Color(0xFF888888)
private val TextDim    = Color(0xFF666666)
private val TerminalBg = Color(0xFF000000)

private val TitleBrush = Brush.horizontalGradient(listOf(GreenNeon, CyanNeon))
private val BtnBrush   = Brush.horizontalGradient(listOf(GreenNeon, Color(0xFF00B8FF)))
private val BgBrush    = Brush.radialGradient(
    colors = listOf(Color(0xFF1A1A1A), BgDeep),
    center = Offset.Zero,
    radius = 1800f
)

// ─────────────────────────────────────────────────────────────────────────────
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
    val isLoggedIn = remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        val token = SecurePrefs(context).getToken()
        if (token?.isNotBlank() == true) isLoggedIn.value = true
    }

    LaunchedEffect(state) {
        val token = SecurePrefs(context).getToken()
        val should = token?.isNotBlank() == true
        if (isLoggedIn.value != should) isLoggedIn.value = should
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(BgBrush)
    ) {
        // Effet scanlines identique au CSS desktop
        Box(modifier = Modifier.fillMaxSize().drawBehind { drawScanlines() })

        if (!isLoggedIn.value) {
            LoginScreen(onSignInViaWebsite = onSignInViaWebsite)
        } else {
            MainDashboard(
                state = state,
                onStart = onStart,
                onStop = onStop,
                onLogout = { onClearToken(); isLoggedIn.value = false },
                context = context
            )
        }
    }
}

// ── Scanlines (reproduit le CSS linear-gradient scanline) ────────────────────
private fun DrawScope.drawScanlines() {
    val line = 2.dp.toPx()
    var y = 0f
    while (y < size.height) {
        drawRect(
            color = Color(0x40000000),
            topLeft = Offset(0f, y + line),
            size = androidx.compose.ui.geometry.Size(size.width, line)
        )
        y += line * 2
    }
}

// ── Header (logo + "REVOLUTION NETWORK" dégradé) ─────────────────────────────
@Composable
private fun AppHeader(version: String = "") {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0x80000000))
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center
        ) {
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .clip(CircleShape)
                    .background(Color(0xFF0A0A0A))
                    .border(1.dp, GreenNeon.copy(alpha = 0.6f), CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    "RN",
                    color = GreenNeon,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace
                )
            }

            Spacer(Modifier.width(10.dp))

            Column {
                Text(
                    "REVOLUTION NETWORK",
                    style = TextStyle(
                        brush = TitleBrush,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.sp
                    )
                )
                if (version.isNotBlank()) {
                    Text(
                        version,
                        color = TextDim,
                        fontSize = 10.sp,
                        fontFamily = FontFamily.Monospace
                    )
                }
            }
        }

        // Ligne de séparation glow vert
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(
                    Brush.horizontalGradient(
                        listOf(Color.Transparent, GreenNeon.copy(alpha = 0.4f), Color.Transparent)
                    )
                )
        )
    }
}

// ── Login Screen ──────────────────────────────────────────────────────────────
@Composable
private fun LoginScreen(onSignInViaWebsite: () -> Unit) {
    Column(modifier = Modifier.fillMaxSize()) {
        AppHeader()

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                "Account Sign In",
                color = Color.White,
                fontSize = 18.sp,
                fontWeight = FontWeight.Light,
                textAlign = TextAlign.Center
            )

            Spacer(Modifier.height(24.dp))

            // Bouton gradient vert→cyan identique .btn-primary
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(BtnBrush)
                    .clickable { onSignInViaWebsite() },
                contentAlignment = Alignment.Center
            ) {
                Text(
                    "SIGN IN VIA WEBSITE",
                    color = Color.Black,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.sp
                )
            }

            Spacer(Modifier.height(12.dp))

            Text(
                "Open website",
                color = TextMuted,
                fontSize = 12.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.clickable { onSignInViaWebsite() }
            )
        }
    }
}

// ── Dashboard principal ───────────────────────────────────────────────────────
@Composable
private fun MainDashboard(
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
    ) {
        AppHeader()

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Grille 2 colonnes : Node Status + Points
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                NodeStatusCard(running = state.running, modifier = Modifier.weight(1f))
                PointsCard(points = state.sessionPoints, modifier = Modifier.weight(1f))
            }

            // Terminal logs
            TerminalCard(logs = state.logs)

            // Bouton rond Start/Stop
            ControlButton(running = state.running, onStart = onStart, onStop = onStop)

            // Footer
            DashboardFooter(onLogout = onLogout, context = context)
        }
    }
}

// ── Card "Node Status" ────────────────────────────────────────────────────────
@Composable
private fun NodeStatusCard(running: Boolean, modifier: Modifier = Modifier) {
    val dotColor = if (running) GreenNeon else RedNeon

    val infiniteTransition = rememberInfiniteTransition(label = "dot")
    val dotAlpha by infiniteTransition.animateFloat(
        initialValue = 0.5f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            tween(900, easing = FastOutSlowInEasing),
            RepeatMode.Reverse
        ),
        label = "alpha"
    )

    NeonCard(modifier = modifier) {
        Text(
            "NODE STATUS",
            color = TextMuted,
            fontSize = 11.sp,
            letterSpacing = 0.5.sp,
            fontFamily = FontFamily.Monospace,
            modifier = Modifier.padding(bottom = 10.dp)
        )
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
            modifier = Modifier.fillMaxWidth()
        ) {
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .clip(CircleShape)
                    .background(dotColor.copy(alpha = if (running) dotAlpha else 1f))
                    .drawBehind {
                        drawCircle(color = dotColor.copy(alpha = 0.35f), radius = size.minDimension * 2f)
                    }
            )
            Spacer(Modifier.width(8.dp))
            Text(
                if (running) "ACTIVE" else "INACTIVE",
                color = dotColor,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace
            )
        }
    }
}

// ── Card "Points" ─────────────────────────────────────────────────────────────
@Composable
private fun PointsCard(points: Int, modifier: Modifier = Modifier) {
    NeonCard(modifier = modifier) {
        Text(
            "POINTS (SESSION)",
            color = TextMuted,
            fontSize = 11.sp,
            letterSpacing = 0.5.sp,
            fontFamily = FontFamily.Monospace,
            modifier = Modifier.padding(bottom = 8.dp)
        )
        Text(
            points.toString(),
            color = Color.White,
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.Monospace,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )
        Text(
            "Earned",
            color = TextDim,
            fontSize = 10.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )
    }
}

// ── Card générique avec barre verte en haut (.stats-card::after) ──────────────
@Composable
private fun NeonCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit
) {
    Box(modifier = modifier) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(BgCard)
                .border(1.dp, BorderCard, RoundedCornerShape(8.dp))
                .padding(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            content = content
        )
        // Barre dégradée verte en haut (identique ::after)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(2.dp)
                .clip(RoundedCornerShape(topStart = 8.dp, topEnd = 8.dp))
                .background(
                    Brush.horizontalGradient(
                        listOf(Color.Transparent, GreenNeon.copy(alpha = 0.5f), Color.Transparent)
                    )
                )
        )
    }
}

// ── Terminal / Logs ───────────────────────────────────────────────────────────
@Composable
private fun TerminalCard(logs: List<String>) {
    val listState = rememberLazyListState()
    LaunchedEffect(logs.size) {
        if (logs.isNotEmpty()) listState.animateScrollToItem(logs.size - 1)
    }

    Box {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(BgCard)
                .border(1.dp, BorderCard, RoundedCornerShape(8.dp))
                .padding(14.dp)
        ) {
            Text(
                "HASHRATE / LOGS",
                color = TextMuted,
                fontSize = 11.sp,
                letterSpacing = 0.5.sp,
                fontFamily = FontFamily.Monospace,
                modifier = Modifier.padding(bottom = 8.dp)
            )

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(110.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(TerminalBg)
                    .border(1.dp, Color(0xFF333333), RoundedCornerShape(4.dp))
                    .padding(8.dp)
            ) {
                if (logs.isEmpty()) {
                    Text(
                        "[SYSTEM] Ready to mine...",
                        color = GreenNeon.copy(alpha = 0.8f),
                        fontSize = 10.sp,
                        fontFamily = FontFamily.Monospace
                    )
                } else {
                    LazyColumn(state = listState) {
                        items(logs.takeLast(50)) { log ->
                            val timeRegex = Regex("""^\[(\d{2}:\d{2}:\d{2})\]\s*(.*)""")
                            val match = timeRegex.find(log)
                            Row {
                                if (match != null) {
                                    Text(
                                        "[${match.groupValues[1]}] ",
                                        color = TextDim,
                                        fontSize = 10.sp,
                                        fontFamily = FontFamily.Monospace
                                    )
                                    Text(
                                        match.groupValues[2],
                                        color = GreenNeon.copy(alpha = 0.9f),
                                        fontSize = 10.sp,
                                        fontFamily = FontFamily.Monospace,
                                        overflow = TextOverflow.Ellipsis,
                                        maxLines = 1
                                    )
                                } else {
                                    Text(
                                        log,
                                        color = GreenNeon.copy(alpha = 0.9f),
                                        fontSize = 10.sp,
                                        fontFamily = FontFamily.Monospace,
                                        overflow = TextOverflow.Ellipsis,
                                        maxLines = 1
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        // Barre verte haut
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(2.dp)
                .clip(RoundedCornerShape(topStart = 8.dp, topEnd = 8.dp))
                .background(
                    Brush.horizontalGradient(
                        listOf(Color.Transparent, GreenNeon.copy(alpha = 0.5f), Color.Transparent)
                    )
                )
        )
    }
}

// ── Bouton rond Start/Stop (.btn-round desktop) ───────────────────────────────
@Composable
private fun ControlButton(
    running: Boolean,
    onStart: () -> Unit,
    onStop: () -> Unit
) {
    val accentColor = if (running) RedNeon else GreenNeon

    val infiniteTransition = rememberInfiniteTransition(label = "glow")
    val glowAlpha by infiniteTransition.animateFloat(
        initialValue = 0.15f,
        targetValue = 0.35f,
        animationSpec = infiniteRepeatable(
            tween(1200, easing = FastOutSlowInEasing),
            RepeatMode.Reverse
        ),
        label = "glow_alpha"
    )

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier
                .size(72.dp)
                .clip(CircleShape)
                .background(
                    Brush.radialGradient(
                        listOf(
                            accentColor.copy(alpha = glowAlpha * if (running) 0.5f else 1f),
                            Color(0x99000000)
                        )
                    )
                )
                .border(2.dp, accentColor, CircleShape)
                .clickable { if (running) onStop() else onStart() },
            contentAlignment = Alignment.Center
        ) {
            if (running) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.width(5.dp).height(22.dp).background(accentColor))
                    Box(Modifier.width(5.dp).height(22.dp).background(accentColor))
                }
            } else {
                Text(
                    "▶",
                    color = accentColor,
                    fontSize = 28.sp,
                    fontWeight = FontWeight.Bold
                )
            }
        }
    }
}

// ── Footer (.footer desktop) ──────────────────────────────────────────────────
@Composable
private fun DashboardFooter(onLogout: () -> Unit, context: android.content.Context) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(BorderCard)
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                "Sign out",
                color = TextMuted,
                fontSize = 12.sp,
                modifier = Modifier
                    .clickable { onLogout() }
                    .padding(4.dp)
            )
            Text(
                "Web Dashboard >>",
                color = TextMuted,
                fontSize = 12.sp,
                modifier = Modifier
                    .clickable {
                        val intent = android.content.Intent(android.content.Intent.ACTION_VIEW)
                        intent.data = android.net.Uri.parse("https://revolution-network.fr/")
                        context.startActivity(intent)
                    }
                    .padding(4.dp)
            )
        }
    }
}