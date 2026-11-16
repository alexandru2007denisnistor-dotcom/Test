package com.proedit.app.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.AspectRatio
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.ContentCut
import androidx.compose.material.icons.filled.Crop
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.EmojiEmotions
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Animation
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.TextFields
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Brush
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.proedit.app.engine.ExportState
import com.proedit.app.model.AudioKind
import com.proedit.app.model.ProjectOps
import kotlinx.coroutines.delay

@Composable
fun EditorScreen(vm: EditorViewModel, projectId: String, onBack: () -> Unit) {
    LaunchedEffect(projectId) { vm.open(projectId) }
    val context = LocalContext.current
    val project by vm.project.collectAsState()
    val position by vm.engine.position.collectAsState()
    val playing by vm.engine.playing.collectAsState()
    val selection by vm.selection.collectAsState()
    val panel by vm.panel.collectAsState()
    val canUndo by vm.canUndo.collectAsState()
    val canRedo by vm.canRedo.collectAsState()
    val exportState by vm.exportState.collectAsState()
    val message by vm.message.collectAsState()
    val busy by vm.busy.collectAsState()
    val playerError by vm.engine.error.collectAsState()
    var renaming by remember { mutableStateOf(false) }

    val mediaPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) vm.addClips(uris)
    }
    val musicPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) { vm.closePanel(); vm.addAudio(uri, AudioKind.MUSIC) }
    }
    val videoAudioPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) { vm.closePanel(); vm.addAudio(uri, AudioKind.EXTRACTED) }
    }
    val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) vm.openPanel(Panel.RECORD) else vm.toast("Mikrofon-Berechtigung benötigt")
    }
    val storagePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { _ ->
        vm.openPanel(Panel.EXPORT)
    }

    LaunchedEffect(message) {
        if (message != null) { delay(2200); vm.consumeMessage() }
    }

    fun requireClip(): Boolean {
        if (vm.selectedClip() == null && vm.selectClipAtPlayhead() == null) {
            vm.toast("Füge zuerst ein Video hinzu"); return false
        }
        return true
    }

    Box(Modifier.fillMaxSize().background(Pal.Bg)) {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding(),
        ) {
            // ---------------------------------------------------------------- top bar
            Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück", tint = Pal.Text) }
                Text(
                    project.name, color = Pal.Text, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f).clickable { renaming = true }.padding(vertical = 8.dp),
                )
                val s by vm.exportSettings.collectAsState()
                Text(
                    when (s.shortSide) { 2160 -> "4K"; 1440 -> "2K"; else -> "${s.shortSide}p" },
                    color = Pal.Text, fontSize = 13.sp,
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(Pal.Surface2)
                        .clickable { vm.openPanel(Panel.EXPORT) }.padding(horizontal = 10.dp, vertical = 6.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    "Export", color = Color.Black, fontWeight = FontWeight.Bold, fontSize = 14.sp,
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(Pal.Accent)
                        .clickable {
                            if (android.os.Build.VERSION.SDK_INT <= 28 &&
                                ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
                            ) storagePermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                            else vm.openPanel(Panel.EXPORT)
                        }
                        .padding(horizontal = 14.dp, vertical = 7.dp),
                )
                Spacer(Modifier.width(8.dp))
            }

            // ---------------------------------------------------------------- preview
            Box(Modifier.weight(1f).fillMaxWidth()) {
                if (project.clips.isEmpty()) {
                    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center) {
                        Text("Keine Clips", color = Pal.TextDim)
                        Spacer(Modifier.height(8.dp))
                        Text("+ Medien hinzufügen", color = Pal.Accent, fontWeight = FontWeight.Bold,
                            modifier = Modifier.clickable { mediaPicker.launch(arrayOf("video/*", "image/*")) }.padding(8.dp))
                    }
                } else {
                    PreviewArea(vm, project, position, selection, Modifier.fillMaxSize())
                }
            }

            // ---------------------------------------------------------------- transport
            Row(Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "${formatTime(position, true)} / ${formatTime(project.durationMs, true)}",
                    color = Pal.Text, fontSize = 12.sp, modifier = Modifier.widthIn(min = 110.dp),
                )
                Spacer(Modifier.weight(1f))
                IconButton(onClick = { vm.engine.toggle() }) {
                    Icon(if (playing) Icons.Default.Pause else Icons.Default.PlayArrow, "Abspielen", tint = Pal.Text, modifier = Modifier.size(32.dp))
                }
                Spacer(Modifier.weight(1f))
                IconButton(onClick = vm::undo, enabled = canUndo) {
                    Icon(Icons.AutoMirrored.Filled.Undo, "Rückgängig", tint = if (canUndo) Pal.Text else Pal.Surface3)
                }
                IconButton(onClick = vm::redo, enabled = canRedo) {
                    Icon(Icons.AutoMirrored.Filled.Redo, "Wiederholen", tint = if (canRedo) Pal.Text else Pal.Surface3)
                }
            }

            // ---------------------------------------------------------------- timeline
            Box(Modifier.fillMaxWidth().background(Pal.Bg).padding(vertical = 4.dp)) {
                Timeline(
                    vm = vm, project = project, positionMs = position, selection = selection, thumbs = vm.thumbs,
                    onAddMedia = { mediaPicker.launch(arrayOf("video/*", "image/*")) },
                )
            }

            // ---------------------------------------------------------------- tools / panel
            val clip = vm.selectedClip()
            when (panel) {
                Panel.SPEED -> clip?.let { SpeedPanel(vm, it) }
                Panel.VOLUME -> clip?.let { VolumePanel(vm, it) }
                Panel.FILTER -> clip?.let { FilterPanel(vm, it, vm.thumbs) }
                Panel.ADJUST -> clip?.let { AdjustPanel(vm, it) }
                Panel.TRANSFORM -> clip?.let { TransformPanel(vm, it) }
                Panel.TRANSITION -> clip?.let { TransitionPanel(vm, it, project.clips.lastOrNull()?.id == it.id) }
                Panel.TEXT_EDIT -> TextEditPanel(vm)
                Panel.TEXT_STYLE -> TextStylePanel(vm)
                Panel.TEXT_ANIM -> TextAnimPanel(vm)
                Panel.AUDIO_VOLUME -> AudioVolumePanel(vm)
                Panel.AUDIO_MENU -> AudioMenuPanel(
                    vm,
                    onMusic = { musicPicker.launch(arrayOf("audio/*")) },
                    onFromVideo = { videoAudioPicker.launch(arrayOf("video/*")) },
                    onRecord = {
                        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                            vm.openPanel(Panel.RECORD)
                        } else micPermission.launch(Manifest.permission.RECORD_AUDIO)
                    },
                )
                Panel.RECORD -> RecordPanel(vm)
                Panel.FORMAT -> FormatPanel(vm)
                Panel.STICKER -> StickerPanel(vm)
                Panel.EXPORT -> ExportPanel(vm)
                Panel.NONE -> Toolbar(vm, selection, onAddMedia = { mediaPicker.launch(arrayOf("video/*", "image/*")) }, requireClip = ::requireClip)
            }
        }

        // ---------------------------------------------------------------- overlays
        message?.let {
            Snackbar(Modifier.align(Alignment.TopCenter).padding(top = 70.dp, start = 24.dp, end = 24.dp), containerColor = Pal.Surface3) {
                Text(it, color = Pal.Text)
            }
        }
        playerError?.let {
            Snackbar(
                Modifier.align(Alignment.TopCenter).padding(top = 70.dp, start = 24.dp, end = 24.dp), containerColor = Pal.Surface3,
                action = { TextButton(onClick = vm.engine::clearError) { Text("OK") } },
            ) { Text(it, color = Pal.Text) }
        }
        if (busy) {
            Box(Modifier.fillMaxSize().background(Color(0x88000000)), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Pal.Accent)
            }
        }
        ExportOverlay(vm, exportState)
    }

    if (renaming) {
        var name by remember { mutableStateOf(project.name) }
        AlertDialog(
            onDismissRequest = { renaming = false },
            title = { Text("Projekt umbenennen") },
            text = { OutlinedTextField(name, { name = it }, singleLine = true) },
            confirmButton = { TextButton(onClick = { vm.renameProject(name); renaming = false }) { Text("OK") } },
            dismissButton = { TextButton(onClick = { renaming = false }) { Text("Abbrechen") } },
        )
    }
}

private data class Tool(val icon: ImageVector, val label: String, val danger: Boolean = false, val action: () -> Unit)

@Composable
private fun Toolbar(vm: EditorViewModel, selection: Selection, onAddMedia: () -> Unit, requireClip: () -> Boolean) {
    val tools: List<Tool> = when (selection) {
        is Selection.ClipSel -> listOf(
            Tool(Icons.Default.ContentCut, "Teilen") { vm.split() },
            Tool(Icons.Default.Speed, "Tempo") { vm.openPanel(Panel.SPEED) },
            Tool(Icons.AutoMirrored.Filled.VolumeUp, "Lautstärke") { vm.openPanel(Panel.VOLUME) },
            Tool(Icons.Default.AutoAwesome, "Filter") { vm.openPanel(Panel.FILTER) },
            Tool(Icons.Default.Tune, "Anpassen") { vm.openPanel(Panel.ADJUST) },
            Tool(Icons.Default.Crop, "Transform") { vm.openPanel(Panel.TRANSFORM) },
            Tool(Icons.Default.SwapHoriz, "Übergang") { vm.openPanel(Panel.TRANSITION) },
            Tool(Icons.Default.Image, "Standbild") { vm.freezeFrame() },
            Tool(Icons.Default.GraphicEq, "Ton extr.") { vm.extractAudio() },
            Tool(Icons.Default.ContentCopy, "Duplizieren") { vm.duplicateSelected() },
            Tool(Icons.Default.ChevronLeft, "Nach vorne") { (selection as? Selection.ClipSel)?.let { s -> vm.commit { ProjectOps.moveClip(it, s.id, -1) } } },
            Tool(Icons.Default.ChevronRight, "Nach hinten") { (selection as? Selection.ClipSel)?.let { s -> vm.commit { ProjectOps.moveClip(it, s.id, 1) } } },
            Tool(Icons.Default.Delete, "Löschen", danger = true) { vm.deleteSelected() },
        )
        is Selection.TextSel -> listOf(
            Tool(Icons.Default.Edit, "Bearbeiten") { vm.openPanel(Panel.TEXT_EDIT) },
            Tool(Icons.Default.Brush, "Stil") { vm.openPanel(Panel.TEXT_STYLE) },
            Tool(Icons.Default.Animation, "Animation") { vm.openPanel(Panel.TEXT_ANIM) },
            Tool(Icons.Default.ContentCut, "Teilen") { vm.split() },
            Tool(Icons.Default.ContentCopy, "Duplizieren") { vm.duplicateSelected() },
            Tool(Icons.Default.Delete, "Löschen", danger = true) { vm.deleteSelected() },
        )
        is Selection.AudioSel -> listOf(
            Tool(Icons.AutoMirrored.Filled.VolumeUp, "Lautstärke") { vm.openPanel(Panel.AUDIO_VOLUME) },
            Tool(Icons.Default.ContentCut, "Teilen") { vm.split() },
            Tool(Icons.Default.ContentCopy, "Duplizieren") { vm.duplicateSelected() },
            Tool(Icons.Default.Delete, "Löschen", danger = true) { vm.deleteSelected() },
        )
        Selection.None -> listOf(
            Tool(Icons.Default.ContentCut, "Bearbeiten") { if (requireClip()) Unit },
            Tool(Icons.Default.MusicNote, "Audio") { vm.openPanel(Panel.AUDIO_MENU) },
            Tool(Icons.Default.TextFields, "Text") { vm.addText() },
            Tool(Icons.Default.EmojiEmotions, "Sticker") { vm.openPanel(Panel.STICKER) },
            Tool(Icons.Default.AutoAwesome, "Filter") { if (requireClip()) vm.openPanel(Panel.FILTER) },
            Tool(Icons.Default.Palette, "Anpassen") { if (requireClip()) vm.openPanel(Panel.ADJUST) },
            Tool(Icons.Default.AspectRatio, "Format") { vm.openPanel(Panel.FORMAT) },
            Tool(Icons.Default.AddPhotoAlternate, "Medien") { onAddMedia() },
        )
    }
    Row(
        Modifier
            .fillMaxWidth()
            .background(Pal.Surface)
            .horizontalScroll(rememberScrollState())
            .padding(vertical = 8.dp, horizontal = 4.dp),
    ) {
        if (selection != Selection.None) {
            ToolButton(Tool(Icons.AutoMirrored.Filled.ArrowBack, "Zurück") { vm.select(Selection.None) })
        }
        tools.forEach { ToolButton(it) }
    }
}

@Composable
private fun ToolButton(t: Tool) {
    Column(
        Modifier
            .width(68.dp)
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = t.action)
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(t.icon, t.label, tint = if (t.danger) Pal.Danger else Pal.Text, modifier = Modifier.size(24.dp))
        Spacer(Modifier.height(4.dp))
        Text(t.label, fontSize = 11.sp, color = if (t.danger) Pal.Danger else Pal.Text, maxLines = 1)
    }
}

@Composable
private fun ExportOverlay(vm: EditorViewModel, state: ExportState) {
    if (state == ExportState.Idle) return
    val context = LocalContext.current
    Box(Modifier.fillMaxSize().background(Color(0xE6000000)).clickable(enabled = true) {}, contentAlignment = Alignment.Center) {
        Column(
            Modifier.padding(32.dp).clip(RoundedCornerShape(18.dp)).background(Pal.Surface).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            when (state) {
                is ExportState.Running -> {
                    Text("Exportiere …", color = Pal.Text, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    Spacer(Modifier.height(16.dp))
                    LinearProgressIndicator(
                        progress = { state.progress / 100f }, color = Pal.Accent, trackColor = Pal.Surface3,
                        modifier = Modifier.width(220.dp).height(6.dp).clip(RoundedCornerShape(3.dp)),
                    )
                    Spacer(Modifier.height(8.dp))
                    Text("${state.progress} %", color = Pal.TextDim)
                    Text("Bitte App geöffnet lassen.", color = Pal.TextDim, fontSize = 12.sp)
                    Spacer(Modifier.height(12.dp))
                    TextButton(onClick = vm::cancelExport) { Text("Abbrechen", color = Pal.Danger) }
                }
                is ExportState.Done -> {
                    Text("✓ Gespeichert", color = Pal.Accent, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                    Spacer(Modifier.height(6.dp))
                    Text("Filme/ProEdit · ${"%.1f".format(state.sizeBytes / 1e6)} MB", color = Pal.TextDim, fontSize = 13.sp)
                    Spacer(Modifier.height(16.dp))
                    Row {
                        TextButton(onClick = {
                            val send = Intent(Intent.ACTION_SEND).apply {
                                type = "video/mp4"
                                putExtra(Intent.EXTRA_STREAM, state.uri)
                                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                            }
                            context.startActivity(Intent.createChooser(send, "Video teilen"))
                        }) { Text("Teilen", color = Pal.Accent) }
                        TextButton(onClick = {
                            val view = Intent(Intent.ACTION_VIEW).apply {
                                setDataAndType(state.uri, "video/mp4")
                                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                            }
                            runCatching { context.startActivity(view) }
                        }) { Text("Ansehen", color = Pal.Accent) }
                        TextButton(onClick = vm::resetExport) { Text("Fertig", color = Pal.Text) }
                    }
                }
                is ExportState.Failed -> {
                    Text("Export fehlgeschlagen", color = Pal.Danger, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    Spacer(Modifier.height(8.dp))
                    Text(state.message, color = Pal.TextDim, fontSize = 13.sp)
                    Spacer(Modifier.height(12.dp))
                    TextButton(onClick = vm::resetExport) { Text("OK", color = Pal.Text) }
                }
                ExportState.Idle -> {}
            }
        }
    }
}
