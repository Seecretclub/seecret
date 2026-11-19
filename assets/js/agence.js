// Complète les mentions légales avec les informations réglementées de
// l'agence (carte T, garantie, RC Pro, médiateur), tenues à jour côté serveur.
(function () {
  var cibles = document.querySelectorAll('[data-agence]');
  if (!cibles.length) return;
  fetch('/api/agence', { headers: { accept: 'application/json' } })
    .then(function (r) { return r.json(); })
    .then(function (a) {
      Array.prototype.forEach.call(cibles, function (el) {
        var v = a && a[el.getAttribute('data-agence')];
        if (v) el.textContent = v;
      });
    })
    .catch(function () { /* on garde le texte par défaut */ });
})();
