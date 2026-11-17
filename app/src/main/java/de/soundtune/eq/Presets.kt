package de.soundtune.eq

/** Die 10 Regler-Frequenzen (Hz). */
val BAND_FREQS = floatArrayOf(31f, 62f, 125f, 250f, 500f, 1000f, 2000f, 4000f, 8000f, 16000f)

class Preset(val id: String, val name: String, val description: String, val gains: FloatArray)

/**
 * Kopfhörer-Korrekturen: gleichen die typische Abstimmung grob in Richtung einer
 * neutralen "Studio"-Zielkurve (Harman-ähnlich) aus. Werte sind Näherungen auf Basis
 * öffentlich bekannter Messungen/Reviews – Feintuning nach Gehör ist ausdrücklich erwünscht.
 */
object Headphones {
    val all = listOf(
        Preset(
            "space_one", "Soundcore Space One",
            "Over-Ear, ab Werk sehr bassig mit etwas Dröhnen im Grundton und leicht dunklen Höhen. " +
                "Korrektur: Grundton entschlacken, Präsenz & Luft anheben. Tipp: In der Soundcore-App LDAC aktivieren und den App-EQ auf \"Signature/Aus\" stellen.",
            floatArrayOf(-1.0f, -1.5f, -2.0f, -2.5f, -1.0f, 0.0f, 1.0f, 1.5f, 1.0f, 2.0f)
        ),
        Preset(
            "earfun_air_pro4", "EarFun Air Pro 4 (\"Airfun Air 4 Pro Plus\")",
            "In-Ear, V-förmig: kräftiger Bass, etwas spitze Höhen um 6–9 kHz. " +
                "Korrektur: Oberbass leicht zurück, Stimmen nach vorn, Zischeln zähmen. Tipp: In der EarFun-App LDAC aktivieren.",
            floatArrayOf(0.0f, -1.0f, -1.5f, -1.0f, 0.0f, 0.0f, 1.0f, 0.5f, -1.5f, 1.0f)
        ),
        Preset(
            "none", "Ohne Korrektur",
            "Keine kopfhörerspezifische Korrektur – nur das Sound-Profil wird angewendet.",
            FloatArray(10)
        ),
    )

    fun byId(id: String) = all.firstOrNull { it.id == id } ?: all[0]
}

object Profiles {
    val all = listOf(
        Preset(
            "lana", "Lana Del Rey · Warm & Cinematic",
            "Tiefer, samtiger Sub-Bass für die Trap-/Orchester-Lows (\"Born to Die\", \"Summertime Sadness\"), " +
                "klarer Grundton ohne Matsch, nahe & hauchige Stimme (2–4 kHz), seidige Luft für Hall & Streicher – ohne Zischeln bei 8 kHz.",
            floatArrayOf(3.5f, 3.5f, 1.5f, 0.0f, -0.5f, 0.0f, 1.5f, 2.0f, 0.5f, 2.5f)
        ),
        Preset(
            "studio", "Studio Neutral",
            "Nur die Kopfhörer-Korrektur – möglichst linear, wie im Tonstudio abgehört.",
            FloatArray(10)
        ),
        Preset(
            "studio_bass", "Studio + Bass",
            "Neutrale Mitten & Höhen, dazu ein sauberer Sub-Bass-Shelf für Druck ohne Dröhnen.",
            floatArrayOf(4.5f, 3.5f, 1.5f, 0.0f, 0.0f, 0.0f, 0.0f, 0.5f, 0.0f, 1.0f)
        ),
        Preset(
            "deep_bass", "Deep Bass",
            "Maximaler Tiefbass für Hip-Hop, Trap & elektronische Musik.",
            floatArrayOf(7.0f, 6.0f, 3.0f, 0.5f, -0.5f, 0.0f, 0.5f, 1.0f, 0.5f, 1.0f)
        ),
        Preset(
            "vocal", "Vocal Klarheit",
            "Stimmen ganz nach vorne – ideal für Balladen & Akustik (z. B. \"Video Games\", \"Mariners Apartment Complex\").",
            floatArrayOf(1.0f, 1.0f, 0.0f, -1.0f, -0.5f, 0.5f, 2.0f, 2.5f, 1.0f, 1.5f)
        ),
    )

    fun byId(id: String) = all.firstOrNull { it.id == id } ?: all[0]
}

/** Endgültige Kurve = Kopfhörer-Korrektur + Profil. */
fun combine(headphone: Preset, profile: Preset) =
    FloatArray(10) { (headphone.gains[it] + profile.gains[it]).coerceIn(-12f, 12f) }

/** Interpoliert die 10 Regler logarithmisch über die Frequenz (für Engine & Kurvenansicht). */
fun gainAt(freq: Float, gains: FloatArray): Float {
    val lf = kotlin.math.log2(freq)
    val l0 = kotlin.math.log2(BAND_FREQS.first())
    val ln = kotlin.math.log2(BAND_FREQS.last())
    if (lf <= l0) return gains.first()
    if (lf >= ln) return gains.last()
    for (i in 0 until BAND_FREQS.size - 1) {
        val a = kotlin.math.log2(BAND_FREQS[i])
        val b = kotlin.math.log2(BAND_FREQS[i + 1])
        if (lf in a..b) {
            val t = (lf - a) / (b - a)
            // Cosinus-Interpolation -> weicher Kurvenverlauf ohne Knicke
            val s = (1 - kotlin.math.cos(t * Math.PI).toFloat()) / 2f
            return gains[i] * (1 - s) + gains[i + 1] * s
        }
    }
    return 0f
}
