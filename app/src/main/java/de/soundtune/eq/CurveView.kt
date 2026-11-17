package de.soundtune.eq

import android.content.Context
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Shader
import android.view.View
import kotlin.math.log10
import kotlin.math.pow

/** Zeichnet den resultierenden Frequenzgang. */
class CurveView(context: Context) : View(context) {
    var gains: FloatArray = FloatArray(10)
        set(v) { field = v; invalidate() }

    private val d = resources.displayMetrics.density
    private val grid = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x22FFFFFF; strokeWidth = 1f * d }
    private val zero = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x55FFFFFF; strokeWidth = 1f * d }
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFE8B04B.toInt(); strokeWidth = 2.5f * d; style = Paint.Style.STROKE; strokeJoin = Paint.Join.ROUND
    }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x88FFFFFF.toInt(); textSize = 10f * d }

    private val fMin = 20f
    private val fMax = 20000f
    private val range = 12f

    private fun xOf(f: Float, w: Float) = ((log10(f) - log10(fMin)) / (log10(fMax) - log10(fMin))) * w
    private fun yOf(db: Float, h: Float) = h / 2f - db / range * (h / 2f)

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val w = MeasureSpec.getSize(widthMeasureSpec)
        setMeasuredDimension(w, (150 * d).toInt())
    }

    override fun onDraw(c: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat() - 14 * d
        for (f in listOf(50f, 100f, 200f, 500f, 1000f, 2000f, 5000f, 10000f)) {
            val x = xOf(f, w)
            c.drawLine(x, 0f, x, h, grid)
            val t = if (f >= 1000) "${(f / 1000).toInt()}k" else "${f.toInt()}"
            c.drawText(t, x - label.measureText(t) / 2, h + 12 * d, label)
        }
        for (db in listOf(-6f, 6f)) c.drawLine(0f, yOf(db, h), w, yOf(db, h), grid)
        c.drawLine(0f, yOf(0f, h), w, yOf(0f, h), zero)

        val path = Path()
        val steps = 120
        for (i in 0..steps) {
            val f = fMin * (fMax / fMin).pow(i / steps.toFloat())
            val x = xOf(f, w)
            val y = yOf(gainAt(f, gains), h)
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        val area = Path(path).apply { lineTo(w, yOf(0f, h)); lineTo(0f, yOf(0f, h)); close() }
        fill.shader = LinearGradient(0f, 0f, 0f, h, 0x55E8B04B, 0x05E8B04B, Shader.TileMode.CLAMP)
        c.drawPath(area, fill)
        c.drawPath(path, line)
    }
}
