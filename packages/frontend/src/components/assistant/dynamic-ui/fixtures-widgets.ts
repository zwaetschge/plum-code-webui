/**
 * Hand-made custom tiles (type "widget") for /chat/ui-demo: quality references
 * for what a model tile should look like. Plain HTML strings (String.raw, no
 * interpolation) so Android can copy them verbatim into its preview screen.
 * They follow the prompt rules: no network, --plum-* colours only, labelled
 * controls, ≥ 40 px touch targets, state through plum.setState.
 */

/** 1. Fokus-Timer: 25/5 or 50/10, survives reloads (end time in plum.state). */
export const WIDGET_POMODORO = String.raw`<div class="pomo" id="app">
  <div class="dial" id="dial">
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <circle class="track" cx="100" cy="100" r="88"></circle>
      <circle class="prog" id="prog" cx="100" cy="100" r="88"></circle>
    </svg>
    <div class="readout">
      <span class="phase" id="phase">Fokus</span>
      <span class="time" id="time" role="timer" aria-live="off">25:00</span>
      <span class="sub" id="sub">Runde 1</span>
    </div>
  </div>
  <div class="side">
    <div class="seg" role="radiogroup" aria-label="Rhythmus">
      <button role="radio" data-preset="25-5">25 / 5</button>
      <button role="radio" data-preset="50-10">50 / 10</button>
    </div>
    <p class="hint" id="hint"></p>
    <div class="rounds">
      <span class="dots" id="dots" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <span id="count" class="muted"></span>
    </div>
    <div class="actions">
      <button class="primary go" id="go">Start</button>
      <button id="skip">Überspringen</button>
      <button id="reset" class="icon" aria-label="Zurücksetzen" title="Zurücksetzen">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M3 4v5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
    <button class="ghost" id="tips">Ideen für die Pause</button>
  </div>
</div>
<style>
  .pomo { --ring: var(--plum-accent); display: grid; gap: 18px; justify-items: center; }
  .pomo.is-break { --ring: var(--plum-chart-2); }
  @media (min-width: 540px) {
    .pomo { grid-template-columns: 208px minmax(0, 1fr); justify-items: start; align-items: center; gap: 32px; padding: 4px 8px; }
  }
  .dial { position: relative; width: 208px; aspect-ratio: 1; border-radius: 50%; }
  .dial svg { width: 100%; height: 100%; transform: rotate(-90deg); overflow: visible; }
  .track { fill: none; stroke: var(--plum-surface-2); stroke-width: 12; }
  .prog { fill: none; stroke: var(--ring); stroke-width: 12; stroke-linecap: round; stroke-dasharray: 552.92; transition: stroke-dashoffset 0.3s linear, stroke 0.5s ease; }
  .dial.is-running .prog { filter: drop-shadow(0 0 6px color-mix(in srgb, var(--ring) 55%, transparent)); }
  .dial.done { animation: pop 0.7s cubic-bezier(.2, .9, .3, 1.4); }
  @keyframes pop { 40% { transform: scale(1.05); } }
  .readout { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 4px; text-align: center; }
  .phase { font-size: 11.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ring); padding: 3px 10px; border-radius: 999px; background: color-mix(in srgb, var(--ring) 15%, transparent); transition: color 0.4s, background-color 0.4s; }
  .time { font-size: 48px; font-weight: 700; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; line-height: 1.05; }
  .sub { font-size: 12.5px; color: var(--plum-muted); }
  .side { display: grid; gap: 14px; justify-items: center; width: 100%; max-width: 360px; }
  .pomo.is-full { min-height: calc(100vh - 40px); align-content: center; justify-content: center; }
  @media (min-width: 540px) { .pomo.is-full { grid-template-columns: 300px minmax(0, 360px); gap: 56px; } }
  .pomo.is-full .dial { width: 300px; }
  .pomo.is-full .time { font-size: 68px; }
  @media (min-width: 540px) { .side { justify-items: start; } }
  .seg { display: inline-flex; padding: 3px; gap: 2px; border-radius: 12px; background: var(--plum-surface); border: 1px solid var(--plum-border); }
  .seg button { min-height: 34px; padding: 6px 14px; border: 0; background: transparent; color: var(--plum-muted); border-radius: 9px; }
  .seg button[aria-checked='true'] { background: var(--plum-surface-2); color: var(--plum-text); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18); }
  .hint { margin: 0; font-size: 13.5px; color: var(--plum-muted); text-align: center; min-height: 2.9em; }
  @media (min-width: 540px) { .hint { text-align: left; } }
  .rounds { display: flex; align-items: center; gap: 10px; font-size: 12.5px; }
  .dots { display: inline-flex; gap: 6px; }
  .dots i { width: 10px; height: 10px; border-radius: 50%; background: var(--plum-surface-2); border: 1px solid var(--plum-border); transition: background-color 0.3s, transform 0.3s; }
  .dots i.on { background: var(--plum-accent); border-color: transparent; transform: scale(1.1); }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
  .go { min-width: 112px; min-height: 42px; }
  .actions button { min-height: 42px; }
  .icon { width: 42px; padding: 0; }
  .ghost { background: none; border: 0; color: var(--plum-accent); padding: 4px 2px; min-height: 36px; font-size: 13px; }
  .ghost:hover { text-decoration: underline; text-underline-offset: 3px; filter: none; }
</style>
<script>
(function () {
  var PRESETS = { '25-5': [25, 5], '50-10': [50, 10] };
  var C = 2 * Math.PI * 88;
  var $ = function (id) { return document.getElementById(id); };
  var app = $('app');
  var s = Object.assign({ preset: '25-5', phase: 'focus', left: 1500, endsAt: 0, rounds: 0 }, plum.state);
  if (!PRESETS[s.preset]) s.preset = '25-5';
  var timer = 0;
  function len(phase) { return PRESETS[s.preset][phase === 'focus' ? 0 : 1] * 60; }
  function left() { return s.endsAt ? Math.max(0, Math.ceil((s.endsAt - Date.now()) / 1000)) : Math.min(s.left, len(s.phase)); }
  function save() { plum.setState({ preset: s.preset, phase: s.phase, left: s.left, endsAt: s.endsAt, rounds: s.rounds }); }
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function schedule() { clearInterval(timer); timer = s.endsAt ? setInterval(tick, 250) : 0; }
  // A finished focus round starts the break by itself; the next round waits for you.
  function next(counted) {
    var focus = s.phase === 'focus';
    if (focus && counted) s.rounds++;
    s.phase = focus ? 'break' : 'focus';
    s.left = len(s.phase);
    s.endsAt = focus && counted ? Date.now() + s.left * 1000 : 0;
    save();
    schedule();
    var dial = $('dial');
    dial.classList.remove('done');
    void dial.offsetWidth;
    dial.classList.add('done');
  }
  function tick() { if (s.endsAt && left() <= 0) next(true); render(); }
  function render() {
    var t = left(), total = len(s.phase), running = !!s.endsAt, p = PRESETS[s.preset];
    app.classList.toggle('is-break', s.phase === 'break');
    $('dial').classList.toggle('is-running', running);
    $('time').textContent = two(Math.floor(t / 60)) + ':' + two(t % 60);
    $('phase').textContent = s.phase === 'focus' ? 'Fokus' : 'Pause';
    $('prog').style.strokeDashoffset = String(C * (1 - t / total));
    $('sub').textContent = s.phase === 'focus' ? 'Runde ' + (s.rounds + 1) : 'danach Runde ' + (s.rounds + 1);
    $('hint').textContent = s.phase === 'focus'
      ? p[0] + ' Minuten konzentriert arbeiten, danach ' + p[1] + ' Minuten Pause. Benachrichtigungen aus, eine Aufgabe.'
      : 'Kurz aufstehen, etwas trinken, in die Ferne schauen. Danach geht es mit Runde ' + (s.rounds + 1) + ' weiter.';
    var go = $('go');
    go.textContent = running ? 'Pause' : t < total ? 'Weiter' : 'Start';
    var filled = s.rounds % 4 === 0 && s.rounds > 0 ? 4 : s.rounds % 4;
    [].forEach.call($('dots').children, function (dot, i) { dot.classList.toggle('on', i < filled); });
    $('count').textContent = s.rounds === 1 ? '1 Fokusrunde geschafft' : s.rounds + ' Fokusrunden geschafft';
    [].forEach.call(document.querySelectorAll('[data-preset]'), function (b) {
      b.setAttribute('aria-checked', String(b.dataset.preset === s.preset));
    });
  }
  $('go').onclick = function () {
    if (s.endsAt) { s.left = left(); s.endsAt = 0; } else { s.left = left(); s.endsAt = Date.now() + s.left * 1000; }
    save(); schedule(); render();
  };
  $('skip').onclick = function () { next(false); render(); };
  $('reset').onclick = function () { s.phase = 'focus'; s.left = len('focus'); s.endsAt = 0; save(); schedule(); render(); };
  [].forEach.call(document.querySelectorAll('[data-preset]'), function (b) {
    b.onclick = function () { s.preset = b.dataset.preset; s.left = len(s.phase); s.endsAt = 0; save(); schedule(); render(); };
  });
  $('tips').onclick = function () {
    plum.sendMessage('Gib mir drei kurze Ideen für eine ' + PRESETS[s.preset][1] + '-Minuten-Pause am Schreibtisch.');
  };
  // Fullscreen: centred and larger.
  var full = function (mode) { app.classList.toggle('is-full', mode === 'fullscreen'); };
  plum.on('display', full);
  full(plum.display);
  if (s.endsAt && left() <= 0) next(true);
  schedule();
  render();
})();
</script>`;

/** 2. Regen-Würfel: rain risk of a walk from live weather, checked by simulation. */
export const WIDGET_RAIN_DICE = String.raw`<div class="rain" id="app"></div>
<style>
  .rain { display: grid; gap: 16px; }
  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .head h3 { margin: 0; font-size: 15px; }
  .place { margin: 2px 0 0; font-size: 12.5px; color: var(--plum-muted); }
  .controls { display: grid; gap: 10px; }
  .label { font-size: 12px; font-weight: 600; color: var(--plum-muted); margin-bottom: 6px; }
  .chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
  .chips button { flex: 0 0 auto; min-height: 36px; padding: 6px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; }
  .chips button[aria-pressed='true'] { background: var(--plum-accent); color: var(--plum-accent-text); border-color: transparent; }
  .bars { position: relative; display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 4px; align-items: end; height: 112px; padding-top: 18px; }
  .bar { position: relative; height: 100%; }
  .bar i { position: absolute; left: 0; right: 0; bottom: 0; height: var(--h); border-radius: 6px 6px 3px 3px; background: var(--plum-surface-2); transition: background-color 0.25s; }
  .bar.in i { background: var(--plum-accent); }
  .bar b { position: absolute; left: -2px; right: -2px; bottom: calc(var(--h) + 3px); text-align: center; font-size: 10.5px; font-weight: 600; color: var(--plum-muted); font-variant-numeric: tabular-nums; }
  .bar.in b { color: var(--plum-text); }
  .hours { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 4px; margin-top: 6px; font-size: 10.5px; color: var(--plum-muted); text-align: center; }
  .hours span { overflow: hidden; white-space: nowrap; }
  .result { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 16px; align-items: center; padding: 14px; border-radius: var(--plum-radius); background: var(--plum-surface); border: 1px solid var(--plum-border); }
  .gauge { position: relative; width: 84px; height: 84px; }
  .gauge svg { width: 100%; height: 100%; transform: rotate(-90deg); }
  .gauge .t { fill: none; stroke: var(--plum-surface-2); stroke-width: 9; }
  .gauge .v { fill: none; stroke: var(--tone); stroke-width: 9; stroke-linecap: round; stroke-dasharray: 213.6; transition: stroke-dashoffset 0.6s cubic-bezier(.16, 1, .3, 1), stroke 0.3s; }
  .gauge strong { position: absolute; inset: 0; display: grid; place-items: center; font-size: 21px; font-variant-numeric: tabular-nums; }
  .verdict { margin: 0; font-size: 15px; font-weight: 650; color: var(--tone); }
  .why { margin: 2px 0 0; font-size: 12.5px; color: var(--plum-muted); }
  .sim { display: grid; gap: 10px; }
  .simbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .roll { min-height: 42px; }
  .die { width: 22px; height: 22px; }
  .rolling .die { animation: spin 0.6s cubic-bezier(.3, .7, .4, 1); }
  @keyframes spin { to { transform: rotate(360deg) scale(1); } 50% { transform: rotate(200deg) scale(1.2); } }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(22px, 1fr)); gap: 5px; }
  .grid span { aspect-ratio: 1; border-radius: 7px; display: grid; place-items: center; background: var(--plum-surface); border: 1px solid var(--plum-border); opacity: 0; transform: scale(0.6); animation: drop 0.35s cubic-bezier(.2, .9, .3, 1.3) forwards; animation-delay: calc(var(--i) * 18ms); }
  .grid span.wet { background: color-mix(in srgb, var(--plum-accent) 20%, transparent); border-color: color-mix(in srgb, var(--plum-accent) 45%, transparent); color: var(--plum-accent); }
  .grid span.dry { color: var(--plum-warn); }
  .grid svg { width: 13px; height: 13px; }
  @keyframes drop { to { opacity: 1; transform: none; } }
  .tally { margin: 0; font-size: 13px; color: var(--plum-muted); }
  .tally b { color: var(--plum-text); }
  .empty { display: grid; gap: 10px; padding: 8px 0; color: var(--plum-muted); font-size: 13px; }
  .sk { height: 12px; border-radius: 7px; background: linear-gradient(90deg, var(--plum-surface), var(--plum-surface-2), var(--plum-surface)) 0 0 / 200% 100%; animation: sh 1.4s linear infinite; }
  @keyframes sh { to { background-position: -200% 0; } }
  .source { margin: 0; font-size: 11.5px; color: var(--plum-muted); }
  .source a { color: inherit; }
</style>
<script>
(function () {
  var app = document.getElementById('app');
  var s = Object.assign({ start: 0, hours: 2 }, plum.state);
  var built = false, sim = null;
  var DROP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s6 6.4 6 10.5A6 6 0 0 1 6 13.5C6 9.4 12 3 12 3Z" fill="currentColor"/></svg>';
  var SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pct(v) { return Math.round(v * 100) + ' %'; }
  function hoursOf(data) { return (data.hourly || []).slice(0, 12); }
  function windowOf(hours) { return hours.slice(s.start, s.start + s.hours); }
  function risk(list) { return 1 - list.reduce(function (dry, h) { return dry * (1 - (h.precip_chance || 0) / 100); }, 1); }
  function state() { return plum.live.wetter || { status: 'pending' }; }
  function render() {
    var l = state();
    if (l.status !== 'resolved' || !l.data) {
      built = false;
      app.innerHTML = l.status === 'failed'
        ? '<div class="empty"><strong>Keine Wetterdaten</strong><span>' + esc(l.error || 'Die Quelle antwortet gerade nicht.') + '</span><button id="retry">Erneut versuchen</button></div>'
        : '<div class="empty" aria-label="Wetterdaten werden geladen"><span>Wetterdaten werden geladen …</span><div class="sk" style="width:60%"></div><div class="sk" style="height:88px"></div><div class="sk" style="width:40%"></div></div>';
      var retry = document.getElementById('retry');
      if (retry) retry.onclick = function () { plum.refresh('wetter'); retry.disabled = true; };
      return;
    }
    var data = l.data, hours = hoursOf(data);
    if (s.start > hours.length - 1) s.start = 0;
    if (!built) build(data, hours);
    update(hours);
  }
  function build(data, hours) {
    built = true;
    var cur = data.current || {};
    app.innerHTML =
      '<div class="head"><div><h3>Wirst du nass?</h3><p class="place">' + esc(data.location && data.location.label) +
      (cur.temperature_c != null ? ' · jetzt ' + Math.round(cur.temperature_c) + ' °C, ' + esc(cur.description) : '') + '</p></div></div>' +
      '<div class="controls"><div><div class="label" id="l-start">Los geht es</div><div class="chips" role="group" aria-labelledby="l-start">' +
      hours.slice(0, 8).map(function (h, i) { return '<button data-start="' + i + '">' + esc(h.label) + '</button>'; }).join('') +
      '</div></div><div><div class="label" id="l-len">Unterwegs</div><div class="chips" role="group" aria-labelledby="l-len">' +
      [1, 2, 3, 4].map(function (n) { return '<button data-hours="' + n + '">' + n + ' Std.</button>'; }).join('') + '</div></div></div>' +
      '<div><div class="bars" id="bars" role="img" aria-label="Regenwahrscheinlichkeit der nächsten 12 Stunden">' +
      hours.map(function (h) { return '<div class="bar" style="--h:' + Math.max(3, h.precip_chance || 0) + '%"><b>' + (h.precip_chance || 0) + '</b><i></i></div>'; }).join('') +
      '</div><div class="hours" aria-hidden="true">' + hours.map(function (h, i) { return '<span>' + (i % 2 ? '' : esc(String(h.label).replace(' Uhr', ''))) + '</span>'; }).join('') + '</div></div>' +
      '<div class="result" id="result"><div class="gauge"><svg viewBox="0 0 84 84"><circle class="t" cx="42" cy="42" r="34"/><circle class="v" id="gv" cx="42" cy="42" r="34"/></svg><strong id="gp">0 %</strong></div>' +
      '<div><p class="verdict" id="verdict"></p><p class="why" id="why"></p></div></div>' +
      '<div class="sim"><div class="simbar"><p class="tally" id="tally">Würfle 40 Spaziergänge mit diesen Wahrscheinlichkeiten durch.</p>' +
      '<button class="primary roll" id="roll"><svg class="die" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.6" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>Würfeln</button></div>' +
      '<div class="grid" id="grid" aria-live="polite"></div></div>' +
      '<p class="source">Quelle: <a href="#" id="src">' + esc(data.source && data.source.name) + '</a> · Stunden gelten als unabhängig</p>';
    [].forEach.call(app.querySelectorAll('[data-start]'), function (b) { b.onclick = function () { s.start = +b.dataset.start; sim = null; plum.setState({ start: s.start }); update(hoursOf(state().data)); }; });
    [].forEach.call(app.querySelectorAll('[data-hours]'), function (b) { b.onclick = function () { s.hours = +b.dataset.hours; sim = null; plum.setState({ hours: s.hours }); update(hoursOf(state().data)); }; });
    document.getElementById('roll').onclick = roll;
    document.getElementById('src').onclick = function (e) { e.preventDefault(); if (data.source && data.source.url) plum.openUrl(data.source.url); };
  }
  function update(hours) {
    var win = windowOf(hours), p = risk(win);
    [].forEach.call(app.querySelectorAll('[data-start]'), function (b) { b.setAttribute('aria-pressed', String(+b.dataset.start === s.start)); });
    [].forEach.call(app.querySelectorAll('[data-hours]'), function (b) { b.setAttribute('aria-pressed', String(+b.dataset.hours === s.hours)); });
    [].forEach.call(document.getElementById('bars').children, function (bar, i) { bar.classList.toggle('in', i >= s.start && i < s.start + s.hours); });
    var tone = p < 0.2 ? 'var(--plum-good)' : p < 0.5 ? 'var(--plum-warn)' : 'var(--plum-bad)';
    var result = document.getElementById('result');
    result.style.setProperty('--tone', tone);
    document.getElementById('gv').style.strokeDashoffset = String(213.6 * (1 - p));
    document.getElementById('gp').textContent = pct(p);
    document.getElementById('verdict').textContent = p < 0.2 ? 'Schirm kann zu Hause bleiben' : p < 0.5 ? 'Knirps einpacken' : 'Lieber den grossen Schirm';
    var peak = win.reduce(function (a, h) { return (h.precip_chance || 0) > (a.precip_chance || 0) ? h : a; }, win[0] || {});
    var when = !win[0] || win[0].label === 'Jetzt' ? 'jetzt' : 'um ' + win[0].label;
    document.getElementById('why').textContent = 'Chance auf mindestens einen Schauer, wenn du ' + when + ' losgehst und ' + s.hours + ' Std. unterwegs bist.' +
      (peak && peak.precip_chance ? ' Am heikelsten: ' + peak.label + ' (' + peak.precip_chance + ' %).' : '');
    if (!sim) { document.getElementById('grid').innerHTML = ''; document.getElementById('tally').innerHTML = 'Würfle 40 Spaziergänge mit diesen Wahrscheinlichkeiten durch.'; }
  }
  function roll() {
    var hours = hoursOf(state().data), win = windowOf(hours), runs = 40, wet = 0, cells = [];
    for (var r = 0; r < runs; r++) {
      var hit = win.some(function (h) { return Math.random() < (h.precip_chance || 0) / 100; });
      if (hit) wet++;
      cells.push(hit);
    }
    sim = { wet: wet, runs: runs };
    var btn = document.getElementById('roll');
    btn.classList.remove('rolling'); void btn.offsetWidth; btn.classList.add('rolling');
    document.getElementById('grid').innerHTML = cells.map(function (hit, i) {
      return '<span class="' + (hit ? 'wet' : 'dry') + '" style="--i:' + i + '" title="' + (hit ? 'nass' : 'trocken') + '">' + (hit ? DROP : SUN) + '</span>';
    }).join('');
    document.getElementById('tally').innerHTML = '<b>' + wet + ' von ' + runs + '</b> Spaziergängen wurden nass (' + Math.round(wet / runs * 100) + ' %). Berechnet: ' + pct(risk(win)) + '.';
  }
  plum.on('live', render);
  render();
})();
</script>`;

/** 3. Hypothek: annuity with extra repayments, SVG chart with hover, schedule table. */
export const WIDGET_LOAN = String.raw`<div class="loan" id="app">
  <div class="inputs">
    <label class="field"><span>Kreditbetrag <output id="o-amount"></output></span>
      <input type="range" id="amount" min="50000" max="1500000" step="10000" aria-describedby="o-amount" /></label>
    <label class="field"><span>Zinssatz <output id="o-rate"></output></span>
      <input type="range" id="rate" min="0.5" max="7" step="0.05" aria-describedby="o-rate" /></label>
    <label class="field"><span>Laufzeit <output id="o-years"></output></span>
      <input type="range" id="years" min="5" max="35" step="1" aria-describedby="o-years" /></label>
    <label class="field"><span>Zusätzlich pro Monat <output id="o-extra"></output></span>
      <input type="range" id="extra" min="0" max="3000" step="50" aria-describedby="o-extra" /></label>
  </div>
  <div class="kpis">
    <div class="kpi"><span>Monatliche Rate</span><strong id="k-rate"></strong><small id="k-rate-sub"></small></div>
    <div class="kpi"><span>Zinskosten total</span><strong id="k-interest"></strong><small id="k-interest-sub"></small></div>
    <div class="kpi"><span>Schuldenfrei nach</span><strong id="k-free"></strong><small id="k-free-sub"></small></div>
  </div>
  <div class="chart" id="chart">
    <div class="legend">
      <span><i style="background:var(--plum-accent)"></i>Restschuld</span>
      <span><i style="background:var(--plum-chart-4)"></i>Bezahlte Zinsen</span>
      <span id="lg-base" hidden><i class="dash"></i>ohne Zusatz</span>
    </div>
    <svg id="svg" role="img" aria-label="Restschuld und bezahlte Zinsen pro Jahr"></svg>
    <div class="tip" id="tip" hidden></div>
  </div>
  <details id="plan">
    <summary>Tilgungsplan nach Jahren</summary>
    <div class="scroll"><table><thead><tr><th>Jahr</th><th>Zinsen</th><th>Tilgung</th><th>Restschuld</th></tr></thead><tbody id="rows"></tbody></table></div>
  </details>
</div>
<style>
  .loan { display: grid; gap: 18px; }
  .inputs { display: grid; gap: 14px 28px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
  .field { display: grid; gap: 6px; font-size: 13px; color: var(--plum-muted); }
  .field span { display: flex; justify-content: space-between; gap: 8px; }
  .field output { color: var(--plum-text); font-weight: 650; font-variant-numeric: tabular-nums; }
  .field input { height: 24px; cursor: pointer; }
  .kpis { display: grid; gap: 10px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  @media (max-width: 520px) { .kpis { grid-template-columns: 1fr 1fr; } .kpi:first-child { grid-column: 1 / -1; } }
  .kpi { display: grid; gap: 2px; padding: 12px 14px; border-radius: var(--plum-radius); background: var(--plum-surface); border: 1px solid var(--plum-border); min-width: 0; }
  .kpi span { font-size: 12px; color: var(--plum-muted); }
  .kpi strong { font-size: 20px; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kpi small { font-size: 12px; color: var(--plum-muted); min-height: 1.4em; }
  .kpi small.good { color: var(--plum-good); font-weight: 600; }
  .chart { position: relative; }
  .legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: var(--plum-muted); margin-bottom: 6px; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
  .legend i.dash { height: 0; border-top: 2px dashed var(--plum-muted); border-radius: 0; vertical-align: 3px; }
  svg { display: block; width: 100%; height: 220px; overflow: visible; touch-action: pan-y; }
  .grid line { stroke: var(--plum-border); }
  .axis text { fill: var(--plum-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  .area { fill: url(#fill); }
  .line { fill: none; stroke: var(--plum-accent); stroke-width: 2.25; stroke-linejoin: round; }
  .interest { fill: none; stroke: var(--plum-chart-4); stroke-width: 2.25; stroke-linejoin: round; }
  .base { fill: none; stroke: var(--plum-muted); stroke-width: 1.5; stroke-dasharray: 5 4; opacity: 0.8; }
  .cursor { stroke: var(--plum-text); stroke-opacity: 0.35; }
  .dot { stroke: var(--plum-bg, transparent); stroke-width: 2; }
  .tip { position: absolute; top: 28px; pointer-events: none; min-width: 168px; padding: 9px 11px; border-radius: 12px; font-size: 12px; line-height: 1.5; background: var(--plum-text); color: #111318; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25); font-variant-numeric: tabular-nums; }
  :root[data-theme='light'] .tip { color: #fff; }
  .tip b { display: block; margin-bottom: 2px; }
  .tip em { font-style: normal; font-weight: 600; }
  .tip span { display: flex; justify-content: space-between; gap: 12px; }
  details { border-top: 1px solid var(--plum-border); padding-top: 12px; }
  summary { cursor: pointer; font-size: 13px; font-weight: 600; color: var(--plum-accent); min-height: 32px; display: flex; align-items: center; }
  .scroll { max-height: 260px; overflow: auto; margin-top: 8px; }
  td, th { text-align: right; font-size: 12.5px; white-space: nowrap; }
  td:first-child, th:first-child { text-align: left; }
  thead th { position: sticky; top: 0; background: var(--plum-surface-2); backdrop-filter: blur(8px); }
</style>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var f = plum.format;
  var s = Object.assign({ amount: 600000, rate: 2.4, years: 25, extra: 0 }, plum.props, plum.state);
  var CHF = function (v) { return f.currency(Math.round(v), 'CHF', 0); };
  var short = function (v) { return v >= 1e6 ? f.number(v / 1e6, 1) + ' Mio.' : f.number(Math.round(v / 1000)) + 'k'; };
  ['amount', 'rate', 'years', 'extra'].forEach(function (key) {
    var input = $(key);
    input.value = s[key];
    input.addEventListener('input', function () { s[key] = +input.value; draw(); });
    input.addEventListener('change', function () { var o = {}; o[key] = s[key]; plum.setState(o); });
  });
  function payment(p, r, n) { return r === 0 ? p / n : (p * r) / (1 - Math.pow(1 + r, -n)); }
  // Monthly simulation; one row per year: interest, principal, balance.
  function schedule(extra) {
    var r = s.rate / 100 / 12, n = s.years * 12, pay = payment(s.amount, r, n) + extra;
    var balance = s.amount, paidInterest = 0, rows = [{ year: 0, balance: balance, interest: 0, principal: 0, cum: 0 }];
    var year = { interest: 0, principal: 0 }, months = 0;
    while (balance > 0.5 && months < n) {
      var i = balance * r, p = Math.min(balance, pay - i);
      balance -= p; paidInterest += i; months++;
      year.interest += i; year.principal += p;
      if (months % 12 === 0 || balance <= 0.5) {
        rows.push({ year: Math.ceil(months / 12), balance: Math.max(0, balance), interest: year.interest, principal: year.principal, cum: paidInterest });
        year = { interest: 0, principal: 0 };
      }
    }
    return { rows: rows, months: months, interest: paidInterest, pay: pay };
  }
  function duration(m) {
    var y = Math.floor(m / 12), r = m % 12;
    if (!r) return y + (y === 1 ? ' Jahr' : ' Jahre');
    return (y ? y + ' J. ' : '') + r + ' Mt.';
  }
  var plan, base;
  function draw() {
    $('o-amount').textContent = CHF(s.amount);
    $('o-rate').textContent = f.number(s.rate, 2) + ' %';
    $('o-years').textContent = s.years + ' Jahre';
    $('o-extra').textContent = s.extra ? '+ ' + CHF(s.extra) : 'keine';
    base = schedule(0);
    plan = s.extra ? schedule(s.extra) : base;
    $('k-rate').textContent = CHF(plan.pay);
    $('k-rate-sub').textContent = s.extra ? 'davon ' + CHF(s.extra) + ' zusätzlich' : 'Zins und Tilgung';
    $('k-interest').textContent = CHF(plan.interest);
    var saved = base.interest - plan.interest;
    var sub = $('k-interest-sub');
    sub.textContent = s.extra && saved > 1 ? CHF(saved) + ' gespart' : f.percent((plan.interest / s.amount) * 100, 0) + ' des Kredits';
    sub.className = s.extra && saved > 1 ? 'good' : '';
    $('k-free').textContent = duration(plan.months);
    var earlier = base.months - plan.months, fs = $('k-free-sub');
    fs.textContent = earlier > 0 ? duration(earlier) + ' früher' : 'nach Plan';
    fs.className = earlier > 0 ? 'good' : '';
    $('lg-base').hidden = !s.extra;
    chart();
    $('rows').innerHTML = plan.rows.slice(1).map(function (row) {
      return '<tr><td>' + row.year + '</td><td>' + CHF(row.interest) + '</td><td>' + CHF(row.principal) + '</td><td>' + CHF(row.balance) + '</td></tr>';
    }).join('');
  }
  var geo;
  function chart() {
    var svg = $('svg'), W = Math.max(280, Math.round(svg.getBoundingClientRect().width)), H = 220, L = 46, R = 8, T = 8, B = 24;
    var years = s.years, max = s.amount;
    var x = function (y) { return L + (y / years) * (W - L - R); };
    var y = function (v) { return T + (1 - v / max) * (H - T - B); };
    var path = function (rows, key) { return rows.map(function (r, i) { return (i ? 'L' : 'M') + x(r.year).toFixed(1) + ' ' + y(r[key]).toFixed(1); }).join(''); };
    var ticks = '', step = years > 20 ? 5 : years > 10 ? 2 : 1;
    for (var t = 0; t <= 4; t++) {
      var v = (max * t) / 4;
      ticks += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>';
    }
    var labels = '';
    for (t = 0; t <= 4; t += 2) labels += '<text x="' + (L - 8) + '" y="' + (y((max * t) / 4) + 4) + '" text-anchor="end">' + (t ? short((max * t) / 4) : '0') + '</text>';
    for (var yr = 0; yr <= years; yr += step) labels += '<text x="' + x(yr) + '" y="' + (H - 6) + '" text-anchor="middle">' + yr + '</text>';
    var rows = plan.rows, last = rows[rows.length - 1];
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML =
      '<defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--plum-accent)" stop-opacity=".32"/><stop offset="1" stop-color="var(--plum-accent)" stop-opacity="0"/></linearGradient></defs>' +
      '<g class="grid">' + ticks + '</g><g class="axis">' + labels + '</g>' +
      (s.extra ? '<path class="base" d="' + path(base.rows, 'balance') + '"/>' : '') +
      '<path class="area" d="' + path(rows, 'balance') + 'L' + x(last.year) + ' ' + y(0) + 'L' + x(0) + ' ' + y(0) + 'Z"/>' +
      '<path class="line" d="' + path(rows, 'balance') + '"/>' +
      '<path class="interest" d="' + path(rows, 'cum') + '"/>' +
      '<g id="cur" visibility="hidden"><line class="cursor" id="cl" y1="' + T + '" y2="' + (H - B) + '"/><circle class="dot" id="c1" r="4.5" fill="var(--plum-accent)"/><circle class="dot" id="c2" r="4.5" fill="var(--plum-chart-4)"/></g>';
    geo = { x: x, y: y, W: W, L: L, R: R, years: years };
  }
  function hover(e) {
    if (!geo) return;
    var box = $('svg').getBoundingClientRect(), px = ((e.clientX - box.left) / box.width) * geo.W;
    var yr = Math.round(((px - geo.L) / (geo.W - geo.L - geo.R)) * geo.years);
    var row = plan.rows[Math.max(0, Math.min(plan.rows.length - 1, yr))];
    if (!row) return;
    var cx = geo.x(row.year);
    $('cur').setAttribute('visibility', 'visible');
    $('cl').setAttribute('x1', cx); $('cl').setAttribute('x2', cx);
    $('c1').setAttribute('cx', cx); $('c1').setAttribute('cy', geo.y(row.balance));
    $('c2').setAttribute('cx', cx); $('c2').setAttribute('cy', geo.y(row.cum));
    var tip = $('tip');
    tip.hidden = false;
    tip.innerHTML = '<b>Nach ' + row.year + (row.year === 1 ? ' Jahr' : ' Jahren') + '</b><span>Restschuld <em>' + CHF(row.balance) + '</em></span><span>Zinsen bisher <em>' + CHF(row.cum) + '</em></span>';
    var left = (cx / geo.W) * box.width;
    tip.style.left = Math.min(box.width - tip.offsetWidth, Math.max(0, left > box.width / 2 ? left - tip.offsetWidth - 12 : left + 12)) + 'px';
  }
  var svgEl = $('svg');
  svgEl.addEventListener('pointermove', hover);
  svgEl.addEventListener('pointerdown', hover);
  svgEl.addEventListener('pointerleave', function () { $('tip').hidden = true; var c = $('cur'); if (c) c.setAttribute('visibility', 'hidden'); });
  new ResizeObserver(function () { if (plan) chart(); }).observe(svgEl);
  draw();
})();
</script>`;

/** 4. Schweizer Memory: 8 pairs, moves/time/best saved in plum.state. */
export const WIDGET_MEMORY = String.raw`<div class="memory" id="app">
  <div class="bar">
    <div class="stats" aria-live="polite">
      <span><small>Züge</small><b id="moves">0</b></span>
      <span><small>Zeit</small><b id="time">0:00</b></span>
      <span><small>Paare</small><b id="pairs">0/8</b></span>
      <span id="best-wrap" hidden><small>Bestwert</small><b id="best"></b></span>
    </div>
    <button id="new">Neu mischen</button>
  </div>
  <div class="board-wrap">
    <div class="board" id="board" role="grid" aria-label="Memory-Karten"></div>
    <div class="win" id="win" hidden>
      <div class="win-card" role="status">
        <svg class="burst" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.4 5.6L20 8.4l-4.3 3.9 1.2 5.9L12 15.3 7.1 18.2l1.2-5.9L4 8.4l5.6-.8Z" fill="currentColor"/></svg>
        <h3>Geschafft!</h3>
        <p id="win-text"></p>
        <div class="win-actions"><button class="primary" id="again">Nochmal spielen</button><button id="share">Ergebnis kopieren</button></div>
      </div>
    </div>
  </div>
</div>
<style>
  .memory { display: grid; gap: 14px; max-width: 440px; margin: 0 auto; }
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .stats { display: flex; gap: 18px; }
  .stats span { display: grid; line-height: 1.2; }
  .stats span[hidden] { display: none; }
  .stats small { font-size: 11px; color: var(--plum-muted); }
  .stats b { font-size: 17px; font-variant-numeric: tabular-nums; }
  .board-wrap { position: relative; }
  .board { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
  .card { position: relative; display: block; width: 100%; aspect-ratio: 1; padding: 0; border: 0; background: none; border-radius: 16px; perspective: 900px; }
  .card:hover { filter: none; }
  .card:disabled { opacity: 1; cursor: default; }
  .inner { position: absolute; inset: 0; transform-style: preserve-3d; transition: transform 0.5s cubic-bezier(.2, .8, .2, 1); }
  .card.open .inner, .card.done .inner { transform: rotateY(180deg); }
  .face { position: absolute; inset: 0; display: grid; place-items: center; align-content: center; gap: 4px; border-radius: 16px; backface-visibility: hidden; -webkit-backface-visibility: hidden; border: 1px solid var(--plum-border); }
  .back { background: radial-gradient(120% 120% at 20% 0%, color-mix(in srgb, var(--plum-accent) 30%, transparent), transparent 60%), var(--plum-surface-2); }
  .back svg { width: 36%; height: auto; aspect-ratio: 1; filter: drop-shadow(0 2px 6px color-mix(in srgb, var(--plum-accent) 40%, transparent)); }
  .back rect { fill: var(--plum-accent); }
  .back path { fill: var(--plum-accent-text); }
  .card:hover .back { border-color: color-mix(in srgb, var(--plum-accent) 55%, transparent); }
  .front { transform: rotateY(180deg); background: var(--plum-surface); color: var(--c); }
  .front svg { width: 44%; height: auto; aspect-ratio: 1; }
  .front em { font-style: normal; font-size: 11px; font-weight: 600; color: var(--plum-muted); max-width: 92%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card.done .front { border-color: color-mix(in srgb, var(--c) 60%, transparent); background: color-mix(in srgb, var(--c) 14%, var(--plum-surface)); }
  .card.done .inner { animation: match 0.5s 0.15s ease-out; }
  @keyframes match { 50% { transform: rotateY(180deg) scale(1.07); } }
  .card.miss .inner { animation: miss 0.4s 0.35s ease-in-out; }
  @keyframes miss { 25% { transform: rotateY(180deg) translateX(-4px); } 75% { transform: rotateY(180deg) translateX(4px); } }
  .win { position: absolute; inset: -6px; display: grid; place-items: center; border-radius: 20px; background: color-mix(in srgb, var(--plum-surface-2) 60%, transparent); backdrop-filter: blur(6px); animation: fade 0.4s ease; }
  .win[hidden] { display: none; }
  @keyframes fade { from { opacity: 0; } }
  .win-card { text-align: center; padding: 20px; max-width: 320px; }
  .win-card h3 { font-size: 20px; margin: 6px 0; }
  .win-card p { color: var(--plum-muted); }
  .burst { width: 40px; height: 40px; color: var(--plum-warn); animation: rise 0.6s cubic-bezier(.2, .9, .3, 1.4); }
  @keyframes rise { from { transform: scale(0.3) rotate(-40deg); opacity: 0; } }
  .win-actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
  .win-actions button { min-height: 42px; }
</style>
<script>
(function () {
  var ICONS = [
    ['Matterhorn', 'var(--plum-chart-5)', '<path d="M2 20 9.5 5.5l3.2 5.3 2.1-3.1L22 20Z" fill="currentColor"/><path d="m9.5 5.5 2.4 4-1.3 1-1.1-1.2-1.3 1.1-.9-.8Z" fill="#fff"/>'],
    ['Käse', 'var(--plum-warn)', '<path d="M3 18.5v-7l13.5-6 4.5 6v7Z" fill="currentColor"/><path d="M3 11.5h18" stroke="rgba(0,0,0,.18)" stroke-width="1.2"/><circle cx="8" cy="15" r="1.6" fill="rgba(0,0,0,.22)"/><circle cx="15.5" cy="14.2" r="2" fill="rgba(0,0,0,.22)"/><circle cx="12" cy="8.8" r="1" fill="rgba(0,0,0,.18)"/>'],
    ['Schoggi', 'color-mix(in srgb, var(--plum-chart-6) 45%, #4a2a14)', '<rect x="5" y="2.5" width="14" height="19" rx="2.2" fill="currentColor"/><path d="M5 8.8h14M5 15.2h14M12 2.5v19" stroke="rgba(0,0,0,.25)" stroke-width="1.3"/>'],
    ['Uhr', 'var(--plum-chart-2)', '<rect x="9" y="1.5" width="6" height="5" rx="1.2" fill="currentColor"/><rect x="9" y="17.5" width="6" height="5" rx="1.2" fill="currentColor"/><circle cx="12" cy="12" r="7.2" fill="currentColor"/><circle cx="12" cy="12" r="5.4" fill="#fff"/><path d="M12 8.6V12l2.5 1.6" fill="none" stroke="#1f2430" stroke-width="1.6" stroke-linecap="round"/>'],
    ['Zahnradbahn', 'var(--plum-bad)', '<rect x="4.5" y="3" width="15" height="14.5" rx="3.2" fill="currentColor"/><rect x="7" y="5.6" width="10" height="5" rx="1.2" fill="#fff" opacity=".92"/><circle cx="8.6" cy="14" r="1.3" fill="#fff"/><circle cx="15.4" cy="14" r="1.3" fill="#fff"/><path d="m8 17.5-2.2 3.6M16 17.5l2.2 3.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'],
    ['Kuhglocke', 'var(--plum-chart-6)', '<path d="M12 2.5a2 2 0 0 1 2 2V6h-4V4.5a2 2 0 0 1 2-2Z" fill="currentColor"/><path d="M7.2 6h9.6L19 18.5H5Z" fill="currentColor"/><path d="M6.3 11.5h11.4" stroke="rgba(255,255,255,.55)" stroke-width="1.6"/><circle cx="12" cy="20" r="2" fill="currentColor"/>'],
    ['Schloss Chillon', 'var(--plum-chart-3)', '<path d="M3 21V9.5h2.2V7H7v2.5h2V7h1.8v2.5H13V7h1.8v2.5h2V7H19v2.5h2V21Z" fill="currentColor"/><path d="M10 21v-4.2a2 2 0 0 1 4 0V21Z" fill="rgba(0,0,0,.28)"/><rect x="5.5" y="12.5" width="2" height="2.6" rx=".6" fill="rgba(0,0,0,.22)"/><rect x="16.5" y="12.5" width="2" height="2.6" rx=".6" fill="rgba(0,0,0,.22)"/>'],
    ['Edelweiss', 'var(--plum-good)', '<g fill="currentColor"><ellipse cx="12" cy="5.8" rx="2.3" ry="4"/><ellipse cx="12" cy="5.8" rx="2.3" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="5.8" rx="2.3" ry="4" transform="rotate(120 12 12)"/><ellipse cx="12" cy="5.8" rx="2.3" ry="4" transform="rotate(180 12 12)"/><ellipse cx="12" cy="5.8" rx="2.3" ry="4" transform="rotate(240 12 12)"/><ellipse cx="12" cy="5.8" rx="2.3" ry="4" transform="rotate(300 12 12)"/></g><circle cx="12" cy="12" r="2.8" fill="#fde68a"/>']
  ];
  var BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6"/><path d="M9.5 5h5v4.5H19v5h-4.5V19h-5v-4.5H5v-5h4.5Z"/></svg>';
  var $ = function (id) { return document.getElementById(id); };
  var board = $('board');
  function shuffled() {
    var deck = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7];
    for (var i = deck.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
    return deck;
  }
  var saved = plum.state;
  var g = saved.deck && saved.deck.length === 16
    ? { deck: saved.deck, done: saved.done || [], moves: saved.moves || 0, time: saved.time || 0, best: saved.best || null }
    : { deck: shuffled(), done: [], moves: 0, time: 0, best: saved.best || null };
  var open = [], lock = false, clock = 0;
  function won() { return g.done.length === 8; }
  function save() { plum.setState({ deck: g.deck, done: g.done, moves: g.moves, time: g.time, best: g.best }); }
  function fmt(t) { return Math.floor(t / 60) + ':' + (t % 60 < 10 ? '0' : '') + (t % 60); }
  function startClock() {
    if (clock || won()) return;
    clock = setInterval(function () {
      if (document.hidden) return;
      g.time++;
      $('time').textContent = fmt(g.time);
      if (g.time % 5 === 0) save();
    }, 1000);
  }
  function stopClock() { clearInterval(clock); clock = 0; }
  function build() {
    board.innerHTML = g.deck.map(function (icon, i) {
      var item = ICONS[icon];
      return '<button class="card" data-i="' + i + '" style="--c:' + item[1] + '" aria-label="Karte ' + (i + 1) + ', verdeckt">' +
        '<span class="inner"><span class="face back">' + BACK + '</span><span class="face front"><svg viewBox="0 0 24 24" aria-hidden="true">' + item[2] + '</svg><em>' + item[0] + '</em></span></span></button>';
    }).join('');
    [].forEach.call(board.children, function (card) { card.onclick = function () { flip(+card.dataset.i); }; });
    update();
  }
  function update() {
    [].forEach.call(board.children, function (card, i) {
      var icon = g.deck[i], done = g.done.indexOf(icon) >= 0, isOpen = open.indexOf(i) >= 0;
      card.classList.toggle('done', done);
      card.classList.toggle('open', isOpen);
      card.setAttribute('aria-label', done || isOpen ? ICONS[icon][0] + (done ? ', gefunden' : ', aufgedeckt') : 'Karte ' + (i + 1) + ', verdeckt');
      card.disabled = done;
    });
    $('moves').textContent = g.moves;
    $('time').textContent = fmt(g.time);
    $('pairs').textContent = g.done.length + '/8';
    $('best-wrap').hidden = !g.best;
    if (g.best) $('best').textContent = g.best.moves + ' Züge';
    var win = $('win');
    win.hidden = !won();
    if (won()) $('win-text').textContent = 'Alle 8 Paare in ' + g.moves + ' Zügen und ' + fmt(g.time) + '.' + (g.best && g.best.moves === g.moves && g.best.fresh ? ' Neuer Bestwert!' : '');
  }
  function flip(i) {
    if (lock || open.indexOf(i) >= 0 || g.done.indexOf(g.deck[i]) >= 0 || won()) return;
    startClock();
    open.push(i);
    update();
    if (open.length < 2) return;
    g.moves++;
    var a = open[0], b = open[1];
    if (g.deck[a] === g.deck[b]) {
      g.done.push(g.deck[a]);
      open = [];
      if (won()) {
        stopClock();
        var fresh = !g.best || g.moves < g.best.moves;
        if (fresh) g.best = { moves: g.moves, time: g.time, fresh: true };
        else if (g.best) g.best.fresh = false;
      }
      save();
      update();
      return;
    }
    save();
    lock = true;
    [a, b].forEach(function (k) { board.children[k].classList.add('miss'); });
    setTimeout(function () {
      [a, b].forEach(function (k) { board.children[k].classList.remove('miss'); });
      open = [];
      lock = false;
      update();
    }, 950);
  }
  function reset() {
    stopClock();
    if (g.best) g.best.fresh = false;
    g = { deck: shuffled(), done: [], moves: 0, time: 0, best: g.best };
    open = [];
    save();
    build();
  }
  $('new').onclick = reset;
  $('again').onclick = reset;
  $('share').onclick = function () {
    plum.copy('Schweizer Memory: alle 8 Paare in ' + g.moves + ' Zügen und ' + fmt(g.time) + ' gefunden.');
  };
  build();
  if (!saved.deck) save();
  if (g.moves > 0 && !won()) startClock();
})();
</script>`;
