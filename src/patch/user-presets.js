// "My presets": named patches (knobs *and* cables) saved in the browser.
// Pure functions over a Storage-like object, so they're testable in Node.

export const USER_PRESETS_KEY = 'the-easel/user-presets/v1';
export const USER_PREFIX = 'user:';
const MAX_NAME = 60;
const MAX_NOTES = 2000;

export const isUserPresetId = (id) => typeof id === 'string' && id.startsWith(USER_PREFIX);

function cleanName(name) {
  return String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
}

function validState(state) {
  return !!state && typeof state === 'object' && state.v === 2 && state.params && typeof state.params === 'object' && Array.isArray(state.cables);
}

function validPreset(p) {
  return !!p && typeof p === 'object' && isUserPresetId(p.id) && cleanName(p.name) && validState(p.state);
}

/** Read the saved list; anything malformed is dropped rather than breaking the menu. */
export function loadUserPresets(storage) {
  try {
    const raw = storage?.getItem(USER_PRESETS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(validPreset) : [];
  } catch {
    return [];
  }
}

/** @returns {boolean} false if the browser refused (private mode, quota) */
export function saveUserPresets(storage, list) {
  try {
    storage.setItem(USER_PRESETS_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function findByName(list, name) {
  const n = cleanName(name).toLowerCase();
  return list.find((p) => p.name.toLowerCase() === n) || null;
}

/**
 * Add a preset, or replace the one with the same name (case-insensitive).
 * @param {object[]} list
 * @param {{name: string, notes?: string, state: object, based?: string}} entry
 * @returns {{list: object[], preset: object, replaced: boolean}}
 */
export function upsertPreset(list, { name, notes = '', state, based = null }, now = Date.now()) {
  const clean = cleanName(name);
  if (!clean) throw new Error('A preset needs a name.');
  if (!validState(state)) throw new Error('Nothing to save.');
  const existing = findByName(list, clean);
  const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'preset';
  const preset = {
    id: existing?.id ?? `${USER_PREFIX}${slug}-${now.toString(36)}`,
    name: clean,
    notes: String(notes ?? '').slice(0, MAX_NOTES),
    based: based ?? existing?.based ?? null,
    created: existing?.created ?? now,
    updated: now,
    state: { v: 2, params: { ...state.params }, cables: state.cables.map((c) => (Array.isArray(c) ? [...c] : c)) },
  };
  const next = existing ? list.map((p) => (p.id === existing.id ? preset : p)) : [...list, preset];
  next.sort((a, b) => a.name.localeCompare(b.name));
  return { list: next, preset, replaced: !!existing };
}

export function removePreset(list, id) {
  return list.filter((p) => p.id !== id);
}
