# Die offenen Entscheidungen — entschieden und begründet

Du warst dir bei drei der vier Fragen unsicher. Ich habe sie entschieden, damit
das Projekt läuft. Jede Entscheidung ist umkehrbar, solange nichts eingereicht ist.
Wo eine Angabe von dir fehlt, steht das ausdrücklich dabei.

---

## 1. Marke — deine Entscheidung: FUCHS jetzt, FahrSyn später

**Umgesetzt so:** Der sichtbare Name ist FUCHS, die technische Kennung ist neutral.

| | Fahrschüler | Fahrlehrer |
|---|---|---|
| Name im Store | `FUCHS` | `FUCHS Fahrlehrer` |
| Technische Kennung (appId) | `de.fahrsyn.fuchs` | `de.fahrsyn.fuchs.fahrlehrer` |

Der Anzeigename lässt sich später jederzeit ändern — die appId **nie**. Deshalb
steht dort schon heute `fahrsyn`. Wenn ihr in zwei Jahren auf FahrSyn umstellt,
ist das ein reiner Namenswechsel im Store: gleiche App, gleiche Nutzer, gleiche
Bewertungen, kein Neustart bei null.

---

## 2. Technischer Weg — meine Entscheidung: Capacitor für beide Plattformen

Im Übergabeprotokoll stand „Android per TWA zuerst" als schneller Weg. Nach der
Durchsicht eures Codes rate ich davon ab. Drei Gründe, alle nachprüfbar:

**Der Service Worker cacht nichts.** `sw.js` enthält ausschließlich Push-Logik,
keine einzige Zeile Caching. Ein TWA-Kandidat muss aber im Lighthouse-PWA-Test
mindestens 80 Punkte erreichen, und Offline-Fähigkeit ist dort ein Pflichtkriterium.
Ihr müsstet den Service Worker erst umbauen — Aufwand, der beim Capacitor-Weg
komplett entfällt, weil dort ohnehin alles lokal liegt.

**`assetlinks.json` fehlt.** Ich habe nachgesehen: `app.fahrsyn.de/.well-known/assetlinks.json`
antwortet mit 404. Ohne diese Datei zeigt der TWA die Browser-Adressleiste — und
Google wertet eine fehlgeschlagene Prüfung als Absturz. Das lässt sich einrichten,
ist aber wieder Arbeit, die nur für den TWA-Weg anfällt.

**Zwei Wege heißt doppelte Pflege.** Für iOS braucht ihr Capacitor ohnehin. Ein
zweiter, andersartiger Build-Weg für Android bedeutet dauerhaft zwei Systeme, in
denen Dinge auseinanderlaufen können.

Der Zeitvorteil des TWA liegt bei vielleicht drei Tagen. Der Mehraufwand über die
nächsten Jahre ist größer. Deshalb: **ein Weg, beide Plattformen.**

---

## 3. Entwicklerkonten — meine Empfehlung: Firma, mit einer Rückfrage an dich

Ich weiß nicht, ob hinter FahrSyn eine eingetragene Firma steht. Danach richtet
sich alles Weitere:

**Wenn es eine GmbH, UG oder ein eingetragenes Einzelunternehmen gibt** — dann
beide Konten als Organisation. Im Store steht der Firmenname, und Googles Pflicht
zur Testphase mit 12 Testern über 14 Tage entfällt vollständig. Das spart drei
Wochen. Nötig ist eine D-U-N-S-Nummer, kostenlos, 5 bis 14 Werktage Bearbeitung.

**Wenn es (noch) keine Firma gibt** — dann Apple und Google auf deinen Namen. Bei
Apple ist das unproblematisch, nur steht „Klaus Thiele" statt eines Firmennamens
als Anbieter im Store. Bei Google kommt die 12-Tester-Phase dazu; die ist machbar,
weil ihr die Fahrlehrer der Pilot-Fahrschule als Tester nehmen könnt, kostet aber
zwei Wochen zusätzlich.

**Was ich brauche:** eine Zeile von dir — Firma vorhanden oder nicht, und wenn ja,
der exakte Name laut Handelsregister. Dann schreibe ich dir den Antragstext fertig.

---

## 4. Reihenfolge — meine Entscheidung: erst das Projekt, dann die Pflichtbausteine

In diesem Paket steckt beides. Der technische Teil ist fertig und getestet, der
Rest ist vorbereitet und wartet auf eure Angaben.

---

## Zwei Dinge, die ich zusätzlich entschieden habe

**Push wird nativ.** Web-Push funktioniert in einer Capacitor-App auf iOS
überhaupt nicht und auf Android nur eingeschränkt — der Service Worker läuft dort
schlicht nicht. Ohne nativen Weg hättet ihr auf iPhones gar keine
Benachrichtigungen mehr, also genau die Funktion verloren, die den App-Store-Auftritt
überhaupt rechtfertigt. Der Umbau ist gelöst, ohne eure App-Dateien anzufassen:
Das Boot-Skript stellt der App eine Web-Push-Attrappe hin und leitet sie intern auf
APNs bzw. FCM um. Euer bestehender Benachrichtigungs-Button funktioniert unverändert
weiter. Der Web-Push-Weg für die Browser-PWA bleibt daneben bestehen.

**Die App-Dateien werden nicht von Hand angepasst.** Statt zwei handgepflegte
Kopien zu erzeugen, die nach dem dritten Update auseinanderlaufen, gibt es ein
Build-Skript. Es liest die Originaldateien, wendet eine überschaubare Liste
dokumentierter Änderungen an und erzeugt daraus das App-Bundle. Ändert ihr die PWA
auf dem Server, kopiert ihr die neue Datei her und lasst den Build erneut laufen.
Es gibt weiterhin genau eine Quelle.

---

## Was ich von dir brauche

| | Angabe | Wofür |
|---|---|---|
| 1 | Firma vorhanden? Wenn ja: exakter Name laut Handelsregister, Rechtsform, Anschrift | D-U-N-S und beide Entwicklerkonten |
| 2 | Steht ein Mac zur Verfügung? | Ohne Mac kein iOS-Build — dann plane ich einen Cloud-Build-Dienst ein |
| 3 | Logo als Vektordatei (`Fuchs AI Rohdatei.ai`) | Ich habe die App-Icons aus dem 512er-PNG hochgerechnet. Aus der Vektordatei wird es sichtbar schärfer |
| 4 | Freigabe für die Demo-Zugänge | Server-seitig anzulegen, siehe `server/demo-zugang.md` |
| 5 | Wer setzt es technisch um — du, jemand im Team, ein Dienstleister? | Bestimmt, wie kleinteilig ich die nächsten Schritte aufschreibe |
