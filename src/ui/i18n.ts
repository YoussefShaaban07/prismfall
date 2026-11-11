import '@fontsource/cairo/arabic-500.css';
import '@fontsource/cairo/arabic-700.css';
import '@fontsource/cairo/arabic-900.css';
import { store } from '../core/util';
import { AR } from './lang/ar';
import { EDEFS, PASSIVES, WEAPONS, BOSS_NAMES } from '../game/data';
import { ACHIEVEMENTS, MODS, SHIPS, UPGRADES } from '../game/meta';
import { BOSS_LORE, ENEMY_LORE, WEAPON_TIPS } from '../game/codex';

/**
 * Tiny localisation layer. English is the source language and doubles as the lookup key, so
 * untranslated text simply falls through. Arabic switches the UI to right-to-left and adds the
 * Cairo font as a per-glyph fallback behind Orbitron/Rajdhani.
 */
export type Lang = 'en' | 'ar';

export const LANG: Lang = (() => {
  const saved = store.get<string | null>('prismfall.lang', null);
  if (saved === 'en' || saved === 'ar') return saved;
  return (navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en';
})();
export const isAr = LANG === 'ar';

const NUM = /\d+(?:[.,:]\d+)*/g;
const HAS_AR = /[؀-ۿ]/;
const HAS_LETTER = /[A-Za-z]/;
/** Strings that reached t() without a translation (Arabic only). Inspect in the console. */
export const misses = new Set<string>();

function lookup(s: string): string | null {
  const direct = AR[s];
  if (direct !== undefined) return direct;
  const nums: string[] = [];
  const key = s.replace(NUM, (m) => {
    nums.push(m);
    return `{${nums.length - 1}}`;
  });
  if (nums.length) {
    const p = AR[key];
    if (p !== undefined) return p.replace(/\{(\d+)\}/g, (_, i) => nums[Number(i)] ?? '');
  }
  return null;
}

/** Translate a display string (no-op in English). */
export function t(s: string): string {
  if (!isAr || !s || HAS_AR.test(s) || !HAS_LETTER.test(s)) return s;
  const hit = lookup(s);
  if (hit !== null) return hit;
  // composite labels: translate each "·"-separated part on its own
  if (s.includes(' · ')) return s.split(' · ').map(t).join(' · ');
  misses.add(s);
  return s;
}

/** Translate a pattern with {0}… slots, then fill the slots with already-localised values. */
export function tf(pattern: string, ...args: (string | number)[]): string {
  const p = isAr ? (AR[pattern] ?? (misses.add(pattern), pattern)) : pattern;
  return p.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''));
}

export function setLang(l: Lang) {
  if (l === LANG) return;
  store.set('prismfall.lang', l);
  location.reload();
}

/** Translate static markup: text nodes, a few attributes, and data-i18n rich-text blocks. */
export function translateDom(root: ParentNode) {
  if (!isAr) return;
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const v = AR['html:' + el.dataset.i18n];
    if (v) el.innerHTML = v;
  });
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  for (const n of nodes) {
    const raw = n.nodeValue ?? '';
    const s = raw.trim();
    if (!s) continue;
    const tr = t(s);
    if (tr !== s) n.nodeValue = raw.replace(s, tr);
  }
  root.querySelectorAll<HTMLElement>('[aria-label],[alt],[title]').forEach((el) => {
    for (const a of ['aria-label', 'alt', 'title']) {
      const v = el.getAttribute(a);
      if (v) el.setAttribute(a, t(v));
    }
  });
}

/** Localise the static game tables in place so every screen built from them reads Arabic. */
function localizeData() {
  for (const d of Object.values(EDEFS)) d.name = t(d.name);
  for (const w of Object.values(WEAPONS)) {
    w.name = t(w.name);
    w.evoName = t(w.evoName);
    w.blurb = t(w.blurb);
    w.levels = w.levels.map(t);
  }
  for (const p of Object.values(PASSIVES)) {
    p.name = t(p.name);
    p.desc = t(p.desc);
  }
  for (let i = 0; i < BOSS_NAMES.length; i++) BOSS_NAMES[i] = t(BOSS_NAMES[i]);
  for (const s of SHIPS) {
    s.name = t(s.name);
    s.blurb = t(s.blurb);
    s.perks = s.perks.map(t);
  }
  for (const u of UPGRADES) {
    u.name = t(u.name);
    const d = u.desc;
    u.desc = (lv: number) => t(d(lv));
  }
  for (const m of MODS) {
    m.name = t(m.name);
    m.desc = t(m.desc);
  }
  for (const a of ACHIEVEMENTS) {
    a.name = t(a.name);
    a.desc = t(a.desc);
  }
  for (const l of Object.values(ENEMY_LORE)) {
    l.lore = t(l.lore);
    l.tip = t(l.tip);
  }
  for (const b of BOSS_LORE) {
    b.name = t(b.name);
    b.lore = t(b.lore);
    b.tip = t(b.tip);
  }
  for (const k of Object.keys(WEAPON_TIPS) as (keyof typeof WEAPON_TIPS)[]) WEAPON_TIPS[k] = t(WEAPON_TIPS[k]);
}

if (isAr) {
  document.documentElement.lang = 'ar';
  localizeData();
  const lt = document.querySelector('.loadtxt');
  if (lt) lt.textContent = t(lt.textContent || '');
}
(window as unknown as { prismfallI18n: unknown }).prismfallI18n = { LANG, misses };
