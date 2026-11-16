package com.proedit.app.engine

import android.content.ContentValues
import android.content.Context
import android.media.MediaCodecList
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.SpeedProvider
import androidx.media3.effect.FrameDropEffect
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.Presentation
import androidx.media3.effect.ScaleAndRotateTransformation
import androidx.media3.effect.TextureOverlay
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import com.proedit.app.model.AspectRatio
import com.proedit.app.model.AudioItem
import com.proedit.app.model.ClipType
import com.proedit.app.model.FitMode
import com.proedit.app.model.Project
import com.proedit.app.model.ProjectOps
import java.io.File
import java.io.RandomAccessFile

enum class ExportQuality(val label: String, val bitsPerPixel: Float) {
    LOW("Klein", 0.06f), NORMAL("Empfohlen", 0.10f), HIGH("Hoch", 0.16f), MAX("Maximal", 0.24f)
}

data class ExportSettings(
    val shortSide: Int = 1080,
    val fps: Int = 30,
    val quality: ExportQuality = ExportQuality.NORMAL,
    val hevc: Boolean = false,
)

sealed interface ExportState {
    data object Idle : ExportState
    data class Running(val progress: Int) : ExportState
    data class Done(val uri: Uri, val sizeBytes: Long) : ExportState
    data class Failed(val message: String) : ExportState
}

object ExportMath {
    fun outputSize(aspect: AspectRatio, shortSide: Int): Pair<Int, Int> {
        fun even(v: Float) = (Math.round(v / 2f) * 2).coerceAtLeast(2)
        return if (aspect.w <= aspect.h) {
            even(shortSide.toFloat()) to even(shortSide * aspect.h.toFloat() / aspect.w)
        } else {
            even(shortSide * aspect.w.toFloat() / aspect.h) to even(shortSide.toFloat())
        }
    }

    fun bitrate(w: Int, h: Int, fps: Int, q: ExportQuality, hevc: Boolean): Int {
        val raw = w.toLong() * h * fps * q.bitsPerPixel * (if (hevc) 0.65f else 1f)
        return raw.toLong().coerceIn(1_000_000L, 120_000_000L).toInt()
    }

    fun hasEncoder(mime: String): Boolean = runCatching {
        MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.any { info ->
            info.isEncoder && info.supportedTypes.any { it.equals(mime, ignoreCase = true) }
        }
    }.getOrDefault(false)
}

class Exporter(private val context: Context) {
    private var transformer: Transformer? = null
    private val handler = Handler(Looper.getMainLooper())
    private var poll: Runnable? = null
    private var outFile: File? = null

    fun start(project: Project, settings: ExportSettings, onState: (ExportState) -> Unit) {
        val p = ProjectOps.clampOverlays(project)
        if (p.clips.isEmpty()) {
            onState(ExportState.Failed("Das Projekt enthält keine Clips.")); return
        }
        val (w, h) = ExportMath.outputSize(p.aspect, settings.shortSide)
        val composition = try {
            buildComposition(p, w, h, settings)
        } catch (e: Exception) {
            onState(ExportState.Failed("Vorbereitung fehlgeschlagen: ${e.message}")); return
        }
        val dir = File(context.cacheDir, "export").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val file = File(dir, "ProEdit_${System.currentTimeMillis()}.mp4")
        outFile = file

        val videoMime = if (settings.hevc && ExportMath.hasEncoder(MimeTypes.VIDEO_H265)) MimeTypes.VIDEO_H265
        else MimeTypes.VIDEO_H264
        val encoderFactory = DefaultEncoderFactory.Builder(context)
            .setRequestedVideoEncoderSettings(
                VideoEncoderSettings.Builder()
                    .setBitrate(ExportMath.bitrate(w, h, settings.fps, settings.quality, videoMime == MimeTypes.VIDEO_H265))
                    .build(),
            )
            .setEnableFallback(true)
            .build()

        val t = Transformer.Builder(context)
            .setVideoMimeType(videoMime)
            .setAudioMimeType(MimeTypes.AUDIO_AAC)
            .setEncoderFactory(encoderFactory)
            .addListener(object : Transformer.Listener {
                override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                    stopPolling()
                    onState(ExportState.Running(100))
                    Thread {
                        val result = runCatching { publish(file) }
                        handler.post {
                            result.fold(
                                { onState(ExportState.Done(it, file.length())) },
                                { onState(ExportState.Failed("Speichern fehlgeschlagen: ${it.message}")) },
                            )
                        }
                    }.start()
                }

                override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                    stopPolling()
                    file.delete()
                    onState(ExportState.Failed(describe(exportException)))
                }
            })
            .build()
        transformer = t
        onState(ExportState.Running(0))
        try {
            t.start(composition, file.absolutePath)
        } catch (e: Exception) {
            onState(ExportState.Failed(e.message ?: "Export konnte nicht starten")); return
        }
        val holder = ProgressHolder()
        poll = object : Runnable {
            override fun run() {
                val tr = transformer ?: return
                if (tr.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
                    onState(ExportState.Running(holder.progress.coerceIn(0, 99)))
                }
                handler.postDelayed(this, 250)
            }
        }.also { handler.post(it) }
    }

    fun cancel() {
        stopPolling()
        transformer?.cancel()
        transformer = null
        outFile?.delete()
    }

    private fun stopPolling() {
        poll?.let { handler.removeCallbacks(it) }
        poll = null
    }

    private fun describe(e: ExportException): String {
        val base = when (e.errorCode) {
            ExportException.ERROR_CODE_IO_FILE_NOT_FOUND, ExportException.ERROR_CODE_IO_NO_PERMISSION ->
                "Eine Quelldatei ist nicht mehr verfügbar."
            ExportException.ERROR_CODE_ENCODER_INIT_FAILED, ExportException.ERROR_CODE_ENCODING_FORMAT_UNSUPPORTED ->
                "Der Encoder unterstützt diese Einstellungen nicht. Versuche eine kleinere Auflösung oder H.264."
            ExportException.ERROR_CODE_DECODER_INIT_FAILED, ExportException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED ->
                "Ein Clip hat ein Format, das dieses Gerät nicht dekodieren kann."
            else -> "Export fehlgeschlagen"
        }
        return "$base (${e.errorCodeName}: ${e.message ?: e.cause?.message ?: ""})"
    }

    // ---------------------------------------------------------------- composition building

    private fun buildComposition(p: Project, w: Int, h: Int, s: ExportSettings): Composition {
        val starts = p.clipStarts()
        val videoItems = p.clips.mapIndexed { index, clip ->
            val clock = LocalClock()
            val (inSpec, outSpec) = ProjectOps.transitionInfo(p, index)
            val mediaItem = MediaItem.Builder().setUri(Uri.parse(clip.uri)).apply {
                if (clip.type == ClipType.IMAGE) {
                    setImageDurationMs(clip.durationMs)
                } else {
                    setClippingConfiguration(
                        MediaItem.ClippingConfiguration.Builder()
                            .setStartPositionMs(clip.trimStartMs)
                            .setEndPositionMs(clip.trimEndMs)
                            .build(),
                    )
                }
            }.build()

            val video = mutableListOf<Effect>()
            val audio = mutableListOf<AudioProcessor>()
            if (clip.type == ClipType.VIDEO && clip.speed != 1f) {
                val pair = Effects.createExperimentalSpeedChangingEffect(ConstantSpeed(clip.speed))
                audio += pair.first
                video += pair.second
            }
            video += FrameDropEffect.createDefaultFrameDropEffect(s.fps.toFloat())
            if (clip.rotation != 0 || clip.flipH || clip.flipV) {
                video += ScaleAndRotateTransformation.Builder()
                    .setScale(if (clip.flipH) -1f else 1f, if (clip.flipV) -1f else 1f)
                    .setRotationDegrees(-clip.rotation.toFloat())
                    .build()
            }
            video += ClipColorEffect(ColorMath.clipMatrix(clip), clock, clip.durationMs, inSpec, outSpec)
            video += Presentation.createForWidthAndHeight(
                w, h,
                if (p.fitMode == FitMode.FILL) Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP else Presentation.LAYOUT_SCALE_TO_FIT,
            )
            video += CanvasTransform(clip.zoom, clip.offsetX, clip.offsetY)
            video += TransitionTransform(clock, clip.durationMs, inSpec, outSpec)

            val clipStart = starts[index]
            val clipEnd = clipStart + clip.durationMs
            val overlays: List<TextureOverlay> = p.texts
                .filter { it.startMs < clipEnd && it.endMs > clipStart }
                .map { TextItemOverlay(it, clock, clipStart) }
            if (overlays.isNotEmpty()) video += OverlayEffect(overlays)

            audio += VolumeEnvelopeProcessor(
                clip.volume, clip.durationMs * 1000, clip.audioFadeInMs * 1000, clip.audioFadeOutMs * 1000,
            )

            EditedMediaItem.Builder(mediaItem).apply {
                if (clip.type == ClipType.IMAGE) {
                    setDurationUs(clip.durationMs * 1000)
                    setFrameRate(s.fps)
                }
                setEffects(Effects(audio, video))
            }.build()
        }

        val sequences = mutableListOf(EditedMediaItemSequence.Builder(videoItems).build())
        val total = p.durationMs
        p.audios.filter { it.startMs < total }.forEach { a ->
            buildAudioSequence(a, total)?.let { sequences += it }
        }
        return Composition.Builder(sequences)
            .experimentalSetForceAudioTrack(true)
            .setHdrMode(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL)
            .build()
    }

    private fun buildAudioSequence(a: AudioItem, projectMs: Long): EditedMediaItemSequence? {
        val endMs = minOf(a.endMs, projectMs)
        val lenMs = endMs - a.startMs
        if (lenMs < 50) return null
        val items = mutableListOf<EditedMediaItem>()
        if (a.startMs > 0) {
            val silence = SilenceWav.file(context, a.startMs)
            items += EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(silence))).build()
        }
        val media = MediaItem.Builder().setUri(Uri.parse(a.uri))
            .setClippingConfiguration(
                MediaItem.ClippingConfiguration.Builder()
                    .setStartPositionMs(a.trimStartMs)
                    .setEndPositionMs(a.trimStartMs + lenMs)
                    .build(),
            ).build()
        val fadeOut = if (endMs < a.endMs) minOf(a.fadeOutMs, lenMs).coerceAtLeast(0) else a.fadeOutMs
        items += EditedMediaItem.Builder(media)
            .setRemoveVideo(true)
            .setEffects(Effects(listOf(VolumeEnvelopeProcessor(a.volume, lenMs * 1000, a.fadeInMs * 1000, fadeOut * 1000)), emptyList()))
            .build()
        return EditedMediaItemSequence.Builder(items).build()
    }

    /** Copies the finished file into the public Movies/ProEdit folder and returns its content Uri. */
    private fun publish(file: File): Uri {
        val resolver = context.contentResolver
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Video.Media.DISPLAY_NAME, file.name)
                put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/ProEdit")
                put(MediaStore.Video.Media.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
                ?: error("MediaStore insert failed")
            resolver.openOutputStream(uri)!!.use { out -> file.inputStream().use { it.copyTo(out) } }
            values.clear()
            values.put(MediaStore.Video.Media.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            file.delete()
            return uri
        } else {
            @Suppress("DEPRECATION")
            val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "ProEdit")
            dir.mkdirs()
            val dest = File(dir, file.name)
            file.copyTo(dest, overwrite = true)
            file.delete()
            val values = ContentValues().apply {
                put(MediaStore.Video.Media.DISPLAY_NAME, dest.name)
                put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                @Suppress("DEPRECATION")
                put(MediaStore.Video.Media.DATA, dest.absolutePath)
            }
            return resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values) ?: Uri.fromFile(dest)
        }
    }
}

class ConstantSpeed(private val speed: Float) : SpeedProvider {
    override fun getSpeed(timeUs: Long) = speed
    override fun getNextSpeedChangeTimeUs(timeUs: Long) = androidx.media3.common.C.TIME_UNSET
}

/** Generates (and caches) silent WAV files used to offset audio tracks on the timeline. */
object SilenceWav {
    private const val RATE = 44100

    fun file(context: Context, durationMs: Long): File {
        val dir = File(context.cacheDir, "silence").apply { mkdirs() }
        val f = File(dir, "silence_$durationMs.wav")
        if (f.exists()) return f
        val samples = (RATE.toLong() * durationMs / 1000).toInt()
        val dataBytes = samples * 2
        RandomAccessFile(f, "rw").use { raf ->
            raf.setLength(0)
            val header = java.nio.ByteBuffer.allocate(44).order(java.nio.ByteOrder.LITTLE_ENDIAN).apply {
                put("RIFF".toByteArray()); putInt(36 + dataBytes); put("WAVE".toByteArray())
                put("fmt ".toByteArray()); putInt(16); putShort(1); putShort(1)
                putInt(RATE); putInt(RATE * 2); putShort(2); putShort(16)
                put("data".toByteArray()); putInt(dataBytes)
            }
            raf.write(header.array())
            raf.setLength(44L + dataBytes) // zero-filled = silence
        }
        return f
    }
}
