package node.revolution.network.ui.update

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import node.revolution.network.update.AppUpdateManager

/**
 * Update UI Components
 * Banner, Modal, and Notification composables for app updates
 */

@Composable
fun UpdateBanner(
    state: AppUpdateManager.UpdateState,
    onDownload: () -> Unit,
    onDismiss: () -> Unit
) {
    AnimatedVisibility(
        visible = state.updateAvailable && !state.updateDownloaded,
        enter = expandVertically() + fadeIn(),
        exit = shrinkVertically() + fadeOut()
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    brush = Brush.horizontalGradient(
                        colors = listOf(
                            Color(0xFF667EEA),
                            Color(0xFF764BA2)
                        )
                    )
                )
                .padding(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.ArrowDownward,
                        contentDescription = "Update",
                        tint = Color.White,
                        modifier = Modifier.size(24.dp)
                    )
                    
                    Column {
                        Text(
                            text = "Nouvelle version disponible",
                            color = Color.White,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 14.sp
                        )
                        
                        state.version?.let {
                            Text(
                                text = "Version $it",
                                color = Color.White.copy(alpha = 0.8f),
                                fontSize = 12.sp
                            )
                        }
                    }
                }
                
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        onClick = onDownload,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color.White,
                            contentColor = Color(0xFF667EEA)
                        ),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text(
                            "Télécharger",
                            fontWeight = FontWeight.Medium,
                            fontSize = 13.sp
                        )
                    }
                    
                    if (!state.forceUpdate) {
                        IconButton(
                            onClick = onDismiss,
                            modifier = Modifier.size(36.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Close,
                                contentDescription = "Dismiss",
                                tint = Color.White
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun UpdateReadyNotification(
    state: AppUpdateManager.UpdateState,
    onInstall: () -> Unit,
    onDismiss: () -> Unit
) {
    AnimatedVisibility(
        visible = state.updateDownloaded,
        enter = fadeIn(),
        exit = fadeOut()
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            shape = RoundedCornerShape(16.dp),
            elevation = CardDefaults.cardElevation(defaultElevation = 8.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surface
            )
        ) {
            Column(
                modifier = Modifier.padding(20.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = "Ready",
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(28.dp)
                        )
                        
                        Column {
                            Text(
                                text = "Mise à jour prête",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold
                            )
                            
                            Text(
                                text = "Redémarrez pour installer la version ${state.version ?: ""}",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
                
                if (state.changelog.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(12.dp))
                    
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = state.changelog,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(12.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                
                Spacer(modifier = Modifier.height(16.dp))
                
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (!state.forceUpdate) {
                        TextButton(
                            onClick = onDismiss
                        ) {
                            Text("Plus tard")
                        }
                        
                        Spacer(modifier = Modifier.width(8.dp))
                    }
                    
                    Button(
                        onClick = onInstall,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.primary
                        )
                    ) {
                        Text("Redémarrer et installer")
                    }
                }
            }
        }
    }
}

@Composable
fun ForceUpdateModal(
    state: AppUpdateManager.UpdateState,
    progress: Float = 0f,
    onInstall: () -> Unit
) {
    if (!state.forceUpdate) return
    
    AlertDialog(
        onDismissRequest = { /* Cannot dismiss force update */ },
        icon = {
            Icon(
                imageVector = Icons.Default.ArrowDownward,
                contentDescription = "Update",
                modifier = Modifier.size(48.dp),
                tint = MaterialTheme.colorScheme.primary
            )
        },
        title = {
            Text(
                text = "Mise à jour obligatoire",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )
        },
        text = {
            Column(
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text(
                    text = "Une mise à jour importante est requise pour continuer à utiliser Revolution Network.",
                    style = MaterialTheme.typography.bodyMedium
                )
                
                if (state.changelog.isNotEmpty()) {
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = state.changelog,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(12.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                
                // Progress bar when downloading
                if (progress > 0f && progress < 100f) {
                    Column {
                        Text(
                            text = "Téléchargement... ${progress.toInt()}%",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        
                        Spacer(modifier = Modifier.height(4.dp))
                        
                        LinearProgressIndicator(
                            progress = { progress / 100f },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = onInstall,
                enabled = state.updateDownloaded || progress >= 100f
            ) {
                Text(
                    if (state.updateDownloaded || progress >= 100f) 
                        "Redémarrer maintenant" 
                    else 
                        "Installation..."
                )
            }
        },
        dismissButton = null // No dismiss button for force update
    )
}

@Composable
fun UpdateCheckingIndicator() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(8.dp),
        contentAlignment = Alignment.Center
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            CircularProgressIndicator(
                modifier = Modifier.size(16.dp),
                strokeWidth = 2.dp
            )
            Text(
                text = "Vérification des mises à jour...",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/**
 * Combined update UI that handles all update states
 */
@Composable
fun UpdateHandler(
    updateManager: AppUpdateManager,
    onDownload: () -> Unit = {},
    onInstall: () -> Unit = {},
    onDismiss: () -> Unit = {}
) {
    val state by updateManager.updateState
    
    Column {
        // Show checking indicator
        if (state.checking) {
            UpdateCheckingIndicator()
        }
        
        // Show banner for available update
        UpdateBanner(
            state = state,
            onDownload = {
                onDownload()
                // Trigger download flow
            },
            onDismiss = {
                onDismiss()
                updateManager.dismissUpdate()
            }
        )
        
        // Show notification when update is ready
        UpdateReadyNotification(
            state = state,
            onInstall = {
                onInstall()
                updateManager.completeUpdate()
            },
            onDismiss = {
                onDismiss()
                updateManager.dismissUpdate()
            }
        )
        
        // Show force update modal
        ForceUpdateModal(
            state = state,
            onInstall = {
                onInstall()
                updateManager.completeUpdate()
            }
        )
    }
}
