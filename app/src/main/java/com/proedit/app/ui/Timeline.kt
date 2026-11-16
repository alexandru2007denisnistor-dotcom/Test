package com.proedit.app.ui

import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.IntOffset
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import com.proedit.app.data.ThumbnailCache
import com.proedit.app.model.AudioKind
import com.proedit.app.model.ClipType
import com.proedit.app.model.Project
import com.proedit.app.model.ProjectOps
import com.proedit.app.model.TransitionType
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

private data class TLayout(
    val textLanes: Map<com.proedit.app.model.TextItem, Int>,
    val audioLanes: Map<com.proedit.app.model.AudioItem, Int>,
    val textTop: Float,
    val audioTop: Float,
)

private sealed interface Hit {
    data class ClipBody(val id: String) : Hit
    data class ClipHandle(val id: String, val left: Boolean) : Hit
    data class TextBody(val id: String) : Hit
    data class TextHandle(val id: String, val left: Boolean) : Hit
    data class AudioBody(val id: String) : Hit
    data class AudioHandle(val id: String, val left: Boolean) : Hit
    data class Transition(val clipId: String) : Hit
    data object AddMedia : Hit
    data object Empty : Hit
}

/** Lays items out on lanes so overlapping items do not cover each other. */
private fun <T> lanes(items: List<T>, start: (T) -> Long, end: (T) -> Long, maxLanes: Int): Map<T, Int> {
    val laneEnds = mutableListOf<Long>()
    val result = mutableMapOf<T, Int>()
    items.sortedBy(start).forEach { item ->
        var lane = laneEnds.indexOfFirst { it <= start(item) }
        if (lane < 0) {
            if (laneEnds.size < maxLanes) { laneEnds += end(item); lane = laneEnds.lastIndex }
            else lane = laneEnds.indices.minBy { laneEnds[it] }
        }
        laneEnds[lane] = max(laneEnds[lane], end(item))
        result[item] = lane
    }
    return result
}

@Composable
fun Timeline(
    vm: EditorViewModel,
    project: Project,
    positionMs: Long,
    selection: Selection,
    thumbs: ThumbnailCache,
    onAddMedia: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    fun dp(v: Float) = with(density) { v * this.density }
    val rulerH = dp(20f)
    val videoTop = dp(26f)
    val videoH = dp(52f)
    val laneH = dp(24f)
    val laneGap = dp(4f)
    val handleW = dp(14f)

    val textLanes = remember(project.texts) { lanes(project.texts, { it.startMs }, { it.endMs }, 3) }
    val audioLanes = remember(project.audios) { lanes(project.audios, { it.startMs }, { it.endMs }, 3) }
    val textLaneCount = max(1, (textLanes.values.maxOrNull() ?: -1) + 1)
    val audioLaneCount = max(1, (audioLanes.values.maxOrNull() ?: -1) + 1)
    val textTop = videoTop + videoH + dp(8f)
    val audioTop = textTop + textLaneCount * (laneH + laneGap) + dp(4f)
    val totalH = audioTop + audioLaneCount * (laneH + laneGap) + dp(6f)
    val layout by rememberUpdatedState(TLayout(textLanes, audioLanes, textTop, audioTop))

    var pps by remember { mutableFloatStateOf(dp(60f)) } // pixels per second
    var thumbVersion by remember { mutableIntStateOf(0) }
    var size by remember { mutableFloatStateOf(1f) }
    val scope = rememberCoroutineScope()

    val proj by rememberUpdatedState(project)
    val pos by rememberUpdatedState(positionMs)
    val sel by rememberUpdatedState(selection)

    fun xOf(t: Long, width: Float) = width / 2f + (t - pos) / 1000f * pps

    fun hitTest(o: Offset, width: Float): Hit {
        val p = proj
        val starts = p.clipStarts()
        val s = sel
        // Handles of the selected item first (they extend outside the item).
        when (s) {
            is Selection.ClipSel -> p.clips.indexOfFirst { it.id == s.id }.takeIf { it >= 0 }?.let { i ->
                val l = xOf(starts[i], width); val r = xOf(starts[i] + p.clips[i].durationMs, width)
                if (o.y in videoTop..(videoTop + videoH)) {
                    if (o.x in (l - handleW * 1.6f)..(l + handleW * 0.4f)) return Hit.ClipHandle(s.id, true)
                    if (o.x in (r - handleW * 0.4f)..(r + handleW * 1.6f)) return Hit.ClipHandle(s.id, false)
                }
            }
            is Selection.TextSel -> p.texts.find { it.id == s.id }?.let { t ->
                val top = layout.textTop + (layout.textLanes[t] ?: 0) * (laneH + laneGap)
                val l = xOf(t.startMs, width); val r = xOf(t.endMs, width)
                if (o.y in (top - laneGap)..(top + laneH + laneGap)) {
                    if (o.x in (l - handleW * 1.6f)..(l + handleW * 0.3f)) return Hit.TextHandle(t.id, true)
                    if (o.x in (r - handleW * 0.3f)..(r + handleW * 1.6f)) return Hit.TextHandle(t.id, false)
                    if (o.x in l..r) return Hit.TextBody(t.id)
                }
            }
            is Selection.AudioSel -> p.audios.find { it.id == s.id }?.let { a ->
                val top = layout.audioTop + (layout.audioLanes[a] ?: 0) * (laneH + laneGap)
                val l = xOf(a.startMs, width); val r = xOf(a.endMs, width)
                if (o.y in (top - laneGap)..(top + laneH + laneGap)) {
                    if (o.x in (l - handleW * 1.6f)..(l + handleW * 0.3f)) return Hit.AudioHandle(a.id, true)
                    if (o.x in (r - handleW * 0.3f)..(r + handleW * 1.6f)) return Hit.AudioHandle(a.id, false)
                    if (o.x in l..r) return Hit.AudioBody(a.id)
                }
            }
            Selection.None -> {}
        }
        if (o.y in (videoTop - dp(4f))..(videoTop + videoH + dp(4f))) {
            // Transition buttons sit on the cuts.
            for (i in 0 until p.clips.size - 1) {
                val x = xOf(starts[i + 1], width)
                if (abs(o.x - x) < dp(13f) && abs(o.y - (videoTop + videoH / 2)) < dp(13f)) return Hit.Transition(p.clips[i].id)
            }
            val endX = xOf(p.durationMs, width)
            if (o.x in (endX + dp(8f))..(endX + dp(8f) + videoH)) return Hit.AddMedia
            for (i in p.clips.indices) {
                val l = xOf(starts[i], width); val r = xOf(starts[i] + p.clips[i].durationMs, width)
                if (o.x in l..r) return Hit.ClipBody(p.clips[i].id)
            }
        }
        if (o.y in layout.textTop..layout.audioTop) {
            p.texts.lastOrNull { t ->
                val top = layout.textTop + (layout.textLanes[t] ?: 0) * (laneH + laneGap)
                o.y in top..(top + laneH) && o.x in xOf(t.startMs, width)..xOf(t.endMs, width)
            }?.let { return Hit.TextBody(it.id) }
        }
        if (o.y >= layout.audioTop) {
            p.audios.lastOrNull { a ->
                val top = layout.audioTop + (layout.audioLanes[a] ?: 0) * (laneH + laneGap)
                o.y in top..(top + laneH) && o.x in xOf(a.startMs, width)..xOf(a.endMs, width)
            }?.let { return Hit.AudioBody(it.id) }
        }
        return Hit.Empty
    }

    val gestureModifier = Modifier.pointerInput(Unit) {
        val slop = viewConfiguration.touchSlop
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            val width = size
            val target = hitTest(down.position, width)
            val p0 = proj
            val pos0 = pos
            var total = Offset.Zero
            var moved = false
            var zoomed = false
            val wasPlaying = vm.engine.playing.value
            while (true) {
                val ev = awaitPointerEvent(PointerEventPass.Main)
                val pressed = ev.changes.filter { it.pressed }
                if (pressed.isEmpty()) break
                if (pressed.size >= 2) {
                    zoomed = true
                    val z = ev.calculateZoom()
                    if (z != 1f) pps = (pps * z).coerceIn(dp(4f), dp(900f))
                    ev.changes.forEach { it.consume() }
                    continue
                }
                val ch = ev.changes.firstOrNull { it.id == down.id } ?: pressed.first()
                total += ch.positionChange()
                if (!moved && total.getDistance() > slop) {
                    moved = true
                    if (wasPlaying) vm.engine.pause()
                }
                if (moved && !zoomed) {
                    val dMs = (total.x / pps * 1000).toLong()
                    when (target) {
                        is Hit.ClipHandle -> {
                            val c = p0.clips.find { it.id == target.id }
                            if (c != null) {
                                val dSrc = if (c.type == ClipType.IMAGE) dMs else (dMs * c.speed).toLong()
                                vm.commit("trim:${c.id}") { p ->
                                    if (c.type == ClipType.IMAGE) {
                                        val len = if (target.left) c.trimmedSourceMs - dSrc else c.trimmedSourceMs + dSrc
                                        ProjectOps.trimClip(p, c.id, 0, len)
                                    } else if (target.left) ProjectOps.trimClip(p, c.id, c.trimStartMs + dSrc, c.trimEndMs)
                                    else ProjectOps.trimClip(p, c.id, c.trimStartMs, c.trimEndMs + dSrc)
                                }
                            }
                        }
                        is Hit.TextHandle -> p0.texts.find { it.id == target.id }?.let { t ->
                            vm.commit("ttrim:${t.id}") { p ->
                                ProjectOps.updateText(p, t.id) {
                                    if (target.left) {
                                        val ns = (t.startMs + dMs).coerceIn(0, t.endMs - ProjectOps.MIN_CLIP_MS)
                                        it.copy(startMs = ns, durationMs = t.endMs - ns)
                                    } else it.copy(durationMs = (t.durationMs + dMs).coerceAtLeast(ProjectOps.MIN_CLIP_MS))
                                }
                            }
                        }
                        is Hit.TextBody -> if ((sel as? Selection.TextSel)?.id == target.id) {
                            p0.texts.find { it.id == target.id }?.let { t ->
                                vm.commit("tmove:${t.id}") { p ->
                                    ProjectOps.updateText(p, t.id) { it.copy(startMs = (t.startMs + dMs).coerceAtLeast(0)) }
                                }
                            }
                        } else vm.engine.seekTo(pos0 - dMs)
                        is Hit.AudioHandle -> p0.audios.find { it.id == target.id }?.let { a ->
                            vm.commit("atrim:${a.id}") { p ->
                                ProjectOps.updateAudio(p, a.id) {
                                    if (target.left) {
                                        val d = dMs.coerceIn(-a.trimStartMs, a.durationMs - ProjectOps.MIN_CLIP_MS)
                                            .coerceAtLeast(-a.startMs)
                                        it.copy(trimStartMs = a.trimStartMs + d, startMs = a.startMs + d)
                                    } else it.copy(
                                        trimEndMs = (a.trimEndMs + dMs).coerceIn(a.trimStartMs + ProjectOps.MIN_CLIP_MS, a.sourceDurationMs),
                                    )
                                }
                            }
                        }
                        is Hit.AudioBody -> if ((sel as? Selection.AudioSel)?.id == target.id) {
                            p0.audios.find { it.id == target.id }?.let { a ->
                                vm.commit("amove:${a.id}") { p ->
                                    ProjectOps.updateAudio(p, a.id) { it.copy(startMs = (a.startMs + dMs).coerceAtLeast(0)) }
                                }
                            }
                        } else vm.engine.seekTo(pos0 - dMs)
                        else -> vm.engine.seekTo(pos0 - dMs)
                    }
                }
                ch.consume()
            }
            if (!moved && !zoomed) {
                when (target) {
                    is Hit.ClipBody, is Hit.ClipHandle -> {
                        val id = if (target is Hit.ClipBody) target.id else (target as Hit.ClipHandle).id
                        vm.select(if ((sel as? Selection.ClipSel)?.id == id) Selection.None else Selection.ClipSel(id))
                    }
                    is Hit.TextBody -> vm.select(Selection.TextSel(target.id))
                    is Hit.TextHandle -> vm.select(Selection.TextSel(target.id))
                    is Hit.AudioBody -> vm.select(Selection.AudioSel(target.id))
                    is Hit.AudioHandle -> vm.select(Selection.AudioSel(target.id))
                    is Hit.Transition -> {
                        vm.select(Selection.ClipSel(target.clipId))
                        vm.openPanel(Panel.TRANSITION)
                    }
                    Hit.AddMedia -> onAddMedia()
                    Hit.Empty -> vm.select(Selection.None)
                }
            }
            vm.endGesture()
        }
    }

    val labelPaint = remember {
        Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.White.toArgb(); typeface = Typeface.DEFAULT_BOLD }
    }
    val dimPaint = remember { Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Pal.TextDim.toArgb() } }

    Canvas(
        modifier
            .fillMaxWidth()
            .height(with(density) { totalH.toDp() })
            .onSizeChanged { size = it.width.toFloat() }
            .then(gestureModifier),
    ) {
        @Suppress("UNUSED_EXPRESSION") thumbVersion // redraw when thumbnails arrive
        val w = this.size.width
        val p = project
        val starts = p.clipStarts()
        labelPaint.textSize = dp(11f)
        dimPaint.textSize = dp(10f)

        drawRuler(w, rulerH, pps, positionMs, dimPaint)

        // ---- video track
        p.clips.forEachIndexed { i, c ->
            val l = xOf(starts[i], w); val r = xOf(starts[i] + c.durationMs, w)
            if (r < 0 || l > w) return@forEachIndexed
            val rect = Rect(l + 1, videoTop, r - 1, videoTop + videoH)
            drawRoundRect(Pal.Surface3, rect.topLeft, rect.size, CornerRadius(dp(6f)))
            clipRect(max(rect.left, 0f), rect.top, min(rect.right, w), rect.bottom) {
                val tileW = videoH * 0.75f
                val firstTile = floor((max(0f, -rect.left)) / tileW).toInt()
                val lastTile = ceil((min(w, rect.right) - rect.left) / tileW).toInt()
                for (k in firstTile..lastTile) {
                    val tx = rect.left + k * tileW
                    if (tx > rect.right) break
                    val outMs = ((k * tileW + tileW / 2) / pps * 1000).toLong()
                    val src = if (c.type == ClipType.IMAGE) 0 else c.trimStartMs + (outMs * c.speed).toLong()
                    val bucket = ThumbnailCache.bucket(src.coerceAtMost(c.sourceDurationMs - 1))
                    val key = ThumbnailCache.key(c.uri, c.type, bucket)
                    val bmp = thumbs.peek(key)
                    if (bmp == null) {
                        if (thumbs.markRequested(key)) scope.launch {
                            if (thumbs.thumbnail(c.uri, c.type, bucket, videoH.toInt()) != null) thumbVersion++
                        }
                    } else {
                        val img = bmp.asImageBitmap()
                        val srcAspect = bmp.width.toFloat() / bmp.height
                        val dstAspect = tileW / videoH
                        val (sw, sh) = if (srcAspect > dstAspect) (bmp.height * dstAspect) to bmp.height.toFloat()
                        else bmp.width.toFloat() to (bmp.width / dstAspect)
                        drawImage(
                            img,
                            srcOffset = IntOffset(((bmp.width - sw) / 2).toInt(), ((bmp.height - sh) / 2).toInt()),
                            srcSize = IntSize(sw.toInt().coerceAtLeast(1), sh.toInt().coerceAtLeast(1)),
                            dstOffset = IntOffset(tx.toInt(), rect.top.toInt()),
                            dstSize = IntSize(ceil(tileW).toInt() + 1, videoH.toInt()),
                        )
                    }
                }
                // Badges
                var bx = max(rect.left, 0f) + dp(4f)
                val by = rect.bottom - dp(5f)
                val badges = buildList {
                    if (c.speed != 1f && c.type == ClipType.VIDEO) add("${"%.2f".format(c.speed).trimEnd('0').trimEnd('.')}x")
                    if (c.volume == 0f && c.type == ClipType.VIDEO) add("🔇")
                    if (c.filter != "none") add("FX")
                }
                badges.forEach { b ->
                    val tw = labelPaint.measureText(b)
                    drawRoundRect(Color(0xAA000000), Offset(bx, by - dp(14f)), Size(tw + dp(8f), dp(16f)), CornerRadius(dp(4f)))
                    drawContext.canvas.nativeCanvas.drawText(b, bx + dp(4f), by - dp(2f), labelPaint)
                    bx += tw + dp(12f)
                }
                val dur = formatTime(c.durationMs, true)
                val tw = dimPaint.measureText(dur)
                if (rect.width > tw + dp(10f)) {
                    drawRoundRect(Color(0x99000000), Offset(rect.right - tw - dp(10f), rect.top + dp(3f)), Size(tw + dp(6f), dp(14f)), CornerRadius(dp(4f)))
                    drawContext.canvas.nativeCanvas.drawText(dur, rect.right - tw - dp(7f), rect.top + dp(14f), labelPaint.apply { textSize = dp(10f) })
                    labelPaint.textSize = dp(11f)
                }
            }
        }

        // Transition buttons on the cuts
        for (i in 0 until p.clips.size - 1) {
            val x = xOf(starts[i + 1], w)
            if (x < -20 || x > w + 20) continue
            val active = p.clips[i].transitionOut != TransitionType.NONE
            val s = dp(20f)
            drawRoundRect(
                if (active) Pal.Accent else Color.White, Offset(x - s / 2, videoTop + videoH / 2 - s / 2), Size(s, s), CornerRadius(dp(4f)),
            )
            drawContext.canvas.nativeCanvas.drawText(
                if (active) "⇄" else "|", x - labelPaint.measureText(if (active) "⇄" else "|") / 2, videoTop + videoH / 2 + dp(4f),
                labelPaint.apply { color = Color.Black.toArgb() },
            )
            labelPaint.color = Color.White.toArgb()
        }

        // Add button
        val endX = xOf(p.durationMs, w)
        if (endX < w) {
            drawRoundRect(Color.White, Offset(endX + dp(8f), videoTop + videoH * 0.15f), Size(videoH * 0.7f, videoH * 0.7f), CornerRadius(dp(8f)))
            val cx = endX + dp(8f) + videoH * 0.35f; val cy = videoTop + videoH / 2
            drawLine(Color.Black, Offset(cx - dp(8f), cy), Offset(cx + dp(8f), cy), dp(2.5f))
            drawLine(Color.Black, Offset(cx, cy - dp(8f)), Offset(cx, cy + dp(8f)), dp(2.5f))
        }

        // Selected clip frame + handles
        (selection as? Selection.ClipSel)?.let { s ->
            val i = p.clips.indexOfFirst { it.id == s.id }
            if (i >= 0) {
                val l = xOf(starts[i], w); val r = xOf(starts[i] + p.clips[i].durationMs, w)
                drawSelection(l, r, videoTop, videoH, handleW)
            }
        }

        // ---- text lanes
        if (p.texts.isEmpty()) {
            drawContext.canvas.nativeCanvas.drawText("+ Text", dp(10f), textTop + laneH * 0.7f, dimPaint)
        }
        p.texts.forEach { t ->
            val top = textTop + (textLanes[t] ?: 0) * (laneH + laneGap)
            val l = xOf(t.startMs, w); val r = xOf(t.endMs, w)
            if (r < 0 || l > w) return@forEach
            val color = if (t.isSticker) Pal.StickerTrack else Pal.TextTrack
            drawRoundRect(color, Offset(l, top), Size(r - l, laneH), CornerRadius(dp(5f)))
            clipRect(max(l, 0f), top, min(r, w), top + laneH) {
                drawContext.canvas.nativeCanvas.drawText(
                    (if (t.isSticker) "" else "T  ") + t.text.replace('\n', ' '),
                    max(l, 0f) + dp(6f), top + laneH * 0.68f, labelPaint,
                )
            }
            if ((selection as? Selection.TextSel)?.id == t.id) drawSelection(l, r, top, laneH, handleW * 0.8f)
        }

        // ---- audio lanes
        if (p.audios.isEmpty()) {
            drawContext.canvas.nativeCanvas.drawText("+ Audio", dp(10f), audioTop + laneH * 0.7f, dimPaint)
        }
        p.audios.forEach { a ->
            val top = audioTop + (audioLanes[a] ?: 0) * (laneH + laneGap)
            val l = xOf(a.startMs, w); val r = xOf(a.endMs, w)
            if (r < 0 || l > w) return@forEach
            val color = when (a.kind) {
                AudioKind.VOICE -> Pal.VoiceTrack
                AudioKind.EXTRACTED -> Pal.ExtractTrack
                else -> Pal.MusicTrack
            }
            drawRoundRect(color, Offset(l, top), Size(r - l, laneH), CornerRadius(dp(5f)))
            // Fade ramps
            if (a.fadeInMs > 0) {
                val fx = l + a.fadeInMs / 1000f * pps
                drawLine(Color(0x88FFFFFF), Offset(l, top + laneH), Offset(min(fx, r), top), dp(1.5f))
            }
            if (a.fadeOutMs > 0) {
                val fx = r - a.fadeOutMs / 1000f * pps
                drawLine(Color(0x88FFFFFF), Offset(max(fx, l), top), Offset(r, top + laneH), dp(1.5f))
            }
            clipRect(max(l, 0f), top, min(r, w), top + laneH) {
                val icon = when (a.kind) { AudioKind.VOICE -> "🎙 "; AudioKind.EXTRACTED -> "🔊 "; else -> "♪ " }
                drawContext.canvas.nativeCanvas.drawText(icon + a.name, max(l, 0f) + dp(6f), top + laneH * 0.68f, labelPaint)
            }
            if ((selection as? Selection.AudioSel)?.id == a.id) drawSelection(l, r, top, laneH, handleW * 0.8f)
        }

        // ---- playhead
        drawLine(Color.White, Offset(w / 2, 0f), Offset(w / 2, this.size.height), dp(2f))
        drawCircle(Color.White, dp(4f), Offset(w / 2, dp(3f)))
    }
}

private fun DrawScope.drawSelection(l: Float, r: Float, top: Float, h: Float, handleW: Float) {
    val d = density
    drawRoundRect(Color.White, Offset(l, top), Size(r - l, h), CornerRadius(4 * d), style = Stroke(2 * d))
    drawRoundRect(Color.White, Offset(l - handleW, top), Size(handleW, h), CornerRadius(4 * d))
    drawRoundRect(Color.White, Offset(r, top), Size(handleW, h), CornerRadius(4 * d))
    drawLine(Color.DarkGray, Offset(l - handleW / 2, top + h * 0.3f), Offset(l - handleW / 2, top + h * 0.7f), 2 * d)
    drawLine(Color.DarkGray, Offset(r + handleW / 2, top + h * 0.3f), Offset(r + handleW / 2, top + h * 0.7f), 2 * d)
}

private fun DrawScope.drawRuler(w: Float, h: Float, pps: Float, positionMs: Long, paint: Paint) {
    val minLabelPx = 70 * density
    val steps = floatArrayOf(0.1f, 0.25f, 0.5f, 1f, 2f, 5f, 10f, 15f, 30f, 60f, 120f, 300f)
    val step = steps.firstOrNull { it * pps >= minLabelPx } ?: 600f
    val minor = step / 5
    val startSec = (positionMs / 1000f) - (w / 2) / pps
    val endSec = (positionMs / 1000f) + (w / 2) / pps
    var t = floor(max(0f, startSec) / minor) * minor
    while (t <= endSec) {
        val x = w / 2 + (t - positionMs / 1000f) * pps
        val major = abs((t / step) - Math.round(t / step)) < 0.001f
        drawLine(Pal.TextDim, Offset(x, h - (if (major) 8 else 4) * density), Offset(x, h), 1 * density)
        if (major) {
            val label = if (step < 1f) "%.1fs".format(t) else formatTime((t * 1000).toLong())
            drawContext.canvas.nativeCanvas.drawText(label, x + 3 * density, h - 9 * density, paint)
        }
        t += minor
    }
}
