package com.proedit.app.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Flip
import androidx.compose.material.icons.filled.FormatAlignCenter
import androidx.compose.material.icons.automirrored.filled.FormatAlignLeft
import androidx.compose.material.icons.automirrored.filled.FormatAlignRight
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.automirrored.filled.RotateRight
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.MimeTypes
import com.proedit.app.data.ThumbnailCache
import com.proedit.app.engine.ColorMath
import com.proedit.app.engine.ExportMath
import com.proedit.app.engine.ExportQuality
import com.proedit.app.engine.TextRenderer
import com.proedit.app.model.AspectRatio
import com.proedit.app.model.Clip
import com.proedit.app.model.ClipType
import com.proedit.app.model.FitMode
import com.proedit.app.model.ProjectOps
import com.proedit.app.model.TextAnimation
import com.proedit.app.model.TransitionType
import kotlinx.coroutines.delay
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.roundToInt

// ------------------------------------------------------------------ building blocks

@Composable
fun PanelScaffold(title: String, onClose: () -> Unit, actions: @Composable () -> Unit = {}, content: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(Pal.Surface)
            .padding(bottom = 6.dp),
    ) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(title, color = Pal.Text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Spacer(Modifier.weight(1f))
            actions()
            IconButton(onClick = onClose) { Icon(Icons.Default.Check, "Fertig", tint = Pal.Accent) }
        }
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) { content() }
    }
}

@Composable
fun Chip(label: String, selected: Boolean, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        Modifier
            .padding(end = 8.dp, bottom = 8.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(if (selected) Pal.Accent else Pal.Surface2)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    ) {
        Text(
            label, fontSize = 13.sp,
            color = when { !enabled -> Pal.TextDim.copy(alpha = 0.4f); selected -> Color.Black; else -> Pal.Text },
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
        )
    }
}

@Composable
fun LabeledSlider(
    label: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    display: String,
    onChange: (Float) -> Unit,
    onDone: () -> Unit,
) {
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth()) {
            Text(label, color = Pal.TextDim, fontSize = 13.sp)
            Spacer(Modifier.weight(1f))
            Text(display, color = Pal.Text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        }
        Slider(
            value = value.coerceIn(range.start, range.endInclusive),
            onValueChange = onChange,
            onValueChangeFinished = onDone,
            valueRange = range,
            colors = SliderDefaults.colors(thumbColor = Color.White, activeTrackColor = Pal.Accent, inactiveTrackColor = Pal.Surface3),
            modifier = Modifier.height(36.dp),
        )
    }
}

@Composable
private fun BigButton(icon: ImageVector, label: String, tint: Color = Pal.Text, onClick: () -> Unit) {
    Column(
        Modifier
            .padding(end = 10.dp, bottom = 8.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Pal.Surface2)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, null, tint = tint)
        Spacer(Modifier.height(4.dp))
        Text(label, fontSize = 12.sp, color = Pal.Text)
    }
}

private fun pct(v: Float) = "${(v * 100).roundToInt()}"
private fun secs(ms: Long) = "%.1fs".format(ms / 1000f)

// ------------------------------------------------------------------ clip panels

@Composable
fun SpeedPanel(vm: EditorViewModel, clip: Clip) {
    PanelScaffold("Tempo", vm::closePanel) {
        if (clip.type == ClipType.IMAGE) {
            Text("Fotos haben kein Tempo – ändere stattdessen die Dauer über die Griffe in der Timeline.",
                color = Pal.TextDim, fontSize = 13.sp, modifier = Modifier.padding(bottom = 12.dp))
            return@PanelScaffold
        }
        // Logarithmic slider: 0.1x .. 10x
        val sliderPos = (ln(clip.speed) / ln(10f) + 1f) / 2f
        LabeledSlider("Geschwindigkeit", sliderPos, 0f..1f, "${"%.2f".format(clip.speed)}x  ·  ${formatTime(clip.durationMs, true)}",
            onChange = { v ->
                val s = 10f.pow(v * 2f - 1f)
                val snapped = listOf(0.25f, 0.5f, 1f, 2f, 4f).firstOrNull { kotlin.math.abs(it - s) / it < 0.04f } ?: s
                vm.updateClip("speed") { it.copy(speed = (snapped * 100).roundToInt() / 100f) }
            },
            onDone = vm::endGesture)
        Row(Modifier.horizontalScroll(rememberScrollState())) {
            listOf(0.25f, 0.5f, 0.75f, 1f, 1.5f, 2f, 3f, 5f, 10f).forEach { s ->
                Chip("${s}x".replace(".0x", "x"), clip.speed == s) { vm.updateClip(null) { it.copy(speed = s) } }
            }
        }
        Text("Tonhöhe bleibt beim Export erhalten.", color = Pal.TextDim, fontSize = 11.sp)
    }
}

@Composable
fun VolumePanel(vm: EditorViewModel, clip: Clip) {
    PanelScaffold("Lautstärke", vm::closePanel) {
        if (clip.type == ClipType.IMAGE) {
            Text("Fotos haben keinen Ton.", color = Pal.TextDim, fontSize = 13.sp, modifier = Modifier.padding(bottom = 12.dp))
            return@PanelScaffold
        }
        LabeledSlider("Lautstärke", clip.volume, 0f..2f, "${pct(clip.volume)} %",
            onChange = { v -> vm.updateClip("vol") { it.copy(volume = (v * 100).roundToInt() / 100f) } }, onDone = vm::endGesture)
        LabeledSlider("Einblenden", clip.audioFadeInMs.toFloat(), 0f..5000f, secs(clip.audioFadeInMs),
            onChange = { v -> vm.updateClip("fin") { it.copy(audioFadeInMs = (v / 100).roundToInt() * 100L) } }, onDone = vm::endGesture)
        LabeledSlider("Ausblenden", clip.audioFadeOutMs.toFloat(), 0f..5000f, secs(clip.audioFadeOutMs),
            onChange = { v -> vm.updateClip("fout") { it.copy(audioFadeOutMs = (v / 100).roundToInt() * 100L) } }, onDone = vm::endGesture)
        Row {
            Chip("Stumm", clip.volume == 0f) { vm.updateClip(null) { it.copy(volume = if (it.volume == 0f) 1f else 0f) } }
            Chip("Ton extrahieren", false) { vm.extractAudio() }
        }
    }
}

@Composable
fun FilterPanel(vm: EditorViewModel, clip: Clip, thumbs: ThumbnailCache) {
    val thumb by produceState<Bitmap?>(null, clip.uri, clip.trimStartMs) {
        value = thumbs.thumbnail(clip.uri, clip.type, ThumbnailCache.bucket(clip.trimStartMs), 160)
    }
    PanelScaffold("Filter", vm::closePanel, actions = {
        Text("Auf alle", color = Pal.Accent, fontSize = 13.sp,
            modifier = Modifier.clickable { vm.commit { ProjectOps.applyLookToAll(it, clip.id) }; vm.toast("Look auf alle Clips angewendet") }.padding(8.dp))
    }) {
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(bottom = 8.dp)) {
            ColorMath.FILTERS.forEach { (id, name) ->
                val selected = clip.filter == id
                Column(
                    Modifier.padding(end = 8.dp).width(64.dp).clickable {
                        vm.updateClip(null) { it.copy(filter = id, filterIntensity = if (it.filter == id) it.filterIntensity else 1f) }
                    },
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(
                        Modifier.size(60.dp).clip(RoundedCornerShape(10.dp)).background(Pal.Surface3)
                            .then(if (selected) Modifier.border(2.dp, Pal.Accent, RoundedCornerShape(10.dp)) else Modifier),
                    ) {
                        thumb?.let {
                            Image(
                                it.asImageBitmap(), null, contentScale = ContentScale.Crop,
                                colorFilter = ColorFilter.colorMatrix(ColorMatrix(ColorMath.toAndroid(ColorMath.filterMatrix(id)))),
                                modifier = Modifier.size(60.dp),
                            )
                        }
                    }
                    Text(name, fontSize = 11.sp, color = if (selected) Pal.Accent else Pal.Text, maxLines = 1, textAlign = TextAlign.Center)
                }
            }
        }
        if (clip.filter != "none") {
            LabeledSlider("Intensität", clip.filterIntensity, 0f..1f, "${pct(clip.filterIntensity)} %",
                onChange = { v -> vm.updateClip("fint") { it.copy(filterIntensity = v) } }, onDone = vm::endGesture)
        }
    }
}

@Composable
fun AdjustPanel(vm: EditorViewModel, clip: Clip) {
    var tab by remember { mutableIntStateOf(0) }
    val params = listOf("Helligkeit", "Kontrast", "Sättigung", "Temperatur", "Tönung", "Farbton")
    val values = listOf(clip.brightness, clip.contrast, clip.saturation, clip.temperature, clip.tint, clip.hue)
    PanelScaffold("Anpassen", vm::closePanel, actions = {
        IconButton(onClick = {
            vm.updateClip(null) { it.copy(brightness = 0f, contrast = 0f, saturation = 0f, temperature = 0f, tint = 0f, hue = 0f) }
        }) { Icon(Icons.Default.RestartAlt, "Zurücksetzen", tint = Pal.TextDim) }
        Text("Auf alle", color = Pal.Accent, fontSize = 13.sp,
            modifier = Modifier.clickable { vm.commit { ProjectOps.applyLookToAll(it, clip.id) }; vm.toast("Auf alle Clips angewendet") }.padding(8.dp))
    }) {
        Row(Modifier.horizontalScroll(rememberScrollState())) {
            params.forEachIndexed { i, n -> Chip(if (values[i] != 0f) "$n •" else n, tab == i) { tab = i } }
        }
        LabeledSlider(params[tab], values[tab], -1f..1f, pct(values[tab]),
            onChange = { v ->
                val sv = if (kotlin.math.abs(v) < 0.03f) 0f else v
                vm.updateClip("adj$tab") {
                    when (tab) {
                        0 -> it.copy(brightness = sv); 1 -> it.copy(contrast = sv); 2 -> it.copy(saturation = sv)
                        3 -> it.copy(temperature = sv); 4 -> it.copy(tint = sv); else -> it.copy(hue = sv)
                    }
                }
            }, onDone = vm::endGesture)
    }
}

@Composable
fun TransformPanel(vm: EditorViewModel, clip: Clip) {
    PanelScaffold("Transformieren", vm::closePanel, actions = {
        IconButton(onClick = {
            vm.updateClip(null) { it.copy(rotation = 0, flipH = false, flipV = false, zoom = 1f, offsetX = 0f, offsetY = 0f) }
        }) { Icon(Icons.Default.RestartAlt, "Zurücksetzen", tint = Pal.TextDim) }
    }) {
        Row(Modifier.horizontalScroll(rememberScrollState())) {
            BigButton(Icons.AutoMirrored.Filled.RotateRight, "Drehen ${clip.rotation}°") { vm.updateClip(null) { it.copy(rotation = (it.rotation + 90) % 360) } }
            BigButton(Icons.Default.Flip, "Spiegeln", if (clip.flipH) Pal.Accent else Pal.Text) { vm.updateClip(null) { it.copy(flipH = !it.flipH) } }
            BigButton(Icons.Default.SwapVert, "Kippen", if (clip.flipV) Pal.Accent else Pal.Text) { vm.updateClip(null) { it.copy(flipV = !it.flipV) } }
        }
        LabeledSlider("Zoom", clip.zoom, 0.5f..4f, "%.2fx".format(clip.zoom),
            onChange = { v -> vm.updateClip("zoom") { it.copy(zoom = if (kotlin.math.abs(v - 1f) < 0.04f) 1f else v) } }, onDone = vm::endGesture)
        LabeledSlider("Position X", clip.offsetX, -1f..1f, pct(clip.offsetX),
            onChange = { v -> vm.updateClip("ox") { it.copy(offsetX = if (kotlin.math.abs(v) < 0.02f) 0f else v) } }, onDone = vm::endGesture)
        LabeledSlider("Position Y", clip.offsetY, -1f..1f, pct(clip.offsetY),
            onChange = { v -> vm.updateClip("oy") { it.copy(offsetY = if (kotlin.math.abs(v) < 0.02f) 0f else v) } }, onDone = vm::endGesture)
    }
}

@Composable
fun TransitionPanel(vm: EditorViewModel, clip: Clip, isLast: Boolean) {
    PanelScaffold("Übergang", vm::closePanel, actions = {
        Text("Auf alle", color = Pal.Accent, fontSize = 13.sp,
            modifier = Modifier.clickable {
                vm.commit { ProjectOps.applyTransitionToAll(it, clip.transitionOut, clip.transitionMs) }
                vm.toast("Übergang auf alle Schnitte angewendet")
            }.padding(8.dp))
    }) {
        if (isLast) {
            Text("Der letzte Clip hat keinen Folgeclip. Wähle einen anderen Schnitt.", color = Pal.TextDim, fontSize = 13.sp,
                modifier = Modifier.padding(bottom = 12.dp))
            return@PanelScaffold
        }
        Row(Modifier.horizontalScroll(rememberScrollState())) {
            TransitionType.entries.forEach { t -> Chip(t.label, clip.transitionOut == t) { vm.updateClip(null) { it.copy(transitionOut = t) } } }
        }
        if (clip.transitionOut != TransitionType.NONE) {
            LabeledSlider("Dauer", clip.transitionMs.toFloat(), 200f..2000f, secs(clip.transitionMs),
                onChange = { v -> vm.updateClip("tdur") { it.copy(transitionMs = (v / 50).roundToInt() * 50L) } }, onDone = vm::endGesture)
        }
    }
}

// ------------------------------------------------------------------ text panels

@Composable
fun TextEditPanel(vm: EditorViewModel) {
    val t = vm.selectedText() ?: return
    var value by remember(t.id) { mutableStateOf(t.text) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(t.id) { delay(150); runCatching { focus.requestFocus() } }
    PanelScaffold(if (t.isSticker) "Sticker" else "Text bearbeiten", vm::closePanel) {
        OutlinedTextField(
            value = value,
            onValueChange = { v ->
                value = v
                vm.updateText("text") { it.copy(text = v) }
            },
            modifier = Modifier.fillMaxWidth().focusRequester(focus).padding(bottom = 10.dp),
            maxLines = 4,
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Pal.Accent, unfocusedBorderColor = Pal.Surface3,
                focusedTextColor = Pal.Text, unfocusedTextColor = Pal.Text, cursorColor = Pal.Accent,
            ),
        )
    }
}

private val SWATCHES = listOf(
    0xFFFFFFFF, 0xFF000000, 0xFFFF3B30, 0xFFFF9500, 0xFFFFCC00, 0xFF34C759,
    0xFF00D1C1, 0xFF007AFF, 0xFF5856D6, 0xFFAF52DE, 0xFFFF2D55, 0xFF8E8E93,
).map { it.toInt() }

@Composable
private fun Swatches(selected: Int, includeNone: Boolean, onPick: (Int) -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()).padding(bottom = 8.dp)) {
        if (includeNone) {
            Box(
                Modifier.padding(end = 8.dp).size(30.dp).clip(CircleShape).background(Pal.Surface3)
                    .border(2.dp, if (selected == 0) Pal.Accent else Color.Transparent, CircleShape)
                    .clickable { onPick(0) },
                contentAlignment = Alignment.Center,
            ) { Text("⌀", color = Pal.Text, fontSize = 14.sp) }
        }
        SWATCHES.forEach { c ->
            Box(
                Modifier.padding(end = 8.dp).size(30.dp).clip(CircleShape).background(Color(c))
                    .border(2.dp, if (selected == c) Pal.Accent else Pal.Surface3, CircleShape)
                    .clickable { onPick(c) },
            )
        }
    }
}

@Composable
fun TextStylePanel(vm: EditorViewModel) {
    val t = vm.selectedText() ?: return
    var tab by remember { mutableIntStateOf(0) }
    PanelScaffold("Stil", vm::closePanel) {
        Row(Modifier.horizontalScroll(rememberScrollState())) {
            listOf("Schrift", "Farbe", "Kontur", "Hintergrund", "Größe").forEachIndexed { i, n -> Chip(n, tab == i) { tab = i } }
        }
        when (tab) {
            0 -> {
                Row(Modifier.horizontalScroll(rememberScrollState())) {
                    TextRenderer.FONTS.forEach { (id, name) -> Chip(name, t.font == id) { vm.updateText(null) { it.copy(font = id) } } }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Chip("Fett", t.bold) { vm.updateText(null) { it.copy(bold = !it.bold) } }
                    Chip("Kursiv", t.italic) { vm.updateText(null) { it.copy(italic = !it.italic) } }
                    Chip("Schatten", t.shadow) { vm.updateText(null) { it.copy(shadow = !it.shadow) } }
                    IconButton(onClick = { vm.updateText(null) { it.copy(align = 0) } }) { Icon(Icons.AutoMirrored.Filled.FormatAlignLeft, null, tint = if (t.align == 0) Pal.Accent else Pal.TextDim) }
                    IconButton(onClick = { vm.updateText(null) { it.copy(align = 1) } }) { Icon(Icons.Default.FormatAlignCenter, null, tint = if (t.align == 1) Pal.Accent else Pal.TextDim) }
                    IconButton(onClick = { vm.updateText(null) { it.copy(align = 2) } }) { Icon(Icons.AutoMirrored.Filled.FormatAlignRight, null, tint = if (t.align == 2) Pal.Accent else Pal.TextDim) }
                }
            }
            1 -> Swatches(t.color, false) { c -> vm.updateText(null) { it.copy(color = c) } }
            2 -> {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 6.dp)) {
                    Text("Kontur", color = Pal.Text, fontSize = 13.sp)
                    Spacer(Modifier.width(10.dp))
                    Switch(t.outline, { v -> vm.updateText(null) { it.copy(outline = v) } },
                        colors = SwitchDefaults.colors(checkedTrackColor = Pal.Accent))
                }
                Swatches(t.outlineColor, false) { c -> vm.updateText(null) { it.copy(outlineColor = c, outline = true) } }
            }
            3 -> Swatches(t.bgColor, true) { c ->
                vm.updateText(null) { it.copy(bgColor = if (c == 0) 0 else (c and 0x00FFFFFF) or (0xD0 shl 24)) }
            }
            else -> LabeledSlider("Größe", t.size, 0.02f..0.3f, "${(t.size * 1000).roundToInt() / 10f}",
                onChange = { v -> vm.updateText("tsize") { it.copy(size = v) } }, onDone = vm::endGesture)
        }
    }
}

@Composable
fun TextAnimPanel(vm: EditorViewModel) {
    val t = vm.selectedText() ?: return
    PanelScaffold("Animation", vm::closePanel) {
        Text("Eingang", color = Pal.TextDim, fontSize = 12.sp)
        Row(Modifier.horizontalScroll(rememberScrollState())) {
            TextAnimation.entries.forEach { a -> Chip(a.label, t.animIn == a) { vm.updateText(null) { it.copy(animIn = a) } } }
        }
        Text("Ausgang", color = Pal.TextDim, fontSize = 12.sp)
        Row(Modifier.horizontalScroll(rememberScrollState())) {
            TextAnimation.entries.filter { it != TextAnimation.TYPEWRITER }.forEach { a ->
                Chip(a.label, t.animOut == a) { vm.updateText(null) { it.copy(animOut = a) } }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StickerPanel(vm: EditorViewModel) {
    val stickers = listOf(
        "😀", "😂", "🤣", "😍", "🥰", "😎", "🤩", "🥳", "😭", "😱", "🤯", "😡", "🤔", "🙄", "😴", "🤫",
        "👍", "👎", "👏", "🙌", "🙏", "💪", "✌️", "🤘", "👀", "💯", "🔥", "✨", "⭐", "🌟", "💥", "💫",
        "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "💔", "🎉", "🎊", "🎁", "🎵", "🎶", "📸", "🎬", "🏆",
        "⚡", "🌈", "☀️", "🌙", "❄️", "🌊", "🍕", "🍔", "☕", "🍿", "🚀", "✈️", "🚗", "📍", "➡️", "⬆️",
    )
    PanelScaffold("Sticker", vm::closePanel) {
        FlowRow(Modifier.height(170.dp).verticalScroll(rememberScrollState())) {
            stickers.forEach { s ->
                Box(Modifier.size(46.dp).clickable { vm.addText(s) }, contentAlignment = Alignment.Center) {
                    Text(s, fontSize = 28.sp)
                }
            }
        }
    }
}

// ------------------------------------------------------------------ audio panels

@Composable
fun AudioVolumePanel(vm: EditorViewModel) {
    val a = vm.selectedAudio() ?: return
    PanelScaffold("Audio: ${a.name}", vm::closePanel) {
        LabeledSlider("Lautstärke", a.volume, 0f..2f, "${pct(a.volume)} %",
            onChange = { v -> vm.updateAudio("avol") { it.copy(volume = (v * 100).roundToInt() / 100f) } }, onDone = vm::endGesture)
        LabeledSlider("Einblenden", a.fadeInMs.toFloat(), 0f..8000f, secs(a.fadeInMs),
            onChange = { v -> vm.updateAudio("afin") { it.copy(fadeInMs = (v / 100).roundToInt() * 100L) } }, onDone = vm::endGesture)
        LabeledSlider("Ausblenden", a.fadeOutMs.toFloat(), 0f..8000f, secs(a.fadeOutMs),
            onChange = { v -> vm.updateAudio("afout") { it.copy(fadeOutMs = (v / 100).roundToInt() * 100L) } }, onDone = vm::endGesture)
    }
}

@Composable
fun AudioMenuPanel(vm: EditorViewModel, onMusic: () -> Unit, onFromVideo: () -> Unit, onRecord: () -> Unit) {
    PanelScaffold("Audio hinzufügen", vm::closePanel) {
        Row(Modifier.horizontalScroll(rememberScrollState())) {
            BigButton(Icons.Default.MusicNote, "Musik / Sound", onClick = onMusic)
            BigButton(Icons.Default.Mic, "Voiceover", onClick = onRecord)
            BigButton(Icons.Default.VideoLibrary, "Aus Video", onClick = onFromVideo)
        }
        Text("Audio wird an der Abspielposition eingefügt.", color = Pal.TextDim, fontSize = 11.sp)
    }
}

@Composable
fun RecordPanel(vm: EditorViewModel) {
    var recording by remember { mutableStateOf(vm.recorder.isRecording) }
    var startMs by remember { mutableLongStateOf(0L) }
    var elapsed by remember { mutableLongStateOf(0L) }
    LaunchedEffect(recording) {
        while (recording) { elapsed = System.currentTimeMillis() - vm.recorder.startedAt; delay(100) }
    }
    PanelScaffold("Voiceover", {
        if (recording) { vm.stopRecording(startMs); recording = false }
        vm.closePanel()
    }) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(if (recording) "Aufnahme läuft · ${formatTime(elapsed, true)}" else "Tippe zum Aufnehmen – das Video läuft mit.",
                color = if (recording) Pal.Danger else Pal.TextDim, fontSize = 13.sp)
            Spacer(Modifier.height(10.dp))
            Box(
                Modifier.size(64.dp).clip(CircleShape).background(if (recording) Pal.Surface3 else Pal.Danger)
                    .clickable {
                        if (!recording) {
                            startMs = vm.engine.position.value
                            recording = vm.startRecording()
                            if (!recording) vm.toast("Mikrofon nicht verfügbar")
                        } else {
                            vm.stopRecording(startMs); recording = false
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                if (recording) Icon(Icons.Default.Stop, null, tint = Pal.Danger, modifier = Modifier.size(32.dp))
                else Icon(Icons.Default.Mic, null, tint = Color.White, modifier = Modifier.size(32.dp))
            }
            Spacer(Modifier.height(10.dp))
        }
    }
}

// ------------------------------------------------------------------ project panels

@Composable
fun FormatPanel(vm: EditorViewModel) {
    val p by vm.project.collectAsState()
    PanelScaffold("Format & Leinwand", vm::closePanel) {
        Row(Modifier.horizontalScroll(rememberScrollState())) {
            AspectRatio.entries.forEach { a -> Chip(a.label, p.aspect == a) { vm.commit { it.copy(aspect = a) } } }
        }
        Row {
            FitMode.entries.forEach { f -> Chip(f.label, p.fitMode == f) { vm.commit { it.copy(fitMode = f) } } }
        }
    }
}

@Composable
fun ExportPanel(vm: EditorViewModel) {
    val s by vm.exportSettings.collectAsState()
    val p by vm.project.collectAsState()
    val hevcOk = remember { ExportMath.hasEncoder(MimeTypes.VIDEO_H265) }
    val (w, h) = ExportMath.outputSize(p.aspect, s.shortSide)
    val bitrate = ExportMath.bitrate(w, h, s.fps, s.quality, s.hevc && hevcOk)
    val sizeMb = (bitrate.toLong() + 192_000) * p.durationMs / 1000 / 8 / 1_000_000.0
    PanelScaffold("Export", vm::closePanel) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            Text("Auflösung", color = Pal.TextDim, fontSize = 12.sp)
            Row(Modifier.horizontalScroll(rememberScrollState())) {
                listOf(480 to "480p", 720 to "720p", 1080 to "1080p", 1440 to "2K", 2160 to "4K").forEach { (v, n) ->
                    Chip(n, s.shortSide == v) { vm.exportSettings.value = s.copy(shortSide = v) }
                }
            }
            Text("Bildrate", color = Pal.TextDim, fontSize = 12.sp)
            Row(Modifier.horizontalScroll(rememberScrollState())) {
                listOf(24, 25, 30, 50, 60).forEach { v -> Chip("$v fps", s.fps == v) { vm.exportSettings.value = s.copy(fps = v) } }
            }
            Text("Qualität", color = Pal.TextDim, fontSize = 12.sp)
            Row(Modifier.horizontalScroll(rememberScrollState())) {
                ExportQuality.entries.forEach { q -> Chip(q.label, s.quality == q) { vm.exportSettings.value = s.copy(quality = q) } }
            }
            Text("Codec", color = Pal.TextDim, fontSize = 12.sp)
            Row {
                Chip("H.264 (kompatibel)", !s.hevc) { vm.exportSettings.value = s.copy(hevc = false) }
                Chip("H.265 / HEVC", s.hevc && hevcOk, enabled = hevcOk) { vm.exportSettings.value = s.copy(hevc = true) }
            }
            Text(
                "$w × $h · ${s.fps} fps · ${"%.1f".format(bitrate / 1e6)} Mbit/s · ca. ${"%.0f".format(sizeMb.coerceAtLeast(1.0))} MB",
                color = Pal.TextDim, fontSize = 12.sp, modifier = Modifier.padding(vertical = 6.dp),
            )
            Box(
                Modifier.fillMaxWidth().padding(vertical = 6.dp).clip(RoundedCornerShape(12.dp)).background(Pal.Accent)
                    .clickable { vm.closePanel(); vm.export() }.padding(14.dp),
                contentAlignment = Alignment.Center,
            ) { Text("Exportieren", color = Color.Black, fontWeight = FontWeight.Bold, fontSize = 16.sp) }
        }
    }
}

