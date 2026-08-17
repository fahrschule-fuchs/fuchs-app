#!/usr/bin/env node
/* =====================================================================
   BUILD: PWA-Quelldatei  ->  App-Bundle (www/)
   ---------------------------------------------------------------------
   Erzeugt aus den unveraenderten Originaldateien der beiden PWAs den
   lokalen Web-Ordner, den Capacitor in die App packt.

   Der Punkt daran: die Originaldateien bleiben die einzige Quelle.
   Wird die PWA auf dem Server weiterentwickelt, kopiert man die neue
   Datei nach quellen/ und laesst diesen Build erneut laufen - fertig.
   Es gibt keine zweite, handgepflegte Fassung, die auseinanderlaeuft.

   Aufruf:  npm run build
            npm run build -- schueler        (nur eine App)
   ===================================================================== */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(WURZEL, 'build.config.json'), 'utf8'));
const nurApp = process.argv[2];

let fehlerZaehler = 0;
const log = (s) => console.log(s);
const warn = (s) => { console.log('  ! ' + s); fehlerZaehler++; };

for (const app of cfg.apps) {
  if (nurApp && app.id !== nurApp) continue;

  log(`\n── ${app.anzeigename}  (${app.appId})`);

  const quelle = join(WURZEL, cfg.quellordner, app.quelldatei);
  if (!existsSync(quelle)) {
    warn(`Quelldatei fehlt: ${cfg.quellordner}/${app.quelldatei} — bitte aus Dropbox "Fuchs-App/app-phone/" kopieren.`);
    continue;
  }

  let html = readFileSync(quelle, 'utf8');
  const urspruenglicheLaenge = html.length;

  /* --- 1. Projektspezifische Ersetzungen ------------------------- */
  for (const r of app.ersetzungen || []) {
    let vorher = html;
    if (r.suchenRegex) {
      html = html.replace(new RegExp(r.suchenRegex, r.alle ? 'g' : ''), r.ersetzen);
    } else {
      html = r.alle ? html.split(r.suchen).join(r.ersetzen) : html.replace(r.suchen, r.ersetzen);
    }
    if (vorher === html) {
      const text = `Ersetzung ohne Treffer: ${r._zweck || r.suchen}`;
      if (r.pflicht) warn(text + '  → Quelldatei geändert? Regel in build.config.json prüfen.');
      else log('  · übersprungen (kein Treffer): ' + (r._zweck || r.suchen));
    } else {
      log('  · ' + (r._zweck || 'Ersetzung angewendet'));
    }
  }

  /* --- 2. Web-Manifest-Verweis entfernen ------------------------- */
  // In einer nativen App wirkungslos; erzeugt beim Start nur einen 404.
  const ohneManifest = html.replace(/\s*<link[^>]+rel=["']manifest["'][^>]*>/gi, '');
  if (ohneManifest !== html) log('  · Manifest-Verweis entfernt');
  html = ohneManifest;

  /* --- 3. Boot-Skript als allererstes Skript einhängen ------------ */
  const konfig = {
    origin: cfg.server.origin,
    apiBasis: app.apiBasis,
    pushEndpunkt: app.pushEndpunkt,
    app: app.id
  };
  const einhaengen =
    `<script>window.FUCHS_CFG=${JSON.stringify(konfig)};</script>\n` +
    `<script src="fuchs-native.js"></script>\n`;

  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => m + '\n' + einhaengen);
    log('  · Boot-Skript eingehängt');
  } else {
    warn('Kein <head> gefunden — Boot-Skript konnte nicht eingehängt werden.');
  }

  /* --- 4. Schreiben ---------------------------------------------- */
  const www = join(WURZEL, 'apps', app.id, 'www');
  if (existsSync(www)) rmSync(www, { recursive: true, force: true });
  mkdirSync(www, { recursive: true });

  writeFileSync(join(www, 'index.html'), html, 'utf8');
  copyFileSync(join(WURZEL, 'shared', 'fuchs-native.js'), join(www, 'fuchs-native.js'));

  let kopiert = 0;
  for (const datei of app.mitkopieren || []) {
    const von = join(WURZEL, cfg.quellordner, datei);
    if (existsSync(von)) { copyFileSync(von, join(www, datei)); kopiert++; }
    else warn(`Asset fehlt: ${datei}`);
  }

  log(`  ✓ apps/${app.id}/www/  —  index.html ${(html.length / 1024).toFixed(0)} KB ` +
      `(Quelle ${(urspruenglicheLaenge / 1024).toFixed(0)} KB), ${kopiert} Bilddateien`);
}

log('');
if (fehlerZaehler) {
  log(`Fertig mit ${fehlerZaehler} Hinweis(en) — bitte oben prüfen.`);
  process.exitCode = 1;
} else {
  log('Fertig ohne Beanstandung. Weiter mit:  npx cap sync');
}
