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

  function start(id) {
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
