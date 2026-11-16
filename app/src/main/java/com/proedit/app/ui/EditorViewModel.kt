package com.proedit.app.ui

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.proedit.app.data.MediaImport
import com.proedit.app.data.ProjectRepository
import com.proedit.app.data.ThumbnailCache
import com.proedit.app.engine.ExportSettings
import com.proedit.app.engine.ExportState
import com.proedit.app.engine.Exporter
import com.proedit.app.engine.PreviewEngine
import com.proedit.app.engine.VoiceRecorder
import com.proedit.app.model.AudioItem
import com.proedit.app.model.AudioKind
import com.proedit.app.model.Clip
import com.proedit.app.model.ClipType
import com.proedit.app.model.Project
import com.proedit.app.model.ProjectOps
import com.proedit.app.model.TextItem
import com.proedit.app.model.locate
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

sealed interface Selection {
    data object None : Selection
    data class ClipSel(val id: String) : Selection
    data class TextSel(val id: String) : Selection
    data class AudioSel(val id: String) : Selection
}

enum class Panel {
    NONE, SPEED, VOLUME, FILTER, ADJUST, TRANSFORM, TRANSITION, TEXT_EDIT, TEXT_STYLE, TEXT_ANIM,
    AUDIO_VOLUME, AUDIO_MENU, FORMAT, STICKER, EXPORT, RECORD
}

class EditorViewModel(app: Application) : AndroidViewModel(app) {
    private val repo = ProjectRepository(app)
    val engine = PreviewEngine(app)
    val thumbs = ThumbnailCache(app)
    private val exporter = Exporter(app)
    val recorder = VoiceRecorder(app)

    private val _project = MutableStateFlow(Project())
    val project: StateFlow<Project> = _project
    private val _selection = MutableStateFlow<Selection>(Selection.None)
    val selection: StateFlow<Selection> = _selection
    private val _panel = MutableStateFlow(Panel.NONE)
    val panel: StateFlow<Panel> = _panel
    private val _exportState = MutableStateFlow<ExportState>(ExportState.Idle)
    val exportState: StateFlow<ExportState> = _exportState
    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy

    private val undoStack = ArrayDeque<Project>()
    private val redoStack = ArrayDeque<Project>()
    private val _canUndo = MutableStateFlow(false)
    val canUndo: StateFlow<Boolean> = _canUndo
    private val _canRedo = MutableStateFlow(false)
    val canRedo: StateFlow<Boolean> = _canRedo
    private var lastCoalesceKey: String? = null
    private var saveJob: Job? = null
    private var loadedId: String? = null

    var exportSettings = MutableStateFlow(ExportSettings())

    fun open(id: String) {
        if (loadedId == id) return
        loadedId = id
        viewModelScope.launch {
            val p = repo.load(id) ?: Project(id = id)
            _project.value = p
            undoStack.clear(); redoStack.clear(); updateUndoFlags()
            engine.setProject(p)
            engine.seekTo(0)
        }
    }

    fun create(uris: List<Uri>, onCreated: (String) -> Unit) {
        viewModelScope.launch {
            _busy.value = true
            val clips = uris.mapNotNull { MediaImport.clipFrom(getApplication(), it) }
            _busy.value = false
            val count = repo.list().size + 1
            val first = clips.firstOrNull()
            val aspect = if (first != null && first.width > first.height) com.proedit.app.model.AspectRatio.R16_9
            else com.proedit.app.model.AspectRatio.R9_16
            val p = Project(name = "Projekt $count", clips = clips, aspect = aspect)
            repo.save(p)
            loadedId = null
            onCreated(p.id)
        }
    }

    // ---------------------------------------------------------------- history

    /** Applies an edit with undo support. Edits with the same [coalesce] key merge into one step. */
    fun commit(coalesce: String? = null, f: (Project) -> Project) {
        val old = _project.value
        val new = ProjectOps.clampOverlays(f(old)).copy(updatedAt = System.currentTimeMillis())
        if (new == old) return
        if (coalesce == null || coalesce != lastCoalesceKey) {
            undoStack.addLast(old)
            if (undoStack.size > 80) undoStack.removeFirst()
            redoStack.clear()
        }
        lastCoalesceKey = coalesce
        apply(new)
    }

    fun endGesture() {
        lastCoalesceKey = null
    }

    private fun apply(p: Project) {
        _project.value = p
        engine.setProject(p)
        validateSelection(p)
        updateUndoFlags()
        scheduleSave()
    }

    fun undo() {
        val prev = undoStack.removeLastOrNull() ?: return
        redoStack.addLast(_project.value)
        lastCoalesceKey = null
        apply(prev)
    }

    fun redo() {
        val next = redoStack.removeLastOrNull() ?: return
        undoStack.addLast(_project.value)
        lastCoalesceKey = null
        apply(next)
    }

    private fun updateUndoFlags() {
        _canUndo.value = undoStack.isNotEmpty()
        _canRedo.value = redoStack.isNotEmpty()
    }

    private fun scheduleSave() {
        saveJob?.cancel()
        saveJob = viewModelScope.launch {
            delay(700)
            repo.save(_project.value)
        }
    }

    fun saveNow() {
        saveJob?.cancel()
        val p = _project.value
        runBlocking { repo.save(p) }
    }

    private fun validateSelection(p: Project) {
        val ok = when (val s = _selection.value) {
            is Selection.ClipSel -> p.clips.any { it.id == s.id }
            is Selection.TextSel -> p.texts.any { it.id == s.id }
            is Selection.AudioSel -> p.audios.any { it.id == s.id }
            Selection.None -> true
        }
        if (!ok) select(Selection.None)
    }

    // ---------------------------------------------------------------- selection / panels

    fun select(s: Selection) {
        _selection.value = s
        if (s == Selection.None || _panel.value != Panel.NONE) _panel.value = Panel.NONE
        lastCoalesceKey = null
    }

    fun openPanel(p: Panel) {
        _panel.value = p
        lastCoalesceKey = null
    }

    fun closePanel() {
        _panel.value = Panel.NONE
        lastCoalesceKey = null
    }

    fun selectedClip(): Clip? = (selection.value as? Selection.ClipSel)?.let { s -> project.value.clips.find { it.id == s.id } }
    fun selectedText(): TextItem? = (selection.value as? Selection.TextSel)?.let { s -> project.value.texts.find { it.id == s.id } }
    fun selectedAudio(): AudioItem? = (selection.value as? Selection.AudioSel)?.let { s -> project.value.audios.find { it.id == s.id } }

    /** Selects the clip under the playhead (used by global tools such as "Edit" or "Filter"). */
    fun selectClipAtPlayhead(): Clip? {
        val p = project.value
        val pos = p.locate(engine.position.value) ?: return null
        val c = p.clips[pos.clipIndex]
        _selection.value = Selection.ClipSel(c.id)
        return c
    }

    fun toast(msg: String) {
        _message.value = msg
    }

    fun consumeMessage() {
        _message.value = null
    }

    // ---------------------------------------------------------------- media

    fun addClips(uris: List<Uri>, atEnd: Boolean = false) {
        viewModelScope.launch {
            _busy.value = true
            val clips = uris.mapNotNull { MediaImport.clipFrom(getApplication(), it) }
            _busy.value = false
            if (clips.isEmpty()) { toast("Keine unterstützten Medien gefunden"); return@launch }
            commit { p ->
                val insertAt = if (atEnd || p.clips.isEmpty()) p.clips.size else {
                    val pos = p.locate(engine.position.value)!!
                    if (pos.offsetInClipMs > p.clips[pos.clipIndex].durationMs / 2) pos.clipIndex + 1 else pos.clipIndex
                }
                p.copy(clips = p.clips.toMutableList().apply { addAll(insertAt, clips) })
            }
        }
    }

    fun addAudio(uri: Uri, kind: AudioKind) {
        viewModelScope.launch {
            val item = MediaImport.audioFrom(getApplication(), uri, kind, engine.position.value)
            if (item == null) { toast("Audiodatei konnte nicht gelesen werden"); return@launch }
            val total = project.value.durationMs
            val trimmed = if (kind == AudioKind.MUSIC && item.endMs > total && total > item.startMs) {
                item.copy(trimEndMs = item.trimStartMs + (total - item.startMs), fadeOutMs = 1500)
            } else item
            commit { it.copy(audios = it.audios + trimmed) }
            _selection.value = Selection.AudioSel(trimmed.id)
        }
    }

    /** CapCut "Extract audio": moves a clip's sound onto its own lane and mutes the clip. */
    fun extractAudio() {
        val c = selectedClip() ?: return
        if (c.type != ClipType.VIDEO) { toast("Fotos haben keinen Ton"); return }
        if (c.speed != 1f) { toast("Bitte zuerst Tempo auf 1x setzen"); return }
        val start = project.value.clipStarts()[project.value.clips.indexOf(c)]
        val item = AudioItem(
            uri = c.uri, name = "Ton: Clip ${project.value.clips.indexOf(c) + 1}", kind = AudioKind.EXTRACTED,
            startMs = start, sourceDurationMs = c.sourceDurationMs, trimStartMs = c.trimStartMs, trimEndMs = c.trimEndMs,
            volume = c.volume,
        )
        commit { p -> ProjectOps.updateClip(p, c.id) { it.copy(volume = 0f) }.copy(audios = p.audios + item) }
        toast("Ton extrahiert")
    }

    fun freezeFrame() {
        val p = project.value
        val pos = p.locate(engine.position.value) ?: return
        val c = p.clips[pos.clipIndex]
        if (c.type != ClipType.VIDEO) { toast("Standbild nur bei Videos"); return }
        viewModelScope.launch {
            _busy.value = true
            val src = c.trimStartMs + (pos.offsetInClipMs * c.speed).toLong()
            val bmp = MediaImport.grabFrame(getApplication(), Uri.parse(c.uri), src)
            _busy.value = false
            if (bmp == null) { toast("Bild konnte nicht gelesen werden"); return@launch }
            val f = MediaImport.saveFrame(getApplication(), bmp)
            commit { ProjectOps.insertFreezeFrame(it, engine.position.value, Uri.fromFile(f).toString(), bmp.width, bmp.height) }
            toast("Standbild eingefügt")
        }
    }

    fun startRecording(): Boolean {
        engine.pause()
        return recorder.start().also { if (it) engine.play() }
    }

    fun stopRecording(startMs: Long) {
        engine.pause()
        val f = recorder.stop() ?: run { toast("Aufnahme fehlgeschlagen"); return }
        viewModelScope.launch {
            val item = MediaImport.audioFrom(getApplication(), Uri.fromFile(f), AudioKind.VOICE, startMs, persist = false)
            if (item == null) { toast("Aufnahme zu kurz"); return@launch }
            commit { it.copy(audios = it.audios + item.copy(name = "Voiceover")) }
        }
    }

    // ---------------------------------------------------------------- generic actions

    fun split() {
        val t = engine.position.value
        when (val s = selection.value) {
            is Selection.TextSel -> commit { ProjectOps.splitText(it, s.id, t) }
            is Selection.AudioSel -> commit { ProjectOps.splitAudio(it, s.id, t) }
            else -> {
                val before = project.value.clips.size
                commit { ProjectOps.splitClipAt(it, t) }
                if (project.value.clips.size == before) toast("Hier kann nicht geteilt werden")
            }
        }
    }

    fun deleteSelected() {
        when (val s = selection.value) {
            is Selection.ClipSel -> commit { ProjectOps.deleteClip(it, s.id) }
            is Selection.TextSel -> commit { ProjectOps.deleteText(it, s.id) }
            is Selection.AudioSel -> commit { ProjectOps.deleteAudio(it, s.id) }
            Selection.None -> {}
        }
        select(Selection.None)
    }

    fun duplicateSelected() {
        when (val s = selection.value) {
            is Selection.ClipSel -> commit { ProjectOps.duplicateClip(it, s.id) }
            is Selection.TextSel -> commit { ProjectOps.duplicateText(it, s.id) }
            is Selection.AudioSel -> commit { ProjectOps.duplicateAudio(it, s.id) }
            Selection.None -> {}
        }
    }

    fun updateClip(key: String?, f: (Clip) -> Clip) {
        val id = (selection.value as? Selection.ClipSel)?.id ?: return
        commit(key?.let { "$it:$id" }) { ProjectOps.updateClip(it, id, f) }
    }

    fun updateText(key: String?, f: (TextItem) -> TextItem) {
        val id = (selection.value as? Selection.TextSel)?.id ?: return
        commit(key?.let { "$it:$id" }) { ProjectOps.updateText(it, id, f) }
    }

    fun updateAudio(key: String?, f: (AudioItem) -> AudioItem) {
        val id = (selection.value as? Selection.AudioSel)?.id ?: return
        commit(key?.let { "$it:$id" }) { ProjectOps.updateAudio(it, id, f) }
    }

    fun addText(sticker: String? = null) {
        val start = engine.position.value
        val item = if (sticker != null) {
            TextItem(text = sticker, startMs = start, size = 0.12f, outline = false, isSticker = true,
                animIn = com.proedit.app.model.TextAnimation.POP)
        } else {
            TextItem(text = "Text eingeben", startMs = start)
        }
        val total = project.value.durationMs
        val fitted = if (total > 0 && item.endMs > total) item.copy(durationMs = (total - start).coerceAtLeast(500)) else item
        commit { it.copy(texts = it.texts + fitted.copy(startMs = start.coerceAtMost((total - 500).coerceAtLeast(0)))) }
        _selection.value = Selection.TextSel(item.id)
        _panel.value = if (sticker == null) Panel.TEXT_EDIT else Panel.NONE
    }

    // ---------------------------------------------------------------- export

    fun export() {
        engine.pause()
        saveNow()
        exporter.start(project.value, exportSettings.value) { _exportState.value = it }
    }

    fun cancelExport() {
        exporter.cancel()
        _exportState.value = ExportState.Idle
    }

    fun resetExport() {
        _exportState.value = ExportState.Idle
    }

    fun renameProject(name: String) = commit { it.copy(name = name.ifBlank { it.name }) }

    override fun onCleared() {
        runCatching { saveNow() }
        engine.release()
        thumbs.release()
        recorder.stop()
        exporter.cancel()
    }
}
