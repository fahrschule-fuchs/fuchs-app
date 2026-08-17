# FUCHS Apps — von der PWA zur Store-App

Dieses Paket macht aus den beiden bestehenden PWAs zwei native Apps für iOS und
Android. Der bestehende Code wird **nicht umgeschrieben** — er wird gebündelt und
bekommt Zugriff auf natives Push, Kamera und Offline-Start.

Getestet: Beide Bundles wurden gebaut, in einem echten Browser geladen und geprüft.
Sie starten ohne JavaScript-Fehler, alle Serveraufrufe gehen korrekt an
`app.fahrsyn.de`, und die Push-Anmeldung läuft über den nativen Weg.

---

## In fünf Minuten zum ersten Build

```bash
# 1. Originaldateien aus Dropbox "Fuchs-App/app-phone/" nach quellen/ kopieren
#    (index.html, fahrlehrer_bereich.html und alle *.png)

npm run build      # erzeugt apps/*/www aus den Originaldateien
npm run pruefe     # prüft das Ergebnis auf die üblichen Fallstricke
npm run rauchtest  # lädt beide Apps in einem echten Browser (optional, braucht Playwright)
```

Danach je App einmalig:

```bash
cd apps/schueler
npm install
npx cap add ios
npx cap add android
npx cap sync
npx cap open ios        # bzw. android
```

Ab dann genügt bei jeder Änderung an der PWA:

```bash
npm run sync            # build + prüfen + beide Apps aktualisieren
```

---

## Was das Build-Skript tut

Es liest die Originaldateien und wendet eine kurze, in `build.config.json`
dokumentierte Liste von Änderungen an. Nichts davon geschieht im Verborgenen —
jeder Schritt wird beim Bauen ausgegeben.

| | Fahrschüler-App | Fahrlehrer-App |
|---|---|---|
| Boot-Skript vorangestellt | ✔ | ✔ |
| Manifest-Verweis entfernt (erzeugt sonst 404) | ✔ | ✔ |
| Bildpfade auf gebündelte Dateien umgebogen | — | ✔ (`/app/…png` → `…png`) |
| Video-Fallback auf absolute Adresse | ✔ | — |
| Link zur Fahrlehrer-App absolut | ✔ | — |
| Fehlende CSS-Klasse `.row` ergänzt | — | ✔ (kosmetischer Fehler im Original) |

Die Originaldateien in `quellen/` bleiben unangetastet.

---

## Was das Boot-Skript zur Laufzeit übernimmt

`shared/fuchs-native.js` wird als erstes Skript geladen und regelt vier Dinge, ohne
dass eine einzige Zeile eures App-Codes angefasst werden muss:

**Adressen.** Die Fahrschüler-App ruft ihre 21 Endpunkte relativ auf (`fetch("konto")`),
die Fahrlehrer-App über eine `API`-Konstante mit `/app/`. In der App liegen die
Dateien lokal, beides würde ins Leere zeigen. Ein Wrapper um `fetch` und
`XMLHttpRequest` biegt jede Adresse auf `app.fahrsyn.de` um.

**Push.** In einer Capacitor-App gibt es keinen Service Worker — auf iOS gar kein
Web-Push, auf Android nur eingeschränkt. Das Boot-Skript stellt der App eine
Attrappe hin, die sich nach außen wie die Web-Push-Schnittstelle verhält, innen
aber APNs bzw. FCM anspricht. Der bestehende Button „🔔 Benachrichtigungen
aktivieren" funktioniert dadurch unverändert; die Anmeldung landet nur auf einem
neuen Endpunkt (`push/native`).

**Externe Links.** WhatsApp-, Karten- und Telefonlinks öffnen im System statt in
der App. Ohne das hängt der Nutzer in einer fremden Seite fest — Apple prüft genau
diesen Fall.

**App-Verhalten.** Android-Zurück-Taste, Statusleiste in Fuchs-Orange,
Startbildschirm, und ein Hinweisbalken bei fehlender Verbindung. Letzteres ist neu:
Bisher schlucken beide Apps Netzfehler stillschweigend und bleiben bei „Lädt …"
stehen.

---

## Serverseite

Zwei Dinge müssen auf `fuchs-prod-1` ergänzt werden — beides in
`server/fuchs_push_nativ.py` fertig vorbereitet:

**CORS.** Der Web-Inhalt läuft in der App unter `capacitor://localhost` bzw.
`https://localhost`, nicht unter `app.fahrsyn.de`. Ohne Freigabe schlägt jeder
Aufruf fehl — und zwar lautlos, weil beide Apps Netzfehler abfangen. Das ist der
Fehler, den man sonst stundenlang sucht.

**Zwei neue Endpunkte** für die nativen Gerätetoken, plus Versandfunktionen für
APNs (iOS, `.p8`-Schlüssel) und FCM (Android). Der bestehende Web-Push-Weg für die
Browser-PWA bleibt vollständig erhalten.

Einbinden:

```python
from fuchs_push_nativ import push_nativ_registrieren, sende_push
push_nativ_registrieren(app)
```

---

## Wichtig vor der Einreichung

`server/demo-zugang.md` lesen. Ohne funktionierenden Prüfer-Zugang werden beide
Apps abgelehnt — das ist bei einer Anmeldung per WhatsApp-Nummer der wahrscheinlichste
Ablehnungsgrund überhaupt. Die gute Nachricht: Beide Apps haben bereits einen Weg
ohne WhatsApp, es müssen nur zwei Datensätze angelegt werden.

---

## Ordnerübersicht

| Ordner / Datei | Inhalt |
|---|---|
| `build.config.json` | Alle projektspezifischen Einstellungen. Nur hier wird angepasst. |
| `quellen/` | Die unveränderten Originaldateien der PWAs |
| `scripts/build-www.mjs` | Erzeugt die App-Bundles |
| `scripts/pruefe.mjs` | Prüft Bundle und Konfiguration |
| `scripts/rauchtest.mjs` | Lädt beide Apps in einem echten Browser |
| `shared/fuchs-native.js` | Das Boot-Skript |
| `apps/schueler/`, `apps/fahrlehrer/` | Je ein Capacitor-Projekt |
| `marke/` | App-Icons 1024×1024 und Startbildschirme, fertig erzeugt |
| `server/` | Flask-Ergänzungen und die Anleitung zum Demo-Zugang |
| `store/` | Store-Texte, Screenshot-Formate, Checkliste, Prüfer-Notizen |
| `ENTSCHEIDUNGEN.md` | Was ich entschieden habe und warum |

---

## Bekannte Punkte

- **Icons sind hochgerechnet.** Aus dem vorhandenen 512er-PNG auf 1024 skaliert.
  Funktioniert, wird aus der Vektordatei (`Fuchs AI Rohdatei.ai`) aber sichtbar
  schärfer. Danach `npm run icons` je App.
- **Fahrlehrer-Anmeldung wird nicht gespeichert.** Kürzel und PIN liegen nur in
  JavaScript-Variablen, nach jedem App-Neustart ist die Anmeldung weg. In einer App
  fällt das stärker auf als im Browser. Sauber gelöst wäre ein Sitzungstoken
  serverseitig statt der PIN bei jedem Aufruf — das ist ein eigener kleiner Umbau
  und keine Voraussetzung für die Einreichung.
- **Der Team-Zugangscode wird nur im Browser geprüft.** Siehe `server/demo-zugang.md`.
- **Videos kommen weiter vom CDN.** Das ist richtig so; sie gehören nicht ins
  App-Bundle. Das `<meta name="referrer" content="no-referrer">` im Original muss
  erhalten bleiben, sonst blockt der Hotlinkschutz die Streams.
