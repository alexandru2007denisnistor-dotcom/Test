package de.soundtune.eq

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.*
import java.util.Locale

class MainActivity : Activity() {
    private lateinit var s: EqSettings
    private lateinit var curve: CurveView
    private lateinit var status: TextView
    private lateinit var hpDesc: TextView
    private lateinit var profDesc: TextView
    private lateinit var preampSeek: SeekBar
    private lateinit var preampValue: TextView
    private val bandSeeks = arrayOfNulls<SeekBar>(10)
    private val bandValues = arrayOfNulls<TextView>(10)
    private val profileButtons = mutableListOf<TextView>()
    private val hpButtons = mutableListOf<TextView>()
    private var suppress = false

    private val accent = 0xFFE8B04B.toInt()
    private val card = 0xFF1A1C23.toInt()
    private val textMain = 0xFFF2F2F5.toInt()
    private val textDim = 0xFF9A9CA8.toInt()
    private val dp by lazy { resources.displayMetrics.density }
    private fun px(v: Int) = (v * dp).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        s = EqSettings(this)
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        setContentView(buildUi())
        refreshAll()
        EqService.start(this)
    }

    override fun onResume() {
        super.onResume()
        EqEngine.listener = { runOnUiThread { refreshStatus() } }
        refreshStatus()
    }

    override fun onPause() {
        EqEngine.listener = null
        super.onPause()
    }

    // ---------- UI ----------

    private fun buildUi(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(px(16), px(20), px(16), px(32))
        }
        root.addView(text("SoundTune EQ", 26f, textMain, bold = true))
        root.addView(text("Studio-Sound & Bass für Spotify", 14f, textDim).apply { setPadding(0, 0, 0, px(14)) })

        // Hauptschalter + Status
        val top = cardLayout()
        val sw = Switch(this).apply {
            text = "Equalizer aktiv"
            setTextColor(textMain); textSize = 17f
            isChecked = s.enabled
            thumbTintList = ColorStateList.valueOf(accent)
            trackTintList = ColorStateList.valueOf(0x66E8B04B)
            setOnCheckedChangeListener { _, c -> s.enabled = c; push() }
        }
        top.addView(sw)
        status = text("", 13f, textDim).apply { setPadding(0, px(6), 0, 0) }
        top.addView(status)
        root.addView(top)

        // Kopfhörer
        root.addView(section("Kopfhörer"))
        val hpCard = cardLayout()
        val hpGroup = chipGroup()
        Headphones.all.forEach { h ->
            val b = chip(h.name) { s.headphoneId = h.id; loadPreset() }
            b.tag = h.id; hpButtons += b; hpGroup.addView(b)
        }
        hpCard.addView(hpGroup)
        hpDesc = text("", 13f, textDim).apply { setPadding(0, px(8), 0, 0) }
        hpCard.addView(hpDesc)
        root.addView(hpCard)

        // Profil
        root.addView(section("Sound-Profil"))
        val pCard = cardLayout()
        val pGroup = chipGroup()
        Profiles.all.forEach { p ->
            val b = chip(p.name) { s.profileId = p.id; loadPreset() }
            b.tag = p.id; profileButtons += b; pGroup.addView(b)
        }
        pCard.addView(pGroup)
        profDesc = text("", 13f, textDim).apply { setPadding(0, px(8), 0, 0) }
        pCard.addView(profDesc)
        root.addView(pCard)

        // Kurve + Regler
        root.addView(section("Frequenzgang"))
        val eqCard = cardLayout()
        curve = CurveView(this)
        eqCard.addView(curve)
        for (i in 0 until 10) eqCard.addView(bandRow(i))

        val pre = row()
        pre.addView(text("Preamp", 13f, textMain).apply { layoutParams = LinearLayout.LayoutParams(px(58), WRAP_CONTENT) })
        preampSeek = seek(240) { v, user ->
            if (user) { s.autoPreamp = false; s.manualPreamp = (v - 120) / 10f; refreshPreamp(); push() }
        }
        pre.addView(preampSeek)
        preampValue = text("", 13f, accent).apply { layoutParams = LinearLayout.LayoutParams(px(64), WRAP_CONTENT); gravity = Gravity.END }
        pre.addView(preampValue)
        eqCard.addView(pre)

        eqCard.addView(check("Auto-Preamp (verhindert Übersteuern)", s.autoPreamp) { s.autoPreamp = it; refreshPreamp(); push() })
        eqCard.addView(check("Limiter (schützt bei starkem Bass)", s.limiter) { s.limiter = it; push() })

        val reset = Button(this).apply {
            text = "Preset wiederherstellen"
            setTextColor(0xFF111111.toInt()); isAllCaps = false
            background = rounded(accent, 12)
            setOnClickListener { loadPreset() }
        }
        eqCard.addView(reset, LinearLayout.LayoutParams(MATCH_PARENT, px(46)).apply { topMargin = px(10) })
        root.addView(eqCard)

        // Tipps
        root.addView(section("Mehr Qualität rausholen"))
        val tips = cardLayout()
        tips.addView(text(TIPS, 13.5f, textMain).apply { setLineSpacing(0f, 1.25f) })
        root.addView(tips)

        return ScrollView(this).apply { addView(root); setBackgroundColor(0xFF0E0F13.toInt()) }
    }

    private fun bandRow(i: Int): View {
        val r = row()
        val f = BAND_FREQS[i]
        val lbl = if (f >= 1000) "${(f / 1000).toInt()} kHz" else "${f.toInt()} Hz"
        r.addView(text(lbl, 13f, textMain).apply { layoutParams = LinearLayout.LayoutParams(px(58), WRAP_CONTENT) })
        val sb = seek(240) { v, user ->
            if (!user || suppress) return@seek
            val g = s.gains; g[i] = (v - 120) / 10f; s.gains = g; s.customized = true
            bandValues[i]?.text = fmt(g[i]); curve.gains = g; refreshPreamp(); refreshChips(); push()
        }
        bandSeeks[i] = sb
        r.addView(sb)
        val v = text("", 13f, accent).apply { layoutParams = LinearLayout.LayoutParams(px(64), WRAP_CONTENT); gravity = Gravity.END }
        bandValues[i] = v
        r.addView(v)
        return r
    }

    // ---------- Logik ----------

    private fun loadPreset() {
        s.gains = combine(Headphones.byId(s.headphoneId), Profiles.byId(s.profileId))
        s.customized = false
        refreshAll(); push()
    }

    private fun push() {
        EqEngine.apply(s)
        EqService.start(this) // Benachrichtigung aktualisieren
        refreshStatus()
    }

    private fun refreshAll() {
        suppress = true
        val g = s.gains
        for (i in 0 until 10) {
            bandSeeks[i]?.progress = (g[i] * 10).toInt() + 120
            bandValues[i]?.text = fmt(g[i])
        }
        suppress = false
        curve.gains = g
        hpDesc.text = Headphones.byId(s.headphoneId).description
        profDesc.text = Profiles.byId(s.profileId).description
        refreshPreamp(); refreshChips(); refreshStatus()
    }

    private fun refreshPreamp() {
        val p = s.effectivePreamp()
        preampSeek.progress = (p * 10).toInt() + 120
        preampValue.text = fmt(p) + if (s.autoPreamp) " A" else ""
    }

    private fun refreshChips() {
        hpButtons.forEach { styleChip(it, it.tag == s.headphoneId) }
        profileButtons.forEach { styleChip(it, !s.customized && it.tag == s.profileId) }
    }

    private fun refreshStatus() {
        if (!::status.isInitialized) return
        val sessions = EqEngine.activeSessions()
        val spotify = sessions.any { it.second.contains("spotify") }
        val sb = StringBuilder()
        sb.append(if (s.enabled) "● Läuft" else "○ Pausiert")
        sb.append(" · ").append(if (sessions.isEmpty()) "keine Audio-Session" else sessions.joinToString { if (it.first == 0) "Global" else it.second.substringAfterLast('.') })
        if (!spotify) sb.append("\nSpotify noch nicht erkannt – einfach einen Song in Spotify starten.")
        else sb.append("\n✓ Spotify erkannt")
        EqEngine.lastError?.let { if (sessions.isEmpty()) sb.append("\n⚠ ").append(it) }
        status.text = sb
    }

    // ---------- Helfer ----------

    private fun fmt(v: Float) = String.format(Locale.GERMANY, "%+.1f dB", v)

    private fun text(t: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        text = t; textSize = size; setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    private fun section(t: String) = text(t.uppercase(), 12f, accent, bold = true).apply {
        letterSpacing = 0.12f; setPadding(px(4), px(18), 0, px(8))
    }

    private fun rounded(color: Int, r: Int) = GradientDrawable().apply { setColor(color); cornerRadius = r * dp }

    private fun cardLayout() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = rounded(card, 18)
        setPadding(px(16), px(14), px(16), px(14))
    }

    private fun row() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(0, px(2), 0, px(2))
    }

    private fun seek(max: Int, onChange: (Int, Boolean) -> Unit) = SeekBar(this).apply {
        this.max = max
        layoutParams = LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f)
        progressTintList = ColorStateList.valueOf(accent)
        thumbTintList = ColorStateList.valueOf(accent)
        progressBackgroundTintList = ColorStateList.valueOf(0x44FFFFFF)
        setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar, p: Int, fromUser: Boolean) = onChange(p, fromUser)
            override fun onStartTrackingTouch(sb: SeekBar) {}
            override fun onStopTrackingTouch(sb: SeekBar) {}
        })
    }

    private fun check(t: String, value: Boolean, onChange: (Boolean) -> Unit) = CheckBox(this).apply {
        text = t; setTextColor(textMain); isChecked = value
        buttonTintList = ColorStateList.valueOf(accent)
        setOnCheckedChangeListener { _, c -> onChange(c) }
    }

    /** Einfache umbrechende Chip-Gruppe (vertikal gestapelt, volle Breite – gut am Handy). */
    private fun chipGroup() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

    private fun chip(t: String, onClick: () -> Unit) = TextView(this).apply {
        text = t; textSize = 14.5f
        setPadding(px(14), px(11), px(14), px(11))
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = px(6) }
        setOnClickListener { onClick() }
    }

    private fun styleChip(v: TextView, selected: Boolean) {
        v.background = GradientDrawable().apply {
            cornerRadius = 12 * dp
            if (selected) setColor(0x33E8B04B) else setColor(0xFF22252E.toInt())
            setStroke(px(1), if (selected) accent else 0x22FFFFFF)
        }
        v.setTextColor(if (selected) accent else textMain)
        v.typeface = if (selected) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        refreshAll()
    }

    companion object {
        private val TIPS = """
            1. Spotify → Einstellungen → Audioqualität: WLAN & Mobil auf „Lossless“ (Premium) bzw. „Sehr hoch“, Download ebenfalls.
            2. Spotify → Wiedergabe → „Equalizer“ AUS lassen (sonst doppelte Bearbeitung). Tippst du dort auf „Equalizer“, öffnet sich SoundTune.
            3. „Lautstärke normalisieren“ aus – oder auf „Normal“, nie „Laut“ (komprimiert die Dynamik).
            4. Soundcore-App (Space One) / EarFun-App: Codec „LDAC“ bzw. „Hi-Res“ aktivieren und deren eigenen EQ neutral stellen.
            5. Entwickleroptionen → Bluetooth-Audio-LDAC-Codec: „Audioqualität optimiert (990 kbit/s)“.
            6. Beim Space One ANC für Musik nutzen – Transparenzmodus färbt den Klang.
            7. Ein In-Ear klingt nur mit dichtem Sitz bassig: probier die verschiedenen Aufsatzgrößen.
            8. Erkennt die App Spotify nicht: einmal einen Song neu starten. Manche Hersteller (z. B. Xiaomi) brauchen „Autostart“/keine Akku-Optimierung für SoundTune.
        """.trimIndent()
    }
}
