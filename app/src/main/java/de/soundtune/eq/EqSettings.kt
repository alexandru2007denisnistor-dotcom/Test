package de.soundtune.eq

import android.content.Context

/** Persistenter Zustand (SharedPreferences). */
class EqSettings(context: Context) {
    private val p = context.getSharedPreferences("eq", Context.MODE_PRIVATE)

    var enabled: Boolean
        get() = p.getBoolean("enabled", true)
        set(v) = p.edit().putBoolean("enabled", v).apply()

    var headphoneId: String
        get() = p.getString("headphone", Headphones.all[0].id)!!
        set(v) = p.edit().putString("headphone", v).apply()

    var profileId: String
        get() = p.getString("profile", Profiles.all[0].id)!!
        set(v) = p.edit().putString("profile", v).apply()

    var gains: FloatArray
        get() {
            val s = p.getString("gains", null) ?: return combine(Headphones.byId(headphoneId), Profiles.byId(profileId))
            return s.split(",").map { it.toFloat() }.toFloatArray().takeIf { it.size == 10 } ?: FloatArray(10)
        }
        set(v) = p.edit().putString("gains", v.joinToString(",")).apply()

    var customized: Boolean
        get() = p.getBoolean("customized", false)
        set(v) = p.edit().putBoolean("customized", v).apply()

    var autoPreamp: Boolean
        get() = p.getBoolean("autoPreamp", true)
        set(v) = p.edit().putBoolean("autoPreamp", v).apply()

    var manualPreamp: Float
        get() = p.getFloat("preamp", 0f)
        set(v) = p.edit().putFloat("preamp", v).apply()

    var limiter: Boolean
        get() = p.getBoolean("limiter", true)
        set(v) = p.edit().putBoolean("limiter", v).apply()

    /** Vorverstärkung: automatisch so weit absenken, dass die stärkste Anhebung nicht übersteuert. */
    fun effectivePreamp(g: FloatArray = gains): Float =
        if (autoPreamp) -(g.maxOrNull() ?: 0f).coerceAtLeast(0f) else manualPreamp
}
