package com.proedit.app.ui

import android.graphics.Bitmap
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.net.Uri
import android.view.LayoutInflater
import android.view.TextureView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.ui.PlayerView
import com.proedit.app.R
import com.proedit.app.data.MediaImport
import com.proedit.app.engine.ColorMath
import com.proedit.app.engine.TextAnimMath
import com.proedit.app.engine.TextRenderer
import com.proedit.app.engine.TransitionMath
import com.proedit.app.model.ClipType
import com.proedit.app.model.FitMode
import com.proedit.app.model.Project
import com.proedit.app.model.ProjectOps
import com.proedit.app.model.TextItem
import com.proedit.app.model.locate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

@Composable
fun PreviewArea(
    vm: EditorViewModel,
    project: Project,
    positionMs: Long,
    selection: Selection,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier.background(Pal.Bg), contentAlignment = Alignment.Center) {
        val density = LocalDensity.current
        val availW = constraints.maxWidth.toFloat()
        val availH = constraints.maxHeight.toFloat()
        val ratio = project.aspect.ratio
        val (cw, ch) = if (availW / availH > ratio) (availH * ratio) to availH else availW to (availW / ratio)
        val cwDp = with(density) { cw.toDp() }
        val chDp = with(density) { ch.toDp() }

        val pos = project.locate(positionMs)
        val clip = pos?.let { project.clips[it.clipIndex] }
        val transition = if (pos != null && clip != null) {
            val (inS, outS) = ProjectOps.transitionInfo(project, pos.clipIndex)
            TransitionMath.visual(pos.offsetInClipMs, clip.durationMs, inS, outS)
        } else null

        Box(
            Modifier
                .requiredSize(cwDp, chDp)
                .clipToBounds()
                .background(Color.Black),
        ) {
            // Transition transform (whole canvas, around its centre)
            Box(
                Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        val t = transition
                        if (t != null) {
                            scaleX = t.scale; scaleY = t.scale
                            rotationZ = t.rotation
                            translationX = t.tx * cw
                            translationY = t.ty * ch
                        }
                    },
            ) {
                // Canvas zoom / position
                Box(
                    Modifier
                        .fillMaxSize()
                        .graphicsLayer {
                            if (clip != null) {
                                scaleX = clip.zoom; scaleY = clip.zoom
                                translationX = clip.offsetX * cw
                                translationY = clip.offsetY * ch
                            }
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    // Content box: rotated media fitted (or cropped) into the canvas
                    val srcW = (clip?.width ?: 0).takeIf { it > 0 } ?: 16
                    val srcH = (clip?.height ?: 0).takeIf { it > 0 } ?: 9
                    val rotated = clip != null && (clip.rotation == 90 || clip.rotation == 270)
                    val mediaRatio = if (rotated) srcH.toFloat() / srcW else srcW.toFloat() / srcH
                    val fill = project.fitMode == FitMode.FILL
                    val boxW: Float
                    val boxH: Float
                    if ((mediaRatio > cw / ch) xor fill) {
                        boxW = cw; boxH = cw / mediaRatio
                    } else {
                        boxH = ch; boxW = ch * mediaRatio
                    }
                    val viewW = if (rotated) boxH else boxW
                    val viewH = if (rotated) boxW else boxH
                    val clipMatrix = clip?.let { ColorMath.clipMatrix(it) }
                    val fullMatrix = if (clipMatrix != null && transition != null && (transition.dim > 0f || transition.whiten > 0f)) {
                        ColorMath.concat(transition.colorMatrix(), clipMatrix)
                    } else clipMatrix
                    val mediaModifier = Modifier
                        .requiredSize(with(density) { viewW.toDp() }, with(density) { viewH.toDp() })
                        .graphicsLayer {
                            if (clip != null) {
                                rotationZ = clip.rotation.toFloat()
                                scaleX = if (clip.flipH) -1f else 1f
                                scaleY = if (clip.flipV) -1f else 1f
                            }
                        }

                    val isImage = clip?.type == ClipType.IMAGE
                    AndroidView(
                        factory = { ctx ->
                            (LayoutInflater.from(ctx).inflate(R.layout.player_view, null) as PlayerView).also {
                                it.player = vm.engine.player
                            }
                        },
                        update = { pv ->
                            pv.alpha = if (isImage) 0f else 1f
                            val tv = pv.videoSurfaceView as? TextureView
                            val m = fullMatrix
                            if (tv != null) {
                                if (m == null || ColorMath.isIdentity(m)) tv.setLayerPaint(null)
                                else tv.setLayerPaint(Paint().apply {
                                    colorFilter = ColorMatrixColorFilter(android.graphics.ColorMatrix(ColorMath.toAndroid(m)))
                                })
                            }
                        },
                        onRelease = { it.player = null },
                        modifier = mediaModifier,
                    )
                    if (isImage) {
                        val bmp = rememberImage(clip!!.uri)
                        if (bmp != null) {
                            Image(
                                bmp.asImageBitmap(), null,
                                contentScale = ContentScale.FillBounds,
                                colorFilter = fullMatrix?.takeUnless { ColorMath.isIdentity(it) }
                                    ?.let { ColorFilter.colorMatrix(ColorMatrix(ColorMath.toAndroid(it))) },
                                modifier = mediaModifier,
                            )
                        }
                    }
                }
            }

            // Text & stickers
            TextLayer(vm, project, positionMs, selection, cw, ch)
        }
    }
}

@Composable
private fun rememberImage(uri: String): Bitmap? {
    val context = LocalContext.current
    val v by produceState<Bitmap?>(null, uri) {
        value = withContext(Dispatchers.IO) { MediaImport.loadImage(context, Uri.parse(uri), 1600) }
    }
    return v
}

@Composable
private fun TextLayer(vm: EditorViewModel, project: Project, positionMs: Long, selection: Selection, cw: Float, ch: Float) {
    val density = LocalDensity.current
    val cache = remember { HashMap<String, Bitmap>() }
    val selectedId = (selection as? Selection.TextSel)?.id
    val currentProject by rememberUpdatedState(project)
    val currentPos by rememberUpdatedState(positionMs)

    fun bitmapFor(t: TextItem, chars: Int): Bitmap {
        val key = "${t.hashCode()}|${cw.toInt()}x${ch.toInt()}|$chars"
        return cache[key] ?: TextRenderer.render(t, cw.toInt(), ch.toInt(), chars).also {
            if (cache.size > 60) cache.clear()
            cache[key] = it
        }
    }

    // Gesture surface: tap selects / toggles playback, transform edits the selected text.
    Box(
        Modifier
            .fillMaxSize()
            .pointerInput(selectedId, cw, ch) {
                detectTapGestures { tap ->
                    val p = currentProject
                    val hit = p.texts.lastOrNull { t ->
                        val s = TextAnimMath.state(t, currentPos)
                        if (!s.visible) return@lastOrNull false
                        val b = bitmapFor(t, -1)
                        val cx = t.x * cw; val cy = t.y * ch
                        tap.x in (cx - b.width / 2f)..(cx + b.width / 2f) && tap.y in (cy - b.height / 2f)..(cy + b.height / 2f)
                    }
                    when {
                        hit != null && hit.id != selectedId -> vm.select(Selection.TextSel(hit.id))
                        hit != null -> vm.openPanel(Panel.TEXT_EDIT)
                        else -> vm.engine.toggle()
                    }
                }
            }
            .pointerInput(selectedId, cw, ch) {
                if (selectedId == null) return@pointerInput
                detectTransformGestures { _, pan, zoom, rotation ->
                    vm.engine.pause()
                    vm.commit("textGesture:$selectedId") { p ->
                        ProjectOps.updateText(p, selectedId) { t ->
                            t.copy(
                                x = (t.x + pan.x / cw).coerceIn(0f, 1f),
                                y = (t.y + pan.y / ch).coerceIn(0f, 1f),
                                size = (t.size * zoom).coerceIn(0.015f, 0.4f),
                                rotation = t.rotation + rotation,
                            )
                        }
                    }
                }
            },
    )

    project.texts.forEach { t ->
        val s = TextAnimMath.state(t, positionMs)
        val selected = t.id == selectedId
        if (!s.visible && !selected) return@forEach
        val bmp = bitmapFor(t, s.visibleChars)
        val full = if (s.visibleChars >= 0) bitmapFor(t, -1) else bmp
        val left = t.x * cw - full.width / 2f
        val top = (t.y + s.dy) * ch - full.height / 2f
        Box(
            Modifier
                .offset { IntOffset(left.roundToInt(), top.roundToInt()) }
                .size(with(density) { full.width.toDp() }, with(density) { full.height.toDp() })
                .graphicsLayer {
                    alpha = if (s.visible) s.alpha.coerceIn(0f, 1f) else 0.35f
                    scaleX = s.scale; scaleY = s.scale
                    rotationZ = t.rotation
                }
                .then(if (selected) Modifier.border(1.5.dp, Color.White) else Modifier),
        ) {
            Image(bmp.asImageBitmap(), null, contentScale = ContentScale.None, alignment = Alignment.TopStart)
        }
    }
}
