package de.soundtune.eq

import android.media.audiofx.DynamicsProcessing
import android.util.Log
import kotlin.math.pow

/**
 * Hängt einen 31-Band (Terz) DynamicsProcessing-EQ + Limiter an Audio-Sessions.
 * Session 0 = globaler Mix (funktioniert auf vielen Geräten), zusätzlich jede Session,
 * die Spotify & Co. per Broadcast melden (zuverlässigster Weg).
 */
object EqEngine {
    private const val TAG = "SoundTuneEQ"
    private const val PRIORITY = Int.MAX_VALUE

    /** Terzband-Mitten 20 Hz .. 20 kHz */
    private val centers = FloatArray(31) { 20f * 2f.pow(it / 3f) }
    private val cutoffs = FloatArray(31) { if (it == 30) 20000f else centers[it] * 2f.pow(1f / 6f) }

    private val effects = linkedMapOf<Int, DynamicsProcessing>()
    val sessionPackages = linkedMapOf<Int, String>()
    var lastError: String? = null
        private set

    var listener: (() -> Unit)? = null

    @Synchronized
    fun attach(session: Int, pkg: String, settings: EqSettings) {
        sessionPackages[session] = pkg
        if (effects.containsKey(session)) { apply(settings); return }
        try {
            val config = DynamicsProcessing.Config.Builder(
                DynamicsProcessing.VARIANT_FAVOR_FREQUENCY_RESOLUTION,
                2,
                true, centers.size,   // Pre-EQ
                false, 0,             // Multiband-Kompressor
                false, 0,             // Post-EQ
                true                  // Limiter
            ).build()
            val dp = DynamicsProcessing(PRIORITY, session, config)
            effects[session] = dp
            lastError = null
            applyTo(dp, settings)
            Log.i(TAG, "attached session=$session pkg=$pkg")
        } catch (e: Throwable) {
            lastError = "Session $session ($pkg): ${e.message ?: e.javaClass.simpleName}"
            Log.w(TAG, "attach failed", e)
        }
        listener?.invoke()
    }

    @Synchronized
    fun detach(session: Int) {
        if (session == 0) return
        sessionPackages.remove(session)
        effects.remove(session)?.let { runCatching { it.release() } }
        listener?.invoke()
    }

    @Synchronized
    fun apply(settings: EqSettings) {
        val dead = mutableListOf<Int>()
        for ((s, dp) in effects) {
            try { applyTo(dp, settings) } catch (e: Throwable) { dead += s }
        }
        dead.forEach { s -> effects.remove(s)?.let { runCatching { it.release() } }; sessionPackages.remove(s) }
    }

    @Synchronized
    fun releaseAll() {
        effects.values.forEach { runCatching { it.release() } }
        effects.clear()
        sessionPackages.clear()
        listener?.invoke()
    }

    fun activeSessions(): List<Pair<Int, String>> = synchronized(this) {
        effects.keys.map { it to (sessionPackages[it] ?: "?") }
    }

    private fun applyTo(dp: DynamicsProcessing, s: EqSettings) {
        val gains = s.gains
        val pre = s.effectivePreamp(gains)
        dp.setInputGainAllChannelsTo(pre)
        for (i in centers.indices) {
            dp.setPreEqBandAllChannelsTo(i, DynamicsProcessing.EqBand(true, cutoffs[i], gainAt(centers[i], gains)))
        }
        dp.setLimiterAllChannelsTo(
            DynamicsProcessing.Limiter(
                true, s.limiter, 0,
                1f,     // attack ms
                80f,    // release ms
                10f,    // ratio
                -1f,    // threshold dBFS
                0f      // post gain
            )
        )
        dp.enabled = s.enabled
    }
}
