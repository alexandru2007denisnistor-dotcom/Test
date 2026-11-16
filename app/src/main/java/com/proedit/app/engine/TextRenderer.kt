package com.proedit.app.engine

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import com.proedit.app.model.TextItem
import kotlin.math.ceil
import kotlin.math.max

object TextRenderer {
    val FONTS = listOf(
        "sans" to "Standard",
        "sans-serif-black" to "Kräftig",
        "sans-serif-condensed" to "Schmal",
        "serif" to "Serif",
        "monospace" to "Mono",
        "cursive" to "Schreibschrift",
        "casual" to "Lässig",
        "sans-serif-light" to "Leicht",
    )

    private fun typeface(item: TextItem): Typeface {
        val family = if (item.font == "sans") "sans-serif" else item.font
        val style = when {
            item.bold && item.italic -> Typeface.BOLD_ITALIC
            item.bold -> Typeface.BOLD
            item.italic -> Typeface.ITALIC
            else -> Typeface.NORMAL
        }
        return Typeface.create(family, style)
    }

    /**
     * Renders [item] for an output frame of [frameW] x [frameH] pixels. The bitmap is tightly
     * cropped around the text; place its centre at (x * frameW, y * frameH).
     */
    fun render(item: TextItem, frameW: Int, frameH: Int, visibleChars: Int = -1): Bitmap {
        val fullText = item.text.ifEmpty { " " }
        val text = if (visibleChars in 0 until fullText.length) fullText.substring(0, visibleChars) else fullText
        val textSize = max(4f, item.size * frameH)
        val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            this.textSize = textSize
            typeface = typeface(item)
            color = item.color
        }
        val maxWidth = (frameW * 0.92f).toInt().coerceAtLeast(16)
        // Measure using the full text so typewriter animation does not shift the layout.
        val measured = StaticLayout.Builder.obtain(fullText, 0, fullText.length, paint, maxWidth).build()
        var widest = 0f
        for (i in 0 until measured.lineCount) widest = max(widest, measured.getLineWidth(i))
        val layoutWidth = ceil(widest).toInt().coerceIn(1, maxWidth)
        val alignment = when (item.align) {
            0 -> Layout.Alignment.ALIGN_NORMAL
            2 -> Layout.Alignment.ALIGN_OPPOSITE
            else -> Layout.Alignment.ALIGN_CENTER
        }
        fun layout(p: TextPaint) = StaticLayout.Builder.obtain(text, 0, text.length, p, layoutWidth)
            .setAlignment(alignment).setIncludePad(true).build()

        val fillLayout = layout(paint)
        val fullHeight = StaticLayout.Builder.obtain(fullText, 0, fullText.length, paint, layoutWidth)
            .setAlignment(alignment).setIncludePad(true).build().height

        val pad = (textSize * (if (item.bgColor != 0) 0.35f else 0.18f)).toInt() + 2
        val w = layoutWidth + pad * 2
        val h = fullHeight + pad * 2
        val bmp = Bitmap.createBitmap(w.coerceAtLeast(2), h.coerceAtLeast(2), Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)

        if (item.bgColor != 0) {
            val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = item.bgColor }
            val r = textSize * 0.25f
            canvas.drawRoundRect(RectF(0f, 0f, w.toFloat(), h.toFloat()), r, r, bg)
        }
        canvas.save()
        canvas.translate(pad.toFloat(), pad.toFloat())
        if (item.shadow) {
            val sp = TextPaint(paint).apply {
                color = Color.TRANSPARENT
                setShadowLayer(textSize * 0.12f, textSize * 0.05f, textSize * 0.07f, 0xAA000000.toInt())
            }
            layout(sp).draw(canvas)
        }
        if (item.outline && !item.isSticker) {
            val op = TextPaint(paint).apply {
                style = Paint.Style.STROKE
                strokeWidth = textSize * 0.12f
                strokeJoin = Paint.Join.ROUND
                color = item.outlineColor
            }
            layout(op).draw(canvas)
        }
        fillLayout.draw(canvas)
        canvas.restore()
        return bmp
    }
}
