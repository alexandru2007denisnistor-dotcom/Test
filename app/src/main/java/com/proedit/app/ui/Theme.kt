package com.proedit.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object Pal {
    val Bg = Color(0xFF0E0F12)
    val Surface = Color(0xFF17191E)
    val Surface2 = Color(0xFF22252C)
    val Surface3 = Color(0xFF2E323B)
    val Accent = Color(0xFF00D1C1)
    val Accent2 = Color(0xFF7C5CFF)
    val Text = Color(0xFFF2F3F5)
    val TextDim = Color(0xFF9AA0AA)
    val Danger = Color(0xFFFF4D5E)
    val ClipBorder = Color(0xFFFFFFFF)
    val TextTrack = Color(0xFFE0A526)
    val StickerTrack = Color(0xFFE05A9C)
    val MusicTrack = Color(0xFF3D7BFF)
    val VoiceTrack = Color(0xFF2FB36D)
    val ExtractTrack = Color(0xFF8E6BFF)
}

@Composable
fun ProEditTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Pal.Accent,
            onPrimary = Color.Black,
            secondary = Pal.Accent2,
            background = Pal.Bg,
            surface = Pal.Surface,
            surfaceVariant = Pal.Surface2,
            onSurface = Pal.Text,
            onSurfaceVariant = Pal.TextDim,
            onBackground = Pal.Text,
            error = Pal.Danger,
        ),
        content = content,
    )
}
