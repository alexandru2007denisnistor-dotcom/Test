package com.proedit.app.data

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.util.LruCache
import com.proedit.app.model.AudioItem
import com.proedit.app.model.AudioKind
import com.proedit.app.model.Clip
import com.proedit.app.model.ClipType
import com.proedit.app.model.Project
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

object MediaImport {
    const val DEFAULT_IMAGE_MS = 3000L

    fun persist(context: Context, uri: Uri) {
        runCatching {
            context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    fun displayName(context: Context, uri: Uri): String {
        runCatching {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) return c.getString(0).substringBeforeLast('.')
            }
        }
        return uri.lastPathSegment?.substringAfterLast('/') ?: "Audio"
    }

    suspend fun clipFrom(context: Context, uri: Uri): Clip? = withContext(Dispatchers.IO) {
        persist(context, uri)
        val mime = context.contentResolver.getType(uri) ?: ""
        if (mime.startsWith("image/") || (mime.isEmpty() && uri.toString().matches(Regex(".*\\.(jpe?g|png|webp|heic)$", RegexOption.IGNORE_CASE)))) {
            val (w, h) = imageSize(context, uri)
            Clip(uri = uri.toString(), type = ClipType.IMAGE, sourceDurationMs = DEFAULT_IMAGE_MS, width = w, height = h)
        } else {
            val r = MediaMetadataRetriever()
            try {
                r.setDataSource(context, uri)
                val dur = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: return@withContext null
                if (r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO) != "yes") return@withContext null
                var w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
                var h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
                val rot = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
                if (rot == 90 || rot == 270) { val t = w; w = h; h = t }
                Clip(uri = uri.toString(), type = ClipType.VIDEO, sourceDurationMs = dur, width = w, height = h)
            } catch (e: Exception) {
                null
            } finally {
                runCatching { r.release() }
            }
        }
    }

    suspend fun audioFrom(context: Context, uri: Uri, kind: AudioKind, startMs: Long, persist: Boolean = true): AudioItem? =
        withContext(Dispatchers.IO) {
            if (persist) persist(context, uri)
            val r = MediaMetadataRetriever()
            try {
                r.setDataSource(context, uri)
                val dur = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
                    ?: return@withContext null
                if (r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO) != "yes") return@withContext null
                AudioItem(uri = uri.toString(), name = displayName(context, uri), kind = kind, startMs = startMs, sourceDurationMs = dur)
            } catch (e: Exception) {
                null
            } finally {
                runCatching { r.release() }
            }
        }

    fun imageSize(context: Context, uri: Uri): Pair<Int, Int> {
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        runCatching { context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) } }
        val o = exifRotation(context, uri)
        return if (o == 90 || o == 270) opts.outHeight to opts.outWidth else opts.outWidth to opts.outHeight
    }

    private fun exifRotation(context: Context, uri: Uri): Int = runCatching {
        context.contentResolver.openInputStream(uri)?.use {
            when (ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90
                ExifInterface.ORIENTATION_ROTATE_180 -> 180
                ExifInterface.ORIENTATION_ROTATE_270 -> 270
                else -> 0
            }
        } ?: 0
    }.getOrDefault(0)

    /** Decodes an image downsampled so its longest side is about [maxSide], honouring EXIF rotation. */
    fun loadImage(context: Context, uri: Uri, maxSide: Int): Bitmap? = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        val bmp = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
            ?: return null
        val rot = exifRotation(context, uri)
        if (rot == 0) bmp else Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(rot.toFloat()) }, true)
    }.getOrNull()

    /** Extracts a full-resolution frame of a video clip, e.g. for freeze frames. */
    suspend fun grabFrame(context: Context, uri: Uri, sourceMs: Long): Bitmap? = withContext(Dispatchers.IO) {
        val r = MediaMetadataRetriever()
        try {
            r.setDataSource(context, uri)
            r.getFrameAtTime(sourceMs * 1000, MediaMetadataRetriever.OPTION_CLOSEST)
        } catch (e: Exception) {
            null
        } finally {
            runCatching { r.release() }
        }
    }

    fun saveFrame(context: Context, bmp: Bitmap): File {
        val dir = File(context.filesDir, "frames").apply { mkdirs() }
        val f = File(dir, "freeze_${System.currentTimeMillis()}.jpg")
        f.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 95, it) }
        return f
    }
}

/** Small thumbnails for the timeline, cached in memory. */
class ThumbnailCache(private val context: Context) {
    private val cache = object : LruCache<String, Bitmap>(48 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
        override fun entryRemoved(evicted: Boolean, key: String, oldValue: Bitmap, newValue: Bitmap?) {
            if (evicted) requested.remove(key)
        }
    }
    private val retrievers = mutableMapOf<String, MediaMetadataRetriever>()
    private val lock = Mutex()
    private val requested = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

    fun peek(key: String): Bitmap? = cache.get(key)

    /** Returns true exactly once per key, so callers start at most one load per thumbnail. */
    fun markRequested(key: String): Boolean = requested.add(key)

    suspend fun thumbnail(uri: String, type: ClipType, sourceMs: Long, heightPx: Int): Bitmap? {
        val key = key(uri, type, sourceMs)
        cache.get(key)?.let { return it }
        return withContext(Dispatchers.IO) {
            lock.withLock {
                cache.get(key)?.let { return@withLock it }
                val bmp = if (type == ClipType.IMAGE) {
                    MediaImport.loadImage(context, Uri.parse(uri), heightPx * 2)
                } else {
                    val r = retrievers.getOrPut(uri) {
                        MediaMetadataRetriever().apply { runCatching { setDataSource(context, Uri.parse(uri)) } }
                    }
                    runCatching {
                        val frame = if (Build.VERSION.SDK_INT >= 27) {
                            r.getScaledFrameAtTime(sourceMs * 1000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, heightPx * 2, heightPx * 2)
                        } else {
                            r.getFrameAtTime(sourceMs * 1000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                        }
                        frame?.let { scaleToHeight(it, heightPx) }
                    }.getOrNull()
                }
                bmp?.also { cache.put(key, it) }
            }
        }
    }

    private fun scaleToHeight(b: Bitmap, h: Int): Bitmap {
        if (b.height <= h) return b
        val w = (b.width * h.toFloat() / b.height).toInt().coerceAtLeast(1)
        return Bitmap.createScaledBitmap(b, w, h, true)
    }

    fun release() {
        retrievers.values.forEach { runCatching { it.release() } }
        retrievers.clear()
    }

    companion object {
        /** Thumbnails are bucketed to 1 s so neighbouring tiles share frames. */
        fun key(uri: String, type: ClipType, sourceMs: Long) =
            if (type == ClipType.IMAGE) "$uri#img" else "$uri#${sourceMs / 1000}"

        fun bucket(sourceMs: Long) = (sourceMs / 1000) * 1000 + 500
    }
}

class ProjectRepository(private val context: Context) {
    private val dir get() = File(context.filesDir, "projects").apply { mkdirs() }

    suspend fun list(): List<Project> = withContext(Dispatchers.IO) {
        dir.listFiles { f -> f.extension == "json" }.orEmpty()
            .mapNotNull { f -> runCatching { Project.fromJson(JSONObject(f.readText())) }.getOrNull() }
            .sortedByDescending { it.updatedAt }
    }

    suspend fun load(id: String): Project? = withContext(Dispatchers.IO) {
        runCatching { Project.fromJson(JSONObject(File(dir, "$id.json").readText())) }.getOrNull()
    }

    suspend fun save(p: Project) = withContext(Dispatchers.IO) {
        val tmp = File(dir, "${p.id}.json.tmp")
        tmp.writeText(p.toJson().toString())
        tmp.renameTo(File(dir, "${p.id}.json"))
    }

    suspend fun delete(id: String) = withContext(Dispatchers.IO) {
        File(dir, "$id.json").delete()
    }
}
