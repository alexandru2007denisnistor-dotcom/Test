package com.proedit.app.engine

import android.graphics.Bitmap
import android.graphics.Matrix
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.Size
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.MatrixTransformation
import androidx.media3.effect.OverlaySettings
import androidx.media3.effect.RgbMatrix
import com.proedit.app.model.TextItem
import com.proedit.app.model.TransitionSpec
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Converts the absolute presentation timestamps Media3 hands to effects into time since the
 * first frame of a clip. Robust to whatever offset the pipeline adds for sequence items.
 */
class LocalClock {
    @Volatile private var baseUs = Long.MIN_VALUE

    fun localUs(presentationTimeUs: Long): Long {
        if (baseUs == Long.MIN_VALUE || presentationTimeUs < baseUs) baseUs = presentationTimeUs
        return presentationTimeUs - baseUs
    }
}

/** Static clip colour look plus the colour part (dip to black / white) of transitions. */
class ClipColorEffect(
    private val clipMatrix: FloatArray,
    private val clock: LocalClock,
    private val durationMs: Long,
    private val inSpec: TransitionSpec?,
    private val outSpec: TransitionSpec?,
) : RgbMatrix {
    private val staticGl = ColorMath.toGl4x4(clipMatrix)

    override fun getMatrix(presentationTimeUs: Long, useHdr: Boolean): FloatArray {
        if (inSpec == null && outSpec == null) return staticGl
        val local = clock.localUs(presentationTimeUs) / 1000
        val v = TransitionMath.visual(local, durationMs, inSpec, outSpec)
        if (v.dim == 0f && v.whiten == 0f) return staticGl
        return ColorMath.toGl4x4(ColorMath.concat(v.colorMatrix(), clipMatrix))
    }

    override fun isNoOp(inputWidth: Int, inputHeight: Int): Boolean =
        inSpec == null && outSpec == null && ColorMath.isIdentity(clipMatrix)
}

/** Canvas zoom/position (applied after the frame was laid out on the output canvas). */
class CanvasTransform(private val zoom: Float, private val offX: Float, private val offY: Float) : MatrixTransformation {
    override fun getMatrix(presentationTimeUs: Long): Matrix = Matrix().apply {
        postScale(zoom, zoom)
        postTranslate(offX * 2f, -offY * 2f)
    }

    override fun isNoOp(inputWidth: Int, inputHeight: Int) = zoom == 1f && offX == 0f && offY == 0f
}

/** Geometric part of transitions (zoom / spin / slide), aspect-correct. */
class TransitionTransform(
    private val clock: LocalClock,
    private val durationMs: Long,
    private val inSpec: TransitionSpec?,
    private val outSpec: TransitionSpec?,
) : MatrixTransformation {
    private var aspect = 1f

    override fun configure(inputWidth: Int, inputHeight: Int): Size {
        aspect = inputWidth.toFloat() / inputHeight.coerceAtLeast(1)
        return Size(inputWidth, inputHeight)
    }

    override fun getMatrix(presentationTimeUs: Long): Matrix {
        val local = clock.localUs(presentationTimeUs) / 1000
        val v = TransitionMath.visual(local, durationMs, inSpec, outSpec)
        return Matrix().apply {
            if (v.isIdentity) return@apply
            // NDC is anisotropic for non-square frames: rotate in pixel-proportional space.
            postScale(aspect, 1f)
            postRotate(-v.rotation)
            postScale(1f / aspect, 1f)
            postScale(v.scale, v.scale)
            postTranslate(v.tx * 2f, -v.ty * 2f)
        }
    }

    override fun isNoOp(inputWidth: Int, inputHeight: Int) = inSpec == null && outSpec == null
}

/**
 * Burns a [TextItem] into a clip. [clipStartMs] is where the clip starts on the project timeline,
 * so the overlay can work out the project time of each frame.
 */
class TextItemOverlay(
    private val item: TextItem,
    private val clock: LocalClock,
    private val clipStartMs: Long,
) : BitmapOverlay() {
    private var frameW = 1080
    private var frameH = 1920
    private var cachedChars = Int.MIN_VALUE
    private var cached: Bitmap? = null
    private var lastState = TextAnimState(false)

    override fun configure(videoSize: Size) {
        super.configure(videoSize)
        if (videoSize.width != frameW || videoSize.height != frameH) {
            frameW = videoSize.width; frameH = videoSize.height
            cached = null; cachedChars = Int.MIN_VALUE
        }
    }

    private fun stateAt(presentationTimeUs: Long): TextAnimState {
        val projectMs = clipStartMs + clock.localUs(presentationTimeUs) / 1000
        return TextAnimMath.state(item, projectMs).also { lastState = it }
    }

    override fun getBitmap(presentationTimeUs: Long): Bitmap {
        val s = stateAt(presentationTimeUs)
        val chars = s.visibleChars
        val bmp = cached
        if (bmp != null && chars == cachedChars) return bmp
        return TextRenderer.render(item, frameW, frameH, chars).also { cached = it; cachedChars = chars }
    }

    override fun getOverlaySettings(presentationTimeUs: Long): OverlaySettings {
        val s = stateAt(presentationTimeUs)
        val ndcX = item.x * 2f - 1f
        val ndcY = 1f - (item.y + s.dy) * 2f
        return OverlaySettings.Builder()
            .setBackgroundFrameAnchor(ndcX, ndcY)
            .setOverlayFrameAnchor(0f, 0f)
            .setScale(s.scale, s.scale)
            .setRotationDegrees(-item.rotation)
            .setAlphaScale(if (s.visible) s.alpha.coerceIn(0f, 1f) else 0f)
            .build()
    }
}

/** Volume with fade in/out, for 16-bit and float PCM. */
class VolumeEnvelopeProcessor(
    private val volume: Float,
    private val durationUs: Long,
    private val fadeInUs: Long,
    private val fadeOutUs: Long,
) : BaseAudioProcessor() {
    private var framesProcessed = 0L

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT && inputAudioFormat.encoding != C.ENCODING_PCM_FLOAT) {
            throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
        }
        if (volume == 1f && fadeInUs <= 0 && fadeOutUs <= 0) return AudioProcessor.AudioFormat.NOT_SET
        return inputAudioFormat
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val fmt = inputAudioFormat
        val bytesPerSample = if (fmt.encoding == C.ENCODING_PCM_FLOAT) 4 else 2
        val frameSize = bytesPerSample * fmt.channelCount
        val remaining = inputBuffer.remaining()
        val out = replaceOutputBuffer(remaining).order(ByteOrder.nativeOrder())
        val input = inputBuffer.order(ByteOrder.nativeOrder())
        val frames = remaining / frameSize
        for (f in 0 until frames) {
            val localUs = (framesProcessed + f) * 1_000_000L / fmt.sampleRate
            val g = AudioEnvelope.gain(volume, localUs, durationUs, fadeInUs, fadeOutUs)
            for (ch in 0 until fmt.channelCount) {
                if (bytesPerSample == 2) {
                    val v = (input.getShort() * g).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
                    out.putShort(v.toShort())
                } else {
                    out.putFloat(input.getFloat() * g)
                }
            }
        }
        // Copy any trailing partial frame unchanged.
        while (input.hasRemaining()) out.put(input.get())
        framesProcessed += frames
        out.flip()
    }

    override fun onFlush() {
        framesProcessed = 0
    }

    override fun onReset() {
        framesProcessed = 0
    }
}
