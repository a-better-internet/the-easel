import { Store } from './state.js';
import { buildPanel } from './ui/panel.js';
import { Patchbay } from './ui/patchbay.js';
import { AudioHost } from './audio/host.js';
import { Recorder, formatDuration, formatBytes, formatPeak } from './audio/recorder.js';
import { Scope } from './ui/scope.js';
import { setLed, h } from './ui/controls.js';
import { RECIPES, RECIPE_BY_ID, recipeParams, recipeCables } from './patch/recipes.js';
import { loadUserPresets, saveUserPresets, upsertPreset, removePreset, findByName, isUserPresetId } from './patch/user-presets.js';
import { PARAM_BY_ID, jackName } from './spec.js';

const STORAGE_KEY = 'the-easel/state/v2';
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
const scaler = $('panel-scaler');
let oneFlash = 0;
const { jacks, leds, programCard } = buildPanel(panelEl, store, {
  onOne: () => {
    host.send({ type: 'one' });
    oneFlash = 1;
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
    markDriven(nets);
    markModified();
    renderSheet();
    scheduleSave();
  },
});

/** Light up input jacks that hear something, and show when aux in replaces the noise. */
function markDriven(nets) {
  const driven = new Set();
  for (const n of nets) if (n.outs.length) for (const i of n.ins) driven.add(i);
  for (const [id, el] of jacks) el.classList.toggle('driven', driven.has(id));
  panelEl.classList.toggle('aux-patched', driven.has('pre.in'));
}

store.onAny((id, v) => {
  host.setParam(id, v);
  markModified();
  scheduleSave();
});

// ------------------------------------------------------------------ fit the panel to the window
function fitPanel() {
  const avail = scaler.parentElement.clientWidth;
  const natural = panelEl.offsetWidth;
  const scale = Math.max(0.5, Math.min(1, avail / natural));
  panelEl.style.transform = scale < 1 ? `scale(${scale})` : '';
  scaler.style.height = `${Math.ceil(panelEl.offsetHeight * scale)}px`;
  scaler.style.width = `${Math.ceil(natural * scale)}px`;
  scaler.parentElement.classList.toggle('scrolls', natural * scale > avail + 1);
  patchbay.refresh();
}
new ResizeObserver(fitPanel).observe(scaler.parentElement);
window.addEventListener('resize', fitPanel);

// ------------------------------------------------------------------ presets (built-in + mine)
let currentRecipe = null; // a built-in recipe id or a user preset id
let currentStep = 0;
let modified = false;
let applying = false;
let userPresets = loadUserPresets(safeStorage());
const presetSel = $('preset');

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const userPreset = (id) => userPresets.find((p) => p.id === id) || null;
const presetName = (id) => RECIPE_BY_ID[id]?.name ?? userPreset(id)?.name ?? null;

function buildPresetMenu() {
  presetSel.replaceChildren();
  const groups = new Map();
  for (const r of RECIPES) {
    if (!groups.has(r.group)) {
      const g = h('optgroup', { label: r.group });
      groups.set(r.group, g);
      presetSel.append(g);
    }
    groups.get(r.group).append(h('option', { value: r.id }, `${r.num}. ${r.name}`));
  }
  if (userPresets.length) {
    presetSel.append(h('optgroup', { label: 'my presets' }, userPresets.map((p) => h('option', { value: p.id }, p.name))));
  }
  presetSel.append(h('option', { value: '__custom', disabled: true }, 'custom'));
  presetSel.value = currentRecipe && presetName(currentRecipe) ? currentRecipe : '__custom';
}

/** Start a newly loaded patch from a clean slate (stepping a quick start doesn't). */
function freshStart() {
  if (!host.running) return;
  host.fadeTo(0, 0.03);
  setTimeout(() => {
    host.send({ type: 'panic' });
    host.fadeTo(1, 0.35);
  }, 40);
}

function loadPatch(params, cables) {
  applying = true;
  try {
    store.setAll(params, { reset: true });
    patchbay.load(cables);
  } finally {
    applying = false;
  }
}

function applyRecipe(id, { step = null, quiet = false } = {}) {
  if (isUserPresetId(id)) return applyUserPreset(id, { quiet });
  const r = RECIPE_BY_ID[id];
  if (!r) return;
  const st = r.steps ? (step ?? 0) : Infinity;
  loadPatch(recipeParams(r, st), recipeCables(r, st));
  const sameRecipe = currentRecipe === id;
  currentRecipe = id;
  currentStep = r.steps ? st : 0;
  modified = false;
  presetSel.value = id;
  programCard.textContent = r.name;
  renderNotes();
  if (!(sameRecipe && r.steps && step !== null)) freshStart();
  if (!quiet) announce(r.steps ? `${r.name}, step ${currentStep + 1}` : `Loaded ${r.name}`);
  scheduleSave();
}

function applyUserPreset(id, { quiet = false } = {}) {
  const p = userPreset(id);
  if (!p) return;
  loadPatch(p.state.params, p.state.cables);
  currentRecipe = id;
  currentStep = 0;
  modified = false;
  presetSel.value = id;
  programCard.textContent = p.name;
  renderNotes();
  freshStart();
  if (!quiet) announce(`Loaded ${p.name}`);
  scheduleSave();
}

presetSel.addEventListener('change', () => applyRecipe(presetSel.value));

function markModified() {
  if (applying || modified) return;
  modified = true;
  if (currentRecipe) renderNotes();
}

// ------------------------------------------------------------------ saving my presets
const saveDialog = $('save-dialog');
const saveName = $('save-name');
const saveNotes = $('save-notes');
const saveHint = $('save-hint');

function persistUserPresets() {
  if (!saveUserPresets(safeStorage(), userPresets)) {
    toast('This browser would not store the preset (private browsing?). Use file › export to keep it.', 6000);
    return false;
  }
  return true;
}

function openSaveDialog() {
  closeMenus();
  const mine = userPreset(currentRecipe);
  const base = presetName(currentRecipe);
  saveName.value = mine ? mine.name : base ? `${base} (variation)` : '';
  saveNotes.value = mine ? mine.notes : '';
  updateSaveHint();
  saveDialog.showModal();
  saveName.select();
}

function updateSaveHint() {
  const existing = findByName(userPresets, saveName.value);
  saveHint.textContent = existing ? `Replaces your preset “${existing.name}”.` : 'Saves every knob, switch, slider and cable.';
}
saveName.addEventListener('input', updateSaveHint);

function savePreset(name, notes) {
  try {
    const based = isUserPresetId(currentRecipe) ? userPreset(currentRecipe)?.based : currentRecipe;
    const { list, preset, replaced } = upsertPreset(userPresets, { name, notes, state: currentState(), based });
    userPresets = list;
    if (!persistUserPresets()) return;
    currentRecipe = preset.id;
    currentStep = 0;
    modified = false;
    buildPresetMenu();
    programCard.textContent = preset.name;
    renderNotes();
    scheduleSave();
    toast(`${replaced ? 'Updated' : 'Saved'} “${preset.name}” in my presets.`);
  } catch (err) {
    toast(err.message || String(err));
  }
}

$('save-form').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'save') return; // cancel just closes
  savePreset(saveName.value, saveNotes.value);
});

function updateCurrentPreset() {
  const p = userPreset(currentRecipe);
  if (p) savePreset(p.name, p.notes);
}

function deleteCurrentPreset() {
  const p = userPreset(currentRecipe);
  if (!p || !window.confirm(`Delete “${p.name}” from my presets? The patch stays loaded.`)) return;
  userPresets = removePreset(userPresets, p.id);
  persistUserPresets();
  currentRecipe = null;
  modified = true;
  buildPresetMenu();
  programCard.textContent = 'custom';
  renderNotes();
  scheduleSave();
  toast(`Deleted “${p.name}”.`);
}

// ------------------------------------------------------------------ notes + patch sheet
const notesEl = $('notes');
const notesToggle = $('notes-toggle');
let notesOpen = true;
let sheetEl = null;

const KIND = { bar: 'shorting bar', tini: 'Tini-Jax', cable: 'cable' };

function renderSheet() {
  if (!sheetEl) return;
  const rows = patchbay.describe();
  sheetEl.replaceChildren(
    h('h3', { class: 'sheet-title' }, 'patch sheet', h('span', { class: 'sheet-count' }, rows.length ? `${rows.length} connection${rows.length > 1 ? 's' : ''}` : '')),
    rows.length
      ? h(
          'ul',
          { class: 'sheet-list' },
          rows.map((r) => {
            const hot = (on) => () => patchbay.setHot(r.id, on);
            return h(
              'li',
              { tabindex: '0', onpointerenter: hot(true), onpointerleave: hot(false), onfocus: hot(true), onblur: hot(false) },
              h('i', { class: `swatch kind-${r.style}`, style: { '--cc': r.color } }),
              h('span', { class: 'from' }, jackName(r.from)),
              h('span', { class: 'arrow', 'aria-label': 'to' }, '→'),
              h('span', { class: 'to' }, jackName(r.to)),
              h('span', { class: 'kind' }, `${KIND[r.style] || 'cable'}${r.stacked ? ' · stacked' : ''}`),
            );
          }),
        )
      : h('p', { class: 'sheet-empty' }, 'No cables: everything you hear is wired inside the instrument.'),
  );
}

function notesActions() {
  const mine = userPreset(currentRecipe);
  return h(
    'div',
    { class: 'notes-actions' },
    h('button', { type: 'button', class: 'tb', onclick: openSaveDialog }, 'save as preset…'),
    mine && modified ? h('button', { type: 'button', class: 'tb', onclick: updateCurrentPreset }, `update “${mine.name}”`) : null,
    mine ? h('button', { type: 'button', class: 'tb warn', onclick: deleteCurrentPreset }, 'delete preset') : null,
  );
}

function renderNotes() {
  notesEl.hidden = !notesOpen;
  notesToggle.setAttribute('aria-expanded', String(notesOpen));
  if (!notesOpen) return;
  const r = RECIPE_BY_ID[currentRecipe];
  const mine = userPreset(currentRecipe);
  const close = h('button', { type: 'button', class: 'notes-close', 'aria-label': 'Hide notes', onclick: () => setNotes(false) }, '×');
  const head = (num, name, tag) =>
    h(
      'div',
      { class: 'notes-head' },
      num != null ? h('span', { class: 'notes-num' }, num) : null,
      h('h2', {}, name),
      tag ? h('span', { class: 'notes-loops' }, tag) : null,
      modified ? h('span', { class: 'notes-mod' }, 'modified') : null,
      close,
    );
  const main = [];
  if (r) {
    main.push(head(r.num, r.name, r.loops));
    if (r.steps) {
      const n = r.steps.length;
      const go = (k) => applyRecipe(r.id, { step: Math.max(0, Math.min(n - 1, k)) });
      main.push(
        h(
          'div',
          { class: 'steps' },
          h('button', { type: 'button', class: 'tb', disabled: currentStep === 0, onclick: () => go(currentStep - 1), 'aria-label': 'Previous step' }, '‹ prev'),
          h(
            'ol',
            { class: 'step-dots' },
            r.steps.map((_, i) =>
              h(
                'li',
                {},
                h(
                  'button',
                  {
                    type: 'button',
                    class: i === currentStep ? 'current' : i < currentStep ? 'done' : '',
                    'aria-label': `Step ${i + 1}`,
                    'aria-current': i === currentStep ? 'step' : null,
                    onclick: () => go(i),
                  },
                  i + 1,
                ),
              ),
            ),
          ),
          h('button', { type: 'button', class: 'tb', disabled: currentStep === n - 1, onclick: () => go(currentStep + 1), 'aria-label': 'Next step' }, 'next ›'),
        ),
        h('p', { class: 'step-text' }, h('b', {}, `Step ${currentStep + 1}: `), r.steps[currentStep].text),
      );
      if (currentStep === n - 1) main.push(h('p', {}, h('b', {}, 'Result: '), r.result));
    } else {
      main.push(h('p', {}, h('b', {}, 'Set: '), r.set), h('p', {}, h('b', {}, 'Result: '), r.result));
      if (r.tip) main.push(h('p', { class: 'notes-tip' }, h('b', {}, 'Tip: '), r.tip));
    }
  } else if (mine) {
    main.push(head('★', mine.name, 'my preset'));
    if (mine.notes) main.push(h('p', { class: 'user-notes' }, mine.notes));
    const based = presetName(mine.based);
    main.push(h('p', { class: 'notes-tip' }, `${based ? `Based on ${based}. ` : ''}Saved ${new Date(mine.updated).toLocaleString()}.`));
  } else {
    main.push(head(null, 'Custom patch', null), h('p', { class: 'notes-tip' }, 'Not saved as a preset yet. Save it to keep the cables and settings in the patch menu.'));
  }
  main.push(notesActions());
  sheetEl = h('aside', { class: 'sheet', 'aria-label': 'Patch sheet' });
  notesEl.replaceChildren(h('div', { class: 'notes-main' }, main), sheetEl);
  renderSheet();
}
function setNotes(open) {
  notesOpen = open;
  renderNotes();
}
notesToggle.addEventListener('click', () => setNotes(!notesOpen));

// ------------------------------------------------------------------ persistence
let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 300);
}
function currentState() {
  return { v: 2, params: store.snapshot(), cables: patchbay.serialize(), recipe: currentRecipe, step: currentStep, modified };
}
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentState()));
  } catch {
    /* storage unavailable (private mode etc.) - the patch simply isn't remembered */
  }
}
function applyState(state) {
  if (!state || typeof state !== 'object' || !state.params || state.v !== 2) return false;
  loadPatch(state.params, state.cables || []);
  currentRecipe = presetName(state.recipe) ? state.recipe : null;
  currentStep = Number.isInteger(state.step) ? state.step : 0;
  modified = !!state.modified || !currentRecipe;
  buildPresetMenu();
  programCard.textContent = currentRecipe ? presetName(currentRecipe) : 'custom';
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
$('save-preset').addEventListener('click', openSaveDialog);
$('export-presets').addEventListener('click', () => {
  closeMenus();
  if (!userPresets.length) {
    toast('No presets saved yet: use “save as preset…” first.');
    return;
  }
  const blob = new Blob([JSON.stringify({ v: 1, kind: 'easel-presets', presets: userPresets }, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'easel-my-presets.json' });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
});

/** Merge an exported preset bundle into my presets (same names are replaced). */
function importPresetBundle(bundle) {
  let n = 0;
  for (const p of bundle.presets) {
    try {
      userPresets = upsertPreset(userPresets, { name: p.name, notes: p.notes, state: p.state, based: p.based }).list;
      n++;
    } catch {
      /* skip anything malformed */
    }
  }
  if (n) {
    persistUserPresets();
    buildPresetMenu();
    renderNotes();
  }
  return n;
}

$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  closeMenus();
  if (!file) return;
  try {
    const state = JSON.parse(await file.text());
    if (state && Array.isArray(state.presets)) {
      const n = importPresetBundle(state);
      toast(n ? `Imported ${n} preset${n > 1 ? 's' : ''} into my presets.` : 'No presets in that file.');
      return;
    }
    if (!applyState(state)) throw new Error('not a patch');
    toast(`Loaded ${file.name}`);
    if (host.running) host.send({ type: 'panic' });
  } catch {
    toast('That file is not a patch for this version of the Easel.');
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
  else if ((e.key === 'r' || e.key === 'R') && !e.repeat) recorder.recording ? stopRecording() : startRecording();
  else if (e.key === '?') help.open ? help.close() : help.showModal();
});

// ------------------------------------------------------------------ power
const powerBtn = $('power');
const scope = new Scope($('scope'));
let warned = false;

async function powerOn() {
  if (host.running) return true;
  powerBtn.classList.add('busy');
  try {
    await host.start(() => ({ params: store.snapshot(), nets: currentNets }));
    scope.attach(host.analyser);
    powerBtn.setAttribute('aria-pressed', 'true');
    document.body.classList.add('powered');
    if (!warned) {
      warned = true;
      toast('Feedback patches can get loud quickly. Keep the monitor level low while you explore.', 5200);
    }
    return true;
  } catch (err) {
    console.error(err);
    toast(`Audio could not start: ${err.message || err}`, 7000);
    return false;
  } finally {
    powerBtn.classList.remove('busy');
  }
}

async function powerOff() {
  if (recorder.recording) await stopRecording(); // save the take before the audio stops
  await host.stop();
  powerBtn.setAttribute('aria-pressed', 'false');
  document.body.classList.remove('powered');
}

powerBtn.addEventListener('click', () => (powerBtn.getAttribute('aria-pressed') === 'true' ? powerOff() : powerOn()));

// ------------------------------------------------------------------ recorder (24-bit WAV)
const recorder = new Recorder(host);
const recBtn = $('rec');
const recStatus = $('rec-status');
const recSource = $('rec-source');
let lastTakeUrl = null;

function recName() {
  return currentRecipe ? `${RECIPE_BY_ID[currentRecipe].name}${modified ? ' (modified)' : ''}` : 'custom patch';
}

function showRecProgress(t) {
  const peak = formatPeak(t.peak);
  recStatus.className = 'rec-status live';
  recStatus.replaceChildren(
    `${formatDuration(t.frames / t.sampleRate)} · ${formatBytes(t.bytes)} · `,
    h('span', { class: t.peak >= 0.989 ? 'hot' : '' }, `peak ${peak}`),
  );
}

async function startRecording() {
  if (!(await powerOn())) return;
  try {
    recorder.start({ source: recSource.value, name: recName() });
  } catch (err) {
    toast(err.message || String(err));
    return;
  }
  if (lastTakeUrl) {
    URL.revokeObjectURL(lastTakeUrl);
    lastTakeUrl = null;
  }
  recBtn.setAttribute('aria-pressed', 'true');
  recSource.disabled = true;
  recStatus.className = 'rec-status live';
  recStatus.textContent = '00:00:00 · 0 KB';
  announce('Recording');
}

async function stopRecording() {
  if (!recorder.recording) return;
  recBtn.setAttribute('aria-pressed', 'false');
  recSource.disabled = false;
  recStatus.className = 'rec-status';
  recStatus.textContent = 'saving…';
  try {
    const take = await recorder.stop();
    lastTakeUrl = URL.createObjectURL(take.blob);
    const link = h('a', { href: lastTakeUrl, download: take.filename, title: `${take.filename} · ${take.sampleRate} Hz · 24-bit · mono` }, `${formatDuration(take.seconds)} take`);
    recStatus.replaceChildren(link, ` · ${formatBytes(take.blob.size)}`);
    link.click(); // download it now; the link stays for another copy
    toast(`Saved ${take.filename}: 24-bit / ${take.sampleRate / 1000} kHz mono, peak ${formatPeak(take.peak)}.`, 6000);
    announce('Recording saved');
  } catch (err) {
    console.error(err);
    recStatus.textContent = 'recording failed';
    toast(`Recording failed: ${err.message || err}`, 6000);
  }
}

recorder.onProgress = showRecProgress;
recorder.onLimit = () => {
  toast('The take reached the WAV size limit (about 4 GB) and was saved.', 7000);
  stopRecording();
};
recBtn.addEventListener('click', () => (recorder.recording ? stopRecording() : startRecording()));
window.addEventListener('beforeunload', (e) => {
  if (recorder.recording) {
    e.preventDefault();
    e.returnValue = '';
  }
});

host.onError = (msg) => toast(`Engine: ${msg}`, 6000);

// ------------------------------------------------------------------ meters
let meters = null;
host.onMeters = (m) => {
  meters = m;
  if (m.recovered) toast('A loop blew up numerically; the engine reset itself.');
};
let pulseShown = 0;
function frame() {
  const on = host.running;
  const m = on ? meters : null;
  pulseShown = Math.max(m?.pulse ?? 0, oneFlash, pulseShown * 0.8);
  oneFlash = 0;
  setLed(leds.pulse, pulseShown);
  leds.stages.forEach((el, i) => setLed(el, m && m.stage === i ? 1 : 0));
  setLed(leds.env, m?.env ?? 0);
  setLed(leds.rand, m?.rand ?? 0);
  leds.randMeter.style.setProperty('--lvl', (m?.rand ?? 0).toFixed(3));
  setLed(leds.det, m ? Math.min(1, m.det) : 0);
  setLed(leds.v1, m?.v1 ?? 0);
  setLed(leds.v2, m?.v2 ?? 0);
  setLed(leds.peak, m ? Math.min(1, m.peak * 1.4) : 0);
  setLed(leds.limit, m ? Math.min(1, m.limit * 5) : 0);
  if (on) scope.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ------------------------------------------------------------------ boot
buildPresetMenu();
const fromHash = stateFromHash();
if (fromHash && applyState(fromHash)) {
  history.replaceState(null, '', location.pathname + location.search);
  toast('Loaded patch from link.');
} else if (!applyState(loadSaved())) {
  applyRecipe(DEFAULT_RECIPE, { quiet: true });
}
markDriven(currentNets);
fitPanel();
document.fonts?.ready.then(fitPanel);

// exposed for debugging and tests
window.easel = { store, patchbay, host, recorder, applyRecipe, PARAM_BY_ID };
