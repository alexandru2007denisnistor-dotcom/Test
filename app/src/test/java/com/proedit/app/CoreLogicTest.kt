package com.proedit.app

import com.proedit.app.engine.AudioEnvelope
import com.proedit.app.engine.ColorMath
import com.proedit.app.engine.ExportMath
import com.proedit.app.engine.LocalClock
import com.proedit.app.engine.TextAnimMath
import com.proedit.app.engine.TransitionMath
import com.proedit.app.model.AspectRatio
import com.proedit.app.model.AudioItem
import com.proedit.app.model.Clip
import com.proedit.app.model.ClipType
import com.proedit.app.model.Project
import com.proedit.app.model.ProjectOps
import com.proedit.app.model.TextAnimation
import com.proedit.app.model.TextItem
import com.proedit.app.model.TransitionType
import com.proedit.app.model.locate
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CoreLogicTest {
    private fun video(len: Long, speed: Float = 1f) =
        Clip(uri = "content://v/$len", type = ClipType.VIDEO, sourceDurationMs = len, speed = speed, width = 1920, height = 1080)

    @Test
    fun durationRespectsTrimAndSpeed() {
        val c = video(10_000, 2f).copy(trimStartMs = 1000, trimEndMs = 9000)
        assertEquals(4000, c.durationMs)
        val p = Project(clips = listOf(c, video(3000)))
        assertEquals(7000, p.durationMs)
        assertEquals(1, p.locate(4500)!!.clipIndex)
        assertEquals(500, p.locate(4500)!!.offsetInClipMs)
    }

    @Test
    fun splitKeepsTotalDurationAndSourceRanges() {
        val c = video(10_000, 2f).copy(transitionOut = TransitionType.FADE)
        val p = Project(clips = listOf(c, video(2000)))
        val s = ProjectOps.splitClipAt(p, 2000) // 2 s output = 4 s source
        assertEquals(3, s.clips.size)
        assertEquals(p.durationMs, s.durationMs)
        assertEquals(4000, s.clips[0].trimEndMs)
        assertEquals(4000, s.clips[1].trimStartMs)
        assertEquals(TransitionType.NONE, s.clips[0].transitionOut)
        assertEquals(TransitionType.FADE, s.clips[1].transitionOut)
    }

    @Test
    fun splitImageRebasesBothHalves() {
        val img = Clip(uri = "x", type = ClipType.IMAGE, sourceDurationMs = 3000)
        val s = ProjectOps.splitClipAt(Project(clips = listOf(img)), 1000)
        assertEquals(listOf(1000L, 2000L), s.clips.map { it.durationMs })
        assertTrue(s.clips.all { it.trimStartMs == 0L })
    }

    @Test
    fun splitTooCloseToEdgeIsIgnored() {
        val p = Project(clips = listOf(video(5000)))
        assertEquals(p, ProjectOps.splitClipAt(p, 50))
    }

    @Test
    fun trimIsClamped() {
        val p = Project(clips = listOf(video(5000)))
        val id = p.clips[0].id
        val t = ProjectOps.trimClip(p, id, -500, 99_999)
        assertEquals(0, t.clips[0].trimStartMs)
        assertEquals(5000, t.clips[0].trimEndMs)
        val t2 = ProjectOps.trimClip(p, id, 4990, 5000)
        assertTrue(t2.clips[0].trimmedSourceMs >= ProjectOps.MIN_CLIP_MS)
    }

    @Test
    fun moveAndDuplicate() {
        val a = video(1000); val b = video(2000)
        val p = Project(clips = listOf(a, b))
        assertEquals(listOf(b.id, a.id), ProjectOps.moveClip(p, a.id, 1).clips.map { it.id })
        assertEquals(p, ProjectOps.moveClip(p, a.id, -1))
        assertEquals(3, ProjectOps.duplicateClip(p, a.id).clips.size)
    }

    @Test
    fun transitionsAreClampedToHalfOfNeighbours() {
        val p = Project(clips = listOf(video(400).copy(transitionOut = TransitionType.FADE, transitionMs = 2000), video(5000)))
        val (_, out) = ProjectOps.transitionInfo(p, 0)
        val (inn, _) = ProjectOps.transitionInfo(p, 1)
        assertEquals(200, out!!.halfMs)
        assertEquals(200, inn!!.halfMs)
        // At the cut the dip is complete, far away it is untouched.
        assertEquals(1f, TransitionMath.visual(400, 400, null, out).dim, 1e-4f)
        assertEquals(0f, TransitionMath.visual(2500, 5000, inn, null).dim, 1e-4f)
    }

    @Test
    fun colorMatrixConversions() {
        assertTrue(ColorMath.isIdentity(ColorMath.clipMatrix(video(1))))
        val gl = ColorMath.toGl4x4(ColorMath.IDENTITY)
        assertArrayEquals(floatArrayOf(1f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 1f), gl, 1e-6f)
        // Brightness goes into the translation column.
        val bright = ColorMath.toGl4x4(ColorMath.clipMatrix(video(1).copy(brightness = 1f)))
        assertEquals(0.3f, bright[12], 1e-5f)
        // Saturation 0 makes every row identical (grey).
        val bw = ColorMath.filterMatrix("bw")
        assertEquals(bw[0], bw[5], 1e-6f); assertEquals(bw[1], bw[6], 1e-6f)
        // concat with identity is a no-op.
        val m = ColorMath.filterMatrix("teal")
        assertArrayEquals(m, ColorMath.concat(ColorMath.IDENTITY, m), 1e-6f)
        assertArrayEquals(m, ColorMath.concat(m, ColorMath.IDENTITY), 1e-6f)
        ColorMath.FILTERS.forEach { (id, _) -> assertEquals(20, ColorMath.filterMatrix(id).size) }
    }

    @Test
    fun textAnimation() {
        val t = TextItem(text = "Hallo", startMs = 1000, durationMs = 3000, animIn = TextAnimation.TYPEWRITER, animOut = TextAnimation.FADE)
        assertFalse(TextAnimMath.state(t, 999).visible)
        assertFalse(TextAnimMath.state(t, 4000).visible)
        assertTrue(TextAnimMath.state(t, 1100).visibleChars in 1..4)
        assertEquals(1f, TextAnimMath.state(t, 2500).alpha, 1e-6f)
        assertEquals(-1, TextAnimMath.state(t, 2500).visibleChars)
        assertTrue(TextAnimMath.state(t, 3950).alpha < 0.2f)
    }

    @Test
    fun localClockHandlesOffsets() {
        val c = LocalClock()
        assertEquals(0, c.localUs(5_000_000))
        assertEquals(40_000, c.localUs(5_040_000))
    }

    @Test
    fun audioEnvelope() {
        assertEquals(0f, AudioEnvelope.gain(1f, 0, 10_000, 1000, 0), 1e-6f)
        assertEquals(0.5f, AudioEnvelope.gain(1f, 500, 10_000, 1000, 0), 1e-6f)
        assertEquals(0.8f, AudioEnvelope.gain(0.8f, 5000, 10_000, 1000, 1000), 1e-6f)
        assertEquals(0f, AudioEnvelope.gain(1f, 10_000, 10_000, 0, 1000), 1e-6f)
    }

    @Test
    fun exportSizes() {
        assertEquals(1080 to 1920, ExportMath.outputSize(AspectRatio.R9_16, 1080))
        assertEquals(3840 to 2160, ExportMath.outputSize(AspectRatio.R16_9, 2160))
        assertEquals(1080 to 1080, ExportMath.outputSize(AspectRatio.R1_1, 1080))
        assertEquals(1080 to 1350, ExportMath.outputSize(AspectRatio.R4_5, 1080))
        val (w, h) = ExportMath.outputSize(AspectRatio.R21_9, 720)
        assertTrue(w % 2 == 0 && h % 2 == 0)
    }

    @Test
    fun jsonRoundTrip() {
        val p = Project(
            name = "Test", aspect = AspectRatio.R4_5,
            clips = listOf(video(5000, 1.5f).copy(filter = "cinema", rotation = 90, transitionOut = TransitionType.SPIN)),
            texts = listOf(TextItem(text = "Hi\nZeile 2", startMs = 100, bgColor = 0x55FF0000, animIn = TextAnimation.POP)),
            audios = listOf(AudioItem(uri = "a", name = "Song", sourceDurationMs = 9000, startMs = 1000, fadeOutMs = 500)),
        )
        val back = Project.fromJson(JSONObject(p.toJson().toString()))
        assertEquals(p, back)
    }

    @Test
    fun clampOverlaysAfterShortening() {
        val p = Project(clips = listOf(video(2000)), texts = listOf(TextItem(text = "x", startMs = 1500, durationMs = 3000),
            TextItem(text = "gone", startMs = 2500)))
        val c = ProjectOps.clampOverlays(p)
        assertEquals(1, c.texts.size)
        assertEquals(500, c.texts[0].durationMs)
    }

    @Test
    fun freezeFrameInsertsStill() {
        val p = Project(clips = listOf(video(4000)))
        val f = ProjectOps.insertFreezeFrame(p, 2000, "file://f.jpg", 100, 100, 1500)
        assertEquals(listOf(ClipType.VIDEO, ClipType.IMAGE, ClipType.VIDEO), f.clips.map { it.type })
        assertEquals(5500, f.durationMs)
    }
}
