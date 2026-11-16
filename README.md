# GlassGym 🏋️

Trainingsplan-, Ernährungs- und Gym-Kalender-App im **Liquid-Glass-Design**: ein in Echtzeit gerenderter, animierter Hintergrund, Glaseffekte mit Lichtreflexen, Federanimationen und Konfetti.

## Funktionen

- **Trainingsplan**: Für jeden Wochentag Name, Muskelgruppen und Übungen mit Sätzen, Wiederholungen und kg festlegen. Fertige Vorlagen: Push/Pull/Legs, Upper/Lower, Ganzkörper.
- **Übungsvorschläge**: Über 70 Übungen in 11 Muskelgruppen, mit Equipment, Schwierigkeit und Technik-Tipp. Im Tages-Editor kommen passende Vorschläge zu den gewählten Muskelgruppen (🔀 Andere, ✨ Auto).
- **Ernährung**: Mahlzeiten, Getränke und Supplements tracken: kcal, Protein, Kohlenhydrate, Fett, Flüssigkeit und Koffein. Ein Pre-Workout-Eintrag zeigt Uhrzeit und Koffein in mg. Vorlagen für Kreatin, Whey, Kaffee, Energy Drinks usw. Warnung bei zu viel Koffein.
- **Kalender**: Gym-Besuche eintragen, mit Notiz. Statistik für die Woche, den Monat und den Wochen-Streak.
- **Erinnerungen**: Eine tägliche Benachrichtigung zur eingestellten Uhrzeit mit dem Training für heute, morgen und übermorgen. Dazu gibt es einen **.ics-Export** in die Kalender-App (wöchentliche Termine mit Erinnerung 1 Tag und 2 Stunden vorher).
- Offline-fähig (PWA). Alle Daten bleiben lokal auf dem Gerät. Backup und Import als JSON.

## Starten

Kein Build nötig. Lokal zum Beispiel so:

```bash
python3 -m http.server 8080
# → http://localhost:8080
```

Hosting, etwa auf GitHub Pages: Repository → Settings → Pages → Branch auswählen. Danach die Seite auf dem Handy öffnen und **„Zum Home-Bildschirm“** wählen.

## Android-App (APK)

Die Web-App wird mit [Capacitor](https://capacitorjs.com) als native Android-App verpackt (`android/`). In der App:

- **Echte Erinnerungen über Android**: Die täglichen Benachrichtigungen werden für die nächsten 14 Tage beim System eingeplant. Sie kommen also auch, wenn die App geschlossen ist, und werden bei jedem Öffnen aktualisiert.
- Backup und Kalender-Export öffnen das Android-Teilen-Menü (z. B. direkt in den Google Kalender).
- Die Zurück-Taste schließt Dialoge und springt zu „Heute“.

APK selbst bauen (benötigt Node 22+, JDK 21 und das Android SDK mit Plattform 36):

```bash
npm install
npm run android:apk
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Die APK wird mit `android/app/glassgym-debug.keystore` signiert (Passwort `android`). Weil der Schlüssel im Repo liegt, lassen sich neue Versionen über die alte installieren, ohne die Daten zu verlieren. Für eine Veröffentlichung im Play Store braucht es einen eigenen, geheimen Release-Schlüssel.

## Hinweis zu Push-Nachrichten

- **iPhone**: Benachrichtigungen gehen nur, wenn die App über Safari zum Home-Bildschirm hinzugefügt wurde (ab iOS 16.4). Die tägliche Erinnerung wird ausgelöst, sobald die App geöffnet oder im Hintergrund aktiv ist. Zuverlässig im geschlossenen Zustand erinnert der **Kalender-Export (.ics)**.
- **Android-App (APK)**: Echte, vom System geplante Benachrichtigungen, siehe oben.
- **Android/Chrome (Web)**: Bei installierter Web-App wird zusätzlich Periodic Background Sync genutzt.
- Echte Server-Pushes sind im Service Worker vorbereitet (`push`-Event). Dafür braucht es einen Push-Server.
