package com.proedit.app.engine

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.SeekParameters
import com.proedit.app.model.AudioItem
import com.proedit.app.model.ClipType
import com.proedit.app.model.Project
import com.proedit.app.model.locate
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlin.math.abs

/**
 * Real-time preview of a [Project]. The main track is an ExoPlayer playlist of clipped items;
 * every audio item gets its own lightweight player that is kept in sync with the main clock.
 */
class PreviewEngine(private val context: Context) {
    val player: ExoPlayer = ExoPlayer.Builder(context).build().apply {
        setSeekParameters(SeekParameters.EXACT)
    }

    private val _position = MutableStateFlow(0L)
    val position: StateFlow<Long> = _position
    private val _playing = MutableStateFlow(false)
    val playing: StateFlow<Boolean> = _playing
    private val _clipIndex = MutableStateFlow(0)
    val clipIndex: StateFlow<Int> = _clipIndex
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    private var project: Project = Project()
    private var playlistKey: List<String> = emptyList()
    private val audioPlayers = mutableMapOf<String, ExoPlayer>()
    private val audioKeys = mutableMapOf<String, String>()
    private val handler = Handler(Looper.getMainLooper())
    private var released = false
    private var pendingSeek: Long? = null
    private var lastSeekAt = 0L

    private val ticker = object : Runnable {
        override fun run() {
            if (released) return
            tick()
            handler.postDelayed(this, 33)
        }
    }

    init {
        player.addListener(object : Player.Listener {
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                applyClipParams()
            }

            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) {
                    player.playWhenReady = false
                    _playing.value = false
                    _position.value = project.durationMs
                    pauseAudio()
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (player.playWhenReady != _playing.value) _playing.value = player.playWhenReady
            }

            override fun onPlayerError(error: PlaybackException) {
                _error.value = "Wiedergabefehler: ${error.errorCodeName}"
                _playing.value = false
            }
        })
        handler.post(ticker)
    }

    // ------------------------------------------------------------------ project sync

    private val rebuildRunnable = Runnable {
        if (released) return@Runnable
        val p = project
        val key = p.clips.map { "${it.id}|${it.uri}|${it.type}|${it.trimStartMs}|${it.trimEndMs}" }
        if (key != playlistKey) {
            playlistKey = key
            rebuildPlaylist(_position.value.coerceAtMost((p.durationMs - 1).coerceAtLeast(0)))
        }
        syncAudioPlayers(p.audios)
    }

    /**
     * Updates the previewed project. Cheap changes (speed, volume, look) apply at once; rebuilding
     * the playlist or audio players is debounced so drag gestures stay smooth.
     */
    fun setProject(p: Project) {
        val old = project
        project = p
        if (old.clips != p.clips) applyClipParams()
        handler.removeCallbacks(rebuildRunnable)
        if (playlistKey.isEmpty() || old.clips.size != p.clips.size || old.clips.map { it.id } != p.clips.map { it.id }) {
            rebuildRunnable.run()
        } else {
            handler.postDelayed(rebuildRunnable, 160)
        }
    }

    private fun rebuildPlaylist(atMs: Long) {
        val items = project.clips.map { c ->
            MediaItem.Builder().setUri(Uri.parse(c.uri)).setMediaId(c.id).apply {
                if (c.type == ClipType.IMAGE) setImageDurationMs(c.durationMs)
                else setClippingConfiguration(
                    MediaItem.ClippingConfiguration.Builder()
                        .setStartPositionMs(c.trimStartMs).setEndPositionMs(c.trimEndMs).build(),
                )
            }.build()
        }
        if (items.isEmpty()) {
            player.clearMediaItems()
            _position.value = 0
            return
        }
        val pos = project.locate(atMs)!!
        val clip = project.clips[pos.clipIndex]
        player.setMediaItems(items, pos.clipIndex, sourceOffset(clip.type, clip.speed, pos.offsetInClipMs))
        player.prepare()
        _error.value = null
        applyClipParams()
    }

    private fun sourceOffset(type: ClipType, speed: Float, outMs: Long) =
        if (type == ClipType.IMAGE) outMs else (outMs * speed).toLong()

    private fun applyClipParams() {
        val idx = player.currentMediaItemIndex
        val clip = project.clips.getOrNull(idx) ?: return
        _clipIndex.value = idx
        val speed = if (clip.type == ClipType.IMAGE) 1f else clip.speed
        if (player.playbackParameters.speed != speed) player.playbackParameters = PlaybackParameters(speed)
    }

    private fun syncAudioPlayers(items: List<AudioItem>) {
        val ids = items.map { it.id }.toSet()
        (audioPlayers.keys - ids).forEach { id ->
            audioPlayers.remove(id)?.release()
            audioKeys.remove(id)
        }
        items.forEach { a ->
            val key = "${a.uri}|${a.trimStartMs}|${a.trimEndMs}"
            val existing = audioPlayers[a.id]
            if (existing == null || audioKeys[a.id] != key) {
                existing?.release()
                val ap = ExoPlayer.Builder(context).build().apply {
                    trackSelectionParameters = trackSelectionParameters.buildUpon()
                        .setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, true).build()
                    setMediaItem(
                        MediaItem.Builder().setUri(Uri.parse(a.uri))
                            .setClippingConfiguration(
                                MediaItem.ClippingConfiguration.Builder()
                                    .setStartPositionMs(a.trimStartMs).setEndPositionMs(a.trimEndMs).build(),
                            ).build(),
                    )
                    prepare()
                }
                audioPlayers[a.id] = ap
                audioKeys[a.id] = key
            }
        }
    }

    // ------------------------------------------------------------------ transport

    fun play() {
        if (project.clips.isEmpty()) return
        if (_position.value >= project.durationMs - 30) seekTo(0)
        player.playWhenReady = true
        _playing.value = true
    }

    fun pause() {
        player.playWhenReady = false
        _playing.value = false
        pauseAudio()
    }

    fun toggle() = if (_playing.value) pause() else play()

    /** Seeks the whole preview to [ms] on the output timeline. Rapid calls are throttled. */
    fun seekTo(ms: Long) {
        val clamped = ms.coerceIn(0, project.durationMs.coerceAtLeast(0))
        _position.value = clamped
        val now = System.currentTimeMillis()
        if (now - lastSeekAt < 40) {
            pendingSeek = clamped
            return
        }
        doSeek(clamped)
    }

    private fun doSeek(ms: Long) {
        lastSeekAt = System.currentTimeMillis()
        pendingSeek = null
        val pos = project.locate(ms) ?: return
        val clip = project.clips[pos.clipIndex]
        val off = sourceOffset(clip.type, clip.speed, pos.offsetInClipMs.coerceAtMost(clip.durationMs - 1).coerceAtLeast(0))
        if (player.playbackState == Player.STATE_ENDED || player.playbackState == Player.STATE_IDLE) player.prepare()
        player.seekTo(pos.clipIndex, off)
        syncAudio(ms, force = true)
    }

    private fun currentProjectMs(): Long {
        val idx = player.currentMediaItemIndex
        val clip = project.clips.getOrNull(idx) ?: return 0
        val start = project.clipStarts()[idx]
        val src = player.currentPosition.coerceAtLeast(0)
        val out = if (clip.type == ClipType.IMAGE) src else (src / clip.speed).toLong()
        return (start + out.coerceAtMost(clip.durationMs)).coerceAtMost(project.durationMs)
    }

    private fun tick() {
        pendingSeek?.let { if (System.currentTimeMillis() - lastSeekAt >= 40) doSeek(it) }
        if (_playing.value && player.playbackState != Player.STATE_ENDED) {
            _position.value = currentProjectMs()
        }
        val ms = _position.value
        // Clip volume incl. fades.
        project.locate(ms)?.let { pos ->
            val c = project.clips[pos.clipIndex]
            player.volume = AudioEnvelope.gain(
                c.volume, pos.offsetInClipMs * 1000, c.durationMs * 1000, c.audioFadeInMs * 1000, c.audioFadeOutMs * 1000,
            ).coerceIn(0f, 1f)
            if (_clipIndex.value != pos.clipIndex && !_playing.value) _clipIndex.value = pos.clipIndex
        }
        syncAudio(ms, force = false)
    }

    private fun syncAudio(ms: Long, force: Boolean) {
        val playing = _playing.value && player.isPlaying
        project.audios.forEach { a ->
            val ap = audioPlayers[a.id] ?: return@forEach
            val inside = ms >= a.startMs && ms < a.endMs
            if (!inside) {
                if (ap.playWhenReady) ap.playWhenReady = false
                return@forEach
            }
            val local = ms - a.startMs
            ap.volume = AudioEnvelope.gain(a.volume, local * 1000, a.durationMs * 1000, a.fadeInMs * 1000, a.fadeOutMs * 1000)
                .coerceIn(0f, 1f)
            if (force || abs(ap.currentPosition - local) > 200 || (playing && !ap.playWhenReady)) {
                if (force || abs(ap.currentPosition - local) > 120) ap.seekTo(local)
            }
            if (ap.playWhenReady != playing) ap.playWhenReady = playing
        }
    }

    private fun pauseAudio() = audioPlayers.values.forEach { it.playWhenReady = false }

    fun clearError() {
        _error.value = null
    }

    fun release() {
        released = true
        handler.removeCallbacksAndMessages(null)
        player.release()
        audioPlayers.values.forEach { it.release() }
        audioPlayers.clear()
    }
}
