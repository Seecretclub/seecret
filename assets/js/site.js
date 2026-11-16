/* ------------------------------------------------------------------
   Seecret — copie statique
   Remplace les animations et micro-interactions qui étaient portées
   par Next.js / React. Aucune dépendance.
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  var docEl = document.documentElement;
  docEl.classList.add('js');

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasScrollTimeline = !!(window.CSS && CSS.supports && CSS.supports('animation-timeline: view()'));

  /* ----------------------------------------------------------------
     1. Photos : fondu à l'arrivée (le CSS attend data-loaded="true")
     ---------------------------------------------------------------- */
  function markLoaded(img) {
    if (img.getAttribute('data-loaded') === 'true') return;
    img.setAttribute('data-loaded', 'true');
    img.classList.add('loaded');
  }

  Array.prototype.forEach.call(document.querySelectorAll('img'), function (img) {
    if (img.complete && img.naturalWidth > 0) {
      markLoaded(img);
      return;
    }
    img.addEventListener('load', function () { markLoaded(img); });
    img.addEventListener('error', function () { markLoaded(img); });
  });

  // Filet de sécurité : une image déjà en cache peut avoir fini de charger
  // avant l'exécution du script (ou avant que son écouteur soit posé).
  function sweepImages() {
    Array.prototype.forEach.call(document.querySelectorAll('img[data-loaded="false"]'), function (img) {
      if (img.complete && img.naturalWidth > 0) markLoaded(img);
    });
  }
  window.addEventListener('load', sweepImages);
  window.setTimeout(sweepImages, 1500);

  /* ----------------------------------------------------------------
     2. Révélations au défilement (repli sans animation-timeline)
     ---------------------------------------------------------------- */
  if (!hasScrollTimeline && !reduceMotion) {
    docEl.classList.add('no-scroll-timeline');
    var revealEls = document.querySelectorAll('.reveal, .line-fill, .line-fill-y');

    if ('IntersectionObserver' in window) {
      var revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-revealed');
          revealObserver.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });

      Array.prototype.forEach.call(revealEls, function (el) {
        revealObserver.observe(el);
      });
    } else {
      Array.prototype.forEach.call(revealEls, function (el) {
        el.classList.add('is-revealed');
      });
    }
  }

  /* ----------------------------------------------------------------
     3. En-tête de l'accueil : fond papier dès que l'on quitte la photo
     ---------------------------------------------------------------- */
  var header = document.querySelector('header.fixed');
  if (header) {
    var syncHeader = function () {
      header.classList.toggle('is-scrolled', window.scrollY > 32);
    };
    syncHeader();
    window.addEventListener('scroll', syncHeader, { passive: true });
  }

  /* ----------------------------------------------------------------
     4. La façade : les fenêtres s'allument une à une
     ---------------------------------------------------------------- */
  var facade = document.getElementById('facade');
  if (facade) {
    var windows = [];

    Array.prototype.forEach.call(facade.querySelectorAll('svg g'), function (group) {
      var lamp = group.querySelector('rect[fill="url(#facade-lamp)"]');
      if (!lamp) return;
      windows.push({
        glow: group.querySelector('rect.fill-lamp'),
        glowOpen: group.querySelector('rect.fill-lamp-open'),
        lamp: lamp,
        soft: group.querySelector('rect.fill-lamp-soft'),
        open: group.querySelector('rect[fill="url(#facade-open)"]'),
        on: false
      });
    });

    var halo = facade.querySelector('div[aria-hidden="true"]');

    var STATES = {
      off: [0, 0, 0, 0, 0],
      lamp: [0.32, 0, 1, 0, 0],
      open: [0, 0.38, 0, 0, 1]
    };

    function paint(win, state) {
      var v = STATES[state];
      if (win.glow) win.glow.style.opacity = v[0];
      if (win.glowOpen) win.glowOpen.style.opacity = v[1];
      if (win.lamp) win.lamp.style.opacity = v[2];
      if (win.soft) win.soft.style.opacity = v[3];
      if (win.open) win.open.style.opacity = v[4];
      win.on = state !== 'off';
    }

    function paintHalo() {
      if (!halo) return;
      var lit = 0;
      for (var i = 0; i < windows.length; i++) if (windows[i].on) lit++;
      halo.style.opacity = (0.12 + 0.6 * (windows.length ? lit / windows.length : 0)).toFixed(2);
    }

    // État de départ tel que rendu par le serveur.
    Array.prototype.forEach.call(windows, function (win) {
      var current = win.lamp && win.lamp.style.opacity;
      win.on = current === '1' || current === 1;
    });
    paintHalo();

    if (!reduceMotion && windows.length) {
      var started = false;

      var lightUp = function () {
        if (started) return;
        started = true;

        var index = 0;
        var lit = windows.reduce(function (n, w) { return n + (w.on ? 1 : 0); }, 0);
        var target = Math.floor(windows.length * 0.62);

        var sequence = window.setInterval(function () {
          var win = windows[index % windows.length];
          index++;
          if (!win.on) {
            paint(win, Math.random() < 0.82 ? 'lamp' : 'open');
            lit++;
            paintHalo();
          }
          if (lit >= target || index > windows.length * 2) {
            window.clearInterval(sequence);
            window.setInterval(function () {
              var pick = windows[Math.floor(Math.random() * windows.length)];
              var roll = Math.random();
              paint(pick, roll < 0.58 ? 'lamp' : roll < 0.8 ? 'open' : 'off');
              paintHalo();
            }, 1400);
          }
        }, 240);
      };

      if ('IntersectionObserver' in window) {
        var facadeObserver = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            lightUp();
            facadeObserver.disconnect();
          });
        }, { threshold: 0.25 });
        facadeObserver.observe(facade);
      } else {
        lightUp();
      }
    }
  }

  /* ----------------------------------------------------------------
     5. Colonne photo (connexion / candidature) : défilement en fondu
     ---------------------------------------------------------------- */
  var faders = document.querySelectorAll('aside img[class*="transition-opacity"]');
  if (faders.length > 1 && !reduceMotion) {
    Array.prototype.forEach.call(faders, function (img, i) {
      img.style.opacity = i === 0 ? '1' : '0';
    });

    var picture = 0;
    window.setInterval(function () {
      faders[picture].style.opacity = '0';
      picture = (picture + 1) % faders.length;
      faders[picture].style.opacity = '1';
    }, 5000);
  }

  /* ----------------------------------------------------------------
     6. Connexion : activer le bouton, puis simuler l'envoi du code
     ---------------------------------------------------------------- */
  var emailInput = document.querySelector('input[type="email"]');
  if (emailInput) {
    var submitButton = document.querySelector('main button');
    var isValidEmail = function () {
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailInput.value.trim());
    };
    var syncSubmit = function () {
      if (submitButton) submitButton.disabled = !isValidEmail();
    };

    emailInput.addEventListener('input', syncSubmit);
    emailInput.addEventListener('change', syncSubmit);
    syncSubmit();

    var ouvrirEspace = function () {
      if (!isValidEmail()) return;
      submitButton.textContent = 'Ouverture de votre espace…';
      submitButton.disabled = true;
      window.location.href = 'espace.html?email=' + encodeURIComponent(emailInput.value.trim());
    };

    if (submitButton) submitButton.addEventListener('click', ouvrirEspace);
    emailInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        ouvrirEspace();
      }
    });
  }

  /* ----------------------------------------------------------------
     7. Candidature : cartes de projet sélectionnables
     ---------------------------------------------------------------- */
  var choices = document.querySelectorAll('main button[aria-pressed]');
  if (choices.length) {
    var noteShown = false;

    var showNote = function () {
      if (noteShown) return;
      noteShown = true;

      var list = choices[0].closest('.space-y-4') || choices[0].parentNode;
      var box = document.createElement('div');
      box.className = 'note-copie mt-8';
      box.innerHTML = '<p class="text-[14.5px] leading-relaxed text-graphite">Votre projet est noté. La suite — votre bien, les photos, la vérification — se fait dans votre espace membre.</p>' +
        '<a class="mt-4 inline-block rounded-full bg-button-ink px-6 py-3.5 text-[15px] font-medium text-white transition-transform active:scale-[0.98]" href="espace.html#/mon-bien">Poursuivre dans mon espace</a>';
      list.appendChild(box);
    };

    Array.prototype.forEach.call(choices, function (button) {
      button.addEventListener('click', function () {
        Array.prototype.forEach.call(choices, function (other) {
          other.setAttribute('aria-pressed', String(other === button));
        });
        showNote();
      });
    });
  }
})();
