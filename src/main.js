import { Store } from './state.js';
import { buildPanel } from './ui/panel.js';
import { Patchbay } from './ui/patchbay.js';
import { AudioHost } from './audio/host.js';
import { Scope } from './ui/scope.js';
import { setLed, h } from './ui/controls.js';
import { RECIPES, RECIPE_BY_ID, recipeParams } from './patch/recipes.js';
import { INPUTS, PARAM_BY_ID } from './spec.js';

const STORAGE_KEY = 'the-easel/state/v1';
const DEFAULT_RECIPE = 'bell-garden';

const $ = (id) => document.getElementById(id);
const store = new Store();
const host = new AudioHost();

// ------------------------------------------------------------------ toast / a11y
const toastEl = $('toast');
let toastTimer = 0;
function toast(msg, ms = 3800) {
  toastEl.textContent = msg;
  toastEl.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('visible'), ms);
}
const announcer = $('announcer');
const announce = (msg) => {
  announcer.textContent = '';
  requestAnimationFrame(() => (announcer.textContent = msg));
};

// ------------------------------------------------------------------ panel
const panelEl = $('panel');
const { jacks, leds } = buildPanel(panelEl, store, {
  onKick: () => {
    host.send({ type: 'kick' });
    flash(leds.pulse);
  },
});

let currentNets = [];
const patchbay = new Patchbay({
  container: panelEl,
  jacks,
  announce,
  onChange: (nets) => {
    currentNets = nets;
    host.setPatch(nets);
    markOverrides(nets);
    markModified();
    scheduleSave();
  },
});

/** Dim the internal selector that a patched input overrides. */
function markOverrides(nets) {
  const driven = new Set();
  for (const n of nets) if (n.outs.length) for (const i of n.ins) driven.add(i);
  for (const input of INPUTS) {
    if (!input.overrides) continue;
    const on = driven.has(input.id);
    for (const el of panelEl.querySelectorAll(`[data-param="${input.overrides}"]`)) {
      if (el.classList.contains('slider-track') || el.classList.contains('knob-body')) continue;
      el.classList.toggle('overridden', on);
      if (on) el.title = `Overridden: a cable is in the ${input.label} jack`;
      else el.removeAttribute('title');
    }
  }
  for (const [id, el] of jacks) el.classList.toggle('driven', driven.has(id));
}

store.onAny((id, v) => {
  host.setParam(id, v);
  markModified();
  scheduleSave();
});

// ------------------------------------------------------------------ recipes
let currentRecipe = null;
let applying = false;
const presetSel = $('preset');
for (const r of RECIPES) presetSel.append(h('option', { value: r.id }, `${r.num}. ${r.name}`));
presetSel.append(h('option', { value: '__custom', disabled: true }, 'custom'));

function applyRecipe(id, { quiet = false } = {}) {
  const r = RECIPE_BY_ID[id];
  if (!r) return;
  applying = true;
  try {
    store.setAll(recipeParams(r), { reset: true });
    patchbay.load(r.cables);
  } finally {
    applying = false;
  }
  currentRecipe = id;
  modified = false;
  presetSel.value = id;
  renderNotes();
  if (host.running) {
    host.fadeTo(0, 0.03);
    setTimeout(() => {
      host.send({ type: 'panic' });
      host.fadeTo(1, 0.35);
    }, 40);
  }
  if (!quiet) announce(`Loaded ${r.name}`);
  scheduleSave();
}

presetSel.addEventListener('change', () => applyRecipe(presetSel.value));

let modified = false;
function markModified() {
  if (applying || !currentRecipe || modified) return;
  modified = true;
  renderNotes();
}

// ------------------------------------------------------------------ notes
const notesEl = $('notes');
const notesToggle = $('notes-toggle');
let notesOpen = true;
function renderNotes() {
  const r = RECIPE_BY_ID[currentRecipe];
  notesEl.hidden = !notesOpen || !r;
  notesToggle.setAttribute('aria-expanded', String(notesOpen && !!r));
  if (!r) return;
  notesEl.replaceChildren(
    ...[
    h(
      'div',
      { class: 'notes-head' },
      h('span', { class: 'notes-num' }, r.num),
      h('h2', {}, r.name),
      h('span', { class: 'notes-loops' }, r.loops),
      modified ? h('span', { class: 'notes-mod' }, 'modified') : null,
      h('button', { type: 'button', class: 'notes-close', 'aria-label': 'Hide notes', onclick: () => setNotes(false) }, '×'),
    ),
    h('p', {}, h('b', {}, 'Set: '), r.set),
    h('p', {}, h('b', {}, 'Result: '), r.result),
    r.tip ? h('p', { class: 'notes-tip' }, h('b', {}, 'Tip: '), r.tip) : null,
    ].filter(Boolean),
  );
}
function setNotes(open) {
  notesOpen = open;
  renderNotes();
  requestAnimationFrame(() => patchbay.refresh());
}
notesToggle.addEventListener('click', () => setNotes(!notesOpen));

// ------------------------------------------------------------------ persistence
let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 300);
}
function currentState() {
  return { v: 1, params: store.snapshot(), cables: patchbay.serialize(), recipe: currentRecipe, modified };
}
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentState()));
  } catch {
    /* storage unavailable (private mode etc.) - the patch simply isn't remembered */
  }
}
function applyState(state) {
  if (!state || typeof state !== 'object' || !state.params) return false;
  applying = true;
  try {
    store.setAll(state.params, { reset: true });
    patchbay.load(state.cables || []);
  } finally {
    applying = false;
  }
  currentRecipe = RECIPE_BY_ID[state.recipe] ? state.recipe : null;
  modified = !!state.modified || !currentRecipe;
  presetSel.value = currentRecipe && !modified ? currentRecipe : currentRecipe || '__custom';
  renderNotes();
  return true;
}
function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const b64 = {
  enc: (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))),
};
function stateFromHash() {
  const m = location.hash.match(/^#p=([\w-]+)$/);
  if (!m) return null;
  try {
    return JSON.parse(b64.dec(m[1]));
  } catch {
    toast('That share link could not be read.');
    return null;
  }
}

$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(currentState(), null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `easel-${currentRecipe || 'patch'}.json` });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
  closeMenus();
});
$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  closeMenus();
  if (!file) return;
  try {
    const state = JSON.parse(await file.text());
    if (!applyState(state)) throw new Error('not a patch');
    toast(`Loaded ${file.name}`);
    if (host.running) host.send({ type: 'panic' });
  } catch {
    toast('That file is not an Easel patch.');
  }
});
$('share').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#p=${b64.enc(JSON.stringify(currentState()))}`;
  closeMenus();
  try {
    await navigator.clipboard.writeText(url);
    toast('Share link copied.');
  } catch {
    history.replaceState(null, '', url);
    toast('Share link is in the address bar.');
  }
});
function closeMenus() {
  for (const d of document.querySelectorAll('details.menu[open]')) d.open = false;
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('details.menu')) closeMenus();
});

// ------------------------------------------------------------------ header tools
const CABLE_MODES = ['solid', 'dim', 'ghost'];
let cableMode = 0;
const cablesBtn = $('cables-mode');
function setCableMode(i) {
  cableMode = i % CABLE_MODES.length;
  panelEl.dataset.cables = CABLE_MODES[cableMode];
  cablesBtn.textContent = `cables: ${CABLE_MODES[cableMode]}`;
}
cablesBtn.addEventListener('click', () => setCableMode(cableMode + 1));
setCableMode(0);

$('clear').addEventListener('click', () => patchbay.clear());
$('panic').addEventListener('click', () => {
  host.send({ type: 'panic' });
  toast('Reset: oscillators, filters, loops and reverb cleared.');
});
$('quality').addEventListener('change', (e) => {
  host.setOversample(Number(e.target.value));
  try {
    localStorage.setItem(`${STORAGE_KEY}/quality`, e.target.value);
  } catch {
    /* ignore */
  }
});
try {
  const q = localStorage.getItem(`${STORAGE_KEY}/quality`);
  if (q && ['1', '2', '4'].includes(q)) {
    $('quality').value = q;
    host.oversample = Number(q);
  }
} catch {
  /* ignore */
}

const help = $('help');
$('help-btn').addEventListener('click', () => help.showModal());
help.addEventListener('click', (e) => {
  if (e.target === help) help.close();
});

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'c' || e.key === 'C') setCableMode(cableMode + 1);
  else if (e.key === '?') help.open ? help.close() : help.showModal();
});

// ------------------------------------------------------------------ power
const powerBtn = $('power');
const scope = new Scope($('scope'));
let warned = false;
powerBtn.addEventListener('click', async () => {
  const on = powerBtn.getAttribute('aria-pressed') !== 'true';
  if (on) {
    powerBtn.classList.add('busy');
    try {
      await host.start(() => ({ params: store.snapshot(), nets: currentNets }));
      scope.attach(host.analyser);
      powerBtn.setAttribute('aria-pressed', 'true');
      document.body.classList.add('powered');
      if (!warned) {
        warned = true;
        toast('Feedback patches can get loud quickly. Keep your volume low while you explore.', 5200);
      }
    } catch (err) {
      console.error(err);
      toast(`Audio could not start: ${err.message || err}`, 7000);
    } finally {
      powerBtn.classList.remove('busy');
    }
  } else {
    await host.stop();
    powerBtn.setAttribute('aria-pressed', 'false');
    document.body.classList.remove('powered');
  }
});

host.onError = (msg) => toast(`Engine: ${msg}`, 6000);

// ------------------------------------------------------------------ meters
let meters = null;
host.onMeters = (m) => {
  meters = m;
  if (m.recovered) toast('A loop blew up numerically; the engine reset itself.');
};
const shown = { pulse: 0 };
function flash(el) {
  if (el) shown.pulse = 1;
}
function frame() {
  const on = host.running;
  const m = on ? meters : null;
  shown.pulse = Math.max(m?.pulse ?? 0, shown.pulse * 0.82);
  setLed(leds.pulse, shown.pulse);
  leds.stages.forEach((el, i) => setLed(el, m && m.stage === i ? 1 : 0));
  setLed(leds.env, m?.env ?? 0);
  setLed(leds.r1, m?.r1 ?? 0);
  setLed(leds.r2, m?.r2 ?? 0);
  setLed(leds.det, m?.det ?? 0);
  setLed(leds.v1, m?.v1 ?? 0);
  setLed(leds.v2, m?.v2 ?? 0);
  setLed(leds.peak, m ? Math.min(1, m.peak * 1.4) : 0);
  setLed(leds.limit, m ? Math.min(1, m.limit * 5) : 0);
  if (on) scope.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ------------------------------------------------------------------ boot
const fromHash = stateFromHash();
if (fromHash && applyState(fromHash)) {
  history.replaceState(null, '', location.pathname + location.search);
  toast('Loaded patch from link.');
} else if (!applyState(loadSaved())) {
  applyRecipe(DEFAULT_RECIPE, { quiet: true });
}
markOverrides(currentNets);
document.fonts?.ready.then(() => patchbay.refresh());

// expose for debugging and tests
window.easel = { store, patchbay, host, applyRecipe, PARAM_BY_ID };
