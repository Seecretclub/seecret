// Réordonner des photos en les faisant glisser : souris (clic maintenu) et
// doigt (appui long puis glisser, sur iPhone / Android).
//
// Utilisation dans le HTML généré :
//   <div data-tri-photos="cle"> <div data-tri-index="0">…</div> … </div>
// À la fin d'un déplacement, un événement « tri-photos » est envoyé sur le
// conteneur : event.detail = { cle, de, vers } (positions avant / après).
// La première position est la photo principale.
(function () {
  'use strict';
  const APPUI_LONG_MS = 280;   // doigt : durée d'appui avant de pouvoir glisser
  const SEUIL_SOURIS = 6;      // souris : distance avant de commencer à glisser
  const TOLERANCE_DOIGT = 10;  // doigt : bouger plus avant l'appui long = défilement normal

  let d = null; // déplacement en cours

  function tuiles(conteneur) { return Array.from(conteneur.querySelectorAll(':scope > [data-tri-index]')); }

  function demarrer(x, y) {
    const t = d.tuile;
    const r = t.getBoundingClientRect();
    d.dx = x - r.left; d.dy = y - r.top;
    // Fantôme qui suit le doigt / la souris.
    const f = t.cloneNode(true);
    f.removeAttribute('data-tri-index');
    Object.assign(f.style, {
      position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px',
      margin: '0', zIndex: '9999', pointerEvents: 'none', opacity: '0.92', transform: 'scale(1.06)',
      boxShadow: '0 14px 34px rgba(20,18,16,.28)', borderRadius: getComputedStyle(t).borderRadius, transition: 'transform .12s'
    });
    document.body.appendChild(f);
    d.fantome = f;
    t.classList.add('tri-place');
    d.actif = true;
    document.documentElement.classList.add('tri-en-cours');
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { /* rien */ } }
  }

  function deplacer(x, y) {
    d.fantome.style.left = (x - d.dx) + 'px';
    d.fantome.style.top = (y - d.dy) + 'px';
    // Tuile sous le pointeur : on y insère l'emplacement.
    const liste = tuiles(d.conteneur);
    for (const el of liste) {
      if (el === d.tuile) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        const iEl = liste.indexOf(el); const iT = liste.indexOf(d.tuile);
        if (iEl < iT) d.conteneur.insertBefore(d.tuile, el);
        else d.conteneur.insertBefore(d.tuile, el.nextSibling);
        break;
      }
    }
  }

  function terminer(annule) {
    if (!d) return;
    clearTimeout(d.minuteur);
    const fin = d; d = null;
    document.documentElement.classList.remove('tri-en-cours');
    if (!fin.actif) return;
    if (fin.fantome) fin.fantome.remove();
    fin.tuile.classList.remove('tri-place');
    const vers = tuiles(fin.conteneur).indexOf(fin.tuile);
    // Empêche le « clic » qui suit le relâchement (ouvrir, définir principale…).
    const bloquer = (e) => { e.stopPropagation(); e.preventDefault(); };
    window.addEventListener('click', bloquer, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', bloquer, { capture: true }), 400);
    if (annule || vers === fin.de || vers < 0) {
      // Remet la tuile à sa place d'origine.
      const liste = tuiles(fin.conteneur).filter((x) => x !== fin.tuile);
      fin.conteneur.insertBefore(fin.tuile, liste[fin.de] || null);
      return;
    }
    fin.conteneur.dispatchEvent(new CustomEvent('tri-photos', { bubbles: true, detail: { cle: fin.conteneur.getAttribute('data-tri-photos'), de: fin.de, vers: vers } }));
  }

  function debut(e, x, y, doigt) {
    if (d) return;
    const tuile = e.target.closest('[data-tri-photos] > [data-tri-index]');
    if (!tuile) return;
    if (e.target.closest('[data-tri-fixe], input, label')) return; // ex. bouton supprimer
    const conteneur = tuile.parentElement;
    d = { tuile: tuile, conteneur: conteneur, de: tuiles(conteneur).indexOf(tuile), x0: x, y0: y, doigt: doigt, actif: false };
    if (doigt) d.minuteur = setTimeout(() => { if (d && !d.actif) { demarrer(d.x0, d.y0); } }, APPUI_LONG_MS);
  }

  // ---- Souris (et stylet) ----
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    debut(e, e.clientX, e.clientY, false);
    if (d) e.preventDefault(); // pas de glisser-déposer natif de l'image
  });
  document.addEventListener('pointermove', (e) => {
    if (!d || d.doigt) return;
    if (!d.actif) {
      if (Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) < SEUIL_SOURIS) return;
      demarrer(e.clientX, e.clientY);
    }
    deplacer(e.clientX, e.clientY);
  });
  document.addEventListener('pointerup', (e) => { if (d && !d.doigt) terminer(false); });

  // ---- Doigt : appui long puis glisser ----
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { terminer(true); return; }
    const t = e.touches[0];
    debut(e, t.clientX, t.clientY, true);
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!d || !d.doigt) return;
    const t = e.touches[0];
    if (!d.actif) {
      // Le doigt bouge avant l'appui long : c'est un défilement, on laisse faire.
      if (Math.abs(t.clientX - d.x0) + Math.abs(t.clientY - d.y0) > TOLERANCE_DOIGT) { clearTimeout(d.minuteur); d = null; }
      return;
    }
    e.preventDefault(); // bloque le défilement pendant le déplacement
    deplacer(t.clientX, t.clientY);
  }, { passive: false });
  document.addEventListener('touchend', () => { if (d && d.doigt) terminer(false); });
  document.addEventListener('touchcancel', () => { if (d && d.doigt) terminer(true); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && d) terminer(true); });

  // Styles : pas de menu « enregistrer l'image » à l'appui long, curseur main.
  const css = document.createElement('style');
  css.textContent =
    '[data-tri-photos] > [data-tri-index]{cursor:grab;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}' +
    '[data-tri-photos] > [data-tri-index] img{-webkit-user-drag:none;pointer-events:none}' +
    '[data-tri-photos] > .tri-place{opacity:.35;outline:2px dashed currentColor;outline-offset:-2px}' +
    'html.tri-en-cours,html.tri-en-cours *{cursor:grabbing!important}';
  document.head.appendChild(css);

  // Nouvel ordre d'une liste après un déplacement.
  window.TriPhotos = { reordonner: function (liste, de, vers) { const l = liste.slice(); const x = l.splice(de, 1)[0]; l.splice(vers, 0, x); return l; } };
})();
