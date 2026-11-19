// Intégrations navigateur, activées seulement si le serveur fournit les clés
// publiques correspondantes (/api/config-public) :
//  - Sentry : remonte les erreurs JavaScript (sans données personnelles) ;
//  - Cloudflare Turnstile : vérification anti-robot, invisible pour la plupart
//    des visiteurs (une case à cocher n'apparaît qu'en cas de doute).
(function () {
  var config = null;
  function lireConfig() {
    if (config) return Promise.resolve(config);
    return fetch('/api/config-public', { headers: { accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (c) { config = c || {}; return config; })
      .catch(function () { config = {}; return config; });
  }
  function chargerScript(src) {
    return new Promise(function (ok, ko) {
      var s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = ok; s.onerror = ko;
      document.head.appendChild(s);
    });
  }

  // --- Sentry
  lireConfig().then(function (c) {
    if (!c.sentryDsn) return;
    chargerScript('https://browser.sentry-cdn.com/10.40.0/bundle.min.js').then(function () {
      if (!window.Sentry) return;
      window.Sentry.init({
        dsn: c.sentryDsn,
        environment: c.sentryEnvironment || 'production',
        sendDefaultPii: false,
        beforeSend: function (e) { if (e.request) { delete e.request.cookies; } return e; }
      });
    }).catch(function () { /* Sentry indisponible : sans effet sur le site */ });
  });

  // --- Turnstile
  var chargement = null, widget = null, attente = null;
  function rendre(valeur) { if (attente) { var f = attente; attente = null; f(valeur); } }
  window.SeecretTurnstile = {
    // Renvoie un jeton Turnstile, ou '' si Turnstile n'est pas configuré.
    jeton: function () {
      return lireConfig().then(function (c) {
        if (!c.turnstileSiteKey) return '';
        if (!chargement) chargement = chargerScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
        return chargement.then(function () {
          var boite = document.getElementById('seecret-turnstile');
          if (!boite) {
            boite = document.createElement('div');
            boite.id = 'seecret-turnstile';
            boite.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:3000';
            document.body.appendChild(boite);
          }
          return new Promise(function (ok) {
            attente = ok;
            if (widget === null) {
              widget = window.turnstile.render(boite, {
                sitekey: c.turnstileSiteKey, execution: 'execute', appearance: 'interaction-only', language: 'fr',
                callback: function (t) { rendre(t); },
                'error-callback': function () { rendre(''); },
                'expired-callback': function () { rendre(''); }
              });
            } else {
              window.turnstile.reset(widget);
            }
            window.turnstile.execute(widget);
            setTimeout(function () { rendre(''); }, 30000);
          });
        }).catch(function () { return ''; });
      });
    }
  };
})();
