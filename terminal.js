/* Page glue for the BASIC terminal games. Config comes from window.FR303_GAME. */
(function () {
  'use strict';
  const cfg = window.FR303_GAME;
  const $ = id => document.getElementById(id);
  const { Basic, Terminal } = window.FR303Basic;
  const term = new Terminal({ out: $('out'), form: $('form'), input: $('in'), quick: $('quick') });
  term.quickRules = cfg.quick || [];
  let current = null, interp = null;

  function programText(id) { return document.getElementById('prog-' + id).textContent; }

  const top = document.querySelector('.top');
  if (top) {
    const b = document.createElement('a'); b.className = 'brandlink'; b.href = '/'; b.setAttribute('aria-label', 'FR303 home');
    b.innerHTML = '<svg class="logo-mark" viewBox="0 0 64 64" width="26" height="26" aria-hidden="true"><rect x="3" y="5" width="58" height="48" rx="9" fill="#101713" stroke="#e4a553" stroke-width="4"/><path d="M16 20l14 10-14 10" fill="none" stroke="#b8f5c8" stroke-width="5" stroke-linecap="square"/><rect x="36" y="37" width="14" height="5" fill="#e4a553"/><path d="M20 59h24" stroke="#e4a553" stroke-width="4"/></svg><span>FR<b>303</b></span>';
    top.insertBefore(b, top.firstChild);
  }
  const foot = document.querySelector('footer');
  const lst = document.createElement('a'); lst.textContent = 'view / edit this listing';
  if (foot) { foot.appendChild(document.createTextNode(' \u00b7 ')); foot.appendChild(lst); }

  function start(id) {
    lst.href = '/basic?p=' + id;
    if (interp) interp.halt();
    term.clear();
    current = id;
    document.querySelectorAll('#picker button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
    try {
      interp = new Basic(programText(id), term);
    } catch (e) { term.write('?' + e.message + '\n'); return; }
    interp.run();
  }

  const picker = $('picker');
  if (cfg.programs.length > 1) {
    picker.innerHTML = cfg.programs.map(p => '<button type="button" data-id="' + p.id + '" aria-pressed="false">' + p.title + '</button>').join('');
    picker.addEventListener('click', e => { const b = e.target.closest('button[data-id]'); if (b) start(b.dataset.id); });
  } else picker.style.display = 'none';

  $('restart').addEventListener('click', () => start(current));
  term.onFinished = () => { $('restart').focus({ preventScroll: true }); };

  const presets = $('presets');
  if (presets && cfg.presets) {
    presets.addEventListener('click', e => {
      const b = e.target.closest('button[data-p]'); if (!b) return;
      const lines = cfg.presets[b.dataset.p].lines.concat(['DONE']);
      term.feed(lines);
    });
  }

  if (cfg.rows) $('out').style.setProperty('--rows', cfg.rows);
  start(cfg.programs[0].id);
})();
