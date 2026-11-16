package com.proedit.app.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.proedit.app.data.ProjectRepository
import com.proedit.app.data.ThumbnailCache
import com.proedit.app.model.Project
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun HomeScreen(onOpen: (String) -> Unit, onCreate: (List<Uri>) -> Unit, busy: StateFlow<Boolean>) {
    val context = LocalContext.current
    val repo = remember { ProjectRepository(context) }
    val thumbs = remember { ThumbnailCache(context) }
    DisposableEffect(Unit) { onDispose { thumbs.release() } }
    var projects by remember { mutableStateOf<List<Project>>(emptyList()) }
    var reload by remember { mutableStateOf(0) }
    var toDelete by remember { mutableStateOf<Project?>(null) }
    val scope = rememberCoroutineScope()
    val isBusy by busy.collectAsState()

    LaunchedEffect(reload) { projects = repo.list() }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) onCreate(uris)
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Pal.Bg)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        Row(Modifier.padding(horizontal = 20.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.Movie, null, tint = Pal.Accent, modifier = Modifier.size(30.dp))
            Spacer(Modifier.width(10.dp))
            Text("ProEdit", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Pal.Text)
            Spacer(Modifier.weight(1f))
            Text("Video-Editor", color = Pal.TextDim, fontSize = 13.sp)
        }

        Box(
            Modifier
                .padding(horizontal = 16.dp)
                .fillMaxWidth()
                .height(120.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(Brush.linearGradient(listOf(Pal.Accent, Pal.Accent2)))
                .clickable(enabled = !isBusy) { picker.launch(arrayOf("video/*", "image/*")) },
            contentAlignment = Alignment.Center,
        ) {
            if (isBusy) {
                CircularProgressIndicator(color = androidx.compose.ui.graphics.Color.White)
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Add, null, tint = androidx.compose.ui.graphics.Color.White, modifier = Modifier.size(36.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Neues Projekt", color = androidx.compose.ui.graphics.Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                }
            }
        }

        Text(
            "Projekte (${projects.size})",
            color = Pal.Text, fontWeight = FontWeight.SemiBold, fontSize = 17.sp,
            modifier = Modifier.padding(start = 20.dp, top = 24.dp, bottom = 8.dp),
        )
        if (projects.isEmpty()) {
            Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) {
                Text("Noch keine Projekte.\nTippe auf „Neues Projekt“ und wähle Videos oder Fotos.",
                    color = Pal.TextDim, fontSize = 14.sp)
            }
        }
        LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(projects, key = { it.id }) { p ->
                ProjectRow(p, thumbs, onClick = { onOpen(p.id) }, onDelete = { toDelete = p })
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }

    toDelete?.let { p ->
        AlertDialog(
            onDismissRequest = { toDelete = null },
            title = { Text("Projekt löschen?") },
            text = { Text("„${p.name}“ wird dauerhaft gelöscht. Deine Originalvideos bleiben erhalten.") },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch { repo.delete(p.id); reload++ }
                    toDelete = null
                }) { Text("Löschen", color = Pal.Danger) }
            },
            dismissButton = { TextButton(onClick = { toDelete = null }) { Text("Abbrechen") } },
        )
    }
}

@Composable
private fun ProjectRow(p: Project, thumbs: ThumbnailCache, onClick: () -> Unit, onDelete: () -> Unit) {
    val first = p.clips.firstOrNull()
    val bmp by produceState<android.graphics.Bitmap?>(null, first?.uri) {
        value = first?.let { thumbs.thumbnail(it.uri, it.type, ThumbnailCache.bucket(it.trimStartMs), 200) }
    }
    Row(
        Modifier
            .padding(horizontal = 16.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Pal.Surface)
            .clickable(onClick = onClick)
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(72.dp).clip(RoundedCornerShape(10.dp)).background(Pal.Surface3),
            contentAlignment = Alignment.Center,
        ) {
            val b = bmp
            if (b != null) Image(b.asImageBitmap(), null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            else Icon(Icons.Default.Movie, null, tint = Pal.TextDim)
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(p.name, color = Pal.Text, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, maxLines = 1)
            Spacer(Modifier.height(4.dp))
            Text(
                "${formatTime(p.durationMs)} · ${p.clips.size} Clips · ${p.aspect.label}",
                color = Pal.TextDim, fontSize = 13.sp,
            )
            Text(
                SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.GERMANY).format(Date(p.updatedAt)),
                color = Pal.TextDim, fontSize = 12.sp,
            )
        }
        IconButton(onClick = onDelete) { Icon(Icons.Default.Delete, "Löschen", tint = Pal.TextDim) }
    }
}

fun formatTime(ms: Long, withTenths: Boolean = false): String {
    val total = ms.coerceAtLeast(0)
    val m = total / 60000
    val s = (total / 1000) % 60
    return if (withTenths) "%02d:%02d.%d".format(m, s, (total / 100) % 10) else "%02d:%02d".format(m, s)
}
