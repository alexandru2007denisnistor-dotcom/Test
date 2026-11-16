package com.proedit.app.model

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

fun newId(): String = UUID.randomUUID().toString()

enum class ClipType { VIDEO, IMAGE }

enum class AspectRatio(val label: String, val w: Int, val h: Int) {
    R9_16("9:16", 9, 16),
    R16_9("16:9", 16, 9),
    R1_1("1:1", 1, 1),
    R4_5("4:5", 4, 5),
    R3_4("3:4", 3, 4),
    R4_3("4:3", 4, 3),
    R21_9("21:9", 21, 9);

    val ratio: Float get() = w.toFloat() / h
}

enum class FitMode(val label: String) { FIT("Einpassen"), FILL("Füllen") }

enum class TransitionType(val label: String) {
    NONE("Keiner"),
    FADE("Abblenden"),
    FLASH("Blitz"),
    ZOOM("Zoom"),
    SPIN("Drehen"),
    SLIDE_LEFT("Wischen ←"),
    SLIDE_UP("Wischen ↑"),
}

enum class TextAnimation(val label: String) {
    NONE("Keine"),
    FADE("Einblenden"),
    POP("Pop"),
    SLIDE_UP("Hochgleiten"),
    TYPEWRITER("Schreibmaschine"),
}

enum class AudioKind { MUSIC, VOICE, EXTRACTED, SFX }

/** A video or photo segment on the main track. All times in milliseconds. */
data class Clip(
    val id: String = newId(),
    val uri: String,
    val type: ClipType,
    /** Full length of the source (video) or the chosen duration (image). */
    val sourceDurationMs: Long,
    val trimStartMs: Long = 0,
    val trimEndMs: Long = sourceDurationMs,
    val speed: Float = 1f,
    val volume: Float = 1f,
    val audioFadeInMs: Long = 0,
    val audioFadeOutMs: Long = 0,
    val filter: String = "none",
    val filterIntensity: Float = 1f,
    val brightness: Float = 0f,
    val contrast: Float = 0f,
    val saturation: Float = 0f,
    val temperature: Float = 0f,
    val tint: Float = 0f,
    val hue: Float = 0f,
    val rotation: Int = 0,
    val flipH: Boolean = false,
    val flipV: Boolean = false,
    val zoom: Float = 1f,
    val offsetX: Float = 0f,
    val offsetY: Float = 0f,
    /** Transition played between this clip and the next one. */
    val transitionOut: TransitionType = TransitionType.NONE,
    val transitionMs: Long = 600,
    val width: Int = 0,
    val height: Int = 0,
) {
    val trimmedSourceMs: Long get() = (trimEndMs - trimStartMs).coerceAtLeast(1)
    /** Duration of this clip on the output timeline. */
    val durationMs: Long
        get() = if (type == ClipType.IMAGE) trimmedSourceMs else (trimmedSourceMs / speed).toLong().coerceAtLeast(1)

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id); put("uri", uri); put("type", type.name)
        put("sourceDurationMs", sourceDurationMs); put("trimStartMs", trimStartMs); put("trimEndMs", trimEndMs)
        put("speed", speed.toDouble()); put("volume", volume.toDouble())
        put("audioFadeInMs", audioFadeInMs); put("audioFadeOutMs", audioFadeOutMs)
        put("filter", filter); put("filterIntensity", filterIntensity.toDouble())
        put("brightness", brightness.toDouble()); put("contrast", contrast.toDouble())
        put("saturation", saturation.toDouble()); put("temperature", temperature.toDouble())
        put("tint", tint.toDouble()); put("hue", hue.toDouble())
        put("rotation", rotation); put("flipH", flipH); put("flipV", flipV)
        put("zoom", zoom.toDouble()); put("offsetX", offsetX.toDouble()); put("offsetY", offsetY.toDouble())
        put("transitionOut", transitionOut.name); put("transitionMs", transitionMs)
        put("width", width); put("height", height)
    }

    companion object {
        fun fromJson(o: JSONObject): Clip {
            val src = o.getLong("sourceDurationMs")
            return Clip(
                id = o.optString("id", newId()), uri = o.getString("uri"),
                type = ClipType.valueOf(o.getString("type")),
                sourceDurationMs = src, trimStartMs = o.optLong("trimStartMs", 0),
                trimEndMs = o.optLong("trimEndMs", src),
                speed = o.optDouble("speed", 1.0).toFloat(), volume = o.optDouble("volume", 1.0).toFloat(),
                audioFadeInMs = o.optLong("audioFadeInMs", 0), audioFadeOutMs = o.optLong("audioFadeOutMs", 0),
                filter = o.optString("filter", "none"),
                filterIntensity = o.optDouble("filterIntensity", 1.0).toFloat(),
                brightness = o.optDouble("brightness", 0.0).toFloat(),
                contrast = o.optDouble("contrast", 0.0).toFloat(),
                saturation = o.optDouble("saturation", 0.0).toFloat(),
                temperature = o.optDouble("temperature", 0.0).toFloat(),
                tint = o.optDouble("tint", 0.0).toFloat(), hue = o.optDouble("hue", 0.0).toFloat(),
                rotation = o.optInt("rotation", 0), flipH = o.optBoolean("flipH"), flipV = o.optBoolean("flipV"),
                zoom = o.optDouble("zoom", 1.0).toFloat(),
                offsetX = o.optDouble("offsetX", 0.0).toFloat(), offsetY = o.optDouble("offsetY", 0.0).toFloat(),
                transitionOut = runCatching { TransitionType.valueOf(o.optString("transitionOut")) }
                    .getOrDefault(TransitionType.NONE),
                transitionMs = o.optLong("transitionMs", 600),
                width = o.optInt("width"), height = o.optInt("height"),
            )
        }
    }
}

/** Text or sticker (emoji) overlay placed on the timeline. */
data class TextItem(
    val id: String = newId(),
    val text: String,
    val startMs: Long,
    val durationMs: Long = 3000,
    /** Center position, normalized 0..1 of the output frame. */
    val x: Float = 0.5f,
    val y: Float = 0.5f,
    /** Font size as a fraction of the output frame height. */
    val size: Float = 0.06f,
    val color: Int = 0xFFFFFFFF.toInt(),
    val bgColor: Int = 0,
    val outline: Boolean = true,
    val outlineColor: Int = 0xFF000000.toInt(),
    val shadow: Boolean = false,
    val bold: Boolean = true,
    val italic: Boolean = false,
    val font: String = "sans",
    val align: Int = 1,
    val rotation: Float = 0f,
    val animIn: TextAnimation = TextAnimation.FADE,
    val animOut: TextAnimation = TextAnimation.FADE,
    val isSticker: Boolean = false,
) {
    val endMs: Long get() = startMs + durationMs

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id); put("text", text); put("startMs", startMs); put("durationMs", durationMs)
        put("x", x.toDouble()); put("y", y.toDouble()); put("size", size.toDouble())
        put("color", color); put("bgColor", bgColor); put("outline", outline); put("outlineColor", outlineColor)
        put("shadow", shadow); put("bold", bold); put("italic", italic); put("font", font); put("align", align)
        put("rotation", rotation.toDouble())
        put("animIn", animIn.name); put("animOut", animOut.name); put("isSticker", isSticker)
    }

    companion object {
        fun fromJson(o: JSONObject) = TextItem(
            id = o.optString("id", newId()), text = o.getString("text"),
            startMs = o.getLong("startMs"), durationMs = o.optLong("durationMs", 3000),
            x = o.optDouble("x", 0.5).toFloat(), y = o.optDouble("y", 0.5).toFloat(),
            size = o.optDouble("size", 0.06).toFloat(),
            color = o.optInt("color", -1), bgColor = o.optInt("bgColor", 0),
            outline = o.optBoolean("outline", true), outlineColor = o.optInt("outlineColor", 0xFF000000.toInt()),
            shadow = o.optBoolean("shadow"), bold = o.optBoolean("bold", true), italic = o.optBoolean("italic"),
            font = o.optString("font", "sans"), align = o.optInt("align", 1),
            rotation = o.optDouble("rotation", 0.0).toFloat(),
            animIn = runCatching { TextAnimation.valueOf(o.optString("animIn")) }.getOrDefault(TextAnimation.FADE),
            animOut = runCatching { TextAnimation.valueOf(o.optString("animOut")) }.getOrDefault(TextAnimation.FADE),
            isSticker = o.optBoolean("isSticker"),
        )
    }
}

/** Music, voice-over, sound effect or extracted audio placed on an audio lane. */
data class AudioItem(
    val id: String = newId(),
    val uri: String,
    val name: String,
    val kind: AudioKind = AudioKind.MUSIC,
    val startMs: Long = 0,
    val sourceDurationMs: Long,
    val trimStartMs: Long = 0,
    val trimEndMs: Long = sourceDurationMs,
    val volume: Float = 1f,
    val fadeInMs: Long = 0,
    val fadeOutMs: Long = 0,
) {
    val durationMs: Long get() = (trimEndMs - trimStartMs).coerceAtLeast(1)
    val endMs: Long get() = startMs + durationMs

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id); put("uri", uri); put("name", name); put("kind", kind.name)
        put("startMs", startMs); put("sourceDurationMs", sourceDurationMs)
        put("trimStartMs", trimStartMs); put("trimEndMs", trimEndMs)
        put("volume", volume.toDouble()); put("fadeInMs", fadeInMs); put("fadeOutMs", fadeOutMs)
    }

    companion object {
        fun fromJson(o: JSONObject): AudioItem {
            val src = o.getLong("sourceDurationMs")
            return AudioItem(
                id = o.optString("id", newId()), uri = o.getString("uri"), name = o.optString("name", "Audio"),
                kind = runCatching { AudioKind.valueOf(o.optString("kind")) }.getOrDefault(AudioKind.MUSIC),
                startMs = o.optLong("startMs", 0), sourceDurationMs = src,
                trimStartMs = o.optLong("trimStartMs", 0), trimEndMs = o.optLong("trimEndMs", src),
                volume = o.optDouble("volume", 1.0).toFloat(),
                fadeInMs = o.optLong("fadeInMs", 0), fadeOutMs = o.optLong("fadeOutMs", 0),
            )
        }
    }
}

data class Project(
    val id: String = newId(),
    val name: String = "Projekt",
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
    val aspect: AspectRatio = AspectRatio.R9_16,
    val fitMode: FitMode = FitMode.FIT,
    val backgroundColor: Int = 0xFF000000.toInt(),
    val clips: List<Clip> = emptyList(),
    val texts: List<TextItem> = emptyList(),
    val audios: List<AudioItem> = emptyList(),
) {
    val durationMs: Long get() = clips.sumOf { it.durationMs }

    /** Output-timeline start of each clip. */
    fun clipStarts(): LongArray {
        val arr = LongArray(clips.size)
        var acc = 0L
        clips.forEachIndexed { i, c -> arr[i] = acc; acc += c.durationMs }
        return arr
    }

    fun toJson(): JSONObject = JSONObject().apply {
        put("version", 1)
        put("id", id); put("name", name); put("createdAt", createdAt); put("updatedAt", updatedAt)
        put("aspect", aspect.name); put("fitMode", fitMode.name); put("backgroundColor", backgroundColor)
        put("clips", JSONArray().apply { clips.forEach { put(it.toJson()) } })
        put("texts", JSONArray().apply { texts.forEach { put(it.toJson()) } })
        put("audios", JSONArray().apply { audios.forEach { put(it.toJson()) } })
    }

    companion object {
        fun fromJson(o: JSONObject): Project {
            fun <T> arr(name: String, f: (JSONObject) -> T): List<T> {
                val a = o.optJSONArray(name) ?: return emptyList()
                return (0 until a.length()).mapNotNull { runCatching { f(a.getJSONObject(it)) }.getOrNull() }
            }
            return Project(
                id = o.getString("id"), name = o.optString("name", "Projekt"),
                createdAt = o.optLong("createdAt"), updatedAt = o.optLong("updatedAt"),
                aspect = runCatching { AspectRatio.valueOf(o.optString("aspect")) }.getOrDefault(AspectRatio.R9_16),
                fitMode = runCatching { FitMode.valueOf(o.optString("fitMode")) }.getOrDefault(FitMode.FIT),
                backgroundColor = o.optInt("backgroundColor", 0xFF000000.toInt()),
                clips = arr("clips", Clip::fromJson),
                texts = arr("texts", TextItem::fromJson),
                audios = arr("audios", AudioItem::fromJson),
            )
        }
    }
}

/** Locates a position on the output timeline inside the clip list. */
data class TimelinePos(val clipIndex: Int, val offsetInClipMs: Long)

fun Project.locate(timeMs: Long): TimelinePos? {
    if (clips.isEmpty()) return null
    var acc = 0L
    clips.forEachIndexed { i, c ->
        if (timeMs < acc + c.durationMs) return TimelinePos(i, (timeMs - acc).coerceAtLeast(0))
        acc += c.durationMs
    }
    return TimelinePos(clips.lastIndex, clips.last().durationMs)
}
