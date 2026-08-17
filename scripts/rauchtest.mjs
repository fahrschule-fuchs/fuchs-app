#!/usr/bin/env node
/* =====================================================================
   RAUCHTEST
   ---------------------------------------------------------------------
   Laedt beide gebauten Bundles in einem echten Browser, taeuscht die
   Capacitor-Umgebung vor und prueft:
     - startet die App ohne JavaScript-Fehler?
     - werden alle Netzaufrufe auf app.fahrsyn.de umgeleitet?
     - geht kein Aufruf mehr an einen lokalen Pfad?
     - loest die Push-Anmeldung den nativen Weg aus?
   Alle Netzaufrufe werden abgefangen, es geht nichts an den echten
   Server. Aufruf:  npm run rauchtest
   ===================================================================== */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(WURZEL, 'build.config.json'), 'utf8'));

const CAPACITOR_ATTRAPPE = `
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    Plugins: new Proxy({}, {
      get(ziel, name) {
        if (name === 'PushNotifications') return {
          addListener: (e, cb) => { if (e === 'registration') setTimeout(() => cb({ value: 'TEST-GERAETE-TOKEN' }), 10); },
          checkPermissions: async () => ({ receive: 'granted' }),
          requestPermissions: async () => ({ receive: 'granted' }),
          register: async () => {}
        };
        return new Proxy({}, { get: () => async () => ({}) });
      }
    })
  };
`;

let fehlerGesamt = 0;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PFAD || undefined });

for (const app of cfg.apps) {
  console.log(`\n── ${app.anzeigename}`);
  const seite = await browser.newPage();
  const jsFehler = [];
  const aufrufe = [];

  seite.on('pageerror', (e) => jsFehler.push(e.message));
  seite.on('console', (m) => { if (m.type() === 'error') jsFehler.push('console: ' + m.text()); });

  await seite.addInitScript(CAPACITOR_ATTRAPPE);

  // Alle Netzaufrufe abfangen und protokollieren
  await seite.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    aufrufe.push(url);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, termine: [], schueler: [], dokumente: [] })
    });
  });

  await seite.goto('file://' + join(WURZEL, 'apps', app.id, 'www', 'index.html'));
  await seite.waitForTimeout(1500);

  // Push-Weg auslösen, wie es der Benachrichtigungs-Button täte
  const pushErgebnis = await seite.evaluate(async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true });
      const r = await fetch('push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'TEST-TOKEN', subscription: sub })
      });
      return { endpoint: sub.endpoint, status: r.status };
    } catch (e) { return { fehler: String(e) }; }
  });

  await seite.waitForTimeout(400);

  const extern = aufrufe.filter((u) => u.startsWith('https://app.fahrsyn.de'));
  const lokalRest = aufrufe.filter((u) => u.startsWith('http://localhost') || u.startsWith('https://localhost'));

  const zeile = (gut, text) => { console.log((gut ? '  ✓ ' : '  ✗ ') + text); if (!gut) fehlerGesamt++; };

  zeile(jsFehler.length === 0, jsFehler.length === 0 ? 'kein JavaScript-Fehler beim Start'
    : `JavaScript-Fehler: ${jsFehler.slice(0, 3).join(' | ')}`);
  zeile(extern.length > 0, `${extern.length} Aufruf(e) korrekt an app.fahrsyn.de umgeleitet`);
  zeile(lokalRest.length === 0, lokalRest.length === 0 ? 'kein Aufruf blieb lokal hängen'
    : `lokal hängen geblieben: ${lokalRest.slice(0, 3).join(', ')}`);
  zeile(/^nativ:/.test(pushErgebnis.endpoint || ''), 'Push-Anmeldung läuft über den nativen Token: ' + (pushErgebnis.endpoint || pushErgebnis.fehler));
  const pushZiel = aufrufe.find((u) => u.includes('push/native'));
  zeile(!!pushZiel, pushZiel ? 'Push-Registrierung ging an ' + pushZiel : 'kein Aufruf an push/native');

  const beispiele = [...new Set(extern)].slice(0, 6);
  if (beispiele.length) console.log('  · Beispiele: ' + beispiele.join('  '));

  await seite.close();
}

await browser.close();
console.log('');
if (fehlerGesamt) { console.log(`${fehlerGesamt} Beanstandung(en).`); process.exitCode = 1; }
else console.log('Rauchtest bestanden.');
