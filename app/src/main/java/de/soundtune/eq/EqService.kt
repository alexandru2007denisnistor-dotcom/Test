package de.soundtune.eq

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.audiofx.AudioEffect
import android.os.Build
import android.os.IBinder

/** Hält den EQ im Hintergrund am Leben, während Spotify läuft. */
class EqService : Service() {
    private val receiver = SessionReceiver()

    override fun onCreate() {
        super.onCreate()
        val filter = IntentFilter().apply {
            addAction(AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION)
            addAction(AudioEffect.ACTION_CLOSE_AUDIO_EFFECT_CONTROL_SESSION)
        }
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        else registerReceiver(receiver, filter)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val settings = EqSettings(this)
        if (intent?.action == ACTION_STOP) {
            EqEngine.releaseAll()
            stopSelf()
            return START_NOT_STICKY
        }
        startForegroundCompat(buildNotification(settings))
        // Globaler Mix (Session 0) – greift auf vielen Geräten für alle Apps
        EqEngine.attach(0, "Global", settings)
        EqEngine.apply(settings)
        return START_STICKY
    }

    private fun startForegroundCompat(n: Notification) {
        if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        else startForeground(1, n)
    }

    private fun buildNotification(s: EqSettings): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Equalizer", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, EqService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE
        )
        val text = if (s.customized) "Eigene Kurve · ${Headphones.byId(s.headphoneId).name}"
        else "${Profiles.byId(s.profileId).name} · ${Headphones.byId(s.headphoneId).name}"
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_silent_mode_off)
            .setContentTitle(if (s.enabled) "SoundTune EQ aktiv" else "SoundTune EQ pausiert")
            .setContentText(text)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, "Beenden", stop).build())
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        runCatching { unregisterReceiver(receiver) }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL = "eq"
        const val ACTION_STOP = "de.soundtune.eq.STOP"

        fun start(context: Context) {
            runCatching { context.startForegroundService(Intent(context, EqService::class.java)) }
        }
    }
}
