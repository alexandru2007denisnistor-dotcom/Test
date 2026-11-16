package com.proedit.app.model

/**
 * Pure, side-effect free editing operations. Every function returns a new [Project]
 * so the editor can keep an undo/redo history of immutable snapshots.
 */
object ProjectOps {
    const val MIN_CLIP_MS = 100L

    fun splitClipAt(p: Project, timeMs: Long): Project {
        val pos = p.locate(timeMs) ?: return p
        val clip = p.clips[pos.clipIndex]
        val off = pos.offsetInClipMs
        if (off < MIN_CLIP_MS || clip.durationMs - off < MIN_CLIP_MS) return p
        val sourceOffset = if (clip.type == ClipType.IMAGE) off else (off * clip.speed).toLong()
        val splitAt = clip.trimStartMs + sourceOffset
        val a = clip.copy(trimEndMs = splitAt, transitionOut = TransitionType.NONE, audioFadeOutMs = 0)
        val b = if (clip.type == ClipType.IMAGE) {
            // Images: the "source" is synthetic, re-base both halves at 0.
            clip.copy(id = newId(), sourceDurationMs = clip.trimEndMs - splitAt, trimStartMs = 0,
                trimEndMs = clip.trimEndMs - splitAt, audioFadeInMs = 0)
        } else {
            clip.copy(id = newId(), trimStartMs = splitAt, audioFadeInMs = 0)
        }
        val fixedA = if (clip.type == ClipType.IMAGE) a.copy(sourceDurationMs = splitAt - clip.trimStartMs,
            trimStartMs = 0, trimEndMs = splitAt - clip.trimStartMs) else a
        val list = p.clips.toMutableList()
        list[pos.clipIndex] = fixedA
        list.add(pos.clipIndex + 1, b)
        return p.copy(clips = list)
    }

    fun splitText(p: Project, id: String, timeMs: Long): Project {
        val t = p.texts.find { it.id == id } ?: return p
        if (timeMs - t.startMs < MIN_CLIP_MS || t.endMs - timeMs < MIN_CLIP_MS) return p
        val a = t.copy(durationMs = timeMs - t.startMs)
        val b = t.copy(id = newId(), startMs = timeMs, durationMs = t.endMs - timeMs)
        return p.copy(texts = p.texts.flatMap { if (it.id == id) listOf(a, b) else listOf(it) })
    }

    fun splitAudio(p: Project, id: String, timeMs: Long): Project {
        val a = p.audios.find { it.id == id } ?: return p
        if (timeMs - a.startMs < MIN_CLIP_MS || a.endMs - timeMs < MIN_CLIP_MS) return p
        val cut = a.trimStartMs + (timeMs - a.startMs)
        val first = a.copy(trimEndMs = cut, fadeOutMs = 0)
        val second = a.copy(id = newId(), startMs = timeMs, trimStartMs = cut, fadeInMs = 0)
        return p.copy(audios = p.audios.flatMap { if (it.id == id) listOf(first, second) else listOf(it) })
    }

    fun deleteClip(p: Project, id: String) = p.copy(clips = p.clips.filterNot { it.id == id })
    fun deleteText(p: Project, id: String) = p.copy(texts = p.texts.filterNot { it.id == id })
    fun deleteAudio(p: Project, id: String) = p.copy(audios = p.audios.filterNot { it.id == id })

    fun duplicateClip(p: Project, id: String): Project {
        val i = p.clips.indexOfFirst { it.id == id }
        if (i < 0) return p
        val list = p.clips.toMutableList()
        list.add(i + 1, p.clips[i].copy(id = newId()))
        return p.copy(clips = list)
    }

    fun duplicateText(p: Project, id: String): Project {
        val t = p.texts.find { it.id == id } ?: return p
        return p.copy(texts = p.texts + t.copy(id = newId(), startMs = t.endMs))
    }

    fun duplicateAudio(p: Project, id: String): Project {
        val a = p.audios.find { it.id == id } ?: return p
        return p.copy(audios = p.audios + a.copy(id = newId(), startMs = a.endMs))
    }

    fun moveClip(p: Project, id: String, delta: Int): Project {
        val i = p.clips.indexOfFirst { it.id == id }
        val j = i + delta
        if (i < 0 || j < 0 || j > p.clips.lastIndex) return p
        val list = p.clips.toMutableList()
        val c = list.removeAt(i)
        list.add(j, c)
        return p.copy(clips = list)
    }

    fun moveClipTo(p: Project, id: String, target: Int): Project {
        val i = p.clips.indexOfFirst { it.id == id }
        if (i < 0) return p
        val list = p.clips.toMutableList()
        val c = list.removeAt(i)
        list.add(target.coerceIn(0, list.size), c)
        return p.copy(clips = list)
    }

    fun updateClip(p: Project, id: String, f: (Clip) -> Clip) =
        p.copy(clips = p.clips.map { if (it.id == id) f(it) else it })

    fun updateText(p: Project, id: String, f: (TextItem) -> TextItem) =
        p.copy(texts = p.texts.map { if (it.id == id) f(it) else it })

    fun updateAudio(p: Project, id: String, f: (AudioItem) -> AudioItem) =
        p.copy(audios = p.audios.map { if (it.id == id) f(it) else it })

    /** Trims a clip; [newStart]/[newEnd] are source times. Keeps a minimum length. */
    fun trimClip(p: Project, id: String, newStart: Long, newEnd: Long): Project = updateClip(p, id) { c ->
        if (c.type == ClipType.IMAGE) {
            val len = (newEnd - newStart).coerceIn(MIN_CLIP_MS, 10 * 60_000L)
            c.copy(sourceDurationMs = len, trimStartMs = 0, trimEndMs = len)
        } else {
            val s = newStart.coerceIn(0, c.sourceDurationMs - MIN_CLIP_MS)
            val e = newEnd.coerceIn(s + MIN_CLIP_MS, c.sourceDurationMs)
            c.copy(trimStartMs = s, trimEndMs = e)
        }
    }

    /** Applies the visual settings of [sourceId] to every clip (CapCut "Apply to all"). */
    fun applyLookToAll(p: Project, sourceId: String): Project {
        val s = p.clips.find { it.id == sourceId } ?: return p
        return p.copy(clips = p.clips.map {
            it.copy(filter = s.filter, filterIntensity = s.filterIntensity, brightness = s.brightness,
                contrast = s.contrast, saturation = s.saturation, temperature = s.temperature,
                tint = s.tint, hue = s.hue)
        })
    }

    fun applyTransitionToAll(p: Project, type: TransitionType, ms: Long): Project =
        p.copy(clips = p.clips.mapIndexed { i, c ->
            if (i == p.clips.lastIndex) c.copy(transitionOut = TransitionType.NONE)
            else c.copy(transitionOut = type, transitionMs = ms)
        })

    /** Inserts a frozen still of the frame at [timeMs] (from [frameUri]) and splits around it. */
    fun insertFreezeFrame(p: Project, timeMs: Long, frameUri: String, w: Int, h: Int, lenMs: Long = 2000): Project {
        val split = splitClipAt(p, timeMs)
        val starts = split.clipStarts()
        var insertAt = starts.indexOfFirst { it >= timeMs }
        if (insertAt < 0) insertAt = split.clips.size
        val list = split.clips.toMutableList()
        list.add(insertAt, Clip(uri = frameUri, type = ClipType.IMAGE, sourceDurationMs = lenMs, width = w, height = h))
        return split.copy(clips = list)
    }

    /** Keeps overlays inside the project length after clips were shortened or removed. */
    fun clampOverlays(p: Project): Project {
        val total = p.durationMs
        if (total <= 0) return p
        return p.copy(
            texts = p.texts.filter { it.startMs < total }.map {
                if (it.endMs > total) it.copy(durationMs = (total - it.startMs).coerceAtLeast(MIN_CLIP_MS)) else it
            },
        )
    }

    /** Linear interpolation helper for transition progress of [clip] at local output time [t]. */
    fun transitionInfo(p: Project, index: Int): Pair<TransitionSpec?, TransitionSpec?> {
        val clip = p.clips[index]
        val prev = p.clips.getOrNull(index - 1)
        val inSpec = prev?.takeIf { it.transitionOut != TransitionType.NONE }?.let {
            TransitionSpec(it.transitionOut, minOf(it.transitionMs / 2, clip.durationMs / 2, it.durationMs / 2))
        }
        val outSpec = clip.takeIf { it.transitionOut != TransitionType.NONE && index < p.clips.lastIndex }?.let {
            val next = p.clips[index + 1]
            TransitionSpec(it.transitionOut, minOf(it.transitionMs / 2, clip.durationMs / 2, next.durationMs / 2))
        }
        return inSpec to outSpec
    }
}

/** Half of a transition as seen from one clip ([halfMs] at the start or end of the clip). */
data class TransitionSpec(val type: TransitionType, val halfMs: Long)
