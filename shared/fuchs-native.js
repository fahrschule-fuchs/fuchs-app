/* =====================================================================
   FUCHS NATIVE BOOT
   ---------------------------------------------------------------------
   Wird vom Build-Skript als ERSTES Skript in die App-HTML eingehaengt.
   Die Original-HTML-Dateien der PWA bleiben dadurch unveraendert -
   diese Datei biegt zur Laufzeit um, was in einer nativen App anders
   funktioniert als im Browser.

   Es werden vier Dinge erledigt:
     1. Alle relativen fetch-Aufrufe zeigen auf den echten Server.
     2. Web-Push wird durch natives Push (APNs/FCM) ersetzt - fuer die
        App-Logik sieht es aus, als gaebe es weiterhin Web-Push.
     3. Externe Links (WhatsApp, Karten, Telefon) oeffnen im System.
     4. Android-Zurueck, Startbildschirm, Offline-Hinweis.
     (5. Kamera, 6. App-Version und Update-Hinweis - seit 1.17)

   Erwartet die vom Build erzeugte Konstante window.FUCHS_CFG.
   ===================================================================== */
(function () {
  'use strict';

  var CFG = window.FUCHS_CFG || {};
  var ORIGIN = CFG.origin || '';
  var BASIS = CFG.apiBasis || '';
  var PUSH_ENDPUNKT = CFG.pushEndpunkt || 'push/native';
  var C = window.Capacitor;
  var NATIV = !!(C && C.isNativePlatform && C.isNativePlatform());
  var P = (C && C.Plugins) || {};

  window.FuchsNative = {
    istApp: NATIV,
    plattform: NATIV && C.getPlatform ? C.getPlatform() : 'web',
    pushToken: null
  };

  /* =================================================================
     1. ADRESSEN AUFLOESEN
     -----------------------------------------------------------------
     Im Browser laufen die Apps unter app.fahrsyn.de - relative Pfade
     wie fetch("konto") oder "/app/..." lösen dort korrekt auf.
     In der App liegen die Dateien lokal, deshalb muss jede Adresse
     absolut gemacht werden. Ein einziger Wrapper deckt alle Aufrufe
     ab; die App-Dateien selbst bleiben unangetastet.
     ================================================================= */
  function absolut(u) {
    if (typeof u !== 'string' || !u) return u;
    if (/^(https?:|data:|blob:|tel:|mailto:|capacitor:)/i.test(u)) return u;
    if (u.charAt(0) === '/') return ORIGIN + u;              // /app/... -> Server
    return BASIS + u.replace(/^\.\//, '');                    // konto -> Basis + konto
  }
  window.FuchsNative.absolut = absolut;

  /* -----------------------------------------------------------------
     App-Version (1.17): Jeder Aufruf an unseren Server bekommt
     X-App-Version, X-App-Plattform und X-App-Name mit. Der Server merkt
     sich daraus nur Version/Plattform/Datum und sagt, ob es eine neuere
     Version gibt (Abschnitt 6). Die Version kommt aus dem Store-Paket
     selbst (App.getInfo), nicht aus dieser Datei.
     ----------------------------------------------------------------- */
  var APP_NAME = CFG.app === 'fahrlehrer' ? 'fl' : 'fs';
  var VERS_RE = /^\d{1,3}(\.\d{1,3}){0,2}$/;
  var APP_VERSION = '';
  var versionFertig = false;
  try { APP_VERSION = localStorage.getItem('fuchsAppVersion') || ''; } catch (e) {}
  if (!VERS_RE.test(APP_VERSION)) APP_VERSION = '';
  var versionGeholt = (NATIV && P.App && P.App.getInfo)
    ? P.App.getInfo().then(function (i) {
        var v = String((i && i.version) || '').trim();
        if (VERS_RE.test(v)) {
          APP_VERSION = v;
          try { localStorage.setItem('fuchsAppVersion', v); } catch (e) {}
        }
      }).catch(function () {}).then(function () {
        versionFertig = true;
        window.FuchsNative.version = APP_VERSION;
      })
    : Promise.resolve();
  function versionWarten() {
    if (versionFertig) return Promise.resolve();
    return Promise.race([versionGeholt, new Promise(function (r) { setTimeout(r, 1500); })]);
  }
  function mitVersion(url) {
    return typeof url === 'string' && url.indexOf(ORIGIN + '/app/') === 0 &&
      url.indexOf('/app/theorievideos/') < 0 &&
      (window.FuchsNative.plattform === 'ios' || window.FuchsNative.plattform === 'android');
  }
  function versionKopf(o) {
    if (!APP_VERSION) return o;
    o = Object.assign({}, o || {});
    var h = new Headers(o.headers || {});
    h.set('X-App-Version', APP_VERSION);
    h.set('X-App-Plattform', window.FuchsNative.plattform);
    h.set('X-App-Name', APP_NAME);
    o.headers = h;
    return o;
  }

  if (NATIV && window.fetch) {
    var originalFetch = window.fetch.bind(window);
    window.fetch = function (eingabe, optionen) {
      try {
        if (typeof eingabe === 'string') {
          // Push-Anmeldung abfangen: geht nativ statt per Web-Push
          if (/push\/subscribe/.test(eingabe)) {
            return pushAnmeldungAbfangen(optionen);
          }
          eingabe = absolut(eingabe);
          if (mitVersion(eingabe)) {
            var adresse = eingabe, opt = optionen;
            return versionWarten().then(function () {
              return originalFetch(adresse, versionKopf(opt));
            }).then(function (antwort) {
              // 426 = diese Version ist unter der Mindestversion
              if (antwort && antwort.status === 426) updatePruefen();
              return antwort;
            });
          }
        } else if (eingabe && eingabe.url) {
          eingabe = new Request(absolut(eingabe.url), eingabe);
        }
      } catch (e) { /* im Zweifel unveraendert weiterreichen */ }
      return originalFetch(eingabe, optionen);
    };

    // XMLHttpRequest der Vollstaendigkeit halber ebenfalls
    var xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) {
      arguments[1] = absolut(u);
      return xhrOpen.apply(this, arguments);
    };
  }

  /* =================================================================
     2. WEB-PUSH -> NATIVES PUSH
     -----------------------------------------------------------------
     In einer Capacitor-App gibt es keinen Service Worker und damit
     kein Web-Push (auf iOS grundsaetzlich nicht, auf Android nur
     eingeschraenkt). Wir stellen der App eine Attrappe hin, die sich
     nach aussen wie die Web-Push-API verhaelt, innen aber APNs bzw.
     FCM anspricht. So bleibt der bestehende Benachrichtigungs-Button
     in beiden Apps unveraendert funktionsfaehig.

     Build 1.9:
     - Nur iOS (APNs). Unter Android fehlt Firebase (google-services.json),
       dort stuerzt register() die App ab - es wird nie aufgerufen.
     - Stilles Erneuern: Ist die Erlaubnis schon erteilt, meldet
       Notification.permission "granted". Dann laeuft der vorhandene
       Erneuerungszweig der Seite ohne System-Dialog an.
     - Die Antwort des Servers zaehlt: Erst nach einem erfolgreichen POST
       gibt es ein (Ersatz-)Abo. Nach einem Fehlversuch 10 Min. kein
       stiller Neuversuch, nach Erfolg in dieser Sitzung keiner mehr.
       Ein Tippen auf den Knopf versucht es immer.
     ================================================================= */
  var IOS = NATIV && window.FuchsNative.plattform === 'ios';
  var PUSH_PAUSE_MS = 10 * 60 * 1000;
  var pushBereit = null;
  var pushErlaubt = false;      // iOS: Erlaubnis lag beim Start schon vor
  var pushGemeldet = false;     // Token in dieser Sitzung beim Server angekommen
  var pushFehlerBis = 0;        // bis dahin kein stiller Neuversuch
  var pushInteraktivBis = 0;    // kurz nach einem Tippen auf den Knopf (gilt fuer EINEN Versuch)
  var pushLaeuft = null;        // laufender Versuch - wird mitbenutzt statt verdoppelt

  function interaktiv() { return Date.now() < pushInteraktivBis; }

  if (IOS && P.PushNotifications && P.PushNotifications.checkPermissions) {
    P.PushNotifications.checkPermissions().then(function (s) {
      pushErlaubt = !!(s && s.receive === 'granted');
    }).catch(function () {});
  }
  if (NATIV) {
    // Tippen auf "Benachrichtigungen aktivieren" (Schueler- bzw. Fahrlehrer-App)
    document.addEventListener('click', function (ereignis) {
      var z = ereignis.target;
      if (z && z.closest && z.closest('#fuchsPushBtn, #flPushBtn')) pushInteraktivBis = Date.now() + 15000;
    }, true);
  }

  function nativenTokenHolen() {
    // Android: ohne Firebase stuerzt register() ab - bis FCM eingebaut ist, nie.
    if (!IOS) return Promise.reject(new Error('Benachrichtigungen gibt es in dieser App noch nicht'));
    if (pushBereit) return pushBereit;
    var mitDialog = interaktiv();
    pushBereit = new Promise(function (aufloesen, ablehnen) {
      if (!P.PushNotifications) return ablehnen(new Error('Push-Plugin fehlt'));
      var fertig = false;
      P.PushNotifications.addListener('registration', function (t) {
        if (fertig) return;
        fertig = true;
        window.FuchsNative.pushToken = t.value;
        aufloesen(t.value);
      });
      P.PushNotifications.addListener('registrationError', function (e) {
        if (!fertig) { fertig = true; ablehnen(e); }
      });
      P.PushNotifications.checkPermissions().then(function (s) {
        if (s.receive === 'granted') return s;
        // Still (ohne Tippen) nie einen System-Dialog oeffnen.
        if (!mitDialog) throw new Error('keine Erlaubnis');
        return P.PushNotifications.requestPermissions();
      }).then(function (s) {
        if (s.receive !== 'granted') throw new Error('abgelehnt');
        pushErlaubt = true;
        return P.PushNotifications.register();
      }).catch(ablehnen);
      setTimeout(function () {
        if (!fertig) { fertig = true; ablehnen(new Error('Zeitueberschreitung')); }
      }, 20000);
    });
    // Abgelehnt oder abgelaufen: beim naechsten Versuch neu fragen duerfen.
    pushBereit.catch(function () { pushBereit = null; });
    return pushBereit;
  }

  /**
   * Faengt den POST auf push/subscribe ab. Der urspruengliche Body
   * enthaelt bereits die Anmeldedaten (Schueler: token, Fahrlehrer:
   * fl + pin). Wir ersetzen nur die Web-Push-Subscription durch den
   * nativen Geraete-Token und schicken das an den neuen Endpunkt.
   * Antwortet der Server nicht mit ok, wird abgelehnt - die Seite
   * zeigt dann "konnte nicht aktiviert werden" und laesst den Knopf stehen.
   */
  function pushAnmeldungAbfangen(optionen) {
    var koerper = {};
    try { koerper = JSON.parse((optionen && optionen.body) || '{}'); } catch (e) {}
    delete koerper.subscription;
    var json = { 'Content-Type': 'application/json' };
    var antwort = function (ergebnis) {
      if (!ergebnis.ok) throw ergebnis.fehler;
      return new Response(JSON.stringify(ergebnis.j), { status: 200, headers: json });
    };

    // Laeuft schon ein Versuch (zwei Pruefungen der Seite ueberschneiden
    // sich), wird dessen Ergebnis mitbenutzt - kein zweiter POST.
    if (pushLaeuft) { pushInteraktivBis = 0; return pushLaeuft.then(antwort); }
    if (interaktiv()) {
      pushInteraktivBis = 0;      // das Tippen gilt fuer genau diesen Versuch
    } else {
      if (pushGemeldet) return Promise.resolve(new Response('{"ok":true}', { status: 200, headers: json }));
      if (Date.now() < pushFehlerBis) return Promise.reject(new Error('Pause nach Fehlversuch'));
    }
    pushLaeuft = versuchen(koerper, json);
    pushLaeuft.then(function () { pushLaeuft = null; });
    return pushLaeuft.then(antwort);
  }

  // Ein Anmeldeversuch beim Server -> {ok, j} bzw. {ok:false, fehler}
  function versuchen(koerper, json) {
    return nativenTokenHolen().then(function (token) {
      koerper.plattform = window.FuchsNative.plattform;   // 'ios'
      koerper.token_typ = 'nativ';
      koerper.geraete_token = token;
      return fetch(absolut(PUSH_ENDPUNKT), {
        method: 'POST',
        headers: json,
        body: JSON.stringify(koerper)
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || (j && j.ok === false)) {
          throw new Error('Anmeldung abgewiesen (' + r.status + ')');
        }
        pushGemeldet = true;
        pushFehlerBis = 0;
        if (kandidat) fakeSubscription = kandidat;
        return { ok: true, j: j || { ok: true } };
      });
    }).catch(function (fehler) {
      fakeSubscription = null;
      pushFehlerBis = Date.now() + PUSH_PAUSE_MS;
      return { ok: false, fehler: fehler };
    });
  }

  // Ersatz-Abo: entsteht bei subscribe() als Kandidat und gilt erst,
  // wenn der Server das Token angenommen hat.
  var fakeSubscription = null;
  var kandidat = null;

  if (NATIV) {
    // Attrappe: Service Worker + Push-Manager
    var fakeRegistrierung = {
      pushManager: {
        getSubscription: function () { return Promise.resolve(fakeSubscription); },
        subscribe: function () {
          return nativenTokenHolen().then(function (token) {
            kandidat = {
              endpoint: 'nativ:' + window.FuchsNative.plattform + ':' + token,
              toJSON: function () { return { endpoint: this.endpoint, keys: {} }; },
              unsubscribe: function () { fakeSubscription = null; kandidat = null; return Promise.resolve(true); }
            };
            return kandidat;
          });
        },
        permissionState: function () { return Promise.resolve('prompt'); }
      },
      showNotification: function (titel, opt) {
        if (P.LocalNotifications) {
          P.LocalNotifications.schedule({
            notifications: [{ id: Date.now() % 100000, title: titel, body: (opt && opt.body) || '' }]
          });
        }
        return Promise.resolve();
      },
      update: function () { return Promise.resolve(); },
      unregister: function () { return Promise.resolve(true); }
    };

    try {
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        get: function () {
          return {
            register: function () { return Promise.resolve(fakeRegistrierung); },
            getRegistration: function () { return Promise.resolve(fakeRegistrierung); },
            ready: Promise.resolve(fakeRegistrierung),
            addEventListener: function () {},
            controller: null
          };
        }
      });
    } catch (e) { /* manche WebViews erlauben das nicht - dann bleibt es beim Original */ }

    // Notification-API auf die native Berechtigung umleiten
    try {
      if (!window.Notification) window.Notification = function () {};
      Object.defineProperty(window.Notification, 'permission', {
        configurable: true,
        get: function () {
          return (window.FuchsNative.pushToken || pushErlaubt) ? 'granted' : 'default';
        }
      });
      window.Notification.requestPermission = function (rueckruf) {
        pushInteraktivBis = Date.now() + 15000;   // kommt nur aus dem Tippen auf den Knopf
        return nativenTokenHolen()
          .then(function () { if (rueckruf) rueckruf('granted'); return 'granted'; })
          .catch(function () { if (rueckruf) rueckruf('denied'); return 'denied'; });
      };
    } catch (e) {}

    // Antippen einer Benachrichtigung -> passende Ansicht oeffnen
    if (P.PushNotifications) {
      P.PushNotifications.addListener('pushNotificationActionPerformed', function (a) {
        var d = (a && a.notification && a.notification.data) || {};
        window.dispatchEvent(new CustomEvent('fuchs:push-geoeffnet', { detail: d }));
        if (d.tab && typeof window.waehleTab === 'function') {
          try { window.waehleTab(d.tab, d.tab_label || ''); } catch (e) {}
        }
      });
      P.PushNotifications.addListener('pushNotificationReceived', function (n) {
        window.dispatchEvent(new CustomEvent('fuchs:push', { detail: n }));
      });
    }
  }

  /* =================================================================
     3. EXTERNE LINKS
     -----------------------------------------------------------------
     WhatsApp-, Karten- und Telefonlinks duerfen die App nicht
     uebernehmen - sonst haengt der Nutzer in einer fremden Seite fest
     und kommt ohne Neustart nicht zurueck. Apple prueft genau das.
     ================================================================= */
  if (NATIV) {
    document.addEventListener('click', function (ereignis) {
      var a = ereignis.target && ereignis.target.closest && ereignis.target.closest('a[href]');
      if (!a) return;
      var ziel = a.getAttribute('href') || '';
      if (/^(tel:|mailto:|sms:)/i.test(ziel)) return;                 // System regelt das
      if (!/^https?:/i.test(ziel)) return;                            // interne Navigation
      ereignis.preventDefault();
      if (P.Browser) P.Browser.open({ url: ziel, presentationStyle: 'popover' });
      else window.open(ziel, '_system');
    }, true);
  }

  /* =================================================================
     4. APP-VERHALTEN: START, ZURUECK, OFFLINE
     ================================================================= */
  if (NATIV) {
    document.addEventListener('DOMContentLoaded', function () {
      // Statusleiste an das Fuchs-Orange angleichen
      if (P.StatusBar) {
        P.StatusBar.setStyle({ style: 'LIGHT' }).catch(function () {});
        if (window.FuchsNative.plattform === 'android') {
          P.StatusBar.setBackgroundColor({ color: '#F67B32' }).catch(function () {});
        }
      }
      // Startbildschirm ausblenden, sobald die Oberflaeche steht
      setTimeout(function () {
        if (P.SplashScreen) P.SplashScreen.hide().catch(function () {});
      }, 250);
    });

    // Android-Zurueck: zuerst darf die App selbst entscheiden (Haken
    // window.fuchsZurueck, gibt true zurueck, wenn erledigt - z.B. Zoom
    // oder Rueckfrage schliessen, laufende Pruefung). Ohne Haken (Fahrlehrer-
    // App) wie bisher: erst die App-eigene Historie, dann beenden.
    if (P.App) {
      P.App.addListener('backButton', function (z) {
        try {
          if (typeof window.fuchsZurueck === 'function' && window.fuchsZurueck()) return;
        } catch (e) { /* im Zweifel wie bisher */ }
        if (z && z.canGoBack) window.history.back();
        else if (P.App.exitApp) P.App.exitApp();
      });
      // Rueckkehr aus dem Hintergrund -> Daten auffrischen
      P.App.addListener('appStateChange', function (z) {
        if (z && z.isActive) window.dispatchEvent(new CustomEvent('fuchs:reaktiviert'));
      });
    }

    // Offline-Hinweis, weil beide Apps Netzfehler bisher stillschweigend schlucken
    if (P.Network) {
      var balken = null;
      var wartend = null;
      var zeige = function (offline) {
        // Der Statusabruf kann antworten, bevor <body> existiert - dann merken
        // wir uns den Zustand und holen die Anzeige nach.
        if (!document.body) {
          wartend = offline;
          document.addEventListener('DOMContentLoaded', function () {
            if (wartend !== null) { var z = wartend; wartend = null; zeige(z); }
          }, { once: true });
          return;
        }
        if (offline && !balken) {
          balken = document.createElement('div');
          balken.textContent = 'Keine Verbindung – Daten werden nicht aktualisiert.';
          balken.setAttribute('style',
            'position:fixed;left:0;right:0;bottom:0;z-index:99999;padding:10px 14px;' +
            'background:#B45309;color:#fff;font:14px/1.3 system-ui;text-align:center');
          document.body.appendChild(balken);
        } else if (!offline && balken) {
          balken.remove(); balken = null;
        }
      };
      P.Network.getStatus().then(function (s) { zeige(!s.connected); });
      P.Network.addListener('networkStatusChange', function (s) { zeige(!s.connected); });
    }
  }

  /* =================================================================
     5. KAMERA - fuer spaetere Nutzung bereitgestellt
     -----------------------------------------------------------------
     Die Apps nutzen heute <input type="file">. Das oeffnet auf beiden
     Plattformen bereits die Kamera-Auswahl und funktioniert auch in
     der App. Wer spaeter direkt die Kamera oeffnen will, ruft
     FuchsNative.foto() auf - Rueckgabe ist eine Data-URL, also genau
     das Format, das die Apps ohnehin hochladen.
     ================================================================= */
  window.FuchsNative.foto = function (quelle) {
    if (!NATIV || !P.Camera) return Promise.reject(new Error('nur in der App'));
    return P.Camera.getPhoto({
      quality: 82,
      allowEditing: false,
      resultType: 'dataUrl',
      source: quelle === 'galerie' ? 'PHOTOS' : 'CAMERA',
      correctOrientation: true,
      width: 2000,
      promptLabelHeader: 'Dokument erfassen',
      promptLabelPhoto: 'Aus Fotos wählen',
      promptLabelPicture: 'Foto aufnehmen',
      promptLabelCancel: 'Abbrechen'
    }).then(function (f) { return f.dataUrl; });
  };

  /* =================================================================
     6. UPDATE-HINWEIS (1.17)
     -----------------------------------------------------------------
     Der Server sagt je App und Plattform, welche Version die neueste
     ist und ob es eine Mindestversion gibt (gepflegt im
     Fahrschulmanager, Verwaltung -> App-Versionen).
     - kleiner als "neueste": Hinweis oben auf der Startseite (die Seite
       stellt dafuer <div id="fuchsUpdateHinweis"> bereit), wegtippbar,
       kommt nach 3 Tagen wieder.
     - kleiner als "Mindestversion": Vollbild mit Store-Knopf.
     Der Store wird ueber eine normale Adresse geoeffnet; Capacitor gibt
     fremde Adressen an das System weiter (App Store / Play Store).
     ================================================================= */
  var UPD_WEG = 'fuchsUpdateWeg';
  var UPD_PAUSE_MS = 3 * 24 * 3600 * 1000;
  var updLetzte = 0;
  window.FuchsNative.update = null;

  function updWeggetippt(neueste) {
    try {
      var w = JSON.parse(localStorage.getItem(UPD_WEG) || 'null');
      return !!(w && w.v === neueste && Date.now() - Number(w.t || 0) < UPD_PAUSE_MS);
    } catch (e) { return false; }
  }

  window.FuchsNative.storeOeffnen = function (link) {
    link = link || (window.FuchsNative.update || {}).link || '';
    if (!/^https:\/\/(apps\.apple\.com|itunes\.apple\.com|play\.google\.com)\//.test(link)) return false;
    window.location.href = link;
    return true;
  };

  function knopf(text) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.setAttribute('style', 'margin-top:8px;background:#F67B32;color:#fff;border:none;border-radius:999px;' +
      'padding:9px 16px;font-weight:700;font-size:14px;line-height:1.2;font-family:inherit;cursor:pointer;');
    b.onclick = function () { window.FuchsNative.storeOeffnen(); };
    return b;
  }

  window.FuchsNative.updateHinweis = function () {
    var el = document.getElementById('fuchsUpdateHinweis');
    if (!el) return;
    var d = window.FuchsNative.update;
    el.innerHTML = '';
    if (!d || !d.veraltet || d.gesperrt || updWeggetippt(d.neueste)) { el.style.display = 'none'; return; }
    var karte = document.createElement('div');
    karte.setAttribute('style', 'display:flex;align-items:flex-start;gap:12px;background:#FEF0E6;' +
      'border:1px solid #F9C9A5;border-radius:16px;padding:12px 10px 12px 14px;margin:0 0 14px;');
    var zeichen = document.createElement('div');
    zeichen.textContent = '⬆';
    zeichen.setAttribute('style', 'width:38px;height:38px;border-radius:12px;background:#F67B32;color:#fff;' +
      'display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:800;flex-shrink:0;');
    var mitte = document.createElement('div');
    mitte.setAttribute('style', 'flex:1;min-width:0;');
    var titel = document.createElement('div');
    titel.textContent = d.titel || 'Neue Version verfügbar';
    titel.setAttribute('style', 'font-weight:800;color:#1A1A1A;font-size:15px;');
    var text = document.createElement('div');
    text.textContent = d.text || '';
    text.setAttribute('style', 'font-size:12.5px;color:#6A6A6A;margin-top:1px;');
    mitte.appendChild(titel); mitte.appendChild(text); mitte.appendChild(knopf('Jetzt aktualisieren'));
    var weg = document.createElement('button');
    weg.type = 'button';
    weg.textContent = '×';
    weg.setAttribute('aria-label', 'Hinweis ausblenden');
    weg.setAttribute('style', 'background:none;border:none;color:#6A6A6A;font-size:22px;line-height:1;padding:0 4px;cursor:pointer;');
    weg.onclick = function () {
      try { localStorage.setItem(UPD_WEG, JSON.stringify({ v: d.neueste, t: Date.now() })); } catch (e) {}
      window.FuchsNative.updateHinweis();
    };
    karte.appendChild(zeichen); karte.appendChild(mitte); karte.appendChild(weg);
    el.appendChild(karte);
    el.style.display = '';
  };

  function sperreZeigen(d) {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', function () { sperreZeigen(d); }, { once: true });
      return;
    }
    var s = document.getElementById('fuchsUpdateSperre');
    if (!s) {
      s = document.createElement('div');
      s.id = 'fuchsUpdateSperre';
      document.body.appendChild(s);
    }
    s.setAttribute('style', 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:100000;background:#FBF8F5;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;' +
      'padding:32px 28px calc(32px + env(safe-area-inset-bottom));font-family:inherit;');
    s.innerHTML = '';
    var bild = document.createElement('img');
    bild.src = 'fuchs-icon.png';
    bild.alt = '';
    bild.setAttribute('style', 'width:84px;height:84px;border-radius:22px;margin-bottom:18px;');
    bild.onerror = function () { bild.remove(); };
    var h = document.createElement('div');
    h.textContent = 'Neue Version erforderlich';
    h.setAttribute('style', 'font-size:23px;font-weight:800;color:#1A1A1A;margin-bottom:8px;');
    var p = document.createElement('div');
    p.textContent = d.sperrtext || 'Bitte aktualisiere die App.';
    p.setAttribute('style', 'font-size:16px;color:#1A1A1A;max-width:320px;line-height:1.4;');
    var klein = document.createElement('div');
    klein.textContent = 'Deine Version: ' + (d.version || APP_VERSION) + ' · ' + (d.plattform === 'ios' ? 'im App Store' : 'bei Google Play');
    klein.setAttribute('style', 'font-size:12.5px;color:#6A6A6A;margin:10px 0 8px;');
    var k = knopf('Jetzt aktualisieren');
    k.style.padding = '13px 26px';
    k.style.fontSize = '16px';
    s.appendChild(bild); s.appendChild(h); s.appendChild(p); s.appendChild(klein); s.appendChild(k);
  }

  function sperreWeg() {
    var s = document.getElementById('fuchsUpdateSperre');
    if (s) s.remove();
  }

  function updatePruefen() {
    if (!NATIV || !originalFetch) return Promise.resolve(null);
    updLetzte = Date.now();
    return versionWarten().then(function () {
      if (!APP_VERSION) return null;
      return originalFetch(ORIGIN + '/app/app-version', versionKopf({
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
    }).then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.ok || !d.bekannt) return null;
        window.FuchsNative.update = d;
        if (d.gesperrt) sperreZeigen(d); else sperreWeg();
        window.FuchsNative.updateHinweis();
        return d;
      }).catch(function () { return null; });
  }
  window.FuchsNative.updatePruefen = updatePruefen;

  if (NATIV) {
    updatePruefen();
    // Nach der Rueckkehr aus dem Hintergrund hoechstens alle 6 Stunden neu fragen
    window.addEventListener('fuchs:reaktiviert', function () {
      if (Date.now() - updLetzte > 6 * 3600 * 1000) updatePruefen();
    });
  }
})();
