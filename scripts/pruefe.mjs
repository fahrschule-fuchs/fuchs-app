#!/usr/bin/env node
/* =====================================================================
   PRUEFUNG DES BUNDLES
   ---------------------------------------------------------------------
   Faengt die Fehler ab, die man sonst erst nach dem App-Store-Upload
   bemerkt. Aufruf:  npm run pruefe
   ===================================================================== */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(WURZEL, 'build.config.json'), 'utf8'));

let fehler = 0, warnungen = 0;
const ok = (s) => console.log('  ✓ ' + s);
const nok = (s) => { console.log('  ✗ ' + s); fehler++; };
const hm = (s) => { console.log('  ~ ' + s); warnungen++; };

for (const app of cfg.apps) {
  console.log(`\n── ${app.anzeigename}`);
  const www = join(WURZEL, 'apps', app.id, 'www');

  if (!existsSync(join(www, 'index.html'))) { nok('www/index.html fehlt — erst "npm run build" ausführen'); continue; }
  const html = readFileSync(join(www, 'index.html'), 'utf8');

  // Boot-Skript vorhanden und an erster Stelle?
  const posBoot = html.indexOf('fuchs-native.js');
  const posErstesSkript = html.search(/<script(?![^>]*fuchs-native)/i);
  if (posBoot === -1) nok('Boot-Skript nicht eingehängt');
  else if (posErstesSkript !== -1 && posErstesSkript < posBoot - 200) nok('Boot-Skript steht nicht vor dem App-Code');
  else ok('Boot-Skript an erster Stelle');

  if (!existsSync(join(www, 'fuchs-native.js'))) nok('fuchs-native.js fehlt im Bundle');
  else ok('fuchs-native.js im Bundle');

  // Verweise auf den Server, die lokal nicht auflösbar sind
  const bilder = [...html.matchAll(/(?:src|href)=["'](\/app\/[^"']+)["']/gi)].map(m => m[1]);
  if (bilder.length) hm(`${bilder.length} Verweis(e) auf /app/… im HTML: ${[...new Set(bilder)].slice(0, 5).join(', ')}`);
  else ok('keine unaufgelösten /app/-Verweise');

  // Manifest darf nicht mehr referenziert sein
  if (/rel=["']manifest["']/i.test(html)) hm('Manifest-Verweis noch vorhanden (erzeugt 404 beim Start)');
  else ok('kein Manifest-Verweis');

  // Alle lokal referenzierten Dateien vorhanden?
  const dateien = new Set(readdirSync(www));
  const lokal = [...html.matchAll(/(?:src|href)=["'](?!https?:|data:|\/|#|tel:|mailto:)([^"']+)["']/gi)]
    .map(m => m[1])
    .filter(d => !d.includes('${'));   // JS-Template-Literale sind zur Laufzeit gefüllt
  const fehlend = [...new Set(lokal)].filter(d => !dateien.has(d.split('?')[0]));
  if (fehlend.length) nok('fehlende Dateien im Bundle: ' + fehlend.join(', '));
  else ok(`alle ${new Set(lokal).size} lokalen Verweise vorhanden`);

  // Externe Abhängigkeiten sichtbar machen (Apple fragt danach)
  const extern = [...new Set([...html.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1]))]
    .filter(h => h !== 'app.fahrsyn.de');
  if (extern.length) console.log('  · externe Hosts: ' + extern.join(', '));

  // Capacitor-Konfiguration
  const konf = join(WURZEL, 'apps', app.id, 'capacitor.config.json');
  if (!existsSync(konf)) { nok('capacitor.config.json fehlt'); continue; }
  const k = JSON.parse(readFileSync(konf, 'utf8'));
  if (k.appId !== app.appId) nok(`appId weicht ab: ${k.appId} statt ${app.appId}`);
  else ok('appId stimmt: ' + k.appId);
  if (k.server && k.server.url) nok('server.url gesetzt — das ist der Fall, den Apple nach 4.2 ablehnt');
  else ok('kein server.url (Inhalte werden lokal gebündelt)');
}

console.log('');
if (fehler) { console.log(`${fehler} Fehler, ${warnungen} Hinweis(e).`); process.exitCode = 1; }
else console.log(`Keine Fehler, ${warnungen} Hinweis(e).`);
