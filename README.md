# ProEdit – Video-Editor für Android

Mobiler Video-Editor im Stil von CapCut: mehrspurige Timeline, Filter, Übergänge, Text, Musik und Export bis 4K.
Gebaut mit Kotlin, Jetpack Compose und Google Media3 (ExoPlayer + Transformer, GPU-beschleunigt).

**APK:** [`dist/ProEdit-v1.0.0.apk`](dist/ProEdit-v1.0.0.apk) (Android 8.0+)

## Funktionen

**Timeline**
- Mehrspurig: Video-/Fotospur, bis zu 3 Text-/Sticker-Spuren, bis zu 3 Audiospuren
- Playhead in der Mitte wie bei CapCut, Wischen zum Spulen, Pinch-Zoom
- Trimm-Griffe für Clips, Texte und Audio; Texte/Audio per Drag verschieben
- Thumbnails, Tempo-/Stumm-/Filter-Badges, Übergangsknöpfe direkt auf den Schnitten
- Rückgängig/Wiederholen (80 Schritte), automatisches Speichern

**Clip-Werkzeuge**
- Teilen, Duplizieren, Löschen, Reihenfolge ändern
- Tempo 0,1x–10x (Tonhöhe bleibt beim Export erhalten)
- Lautstärke 0–200 %, Ein-/Ausblenden, Stummschalten
- 17 Filter mit Intensität (Kino, Teal & Orange, Vintage, Noir …)
- Anpassen: Helligkeit, Kontrast, Sättigung, Temperatur, Tönung, Farbton – „Auf alle anwenden“
- Transformieren: Drehen, Spiegeln, Zoom, Position
- Übergänge: Abblenden, Blitz, Zoom, Drehen, Wischen (Dauer einstellbar, „Auf alle“)
- Standbild (Freeze Frame), Ton extrahieren
- Fotos als Clips mit einstellbarer Dauer

**Text & Sticker**
- Freier Text, 8 Schriften, Fett/Kursiv, Ausrichtung, Farbe, Kontur, Hintergrund, Schatten
- In der Vorschau verschieben, mit zwei Fingern skalieren und drehen
- Animationen: Einblenden, Pop, Hochgleiten, Schreibmaschine
- 64 Emoji-Sticker

**Audio**
- Musik/Sounds importieren, Ton aus anderen Videos übernehmen
- Voiceover direkt aufnehmen, während das Video läuft
- Lautstärke und Fades pro Audiospur

**Projekt & Export**
- Formate 9:16, 16:9, 1:1, 4:5, 3:4, 4:3, 21:9; Einpassen oder Füllen
- Export 480p, 720p, 1080p, 2K, 4K; 24–60 fps; 4 Qualitätsstufen; H.264 oder H.265
- HDR-Videos werden automatisch nach SDR umgewandelt
- Speichern unter *Filme/ProEdit*, direkt teilen
- Videos aus anderen Apps per „Teilen → ProEdit“ öffnen

## Bauen

```bash
./gradlew :app:assembleRelease     # APK: app/build/outputs/apk/release/app-release.apk
./gradlew :app:testReleaseUnitTest # Unit-Tests der Schnitt-, Farb- und Exportlogik
```

Benötigt JDK 17+ und das Android SDK (Plattform 35). Signiert wird mit `keystore/proedit-release.jks`
(Passwort steht in `app/build.gradle.kts`). Das ist nur für den privaten Gebrauch gedacht – vor einer
Veröffentlichung im Play Store einen eigenen, geheimen Schlüssel verwenden.

## Architektur

| Bereich | Datei |
|---|---|
| Datenmodell, JSON | `model/Project.kt` |
| Schnittoperationen (pure Functions, getestet) | `model/ProjectOps.kt` |
| Farb-, Übergangs-, Text-Animations-Mathematik (Vorschau = Export) | `engine/Look.kt` |
| Echtzeit-Vorschau (ExoPlayer + synchronisierte Audio-Player) | `engine/PreviewEngine.kt` |
| Export (Media3 Transformer, eigene GPU-Effekte, Audio-Hüllkurve) | `engine/Exporter.kt`, `engine/ExportEffects.kt` |
| Timeline, Vorschau, Panels | `ui/` |
