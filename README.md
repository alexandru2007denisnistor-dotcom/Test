# 🎧 Klangwerk

**Spotify, YouTube Music und Deezer in einer App.** Ein Suchfeld durchsucht alle drei Kataloge gleichzeitig. Gleiche Songs werden erkannt und zusammengefasst, und ein gemeinsamer Player spielt jeden Song über den Dienst ab, den du bevorzugst.

## Funktionen

- **Eine Suche, drei Kataloge:** Treffer von Spotify, YouTube Music und Deezer erscheinen in einer Liste. Ein Song, den es auf mehreren Diensten gibt, steht nur einmal da, mit Abzeichen für jeden Dienst (Erkennung über ISRC-Code, Künstler/Titel und Laufzeit).
- **Gemeinsamer Player:** Wiedergabe, Pause, Vor/Zurück, Spulen, Zufall, Wiederholen, Warteschlange, Medientasten und Sperrbildschirm.
- **Freie Quellenwahl:** Du legst eine Reihenfolge fest, z. B. „erst YouTube, dann Spotify, dann Deezer“. Gibt es einen Song auf deiner Lieblingsquelle nicht, sucht Klangwerk ihn dort automatisch. Ein Tipp auf ein Abzeichen spielt gezielt über diesen Dienst.
- **Automatischer Rückfall:** Ist ein Video nicht einbettbar oder ein Dienst gestört, wird die nächste Quelle versucht.
- **Charts und Genres** (über Deezer, ganz ohne Schlüssel).
- **Bibliothek:** Lieblingssongs, eigene Playlists mit Songs aus allen Diensten gemischt, Verlauf, Export/Import als Datei.
- **Für Handy und Desktop:** responsiv, helles und dunkles Design, als App installierbar (PWA).

## Schnellstart

Du brauchst [Node.js](https://nodejs.org) ab Version 18. Weitere Pakete sind nicht nötig.

```bash
npm start
```

Dann im Browser **http://localhost:3000** öffnen.

Ohne weitere Einrichtung ist **Deezer** schon aktiv (Suche, Charts, 30-Sekunden-Vorschauen). Für die richtig große Auswahl richtest du zusätzlich Spotify und YouTube ein:

```bash
cp .env.example .env    # dann Schlüssel eintragen und Server neu starten
```

### Spotify einrichten (kostenlos, ca. 5 Minuten)

1. Auf https://developer.spotify.com/dashboard anmelden und **„Create app“** wählen.
2. Name und Beschreibung beliebig. Als Redirect-URI z. B. `http://127.0.0.1:3000` eintragen (wird nicht genutzt, ist aber Pflicht). Bei den APIs **„Web API“** ankreuzen.
3. In den App-Einstellungen **Client ID** und **Client Secret** kopieren und in `.env` eintragen:
   ```
   SPOTIFY_CLIENT_ID=...
   SPOTIFY_CLIENT_SECRET=...
   ```

> Hinweis: Spotify hat 2026 die Regeln für Entwickler-Apps verschärft. Die Suche liefert jetzt höchstens 10 Treffer pro Anfrage (Klangwerk lädt deshalb 2 Seiten), und für den Entwicklermodus kann ein Premium-Konto nötig sein.

### YouTube einrichten (kostenlos, ca. 5 Minuten)

1. Auf https://console.cloud.google.com ein Projekt anlegen.
2. Unter **„APIs & Dienste → Bibliothek“** die **„YouTube Data API v3“** aktivieren.
3. Unter **„Anmeldedaten“** einen **API-Schlüssel** erstellen (am besten auf die YouTube Data API beschränken) und eintragen:
   ```
   YOUTUBE_API_KEY=...
   ```

> **Kontingent:** Ein Standard-Schlüssel erlaubt etwa **100 YouTube-Suchen pro Tag**. Darum geht Klangwerk sparsam damit um:
> - Beim Tippen werden nur Spotify und Deezer durchsucht, YouTube erst nach **Enter**.
> - Ergebnisse werden 12 bis 24 Stunden zwischengespeichert.
> - Die automatische Suche fehlender Quellen lässt sich in den Einstellungen abschalten.

### Auf dem Handy nutzen

Setze in `.env` `HOST=0.0.0.0`, starte neu und öffne auf dem Handy `http://<IP-deines-Rechners>:3000` (gleiches WLAN). Über „Zum Startbildschirm hinzufügen“ wird daraus eine App.

## Wie die Wiedergabe funktioniert

Klangwerk nutzt ausschließlich die **offiziellen Player** der Dienste. Es wird nichts heruntergeladen oder mitgeschnitten.

| Dienst | Was du hörst | Wie |
|---|---|---|
| **YouTube Music** | komplette Songs | offizieller YouTube-Player (als Video sichtbar, so verlangen es die YouTube-Regeln) |
| **Spotify** | komplette Songs, wenn du im selben Browser bei Spotify angemeldet bist, sonst eine Vorschau | offizieller Spotify-Embed-Player |
| **Deezer** | 30-Sekunden-Vorschau | öffentliche Vorschau-Datei |

**Empfehlung:** Lass YouTube an erster Stelle (Standard). So läuft fast jeder Song komplett, auch Treffer, die ursprünglich nur von Spotify oder Deezer kamen.

Grenzen, die von den Diensten vorgegeben sind:

- Bei Spotify lässt sich die Lautstärke nur im Spotify-Player selbst regeln. Manche Browser verlangen beim ersten Song einen Tipp auf ▶ im Spotify-Player.
- Deezer erlaubt Drittanbietern nur Vorschauen.
- „YouTube Music“ hat keine eigene öffentliche Schnittstelle. Klangwerk durchsucht deshalb die Musik-Kategorie von YouTube und öffnet Links in YouTube Music.

## Aufbau

```
server.js                 HTTP-Server: liefert die App aus und stellt /api bereit
src/
  api.js                  API-Routen: Suche, Charts, Genres, Nachauflösung, Cache
  merge.js                Erkennen und Zusammenführen gleicher Songs
  cache.js                Zwischenspeicher mit Ablaufzeit (schont Kontingente)
  providers/
    spotify.js            Spotify Web API (Client-Credentials, Secret bleibt auf dem Server)
    youtube.js            YouTube Data API v3 (Kategorie Musik)
    deezer.js             Deezer API (ohne Schlüssel)
public/
  index.html, styles.css  Oberfläche
  js/app.js               Ansichten, Suche, Menüs
  js/player.js            ein Player mit drei Adaptern (YouTube, Spotify, Deezer)
  js/store.js             Bibliothek und Einstellungen (localStorage)
test/                     automatische Tests (node --test)
```

API-Endpunkte:

| Endpunkt | Zweck |
|---|---|
| `GET /api/status` | welche Dienste eingerichtet sind |
| `GET /api/search?q=…&sources=spotify,deezer,youtube` | vereinte Suche |
| `GET /api/charts?genre=0` | Charts (Deezer-Genre-ID) |
| `GET /api/genres` | Genre-Liste |
| `GET /api/resolve?provider=youtube&title=…&artist=…&isrc=…` | Song nachträglich auf einem Dienst finden |
| `GET /api/deezer/track/:id` | frischer Vorschau-Link |

## Tests

```bash
npm test
```

Die Tests prüfen das Zusammenführen (z. B. „Remastered 2011“, „feat.“, Musikvideos mit Intro, Remix ≠ Original), die drei Dienst-Anbindungen mit simulierten Antworten (Token, Seitenaufteilung, Kontingent, Fehler) und die API samt Schutz vor Pfad-Ausbrüchen.

## Datenschutz

- Die API-Schlüssel bleiben auf dem Server und erreichen nie den Browser.
- Bibliothek, Playlists und Verlauf liegen nur im `localStorage` deines Browsers. Es gibt kein Konto und keine Cloud.
- Mit Export/Import nimmst du deine Bibliothek auf ein anderes Gerät mit.
