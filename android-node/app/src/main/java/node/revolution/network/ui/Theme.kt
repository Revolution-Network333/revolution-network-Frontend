package node.revolution.network.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColors = darkColorScheme(
    primary = Color(0xFF7C3AED),
    secondary = Color(0xFF22D3EE),
    tertiary = Color(0xFF34D399),
    background = Color(0xFF060812),
    surface = Color(0xFF0B1020),
)

private val LightColors = lightColorScheme(
    primary = Color(0xFF5B21B6),
    secondary = Color(0xFF0891B2),
    tertiary = Color(0xFF059669),
)

@Composable
fun AppTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    MaterialTheme(
        colorScheme = if (dark) DarkColors else LightColors,
        content = content
    )
}
