package com.proedit.app.engine

import com.proedit.app.model.Clip
import com.proedit.app.model.TextAnimation
import com.proedit.app.model.TextItem
import com.proedit.app.model.TransitionSpec
import com.proedit.app.model.TransitionType
import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.sin

/**
 * Colour math shared by preview and export.
 *
 * Matrices use the android.graphics.ColorMatrix layout (4 rows x 5 columns, row-major) but with
 * the offset column expressed in the 0..1 range instead of 0..255.
 */
object ColorMath {
    val IDENTITY: FloatArray
        get() = floatArrayOf(
            1f, 0f, 0f, 0f, 0f,
            0f, 1f, 0f, 0f, 0f,
            0f, 0f, 1f, 0f, 0f,
            0f, 0f, 0f, 1f, 0f,
        )

    /** Returns a * b (apply b first, then a). */
    fun concat(a: FloatArray, b: FloatArray): FloatArray {
        val r = FloatArray(20)
        for (row in 0 until 4) {
            for (col in 0 until 5) {
                var v = 0f
                for (k in 0 until 4) v += a[row * 5 + k] * b[k * 5 + col]
                if (col == 4) v += a[row * 5 + 4]
                r[row * 5 + col] = v
            }
        }
        return r
    }

    fun lerp(a: FloatArray, b: FloatArray, t: Float) = FloatArray(20) { a[it] + (b[it] - a[it]) * t }

    fun scale(r: Float, g: Float, b: Float, off: Float = 0f) = floatArrayOf(
        r, 0f, 0f, 0f, off,
        0f, g, 0f, 0f, off,
        0f, 0f, b, 0f, off,
        0f, 0f, 0f, 1f, 0f,
    )

    fun saturation(s: Float): FloatArray {
        val lr = 0.2126f * (1 - s); val lg = 0.7152f * (1 - s); val lb = 0.0722f * (1 - s)
        return floatArrayOf(
            lr + s, lg, lb, 0f, 0f,
            lr, lg + s, lb, 0f, 0f,
            lr, lg, lb + s, 0f, 0f,
            0f, 0f, 0f, 1f, 0f,
        )
    }

    fun contrast(c: Float): FloatArray {
        val k = if (c >= 0) 1f + c else 1f + c * 0.7f
        return scale(k, k, k, (1 - k) * 0.5f)
    }

    fun hueRotate(degrees: Float): FloatArray {
        val rad = degrees / 180f * PI.toFloat()
        val c = cos(rad); val s = sin(rad)
        val lr = 0.213f; val lg = 0.715f; val lb = 0.072f
        return floatArrayOf(
            lr + c * (1 - lr) + s * (-lr), lg + c * (-lg) + s * (-lg), lb + c * (-lb) + s * (1 - lb), 0f, 0f,
            lr + c * (-lr) + s * 0.143f, lg + c * (1 - lg) + s * 0.140f, lb + c * (-lb) + s * (-0.283f), 0f, 0f,
            lr + c * (-lr) + s * (-(1 - lr)), lg + c * (-lg) + s * lg, lb + c * (1 - lb) + s * lb, 0f, 0f,
            0f, 0f, 0f, 1f, 0f,
        )
    }

    private fun m(vararg v: Float) = floatArrayOf(*v)

    val SEPIA = m(
        0.393f, 0.769f, 0.189f, 0f, 0f,
        0.349f, 0.686f, 0.168f, 0f, 0f,
        0.272f, 0.534f, 0.131f, 0f, 0f,
        0f, 0f, 0f, 1f, 0f,
    )

    /** Filter presets: id -> (display name, matrix). */
    val FILTERS: List<Pair<String, String>> = listOf(
        "none" to "Original",
        "vivid" to "Lebendig",
        "cinema" to "Kino",
        "teal" to "Teal & Orange",
        "warm" to "Warm",
        "cool" to "Kühl",
        "golden" to "Golden Hour",
        "vintage" to "Vintage",
        "film" to "Film",
        "fade" to "Matt",
        "pastel" to "Pastell",
        "forest" to "Wald",
        "cyber" to "Cyber",
        "dramatic" to "Dramatisch",
        "bw" to "S/W",
        "noir" to "Noir",
        "sepia" to "Sepia",
    )

    fun filterMatrix(id: String): FloatArray = when (id) {
        "vivid" -> concat(contrast(0.15f), saturation(1.45f))
        "cinema" -> concat(concat(contrast(0.2f), saturation(0.85f)), scale(0.98f, 1.0f, 1.06f, -0.02f))
        "teal" -> concat(
            concat(contrast(0.18f), saturation(1.1f)),
            m(
                1.08f, 0.02f, -0.06f, 0f, 0.02f,
                -0.04f, 1.02f, 0.04f, 0f, 0f,
                -0.10f, 0.10f, 1.10f, 0f, 0.03f,
                0f, 0f, 0f, 1f, 0f,
            ),
        )
        "warm" -> scale(1.10f, 1.02f, 0.88f, 0.01f)
        "cool" -> scale(0.90f, 1.0f, 1.12f, 0.0f)
        "golden" -> concat(scale(1.15f, 1.04f, 0.80f, 0.03f), saturation(1.15f))
        "vintage" -> concat(lerp(IDENTITY, SEPIA, 0.45f), concat(contrast(-0.15f), scale(1f, 1f, 1f, 0.04f)))
        "film" -> concat(contrast(0.1f), concat(saturation(0.8f), scale(1.03f, 1.0f, 0.95f, 0.02f)))
        "fade" -> concat(contrast(-0.3f), concat(saturation(0.75f), scale(1f, 1f, 1f, 0.06f)))
        "pastel" -> concat(saturation(0.6f), scale(0.92f, 0.92f, 0.95f, 0.1f))
        "forest" -> concat(saturation(1.1f), scale(0.92f, 1.08f, 0.95f, 0f))
        "cyber" -> concat(contrast(0.15f), scale(1.08f, 0.9f, 1.18f, 0f))
        "dramatic" -> concat(contrast(0.45f), saturation(0.7f))
        "bw" -> saturation(0f)
        "noir" -> concat(contrast(0.55f), saturation(0f))
        "sepia" -> SEPIA
        else -> IDENTITY
    }

    /** The complete colour look of a clip. */
    fun clipMatrix(c: Clip): FloatArray {
        var mtx = lerp(IDENTITY, filterMatrix(c.filter), c.filterIntensity.coerceIn(0f, 1f))
        if (c.temperature != 0f || c.tint != 0f) {
            val t = c.temperature * 0.15f
            val ti = c.tint * 0.12f
            mtx = concat(scale(1f + t + ti * 0.5f, 1f - ti, 1f - t + ti * 0.5f), mtx)
        }
        if (c.hue != 0f) mtx = concat(hueRotate(c.hue * 180f), mtx)
        if (c.saturation != 0f) mtx = concat(saturation(1f + c.saturation), mtx)
        if (c.contrast != 0f) mtx = concat(contrast(c.contrast), mtx)
        if (c.brightness != 0f) mtx = concat(scale(1f, 1f, 1f, c.brightness * 0.3f), mtx)
        return mtx
    }

    fun isIdentity(mtx: FloatArray): Boolean {
        val id = IDENTITY
        return mtx.indices.all { kotlin.math.abs(mtx[it] - id[it]) < 1e-4f }
    }

    /** Converts to Media3's column-major 4x4 RGB matrix (applied to vec4(rgb, 1)). */
    fun toGl4x4(mtx: FloatArray): FloatArray {
        val out = FloatArray(16)
        for (row in 0 until 3) {
            for (col in 0 until 3) out[col * 4 + row] = mtx[row * 5 + col]
            out[3 * 4 + row] = mtx[row * 5 + 4]
        }
        out[15] = 1f
        return out
    }

    /** Converts to android.graphics.ColorMatrix values (offsets in 0..255). */
    fun toAndroid(mtx: FloatArray): FloatArray = FloatArray(20) { i -> if (i % 5 == 4) mtx[i] * 255f else mtx[i] }
}

/** Geometric + colour state produced by a transition at one instant. */
data class TransitionVisual(
    val scale: Float = 1f,
    val rotation: Float = 0f,
    /** Translation in fractions of the frame (1 = one full frame width/height). */
    val tx: Float = 0f,
    val ty: Float = 0f,
    /** 0 = untouched, 1 = fully black. */
    val dim: Float = 0f,
    /** 0 = untouched, 1 = fully white. */
    val whiten: Float = 0f,
) {
    val isIdentity get() = scale == 1f && rotation == 0f && tx == 0f && ty == 0f && dim == 0f && whiten == 0f

    /** Colour matrix for dim/whiten. */
    fun colorMatrix(): FloatArray {
        val keep = (1f - dim) * (1f - whiten)
        return ColorMath.scale(keep, keep, keep, whiten)
    }
}

object TransitionMath {
    private fun smooth(t: Float): Float {
        val x = t.coerceIn(0f, 1f)
        return x * x * (3 - 2 * x)
    }

    /**
     * @param localMs time since the start of the clip on the output timeline.
     * @param durationMs output duration of the clip.
     */
    fun visual(localMs: Long, durationMs: Long, inSpec: TransitionSpec?, outSpec: TransitionSpec?): TransitionVisual {
        if (inSpec != null && inSpec.halfMs > 0 && localMs < inSpec.halfMs) {
            val p = smooth(1f - localMs.toFloat() / inSpec.halfMs)
            return forType(inSpec.type, p, entering = true)
        }
        if (outSpec != null && outSpec.halfMs > 0 && localMs > durationMs - outSpec.halfMs) {
            val p = smooth(1f - (durationMs - localMs).toFloat() / outSpec.halfMs)
            return forType(outSpec.type, p, entering = false)
        }
        return TransitionVisual()
    }

    /** [p] = 1 at the cut, 0 away from it. */
    fun forType(type: TransitionType, p: Float, entering: Boolean): TransitionVisual = when (type) {
        TransitionType.NONE -> TransitionVisual()
        TransitionType.FADE -> TransitionVisual(dim = p)
        TransitionType.FLASH -> TransitionVisual(whiten = p)
        TransitionType.ZOOM -> TransitionVisual(scale = 1f + 0.8f * p, whiten = 0.35f * p * p)
        TransitionType.SPIN -> TransitionVisual(
            scale = 1f - 0.6f * p,
            rotation = (if (entering) -1 else 1) * 180f * p,
            dim = p * p,
        )
        TransitionType.SLIDE_LEFT -> TransitionVisual(tx = if (entering) p else -p)
        TransitionType.SLIDE_UP -> TransitionVisual(ty = if (entering) p else -p)
    }
}

/** Animated state of a text overlay at one instant. */
data class TextAnimState(
    val visible: Boolean,
    val alpha: Float = 1f,
    val scale: Float = 1f,
    /** Vertical offset as a fraction of the frame height (positive = down). */
    val dy: Float = 0f,
    /** Number of characters to show, or -1 for all. */
    val visibleChars: Int = -1,
)

object TextAnimMath {
    private fun easeOutBack(t: Float): Float {
        val c1 = 1.70158f; val c3 = c1 + 1
        val x = t - 1
        return 1 + c3 * x * x * x + c1 * x * x
    }

    fun state(item: TextItem, timeMs: Long): TextAnimState {
        if (timeMs < item.startMs || timeMs >= item.endMs) return TextAnimState(false, alpha = 0f)
        val local = timeMs - item.startMs
        val animLen = minOf(450L, item.durationMs / 3).coerceAtLeast(1)
        var s = TextAnimState(true)
        if (local < animLen && item.animIn != TextAnimation.NONE) {
            s = apply(s, item, item.animIn, local.toFloat() / animLen, entering = true)
        }
        val remain = item.durationMs - local
        if (remain < animLen && item.animOut != TextAnimation.NONE) {
            s = apply(s, item, item.animOut, remain.toFloat() / animLen, entering = false)
        }
        return s
    }

    /** [p] goes 0 -> 1 as the item becomes fully shown. */
    private fun apply(s: TextAnimState, item: TextItem, a: TextAnimation, p: Float, entering: Boolean) = when (a) {
        TextAnimation.NONE -> s
        TextAnimation.FADE -> s.copy(alpha = s.alpha * p)
        TextAnimation.POP -> s.copy(alpha = s.alpha * minOf(1f, p * 2), scale = s.scale * (0.3f + 0.7f * easeOutBack(p)))
        TextAnimation.SLIDE_UP -> s.copy(alpha = s.alpha * p, dy = s.dy + (if (entering) 0.08f else -0.08f) * (1 - p))
        TextAnimation.TYPEWRITER ->
            if (entering) s.copy(visibleChars = ceil(item.text.length * p).toInt().coerceAtLeast(1))
            else s.copy(alpha = s.alpha * p)
    }
}

/** Gain envelope for audio fades: linear fade-in/out on top of a base volume. */
object AudioEnvelope {
    fun gain(volume: Float, localUs: Long, durationUs: Long, fadeInUs: Long, fadeOutUs: Long): Float {
        var g = volume
        if (fadeInUs > 0 && localUs < fadeInUs) g *= (localUs.toFloat() / fadeInUs).coerceIn(0f, 1f)
        if (fadeOutUs > 0 && localUs > durationUs - fadeOutUs) {
            g *= ((durationUs - localUs).toFloat() / fadeOutUs).coerceIn(0f, 1f)
        }
        return g
    }
}
