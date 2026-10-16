'use strict';

/* =====================================================================
   Planning Chantier — application monopage (sans dépendance)
   Données : { techs:[], sites:[], jobs:[] }
   Stockage : API /api/data (partagé, Vercel + Upstash Redis)
              sinon localStorage (ce navigateur uniquement)
   ===================================================================== */

/* ---------- Utilitaires ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const cmp = (a, b) => String(a || '').localeCompare(String(b || ''), 'fr', { sensitivity: 'base' });

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } }
function lsJSON(k) { try { return JSON.parse(lsGet(k)); } catch { return null; } }

/* ---------- Dates (chaînes AAAA-MM-JJ, heure locale) ---------- */
const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (s, n) => { const d = fromISO(s); d.setDate(d.getDate() + n); return toISO(d); };
const todayISO = () => toISO(new Date());
const dow = s => (fromISO(s).getDay() + 6) % 7; // 0 = lundi
const mondayOf = s => addDays(s, -dow(s));
const isISODate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
function isoWeek(s) {
  const d = fromISO(s);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const w1 = new Date(d.getFullYear(), 0, 4, 12);
  return 1 + Math.round(((d - w1) / 864e5 - 3 + (w1.getDay() + 6) % 7) / 7);
}
const DAY_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const fmt = (s, o) => fromISO(s).toLocaleDateString('fr-FR', o);
const fmtShort = s => `${DAY_SHORT[dow(s)]} ${s.slice(8)}/${s.slice(5, 7)}`;
const fmtLong = s => { const t = fmt(s, { weekday: 'long', day: 'numeric', month: 'long' }); return t[0].toUpperCase() + t.slice(1); };
const fmtNum = n => String(Math.round(n * 10) / 10).replace('.', ',');

const holidayCache = {};
function holidays(y) {
  if (holidayCache[y]) return holidayCache[y];
  // Date de Pâques (algorithme de Meeus/Jones/Butcher)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
    f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = toISO(new Date(y, month - 1, day, 12));
  return (holidayCache[y] = {
    [`${y}-01-01`]: "Jour de l'an", [addDays(easter, 1)]: 'Lundi de Pâques', [`${y}-05-01`]: 'Fête du Travail',
    [`${y}-05-08`]: 'Victoire 1945', [addDays(easter, 39)]: 'Ascension', [addDays(easter, 50)]: 'Lundi de Pentecôte',
    [`${y}-07-14`]: 'Fête nationale', [`${y}-08-15`]: 'Assomption', [`${y}-11-01`]: 'Toussaint',
    [`${y}-11-11`]: 'Armistice', [`${y}-12-25`]: 'Noël',
  });
}
const holidayName = s => holidays(+s.slice(0, 4))[s];

/* ---------- Constantes métier ---------- */
const SLOTS = { day: 'Journée', am: 'Matin', pm: 'Après-midi' };
const SLOT_SHORT = { day: '', am: 'AM', pm: 'PM' };
const SLOT_ORDER = { am: 0, day: 1, pm: 2 };
const STATUS = { prevu: 'Prévu', encours: 'En cours', fait: 'Terminé' };
const ABSENCES = ['Congés', 'RTT', 'Formation', 'Maladie', 'Autre'];
const PALETTE = ['#E73A2C', '#61C2CF', '#F2A541', '#4C9F70', '#7B61FF', '#D9548F', '#3D7DCA', '#8C6D46', '#2A9D8F', '#B5651D', '#5C6F82', '#C0392B'];

const LS_DATA = 'pc:data', LS_KEY = 'pc:key', LS_UI = 'pc:ui';

function normalize(d) {
  d = d && typeof d === 'object' ? d : {};
  const arr = x => (Array.isArray(x) ? x.filter(o => o && typeof o === 'object' && o.id) : []);
  return {
    categories: arr(d.categories),
    techs: arr(d.techs),
    sites: arr(d.sites),
    jobs: arr(d.jobs).filter(j => isISODate(j.date)).map(j => ({ slot: 'day', status: 'prevu', kind: 'site', ...j })),
  };
}
const D = () => Store.data;
const RO = () => Store.role === 'view'; // lecture seule
const techById = id => D().techs.find(t => t.id === id);
const siteById = id => D().sites.find(s => s.id === id);
const catById = id => (id ? D().categories.find(c => c.id === id) : null);
/** Ordre d'affichage des catégories : ordre choisi (champ order), puis alphabétique. */
const sortCats = list => [...list].sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || cmp(a.name, b.name));
const sortedCats = () => sortCats(D().categories);
const CAT_SORTS = { custom: 'Ordre personnalisé', az: 'A → Z', za: 'Z → A', count: 'Plus de techniciens' };
/** Catégories dans l'ordre d'affichage choisi dans la barre d'outils. */
function displayCats() {
  const list = sortedCats();
  if (UI.catSort === 'az') return [...list].sort((a, b) => cmp(a.name, b.name));
  if (UI.catSort === 'za') return [...list].sort((a, b) => cmp(b.name, a.name));
  if (UI.catSort === 'count') {
    const n = id => D().techs.filter(t => t.categoryId === id && t.active !== false).length;
    return [...list].sort((a, b) => n(b.id) - n(a.id) || cmp(a.name, b.name));
  }
  return list;
}
const nextCatOrder = d => d.categories.reduce((m, c) => Math.max(m, c.order ?? -1), -1) + 1;
function catArrows(c) {
  const cats = sortedCats(), i = cats.findIndex(x => x.id === c.id);
  return `<span class="ord"><button type="button" data-act="cat-up" data-id="${c.id}" title="Monter" aria-label="Monter ${esc(c.name)}"${i <= 0 ? ' disabled' : ''}>▲</button>`
    + `<button type="button" data-act="cat-down" data-id="${c.id}" title="Descendre" aria-label="Descendre ${esc(c.name)}"${i >= cats.length - 1 ? ' disabled' : ''}>▼</button></span>`;
}
function moveCat(id, delta) {
  Store.commit(d => {
    const list = sortCats(d.categories);
    const i = list.findIndex(c => c.id === id), k = i + delta;
    if (i < 0 || k < 0 || k >= list.length) return;
    [list[i], list[k]] = [list[k], list[i]];
    list.forEach((c, n) => { c.order = n; });
  });
}
const hasCats = () => D().categories.length > 0;
/** Le technicien appartient-il à la catégorie filtrée ? ('' = toutes, '__none' = sans catégorie) */
function techInCat(techId, cat = UI.cat) {
  if (!cat) return true;
  const t = techById(techId);
  return cat === '__none' ? !catById(t?.categoryId) : t?.categoryId === cat;
}
/** Regroupe des techniciens par catégorie (ordre alphabétique, « Sans catégorie » à la fin). */
function groupTechs(techs) {
  const groups = displayCats().map(c => ({ cat: c, techs: techs.filter(t => t.categoryId === c.id) }));
  groups.push({ cat: null, techs: techs.filter(t => !catById(t.categoryId)) });
  return groups.filter(g => g.techs.length).map(g => ({ ...g, techs: [...g.techs].sort((a, b) => cmp(a.name, b.name)) }));
}
const catName = c => (c ? c.name : 'Sans catégorie');
const catColor = c => (c ? c.color : '#9AA0A6');
const numTag = s => (s?.number ? `<span class="num">${esc(s.number)}</span>` : '');
const siteLabel = s => (s ? (s.number ? s.number + ' · ' : '') + s.name : '');
const overlaps = (a, b) => a === 'day' || b === 'day' || a === b;
const bySlot = (a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot];
function hasConflict(list) {
  for (let i = 0; i < list.length; i++)
    for (let k = i + 1; k < list.length; k++) if (overlaps(list[i].slot, list[k].slot)) return true;
  return false;
}
function nextColor(d, field = 'sites') {
  const used = new Set(d[field].map(x => x.color));
  return PALETTE.find(c => !used.has(c)) || PALETTE[d[field].length % PALETTE.length];
}
function indexJobs(field) {
  const m = new Map();
  for (const j of D().jobs) {
    const k = j[field] + '|' + j.date;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(j);
  }
  for (const l of m.values()) l.sort(bySlot);
  return m;
}

/* ---------- Stockage ---------- */
const Store = {
  mode: 'local', role: 'edit', version: 0, data: normalize(null), status: 'idle', pending: 0, queue: Promise.resolve(),

  headers() {
    const h = { 'Content-Type': 'application/json' };
    const k = lsGet(LS_KEY);
    if (k) h['x-app-key'] = k;
    return h;
  },

  async init() {
    try {
      const r = await fetch('/api/data', { headers: this.headers(), cache: 'no-store' });
      if (r.status === 401) { await askKey(lsGet(LS_KEY) ? 'Code incorrect.' : ''); return this.init(); }
      if (r.ok) {
        const j = await r.json();
        this.mode = 'remote'; this.role = j.role || 'edit'; this.version = j.version || 0; this.data = normalize(j.data); this.status = 'ok';
        return;
      }
    } catch { /* pas d'API : mode local */ }
    this.mode = 'local';
    this.data = normalize(lsJSON(LS_DATA));
  },

  /** Applique une modification. En mode partagé, rejoue la modification sur la
   *  dernière version du serveur en cas d'édition concurrente (409). */
  commit(mutator) {
    if (this.role === 'view') { toast('Accès en lecture seule : modification impossible', 'error'); return Promise.resolve(); }
    this.pending++;
    this.queue = this.queue
      .then(() => this._commit(mutator))
      .catch(err => { console.error(err); setSync('error'); toast('Erreur de sauvegarde : ' + err.message, 'error'); })
      .finally(() => { this.pending--; });
    return this.queue;
  },

  async _commit(mutator) {
    if (this.mode === 'local') {
      mutator(this.data);
      lsSet(LS_DATA, JSON.stringify(this.data));
      render();
      return;
    }
    let draft = clone(this.data);
    mutator(draft);
    this.data = draft; render(); setSync('saving');
    for (let i = 0; i < 5; i++) {
      const r = await fetch('/api/data', { method: 'PUT', headers: this.headers(), body: JSON.stringify({ baseVersion: this.version, data: draft }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { this.version = j.version; setSync('ok'); return; }
      if (r.status === 409) {
        this.version = j.version; draft = normalize(j.data); mutator(draft); this.data = draft; render();
        continue;
      }
      if (r.status === 401) { await askKey('Code d\'accès requis.'); continue; }
      if (r.status === 403) { this.role = 'view'; this.version = -1; render(); throw new Error('accès en lecture seule'); }
      throw new Error(j.error || 'HTTP ' + r.status);
    }
    throw new Error('trop de modifications simultanées, réessayez');
  },

  async poll() {
    if (this.mode !== 'remote' || document.hidden || UI.dragging || this.pending) return;
    try {
      const r = await fetch('/api/data?v=' + this.version, { headers: this.headers(), cache: 'no-store' });
      if (!r.ok) { setSync('error'); return; }
      const j = await r.json();
      if (this.pending) return; // une sauvegarde a démarré entre-temps
      if (j.role && j.role !== this.role) { this.role = j.role; render(); }
      setSync('ok');
      if (!j.unchanged && j.version !== this.version) { this.version = j.version; this.data = normalize(j.data); render(); }
    } catch { setSync('error'); }
  },
};

function setSync(s) { Store.status = s; renderSync(); }
function renderSync() {
  const el = $('#sync');
  const [cls, txt] = Store.mode === 'local'
    ? ['local', 'Local · ce navigateur']
    : RO() && Store.status !== 'error' ? ['ro', '🔒 Lecture seule']
    : ({ ok: ['ok', 'Partagé · à jour'], saving: ['saving', 'Enregistrement…'], error: ['error', 'Hors ligne'], idle: ['ok', 'Partagé'] })[Store.status];
  el.className = 'sync ' + cls;
  $('span', el).textContent = txt;
  el.title = RO()
    ? 'Consultation seule : le planning ne peut pas être modifié. Cliquez pour saisir un autre code d\'accès.'
    : Store.mode === 'local'
    ? 'Données enregistrées dans ce navigateur uniquement. Connectez une base Upstash Redis sur Vercel pour partager le planning entre tous les postes.'
    : 'Planning partagé : les modifications sont visibles par toute l\'équipe.';
}

/* ---------- État de l'interface ---------- */
const UI = { view: 'tech', day: todayISO(), start: mondayOf(todayISO()), weeks: 1, weekend: false, filter: '', cat: '', catSort: 'custom', meTech: null, meSpan: 14, dragging: false };
const UI_SAVED = ['view', 'weeks', 'weekend', 'cat', 'catSort', 'meTech', 'meSpan'];
function saveUI() { lsSet(LS_UI, JSON.stringify(Object.fromEntries(UI_SAVED.map(k => [k, UI[k]])))); }

function visibleDays() {
  const out = [];
  for (let i = 0; i < UI.weeks * 7; i++) {
    const d = addDays(UI.start, i);
    if (!UI.weekend && dow(d) >= 5) continue;
    out.push(d);
  }
  return out;
}

/* ---------- Rendu ---------- */
function render() {
  renderSync();
  document.body.classList.toggle('readonly', RO());
  if (RO() && UI.view === 'res') UI.view = 'tech';
  $('#tabs [data-view="res"]').hidden = RO();
  $('#add').hidden = RO();
  $('#fab').hidden = RO() || UI.view === 'res';
  if (UI.cat && UI.cat !== '__none' && !catById(UI.cat)) UI.cat = '';
  const cs = $('#cat');
  cs.hidden = !hasCats() || UI.view === 'me' || UI.view === 'res';
  cs.innerHTML = '<option value="">Toutes catégories</option>' + displayCats().map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('') + '<option value="__none">Sans catégorie</option>';
  cs.value = UI.cat;
  cs.classList.toggle('on', !!UI.cat);
  if (!CAT_SORTS[UI.catSort]) UI.catSort = 'custom';
  const so = $('#cat-sort');
  so.hidden = D().categories.length < 2 || UI.view === 'me' || UI.view === 'res';
  so.innerHTML = Object.entries(CAT_SORTS).map(([k, v]) => `<option value="${k}">Tri : ${v}</option>`).join('');
  so.value = UI.catSort;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === UI.view));
  const planning = UI.view === 'tech' || UI.view === 'site';
  $('#toolbar').hidden = !planning;
  $('#weeks').value = String(UI.weeks);
  $('#weekend').checked = UI.weekend;
  if (planning) (isMobile() ? renderPlanningMobile : renderPlanning)();
  else if (UI.view === 'me') renderMe();
  else renderResources();
  saveUI();
}

function emptyState() {
  if (RO()) return '<div class="empty"><h2>Planning vide</h2><p>Aucune intervention n\'a encore été planifiée.</p></div>';
  return `<div class="empty">
    <h2>Bienvenue sur le planning</h2>
    <p>Commencez par ajouter vos techniciens et vos chantiers, puis cliquez dans une case du planning pour affecter une intervention.</p>
    <div class="acts">
      <button class="btn primary" data-act="add-tech">+ Technicien</button>
      <button class="btn" data-act="add-site">+ Chantier</button>
      <button class="btn ghost" data-act="demo">Charger un exemple</button>
    </div></div>`;
}

/* ---------- Vue téléphone : un jour à la fois ---------- */
const MQ = window.matchMedia('(max-width: 760px)');
const isMobile = () => MQ.matches;

function mobileDays() {
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(UI.start, i);
    if (!UI.weekend && dow(d) >= 5) continue;
    out.push(d);
  }
  return out;
}

function renderPlanningMobile() {
  const view = $('#view');
  const isTech = UI.view === 'tech';
  const days = mobileDays();
  const today = todayISO();
  if (!days.includes(UI.day)) UI.day = days.includes(today) ? today : days[0];
  const day = UI.day;
  $('#range').innerHTML = `<b>S${isoWeek(days[0])}</b>${esc(fmt(days[0], { day: 'numeric', month: 'short' }))} – ${esc(fmt(days[days.length - 1], { day: 'numeric', month: 'short' }))}`;

  if (!D().techs.length && !D().sites.length) { view.innerHTML = emptyState(); return; }

  const techIdx = indexJobs('techId');
  const q = UI.filter.trim().toLowerCase();
  const jobText = j => [j.task, j.notes, j.label, siteById(j.siteId)?.name, siteById(j.siteId)?.number, siteById(j.siteId)?.client, techById(j.techId)?.name].join(' ').toLowerCase();
  const rowText = r => [r.name, r.number, r.role, r.client, r.address].join(' ').toLowerCase();
  const dayJobs = D().jobs.filter(j => j.date === day);
  const countFor = d => D().jobs.filter(j => j.date === d && j.kind !== 'absence').length;

  let h = `<div class="m-days">${days.map(d => `<button type="button" class="m-day${d === day ? ' on' : ''}${d === today ? ' today' : ''}${holidayName(d) ? ' hol' : ''}" data-day="${d}">
      <span>${DAY_SHORT[dow(d)]}</span><b>${+d.slice(8)}</b><i${countFor(d) ? ' class="has"' : ''}></i></button>`).join('')}</div>`;
  const hol = holidayName(day);
  h += `<h2 class="m-title">${esc(fmtLong(day))}${hol ? ` <span class="hn">${esc(hol)}</span>` : ''}</h2>`;

  const item = (j, label, color, sub) => {
    const st = j.status || 'prevu', abs = j.kind === 'absence';
    return `<button type="button" class="m-job st-${st}${abs ? ' abs' : ''}" data-job="${j.id}" style="--c:${esc(color)}">
      <span class="m-slot">${SLOTS[j.slot]}</span>
      <span class="m-main"><b>${label}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
      ${abs ? '' : `<span class="badge ${st}">${STATUS[st]}</span>`}</button>`;
  };

  let cards = '', n = 0;
  if (isTech) {
    const rows = D().techs.filter(t => t.active !== false && techInCat(t.id)).filter(t => !q || rowText(t).includes(q) || (techIdx.get(t.id + '|' + day) || []).some(j => jobText(j).includes(q)));
    const seq = hasCats() ? groupTechs(rows).flatMap(g => [{ grp: g }, ...g.techs]) : rows.sort((a, b) => cmp(a.name, b.name));
    for (const t of seq) {
      if (t.grp) { cards += `<h3 class="m-grp" style="--c:${esc(catColor(t.grp.cat))}"><i class="dot"></i>${esc(catName(t.grp.cat))}<small>${t.grp.techs.length}</small>${t.grp.cat && !RO() && UI.catSort === 'custom' ? catArrows(t.grp.cat) : ''}</h3>`; continue; }
      const list = (techIdx.get(t.id + '|' + day) || []);
      const conflict = hasConflict(list);
      n += list.filter(j => j.kind !== 'absence').length;
      cards += `<section class="m-card${conflict ? ' conflict' : ''}" style="--c:${esc(t.color)}">
        <header><i class="dot"></i><div><b>${esc(t.name)}</b><small>${esc(t.role || '')}</small></div>
          ${conflict ? '<span class="m-warn">⚠ Conflit</span>' : ''}
          ${RO() ? '' : `<button type="button" class="m-add" data-add="${t.id}" aria-label="Ajouter une intervention pour ${esc(t.name)}">+</button>`}</header>
        ${list.length ? list.map(j => {
          if (j.kind === 'absence') return item(j, esc(j.label || 'Absence'), '#9AA0A6', j.notes);
          const s = siteById(j.siteId);
          return item(j, numTag(s) + esc(s?.name || 'Chantier supprimé'), s?.color || '#999', j.task);
        }).join('') : '<div class="m-free">Libre</div>'}</section>`;
    }
  } else {
    const bySite = new Map();
    for (const j of dayJobs) if (j.kind !== 'absence' && techInCat(j.techId)) { if (!bySite.has(j.siteId)) bySite.set(j.siteId, []); bySite.get(j.siteId).push(j); }
    const sites = [...bySite.keys()].map(id => siteById(id) || { id, name: 'Chantier supprimé', color: '#999' }).sort((a, b) => cmp(a.name, b.name));
    for (const s of sites) {
      const list = bySite.get(s.id).sort(bySlot);
      if (q && !rowText(s).includes(q) && !list.some(j => jobText(j).includes(q))) continue;
      n += list.length;
      cards += `<section class="m-card" style="--c:${esc(s.color)}">
        <header><i class="dot"></i><div><b>${numTag(s)}${esc(s.name)}</b><small>${esc([s.client, s.address].filter(Boolean).join(' · '))}</small></div>
          ${RO() ? '' : `<button type="button" class="m-add" data-add="${s.id}" aria-label="Ajouter un technicien sur ${esc(s.name)}">+</button>`}</header>
        ${list.map(j => {
          const t = techById(j.techId);
          const clash = hasConflict(techIdx.get(j.techId + '|' + j.date) || []);
          return item(j, esc(t?.name || 'Technicien supprimé') + (clash ? ' <span class="m-warn">⚠</span>' : ''), t?.color || '#999', j.task);
        }).join('')}</section>`;
    }
    const absents = dayJobs.filter(j => j.kind === 'absence' && techInCat(j.techId)).map(j => `${techById(j.techId)?.name || '?'} (${j.label || 'absent'})`);
    if (absents.length) cards += `<p class="m-abs">Absents : ${esc(absents.join(', '))}</p>`;
  }

  if (!cards) cards = `<div class="empty-list">${q ? 'Aucun résultat pour « ' + esc(UI.filter) + ' ».' : isTech ? 'Aucun technicien actif.' : 'Aucun chantier ce jour-là.'}</div>`;
  h += `<div class="m-list">${cards}</div>`;
  h += `<div class="sum"><span><b>${n}</b> intervention${n > 1 ? 's' : ''} ce jour</span></div>`;
  view.innerHTML = h;
}

function shiftDay(n) {
  const days = mobileDays();
  const i = days.indexOf(UI.day) + n;
  if (i >= 0 && i < days.length) UI.day = days[i];
  else {
    UI.start = addDays(UI.start, n > 0 ? 7 : -7);
    const nd = mobileDays();
    UI.day = n > 0 ? nd[0] : nd[nd.length - 1];
  }
  render();
}

function renderPlanning() {
  const view = $('#view');
  const isTech = UI.view === 'tech';
  const days = visibleDays();
  const first = days[0], last = days[days.length - 1];
  $('#range').innerHTML = `<b>S${isoWeek(first)}${UI.weeks > 1 ? '–' + isoWeek(last) : ''}</b>${esc(fmt(first, { day: 'numeric', month: 'short' }))} – ${esc(fmt(last, { day: 'numeric', month: 'short', year: 'numeric' }))}`;

  if (!D().techs.length && !D().sites.length) { view.innerHTML = emptyState(); return; }

  const techIdx = indexJobs('techId');
  const idx = isTech ? techIdx : indexJobs('siteId');
  const inRange = j => j.date >= first && j.date <= last;
  let rows;
  if (isTech) rows = D().techs.filter(t => t.active !== false && techInCat(t.id)).sort((a, b) => cmp(a.name, b.name));
  else {
    const used = new Set(D().jobs.filter(j => j.kind !== 'absence' && inRange(j)).map(j => j.siteId));
    rows = D().sites.filter(s => s.status !== 'termine' || used.has(s.id)).sort((a, b) => cmp(a.name, b.name));
  }

  const q = UI.filter.trim().toLowerCase();
  const jobText = j => [j.task, j.notes, j.label, siteById(j.siteId)?.name, siteById(j.siteId)?.number, siteById(j.siteId)?.client, techById(j.techId)?.name].join(' ').toLowerCase();
  const rowText = r => [r.name, r.number, r.role, r.client, r.address].join(' ').toLowerCase();
  const rowMatch = new Set();
  if (q) {
    rows = rows.filter(r => {
      if (rowText(r).includes(q)) { rowMatch.add(r.id); return true; }
      return days.some(d => (idx.get(r.id + '|' + d) || []).some(j => jobText(j).includes(q)));
    });
  }

  const minW = { 1: 120, 2: 78, 4: 44 }[UI.weeks];
  const today = todayISO();
  const dayCls = d => [dow(d) >= 5 && 'we', holidayName(d) && 'hol', d === today && 'today'].filter(Boolean).join(' ');
  const wkStart = d => (d !== first && dow(d) === 0 ? ' wks' : '');

  let h = `<h1 class="print-only">Planning ${isTech ? 'techniciens' : 'chantiers'} — ${esc($('#range').textContent)}</h1>`;
  h += `<div class="grid-wrap"><div class="grid ${UI.weeks === 4 ? 'compact' : UI.weeks === 2 ? 'medium' : ''}" style="grid-template-columns:minmax(150px,210px) repeat(${days.length},minmax(${minW}px,1fr))">`;
  h += `<div class="gh corner">${isTech ? 'Technicien' : 'Chantier'} <small>${rows.length}</small></div>`;
  for (const d of days) {
    const hol = holidayName(d);
    h += `<div class="gh ${dayCls(d)}${wkStart(d)}" title="${esc(fmtLong(d) + (hol ? ' — ' + hol : ''))}">
      <span class="dn">${DAY_SHORT[dow(d)]}</span><span class="dd">${+d.slice(8)}</span>
      ${UI.weeks > 1 && dow(d) === 0 ? `<span class="wk">S${isoWeek(d)}</span>` : ''}${hol ? `<span class="hn">${esc(hol)}</span>` : ''}</div>`;
  }

  let nJobs = 0, manDays = 0, nConflicts = 0;
  const seq = isTech && hasCats() ? groupTechs(rows).flatMap(g => [{ grp: g }, ...g.techs]) : rows;
  for (const r of seq) {
    if (r.grp) {
      h += `<div class="grp" style="--c:${esc(catColor(r.grp.cat))}"><span><i class="dot"></i>${esc(catName(r.grp.cat))}<small>${r.grp.techs.length}</small>${r.grp.cat && !RO() && UI.catSort === 'custom' ? catArrows(r.grp.cat) : ''}</span></div>`;
      continue;
    }
    let load = 0, cells = '';
    for (const d of days) {
      const all = idx.get(r.id + '|' + d) || [];
      const list = isTech ? all : all.filter(j => j.kind !== 'absence' && techInCat(j.techId));
      const conflict = isTech && hasConflict(list);
      if (conflict) nConflicts++;
      for (const j of list) if (j.kind !== 'absence') { load += j.slot === 'day' ? 1 : 0.5; nJobs++; }
      const chips = list.map(j => {
        const clash = !isTech && hasConflict(techIdx.get(j.techId + '|' + j.date) || []);
        const dim = q && !rowMatch.has(r.id) && !jobText(j).includes(q);
        return chipHTML(j, isTech, clash, dim);
      }).join('');
      cells += `<div class="cell ${dayCls(d)}${wkStart(d)}${conflict ? ' conflict' : ''}" data-row="${r.id}" data-date="${d}"${conflict ? ' title="Conflit : créneaux qui se chevauchent"' : ''}>${chips}</div>`;
    }
    manDays += load;
    h += `<div class="rh" data-edit="${isTech ? 'tech' : 'site'}" data-id="${r.id}" style="--c:${esc(r.color)}"${RO() ? '' : ' title="Modifier"'}>
      <i class="dot"></i><div><b>${isTech ? '' : numTag(r)}${esc(r.name)}</b><small>${esc((isTech ? r.role : r.client) || '')}</small></div>
      <span class="load" title="Jours planifiés sur la période">${fmtNum(load)} j</span></div>${cells}`;
  }
  h += '</div></div>';
  if (!rows.length) h += `<div class="empty-list">${q ? 'Aucun résultat pour « ' + esc(UI.filter) + ' ».' : isTech ? 'Aucun technicien actif.' + (RO() ? '' : ' <a href="#" data-act="add-tech">Ajouter un technicien</a>') : 'Aucun chantier actif.' + (RO() ? '' : ' <a href="#" data-act="add-site">Ajouter un chantier</a>')}</div>`;
  h += `<div class="sum"><span><b>${nJobs}</b> intervention${nJobs > 1 ? 's' : ''}</span><span><b>${fmtNum(manDays)}</b> jour${manDays > 1 ? 's' : ''}-homme</span>
    ${nConflicts ? `<span class="bad">⚠ ${nConflicts} conflit${nConflicts > 1 ? 's' : ''}</span>` : ''}
    <span class="hint">${RO() ? 'Consultation seule · cliquez sur une intervention pour voir le détail' : 'Glisser-déposer pour déplacer · Ctrl + glisser pour copier'} · ← → pour naviguer</span></div>`;
  view.innerHTML = h;
}

function chipHTML(j, isTech, clash, dim) {
  const site = siteById(j.siteId), tech = techById(j.techId);
  const abs = j.kind === 'absence';
  const color = abs ? '#9AA0A6' : isTech ? (site?.color || '#999') : (tech?.color || '#999');
  const title = abs ? (j.label || 'Absence') : isTech ? (site?.name || 'Chantier supprimé') : (tech?.name || 'Technicien supprimé');
  const tip = [abs ? `${tech?.name || '?'} — ${j.label || 'Absence'}` : `${siteLabel(site) || '?'} — ${tech?.name || '?'}`,
    SLOTS[j.slot], j.task, abs ? '' : STATUS[j.status], j.notes, clash ? '⚠ Conflit pour ce technicien' : ''].filter(Boolean).join('\n');
  const cls = ['chip', abs && 'abs', 'st-' + (j.status || 'prevu'), clash && 'clash', dim && 'dim'].filter(Boolean).join(' ');
  return `<div class="${cls}" draggable="${!RO()}" data-job="${j.id}" style="--c:${esc(color)}" title="${esc(tip)}">`
    + `<span class="ct">${j.status === 'fait' && !abs ? '✓ ' : ''}${isTech && !abs ? numTag(site) : ''}${esc(title)}</span>`
    + (j.slot !== 'day' ? `<span class="slot">${SLOT_SHORT[j.slot]}</span>` : '')
    + (j.task ? `<span class="cs">${esc(j.task)}</span>` : '')
    + '</div>';
}

function renderResources() {
  const today = todayISO();
  const upcoming = (field, id) => D().jobs.filter(j => j[field] === id && j.date >= today && j.kind !== 'absence');
  const techs = [...D().techs].sort((a, b) => (a.active === false) - (b.active === false) || cmp(a.name, b.name));
  const sites = [...D().sites].sort((a, b) => (a.status === 'termine') - (b.status === 'termine') || cmp(a.name, b.name));

  const techLi = t => {
    const n = upcoming('techId', t.id).length;
    return `<li data-edit="tech" data-id="${t.id}" class="${t.active === false ? 'off' : ''}" style="--c:${esc(t.color)}">
      <i class="dot"></i><div><b>${esc(t.name)}${t.active === false ? '<span class="tag">inactif</span>' : ''}</b>
      <small>${esc([t.role, t.phone].filter(Boolean).join(' · ') || '—')}</small></div>
      <span class="meta">${n ? n + ' à venir' : '—'}</span></li>`;
  };
  const siteLi = s => {
    const js = D().jobs.filter(j => j.siteId === s.id && j.kind !== 'absence').map(j => j.date).sort();
    const range = js.length ? (js[0] === js[js.length - 1] ? fmtShort(js[0]) : `${fmtShort(js[0])} → ${fmtShort(js[js.length - 1])}`) : 'Non planifié';
    return `<li data-edit="site" data-id="${s.id}" class="${s.status === 'termine' ? 'off' : ''}" style="--c:${esc(s.color)}">
      <i class="dot"></i><div><b>${numTag(s)}${esc(s.name)}${s.status === 'termine' ? '<span class="tag">terminé</span>' : ''}</b>
      <small>${esc([s.client, s.address].filter(Boolean).join(' · ') || '—')}</small></div>
      <span class="meta">${esc(range)}<br>${js.length} interv.</span></li>`;
  };

  const local = Store.mode === 'local';
  $('#view').innerHTML = `<div class="res">
    <section class="card"><header><h2>Techniciens<small>${techs.length}</small></h2><button class="btn primary sm" data-act="add-tech">+ Ajouter</button></header>
      ${!techs.length ? '<div class="empty-list">Aucun technicien.</div>'
        : hasCats() ? `<ul class="list">${groupTechs(techs).map(g => `<li class="li-grp" style="--c:${esc(catColor(g.cat))}"><i class="dot"></i>${esc(catName(g.cat))}<small>${g.techs.length}</small></li>${[...g.techs].sort((a, b) => (a.active === false) - (b.active === false) || cmp(a.name, b.name)).map(techLi).join('')}`).join('')}</ul>`
        : `<ul class="list">${techs.map(techLi).join('')}</ul>`}</section>
    <section class="card"><header><h2>Chantiers<small>${sites.length}</small></h2><button class="btn primary sm" data-act="add-site">+ Ajouter</button></header>
      ${sites.length ? `<ul class="list">${sites.map(siteLi).join('')}</ul>` : '<div class="empty-list">Aucun chantier.</div>'}</section>
    <section class="card"><header><h2>Catégories de techniciens<small>${D().categories.length}</small></h2><button class="btn primary sm" data-act="add-cat">+ Ajouter</button></header>
      ${hasCats() ? `<ul class="list">${sortedCats().map(c => {
        const n = D().techs.filter(t => t.categoryId === c.id).length;
        return `<li data-edit="cat" data-id="${c.id}" style="--c:${esc(c.color)}"><i class="dot"></i><div><b>${esc(c.name)}</b></div><span class="meta">${n} technicien${n > 1 ? 's' : ''}</span>${catArrows(c)}</li>`;
      }).join('')}</ul>` : '<div class="empty-list">Aucune catégorie. Exemples : Électricité, Courants faibles, SSI, Apprentis…</div>'}
      ${D().categories.length > 1 ? '<p class="card-hint">▲ ▼ : ordre d\'affichage des catégories dans le planning.</p>' : ''}</section>
    <section class="card data"><header><h2>Données</h2></header><div class="pad">
      <p>${local
        ? '<b>Mode local :</b> le planning est enregistré dans ce navigateur uniquement. Pour le partager avec toute l\'équipe, connectez une base Upstash Redis au projet Vercel (voir README).'
        : '<b>Mode partagé :</b> le planning est enregistré sur le serveur et synchronisé automatiquement entre tous les postes.'}</p>
      <button class="btn" data-act="export-json">Exporter une sauvegarde (JSON)</button>
      <button class="btn" data-act="import-json">Importer une sauvegarde</button>
      <button class="btn ghost" data-act="demo">Ajouter des données d'exemple</button>
      <button class="btn danger" data-act="purge" style="margin-right:0;margin-left:auto">Purger l'historique</button>
      <button class="btn danger" data-act="reset" style="margin-right:0">Tout effacer</button>
    </div></section></div>`;
}

function renderMe() {
  const techs = D().techs.filter(t => t.active !== false).sort((a, b) => cmp(a.name, b.name));
  if (!techs.length) { $('#view').innerHTML = emptyState(); return; }
  if (!techById(UI.meTech)) UI.meTech = techs[0].id;
  const tech = techById(UI.meTech);
  const idx = indexJobs('techId');
  const today = todayISO();

  let body = '';
  for (let i = 0; i < UI.meSpan; i++) {
    const d = addDays(today, i);
    const list = idx.get(tech.id + '|' + d) || [];
    const hol = holidayName(d);
    if (!list.length && d !== today) continue;
    body += `<section class="day ${d === today ? 'today' : ''}"><h3>${d === today ? "Aujourd'hui · " : i === 1 ? 'Demain · ' : ''}${esc(fmtLong(d))}${hol ? ' · ' + esc(hol) : ''}</h3>`;
    if (!list.length) body += '<div class="none">Aucune intervention prévue.</div>';
    for (const j of list) body += meCard(j);
    body += '</section>';
  }
  if (!body.includes('class="job')) body += `<div class="empty-list">Rien de planifié sur les ${UI.meSpan} prochains jours.</div>`;

  $('#view').innerHTML = `<div class="me">
    <div class="me-head">
      <select id="me-tech" aria-label="Technicien">${(() => { const opt = t => `<option value="${t.id}" ${t.id === tech.id ? 'selected' : ''}>${esc(t.name)}</option>`; return hasCats() ? groupTechs(techs).map(g => `<optgroup label="${esc(catName(g.cat))}">${g.techs.map(opt).join('')}</optgroup>`).join('') : techs.map(opt).join(''); })()}</select>
      <select id="me-span" aria-label="Période">${[7, 14, 30].map(n => `<option value="${n}" ${n === UI.meSpan ? 'selected' : ''}>${n} jours</option>`).join('')}</select>
      <button class="btn" data-act="export-me" title="Feuille de route de la semaine (PDF ou texte)">Exporter la semaine</button>
      <button class="btn" data-act="copy-link" title="Lien direct vers le planning de ce technicien">Copier le lien</button>
    </div>${body}</div>`;
}

function meCard(j) {
  if (j.kind === 'absence') {
    return `<article class="job abs" style="--c:#9AA0A6"><div class="jt"><h4>${esc(j.label || 'Absence')}</h4><span class="badge">${SLOTS[j.slot]}</span></div>
      ${j.notes ? `<p class="small">${esc(j.notes)}</p>` : ''}</article>`;
  }
  const s = siteById(j.siteId) || { name: 'Chantier supprimé', color: '#999' };
  const mates = D().jobs.filter(x => x.siteId === j.siteId && x.date === j.date && x.techId !== j.techId && x.kind !== 'absence')
    .map(x => techById(x.techId)?.name).filter(Boolean);
  const maps = s.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}` : '';
  const st = j.status || 'prevu';
  return `<article class="job" style="--c:${esc(s.color)}">
    <div class="jt"><h4>${numTag(s)}${esc(s.name)}</h4><span class="badge ${st}">${SLOTS[j.slot]} · ${STATUS[st]}</span></div>
    ${j.task ? `<p><b>${esc(j.task)}</b></p>` : ''}
    ${s.client ? `<p class="small">Client : ${esc(s.client)}</p>` : ''}
    ${s.address ? `<p>📍 <a href="${maps}" target="_blank" rel="noopener">${esc(s.address)}</a></p>` : ''}
    ${s.contact || s.phone ? `<p>👤 ${esc(s.contact || '')}${s.phone ? ` · <a href="tel:${esc(s.phone.replace(/\s/g, ''))}">${esc(s.phone)}</a>` : ''}</p>` : ''}
    ${mates.length ? `<p class="small">Avec : ${esc([...new Set(mates)].join(', '))}</p>` : ''}
    ${j.notes ? `<p class="small">${esc(j.notes)}</p>` : ''}
    ${s.notes ? `<p class="small">Chantier : ${esc(s.notes)}</p>` : ''}
    ${RO() ? '' : `<div class="acts">
      <button class="btn sm ${st === 'encours' ? 'on' : ''}" data-act="status" data-job="${j.id}" data-status="encours">▶ En cours</button>
      <button class="btn sm ${st === 'fait' ? 'on' : ''}" data-act="status" data-job="${j.id}" data-status="fait">✓ Terminé</button>
      ${st !== 'prevu' ? `<button class="btn sm ghost" data-act="status" data-job="${j.id}" data-status="prevu">Réinitialiser</button>` : ''}
    </div>`}</article>`;
}

/* ---------- Modales ---------- */
function openModal({ title, body, buttons = [], onMount, onClose, cls = '' }) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="backdrop"><form class="modal ${cls}" novalidate>
    <header><h2>${esc(title)}</h2><button type="button" class="x" aria-label="Fermer">×</button></header>
    <div class="mbody">${body}</div>
    <footer>${buttons.map((b, i) => `<button type="${b.submit ? 'submit' : 'button'}" class="btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</footer>
  </form></div>`;
  const form = $('.modal', root);
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    if (root.firstElementChild && root.firstElementChild.contains(form)) root.innerHTML = '';
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  $('.x', root).onclick = close;
  $('.backdrop', root).addEventListener('mousedown', e => { if (e.target.classList.contains('backdrop')) close(); });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const b = buttons.find(x => x.submit);
    if (b && (await b.action(form)) !== false) close();
  });
  $$('footer [data-i]', form).forEach(btn => {
    const b = buttons[btn.dataset.i];
    if (!b.submit) btn.onclick = async () => { if ((await b.action?.(form)) !== false) close(); };
  });
  onMount?.(form, close);
  setTimeout(() => $('[autofocus]', form)?.focus(), 30);
  return close;
}

function confirmBox(message, okLabel = 'Confirmer', danger = true) {
  return new Promise(resolve => {
    openModal({
      title: 'Confirmation', cls: 'small', body: `<p>${message}</p>`,
      buttons: [{ label: 'Annuler', cls: 'ghost' }, { label: okLabel, cls: danger ? 'primary' : 'primary', submit: true, action: () => resolve(true) }],
      onClose: () => resolve(false),
    });
  });
}

function askKey(msg) {
  return new Promise(resolve => {
    openModal({
      title: 'Code d\'accès', cls: 'small',
      body: `<p>Ce planning est protégé. Saisissez le code d'accès communiqué par votre responsable.</p>
        ${msg ? `<div class="warn err">${esc(msg)}</div>` : ''}
        <div class="field"><label for="f-key">Code</label><input type="password" id="f-key" autocomplete="current-password" autofocus></div>`,
      buttons: [{ label: 'Valider', cls: 'primary', submit: true, action: f => { lsSet(LS_KEY, $('#f-key', f).value); resolve(); } }],
      onClose: () => resolve(),
    });
  });
}

function colorField(cur) {
  return `<div class="swatches">${PALETTE.map(c => `<button type="button" class="sw ${c === cur ? 'on' : ''}" style="--c:${c}" data-c="${c}" aria-label="Couleur ${c}"></button>`).join('')}
    <input type="color" id="f-color" value="${esc(cur)}" title="Couleur personnalisée"></div>`;
}
function bindColor(form) {
  form.addEventListener('click', e => {
    const s = e.target.closest('.sw'); if (!s) return;
    $('#f-color', form).value = s.dataset.c;
    $$('.sw', form).forEach(x => x.classList.toggle('on', x === s));
  });
  $('#f-color', form).addEventListener('input', () => $$('.sw', form).forEach(x => x.classList.remove('on')));
}
const val = (f, id) => $('#' + id, f)?.value.trim() ?? '';

/* --- Intervention --- */
function pickHTML(techs, sel) {
  if (!techs.length) return '<em>Aucun technicien : ajoutez-en dans Ressources.</em>';
  const lab = t => `<label class="pk" style="--c:${esc(t.color)}"><input type="checkbox" value="${t.id}" ${sel.has(t.id) ? 'checked' : ''}><span>${esc(t.name)}</span></label>`;
  if (!hasCats()) return techs.map(lab).join('');
  return groupTechs(techs).map(g => `<div class="pick-grp"><button type="button" class="pick-all" style="--c:${esc(catColor(g.cat))}" title="Tout sélectionner / désélectionner">${esc(catName(g.cat))}</button>
    <div class="pick">${g.techs.map(lab).join('')}</div></div>`).join('');
}

function openJob(id, preset = {}) {
  const existing = id ? D().jobs.find(j => j.id === id) : null;
  if (id && !existing) return;
  const isNew = !existing;
  const j = existing ? { ...existing } : {
    kind: preset.kind || 'site', techId: null, siteId: preset.siteId || '', date: preset.date || todayISO(),
    slot: 'day', status: 'prevu', task: '', notes: '', label: ABSENCES[0],
  };
  const techs = D().techs.filter(t => t.active !== false || t.id === j.techId).sort((a, b) => cmp(a.name, b.name));
  const sites = [...D().sites].sort((a, b) => (a.status === 'termine') - (b.status === 'termine') || cmp(a.name, b.name));
  const sel = new Set(isNew ? (preset.techIds || []) : [j.techId]);

  const body = `
    <div class="seg" id="f-kind"><button type="button" data-k="site">Chantier</button><button type="button" data-k="absence">Absence</button></div>
    <div class="field"><label>${isNew ? 'Technicien(s)' : 'Technicien'}</label>
      ${isNew
        ? `<div class="pick" id="f-techs">${pickHTML(techs, sel)}</div>`
        : `<select id="f-tech">${techs.map(t => `<option value="${t.id}" ${t.id === j.techId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`}
    </div>
    <div class="field only-site"><label for="f-site">Chantier</label>
      <select id="f-site"><option value="">— Choisir un chantier —</option>
        ${sites.map(s => `<option value="${s.id}" ${s.id === j.siteId ? 'selected' : ''}>${esc(siteLabel(s))}${s.client ? ' · ' + esc(s.client) : ''}${s.status === 'termine' ? ' (terminé)' : ''}</option>`).join('')}
        <option value="__new">+ Nouveau chantier…</option></select>
      <input type="text" id="f-newsite" placeholder="Nom du nouveau chantier" hidden></div>
    <div class="field only-abs"><label for="f-label">Motif</label>
      <select id="f-label">${ABSENCES.map(a => `<option ${a === j.label ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
    <div class="row2">
      <div class="field"><label for="f-date">${isNew ? 'Du' : 'Date'}</label><input type="date" id="f-date" value="${j.date}" required></div>
      ${isNew ? `<div class="field"><label for="f-end">Au</label><input type="date" id="f-end" value="${esc(preset.end || j.date)}"></div>` : ''}
    </div>
    ${isNew ? '<label class="chk" id="f-skipwrap"><input type="checkbox" id="f-skip" checked> Ignorer les week-ends et jours fériés</label>' : ''}
    <div class="row2">
      <div class="field"><label for="f-slot">Créneau</label><select id="f-slot">${Object.entries(SLOTS).map(([k, v]) => `<option value="${k}" ${k === j.slot ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field only-site"><label for="f-status">Statut</label><select id="f-status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === j.status ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    </div>
    <div class="field only-site"><label for="f-task">Tâche</label><input type="text" id="f-task" value="${esc(j.task)}" placeholder="ex. Tirage de câbles, raccordement TGBT, mise en service…"></div>
    <div class="field"><label for="f-notes">Notes</label><textarea id="f-notes" rows="2" placeholder="Matériel, accès, consignes…">${esc(j.notes)}</textarea></div>
    <div class="warn" id="f-warn" hidden></div>`;

  let kind = j.kind === 'absence' ? 'absence' : 'site';
  const newSiteId = uid();

  const collect = f => {
    const v = { kind, slot: val(f, 'f-slot'), status: val(f, 'f-status'), task: val(f, 'f-task'), notes: val(f, 'f-notes'), label: val(f, 'f-label') };
    v.techIds = isNew ? $$('#f-techs input:checked', f).map(i => i.value) : [val(f, 'f-tech')];
    v.siteId = val(f, 'f-site');
    v.newSite = v.siteId === '__new' ? val(f, 'f-newsite') : '';
    if (v.newSite) v.siteId = newSiteId;
    const start = val(f, 'f-date');
    const end = isNew ? (val(f, 'f-end') || start) : start;
    v.dates = [];
    if (isISODate(start) && isISODate(end) && end >= start) {
      const skip = isNew && $('#f-skip', f).checked && end > start;
      for (let d = start; d <= end && v.dates.length < 366; d = addDays(d, 1))
        if (!skip || (dow(d) < 5 && !holidayName(d))) v.dates.push(d);
    }
    v.errors = [];
    if (!v.techIds.filter(Boolean).length) v.errors.push('Choisissez au moins un technicien.');
    if (kind === 'site' && (!v.siteId || v.siteId === '__new')) v.errors.push('Choisissez ou créez un chantier.');
    if (!isISODate(start)) v.errors.push('Date invalide.');
    else if (end < start) v.errors.push('La date de fin est avant la date de début.');
    else if (!v.dates.length) v.errors.push('Aucun jour ouvré dans la période choisie.');
    return v;
  };

  const showConflicts = f => {
    const v = collect(f), w = $('#f-warn', f), msgs = [];
    for (const t of v.techIds) for (const d of v.dates) {
      for (const x of D().jobs) {
        if (x.techId !== t || x.date !== d || x.id === j.id || !overlaps(x.slot, v.slot)) continue;
        const what = x.kind === 'absence' ? (x.label || 'Absence') : (siteById(x.siteId)?.name || 'un chantier');
        msgs.push(`${techById(t)?.name} est déjà sur « ${what} » le ${fmtShort(d)} (${SLOTS[x.slot]})`);
      }
    }
    w.classList.remove('err');
    w.hidden = !msgs.length;
    w.innerHTML = msgs.slice(0, 5).map(m => `<div>⚠ ${esc(m)}</div>`).join('') + (msgs.length > 5 ? `<div>… et ${msgs.length - 5} autre(s)</div>` : '');
  };

  const save = f => {
    const v = collect(f);
    if (v.errors.length) {
      const w = $('#f-warn', f);
      w.hidden = false; w.classList.add('err'); w.innerHTML = v.errors.map(e => `<div>${esc(e)}</div>`).join('');
      return false;
    }
    const fields = d => ({
      kind: v.kind, siteId: v.kind === 'site' ? v.siteId : null, label: v.kind === 'absence' ? v.label : '',
      slot: v.slot, status: v.kind === 'site' ? v.status : 'prevu', task: v.kind === 'site' ? v.task : '', notes: v.notes,
      date: d, updatedAt: Date.now(),
    });
    Store.commit(d => {
      if (v.kind === 'site' && v.newSite && !d.sites.some(s => s.id === newSiteId))
        d.sites.push({ id: newSiteId, number: '', name: v.newSite, client: '', address: '', contact: '', phone: '', notes: '', color: nextColor(d), status: 'actif' });
      if (isNew) {
        for (const t of v.techIds) for (const date of v.dates) d.jobs.push({ id: uid(), techId: t, ...fields(date) });
      } else {
        const x = d.jobs.find(q => q.id === j.id);
        if (x) Object.assign(x, { techId: v.techIds[0], ...fields(v.dates[0]) });
      }
    });
    const n = isNew ? v.techIds.length * v.dates.length : 1;
    toast(isNew ? `${n} intervention${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''}` : 'Intervention modifiée');
  };

  const buttons = [];
  if (!isNew) buttons.push({
    label: 'Supprimer', cls: 'danger', action: async () => {
      if (!(await confirmBox('Supprimer cette intervention ?', 'Supprimer'))) return false;
      Store.commit(d => { d.jobs = d.jobs.filter(x => x.id !== j.id); });
      toast('Intervention supprimée');
    },
  });
  buttons.push({ label: 'Annuler', cls: 'ghost' }, { label: isNew ? 'Ajouter' : 'Enregistrer', cls: 'primary', submit: true, action: save });

  openModal({
    title: isNew ? 'Nouvelle intervention' : 'Modifier l\'intervention', body, buttons,
    onMount: f => {
      const setKind = k => {
        kind = k; f.dataset.kind = k;
        $$('#f-kind button', f).forEach(b => b.classList.toggle('on', b.dataset.k === k));
        showConflicts(f);
      };
      $('#f-techs', f)?.addEventListener('click', e => {
        const b = e.target.closest('.pick-all'); if (!b) return;
        const boxes = $$('input', b.parentElement);
        const all = boxes.every(x => x.checked);
        boxes.forEach(x => { x.checked = !all; });
        showConflicts(f);
      });
      $('#f-kind', f).addEventListener('click', e => { const b = e.target.closest('button'); if (b) setKind(b.dataset.k); });
      $('#f-site', f).addEventListener('change', () => {
        const n = $('#f-newsite', f);
        n.hidden = $('#f-site', f).value !== '__new';
        if (!n.hidden) n.focus();
      });
      const syncEnd = () => {
        const e = $('#f-end', f); if (!e) return;
        e.min = $('#f-date', f).value;
        if (e.value < e.min) e.value = e.min;
        $('#f-skipwrap', f).hidden = e.value === $('#f-date', f).value;
      };
      $('#f-date', f).addEventListener('change', syncEnd);
      $('#f-end', f)?.addEventListener('change', syncEnd);
      f.addEventListener('change', () => showConflicts(f));
      syncEnd();
      setKind(kind);
      (isNew && !sel.size ? $('#f-techs input', f) : kind === 'site' && !j.siteId ? $('#f-site', f) : $('#f-task', f))?.focus();
    },
  });
}

/* --- Consultation d'une intervention (lecture seule) --- */
function openJobView(id) {
  const j = D().jobs.find(x => x.id === id);
  if (!j) return;
  const t = techById(j.techId), s = siteById(j.siteId), abs = j.kind === 'absence';
  const maps = s?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}` : '';
  const mates = abs ? [] : [...new Set(D().jobs.filter(x => x.siteId === j.siteId && x.date === j.date && x.techId !== j.techId && x.kind !== 'absence')
    .map(x => techById(x.techId)?.name).filter(Boolean))];
  const row = (k, v) => (v ? `<div class="kv"><span>${k}</span><div>${v}</div></div>` : '');
  openModal({
    title: abs ? (j.label || 'Absence') : (s ? siteLabel(s) : 'Chantier supprimé'), cls: 'small',
    body: [
      row('Technicien', esc(t?.name)),
      row('Date', esc(fmtLong(j.date)) + ' · ' + SLOTS[j.slot]),
      abs ? '' : row('Statut', STATUS[j.status || 'prevu']),
      abs ? '' : row('Tâche', esc(j.task)),
      abs ? '' : row('Client', esc(s?.client)),
      abs ? '' : row('Adresse', s?.address ? `<a href="${maps}" target="_blank" rel="noopener">${esc(s.address)}</a>` : ''),
      abs ? '' : row('Contact', esc([s?.contact, s?.phone].filter(Boolean).join(' · '))),
      row('Avec', esc(mates.join(', '))),
      row('Notes', esc(j.notes)),
      abs ? '' : row('Infos chantier', esc(s?.notes)),
    ].join(''),
    buttons: [{ label: 'Fermer', cls: 'primary' }],
  });
}

/* --- Technicien --- */
function openTech(id) {
  const ex = id ? techById(id) : null;
  const t = ex ? { ...ex } : { name: '', role: '', phone: '', categoryId: UI.cat && UI.cat !== '__none' ? UI.cat : '', color: nextColor(D(), 'techs'), active: true };
  const newCatId = uid();
  const buttons = [];
  if (ex) buttons.push({
    label: 'Supprimer', cls: 'danger', action: async () => {
      const n = D().jobs.filter(j => j.techId === id).length;
      if (!(await confirmBox(`Supprimer <b>${esc(t.name)}</b>${n ? ` et ses ${n} intervention(s)` : ''} ?<br><small>Astuce : décochez plutôt « Actif » pour conserver l'historique.</small>`, 'Supprimer'))) return false;
      Store.commit(d => { d.techs = d.techs.filter(x => x.id !== id); d.jobs = d.jobs.filter(j => j.techId !== id); });
      toast('Technicien supprimé');
    },
  });
  buttons.push({ label: 'Annuler', cls: 'ghost' }, {
    label: ex ? 'Enregistrer' : 'Ajouter', cls: 'primary', submit: true, action: f => {
      const v = { name: val(f, 'f-name'), role: val(f, 'f-role'), phone: val(f, 'f-phone'), categoryId: val(f, 'f-cat'), color: $('#f-color', f).value, active: $('#f-active', f).checked };
      const newCat = v.categoryId === '__new' ? val(f, 'f-newcat') : '';
      const warn = msg => { const w = $('#f-warn', f); w.hidden = false; w.textContent = msg; return false; };
      if (!v.name) return warn('Le nom est obligatoire.');
      if (v.categoryId === '__new' && !newCat) return warn('Donnez un nom à la nouvelle catégorie.');
      if (newCat) v.categoryId = newCatId;
      const newId = uid();
      Store.commit(d => {
        if (newCat && !d.categories.some(c => c.id === newCatId)) d.categories.push({ id: newCatId, name: newCat, color: nextColor(d, 'categories'), order: nextCatOrder(d) });
        const x = ex && d.techs.find(q => q.id === id);
        if (x) Object.assign(x, v); else if (!ex) d.techs.push({ id: newId, ...v });
      });
      toast(ex ? 'Technicien modifié' : 'Technicien ajouté');
    },
  });
  openModal({
    title: ex ? 'Technicien' : 'Nouveau technicien', cls: 'small', buttons,
    body: `<div class="field"><label for="f-name">Nom</label><input type="text" id="f-name" value="${esc(t.name)}" placeholder="Prénom Nom" autofocus></div>
      <div class="field"><label for="f-role">Fonction</label><input type="text" id="f-role" value="${esc(t.role)}" placeholder="ex. Électricien, Chef d'équipe…"></div>
      <div class="field"><label for="f-cat">Catégorie</label>
        <select id="f-cat"><option value="">— Sans catégorie —</option>${sortedCats().map(c => `<option value="${c.id}" ${c.id === t.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="__new">+ Nouvelle catégorie…</option></select>
        <input type="text" id="f-newcat" placeholder="Nom de la catégorie (ex. Courants faibles)" hidden></div>
      <div class="field"><label for="f-phone">Téléphone</label><input type="tel" id="f-phone" value="${esc(t.phone)}"></div>
      <div class="field"><label>Couleur</label>${colorField(t.color)}</div>
      <label class="chk"><input type="checkbox" id="f-active" ${t.active !== false ? 'checked' : ''}> Actif (affiché dans le planning)</label>
      <div class="warn err" id="f-warn" hidden></div>`,
    onMount: f => {
      bindColor(f);
      $('#f-cat', f).addEventListener('change', () => {
        const n = $('#f-newcat', f);
        n.hidden = $('#f-cat', f).value !== '__new';
        if (!n.hidden) n.focus();
      });
    },
  });
}

/* --- Catégorie de techniciens --- */
function openCat(id) {
  const ex = catById(id);
  const c = ex ? { ...ex } : { name: '', color: nextColor(D(), 'categories') };
  const members = ex ? D().techs.filter(t => t.categoryId === id) : [];
  const buttons = [];
  if (ex) buttons.push({
    label: 'Supprimer', cls: 'danger', action: async () => {
      if (!(await confirmBox(`Supprimer la catégorie <b>${esc(c.name)}</b> ?${members.length ? `<br>Ses ${members.length} technicien(s) passeront « Sans catégorie » (ils ne sont pas supprimés).` : ''}`, 'Supprimer'))) return false;
      Store.commit(d => {
        d.categories = d.categories.filter(x => x.id !== id);
        d.techs.forEach(t => { if (t.categoryId === id) t.categoryId = ''; });
      });
      if (UI.cat === id) UI.cat = '';
      toast('Catégorie supprimée');
    },
  });
  buttons.push({ label: 'Annuler', cls: 'ghost' }, {
    label: ex ? 'Enregistrer' : 'Ajouter', cls: 'primary', submit: true, action: f => {
      const v = { name: val(f, 'f-name'), color: $('#f-color', f).value };
      if (!v.name) { const w = $('#f-warn', f); w.hidden = false; w.textContent = 'Le nom est obligatoire.'; return false; }
      const newId = uid();
      Store.commit(d => {
        const x = ex && d.categories.find(q => q.id === id);
        if (x) Object.assign(x, v); else if (!ex) d.categories.push({ id: newId, ...v, order: nextCatOrder(d) });
      });
      toast(ex ? 'Catégorie modifiée' : 'Catégorie ajoutée');
    },
  });
  openModal({
    title: ex ? 'Catégorie' : 'Nouvelle catégorie', cls: 'small', buttons,
    body: `<div class="field"><label for="f-name">Nom</label><input type="text" id="f-name" value="${esc(c.name)}" placeholder="ex. Électricité, Courants faibles, SSI…" autofocus></div>
      <div class="field"><label>Couleur</label>${colorField(c.color)}</div>
      ${members.length ? `<p class="small-note">Techniciens : ${esc(members.map(t => t.name).sort(cmp).join(', '))}</p>` : ''}
      <div class="warn err" id="f-warn" hidden></div>`,
    onMount: bindColor,
  });
}

/* --- Chantier --- */
function openSite(id) {
  const ex = id ? siteById(id) : null;
  const s = ex ? { ...ex } : { number: '', name: '', client: '', address: '', contact: '', phone: '', notes: '', color: nextColor(D()), status: 'actif' };
  const buttons = [];
  if (ex) buttons.push({
    label: 'Supprimer', cls: 'danger', action: async () => {
      const n = D().jobs.filter(j => j.siteId === id).length;
      if (!(await confirmBox(`Supprimer le chantier <b>${esc(s.name)}</b>${n ? ` et ses ${n} intervention(s)` : ''} ?<br><small>Astuce : passez-le plutôt en « Terminé » pour garder l'historique.</small>`, 'Supprimer'))) return false;
      Store.commit(d => { d.sites = d.sites.filter(x => x.id !== id); d.jobs = d.jobs.filter(j => j.siteId !== id); });
      toast('Chantier supprimé');
    },
  });
  buttons.push({ label: 'Annuler', cls: 'ghost' }, {
    label: ex ? 'Enregistrer' : 'Ajouter', cls: 'primary', submit: true, action: f => {
      const v = {
        number: val(f, 'f-number'), name: val(f, 'f-name'), client: val(f, 'f-client'), address: val(f, 'f-address'), contact: val(f, 'f-contact'),
        phone: val(f, 'f-phone'), notes: val(f, 'f-notes'), color: $('#f-color', f).value, status: val(f, 'f-status'),
      };
      if (!v.name) { const w = $('#f-warn', f); w.hidden = false; w.textContent = 'Le nom du chantier est obligatoire.'; return false; }
      const newId = uid();
      Store.commit(d => {
        const x = ex && d.sites.find(q => q.id === id);
        if (x) Object.assign(x, v); else if (!ex) d.sites.push({ id: newId, ...v });
      });
      toast(ex ? 'Chantier modifié' : 'Chantier ajouté');
    },
  });
  openModal({
    title: ex ? 'Chantier' : 'Nouveau chantier', buttons,
    body: `<div class="row2 num-row"><div class="field"><label for="f-number">N° de chantier</label><input type="text" id="f-number" value="${esc(s.number || '')}" placeholder="ex. 2026-118" autofocus></div>
        <div class="field"><label for="f-name">Nom du chantier</label><input type="text" id="f-name" value="${esc(s.name)}"></div></div>
      <div class="row2"><div class="field"><label for="f-client">Client</label><input type="text" id="f-client" value="${esc(s.client)}"></div>
        <div class="field"><label for="f-status">Statut</label><select id="f-status"><option value="actif">En cours</option><option value="termine" ${s.status === 'termine' ? 'selected' : ''}>Terminé</option></select></div></div>
      <div class="field"><label for="f-address">Adresse</label><input type="text" id="f-address" value="${esc(s.address)}" placeholder="Utilisée pour le lien GPS des techniciens"></div>
      <div class="row2"><div class="field"><label for="f-contact">Contact sur site</label><input type="text" id="f-contact" value="${esc(s.contact)}"></div>
        <div class="field"><label for="f-phone">Téléphone</label><input type="tel" id="f-phone" value="${esc(s.phone)}"></div></div>
      <div class="field"><label for="f-notes">Notes (accès, code portail, EPI…)</label><textarea id="f-notes" rows="2">${esc(s.notes)}</textarea></div>
      <div class="field"><label>Couleur</label>${colorField(s.color)}</div>
      <div class="warn err" id="f-warn" hidden></div>`,
    onMount: bindColor,
  });
}

/* ---------- Actions ---------- */
function moveJob(id, row, date, copy) {
  const isTech = UI.view === 'tech';
  const j = D().jobs.find(x => x.id === id);
  if (!j || (!isTech && j.kind === 'absence')) return;
  if (!copy && j.date === date && (isTech ? j.techId : j.siteId) === row) return;
  const newId = uid();
  Store.commit(d => {
    const src = d.jobs.find(x => x.id === id); if (!src) return;
    const t = copy ? { ...src, id: newId, status: 'prevu' } : src;
    if (isTech) t.techId = row; else t.siteId = row;
    t.date = date; t.updatedAt = Date.now();
    if (copy && !d.jobs.some(x => x.id === newId)) d.jobs.push(t);
  });
  toast(copy ? 'Intervention copiée' : 'Intervention déplacée');
}

function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportCSV() {
  const days = new Set(visibleDays());
  const rows = [['Date', 'Jour', 'Technicien', 'Catégorie', 'Type', 'N° chantier', 'Chantier / Motif', 'Client', 'Adresse', 'Créneau', 'Tâche', 'Statut', 'Notes']];
  D().jobs.filter(j => days.has(j.date) && techInCat(j.techId))
    .sort((a, b) => a.date.localeCompare(b.date) || cmp(techById(a.techId)?.name, techById(b.techId)?.name) || bySlot(a, b))
    .forEach(j => {
      const s = siteById(j.siteId) || {}, abs = j.kind === 'absence';
      rows.push([fmt(j.date, { day: '2-digit', month: '2-digit', year: 'numeric' }), DAY_SHORT[dow(j.date)], techById(j.techId)?.name || '', catById(techById(j.techId)?.categoryId)?.name || '',
        abs ? 'Absence' : 'Chantier', abs ? '' : s.number || '', abs ? j.label : s.name, abs ? '' : s.client, abs ? '' : s.address, SLOTS[j.slot], j.task || '', abs ? '' : STATUS[j.status], j.notes || '']);
    });
  const csv = '﻿' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const ds = [...days];
  download(`planning_${ds[0]}_${ds[ds.length - 1]}.csv`, csv, 'text/csv;charset=utf-8');
}

function loadDemo() {
  const mon = mondayOf(todayISO()), today = todayISO();
  Store.commit(d => {
    const C = [['Électricité', '#E73A2C'], ['Courants faibles / SSI', '#61C2CF'], ['Apprentis', '#F2A541']].map(([name, color], i) => ({ id: uid(), name, color, order: nextCatOrder(d) + i }));
    const T = [['Lucas Martin', "Chef d'équipe", 0], ['Emma Bernard', 'Électricienne', 0], ['Hugo Petit', 'Électricien', 0], ['Léa Moreau', 'Technicienne CFA', 1], ['Nathan Roux', 'Apprenti', 2]]
      .map(([name, role, c], i) => ({ id: uid(), name, role, categoryId: C[c].id, phone: '06 00 00 00 0' + i, color: PALETTE[(i + 6) % PALETTE.length], active: true }));
    const S = [['Résidence Les Tilleuls', 'Bati Ouest', '12 rue des Tilleuls, 35000 Rennes'], ['Lycée – rénovation électrique', 'Région Bretagne', 'Avenue Georges Graff, 35200 Rennes'],
      ['Entrepôt logistique ZA Nord', 'LogiBreizh', 'ZA Nord, 35760 Saint-Grégoire'], ['Clinique – mise à niveau SSI', 'Clinique Saint-Laurent', 'Rennes'], ['Bureaux – câblage VDI', 'Immo Cesson', '35510 Cesson-Sévigné']]
      .map(([name, client, address], i) => ({ id: uid(), number: `2026-${String(101 + i * 7)}`, name, client, address, contact: '', phone: '', notes: '', color: PALETTE[i], status: 'actif' }));
    const add = (t, s, day, slot = 'day', task = '') => {
      const date = addDays(mon, day);
      d.jobs.push({ id: uid(), kind: 'site', techId: T[t].id, siteId: S[s].id, date, slot, task, notes: '', label: '', status: date < today ? 'fait' : date === today ? 'encours' : 'prevu' });
    };
    for (let w = 0; w < 2; w++) for (let k = 0; k < 5; k++) {
      const day = w * 7 + k;
      add(0, 0, day, 'day', w ? 'Appareillage' : 'Tirage de câbles');
      if (!(w === 1 && k === 4)) add(4, 0, day, 'day', w ? 'Appareillage' : 'Tirage de câbles');
      add(1, w ? 2 : 1, day, 'day', w ? 'Éclairage LED' : 'Remplacement TD');
      if (k === 2) d.jobs.push({ id: uid(), kind: 'absence', techId: T[3].id, siteId: null, label: 'Formation', date: addDays(mon, day), slot: 'day', status: 'prevu', task: '', notes: 'Habilitation électrique' });
      else { add(3, 3, day, 'am', 'Tests SSI'); add(3, 4, day, 'pm', 'Baies VDI'); }
      if (w === 1 && k === 4) d.jobs.push({ id: uid(), kind: 'absence', techId: T[2].id, siteId: null, label: 'Congés', date: addDays(mon, day), slot: 'day', status: 'prevu', task: '', notes: '' });
      else add(2, k < 3 ? 2 : 1, day, 'day', 'Pose chemins de câbles');
    }
    d.categories.push(...C); d.techs.push(...T); d.sites.push(...S);
  });
  toast('Données d\'exemple ajoutées');
}

async function handleAct(act, el) {
  if (RO() && act !== 'copy-link' && act !== 'export-me') return;
  switch (act) {
    case 'add-tech': return openTech();
    case 'add-site': return openSite();
    case 'add-cat': return openCat();
    case 'cat-up': return moveCat(el.dataset.id, -1);
    case 'cat-down': return moveCat(el.dataset.id, 1);
    case 'demo': return loadDemo();
    case 'export-json':
      return download(`planning-chantier_${todayISO()}.json`, JSON.stringify({ app: 'planning-chantier', exportedAt: new Date().toISOString(), ...D() }, null, 2), 'application/json');
    case 'import-json': return $('#import-file').click();
    case 'reset':
      if (await confirmBox('Effacer <b>tous</b> les techniciens, chantiers et interventions ?<br>Pensez à exporter une sauvegarde avant.', 'Tout effacer')) {
        Store.commit(d => { d.categories = []; d.techs = []; d.sites = []; d.jobs = []; });
        toast('Planning vidé');
      }
      return;
    case 'purge': {
      const limit = addDays(todayISO(), -365);
      const n = D().jobs.filter(j => j.date < limit).length;
      if (!n) return toast('Aucune intervention de plus d\'un an à purger');
      if (await confirmBox(`Supprimer les <b>${n}</b> interventions de plus d'un an (avant le ${fmt(limit, { day: 'numeric', month: 'long', year: 'numeric' })}) ?`, 'Purger')) {
        Store.commit(d => { d.jobs = d.jobs.filter(j => j.date >= limit); });
        toast(`${n} interventions purgées`);
      }
      return;
    }
    case 'status': {
      const { job, status } = el.dataset;
      Store.commit(d => { const x = d.jobs.find(j => j.id === job); if (x) { x.status = status; x.updatedAt = Date.now(); } });
      return;
    }
    case 'export-me': return openWeekExport({ techIds: [UI.meTech] });
    case 'copy-link': {
      const url = `${location.origin}${location.pathname}?tech=${encodeURIComponent(UI.meTech)}`;
      try { await navigator.clipboard.writeText(url); toast('Lien copié : à envoyer au technicien'); }
      catch { window.prompt('Lien du planning du technicien :', url); }
    }
  }
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 2600);
}

/* ---------- Événements ---------- */
function shift(n) { UI.start = addDays(UI.start, n * 7 * (isMobile() ? 1 : UI.weeks)); render(); }

function bindEvents() {
  $('#sync').onclick = async () => {
    if (Store.mode !== 'remote' || !lsGet(LS_KEY)) return;
    await askKey('');
    await Store.init();
    render();
  };
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    UI.view = b.dataset.view; render();
  });
  $('#prev').onclick = () => shift(-1);
  $('#next').onclick = () => shift(1);
  $('#today').onclick = () => { UI.start = mondayOf(todayISO()); UI.day = todayISO(); render(); };
  $('#cat').onchange = e => { UI.cat = e.target.value; render(); };
  $('#cat-sort').onchange = e => { UI.catSort = e.target.value; render(); };
  $('#weeks').onchange = e => { UI.weeks = +e.target.value; render(); };
  $('#weekend').onchange = e => { UI.weekend = e.target.checked; render(); };
  $('#filter').oninput = e => { UI.filter = e.target.value; render(); };
  $('#csv').onclick = exportCSV;
  $('#export-week').onclick = () => openWeekExport({ techIds: UI.cat ? D().techs.filter(t => t.active !== false && techInCat(t.id)).map(t => t.id) : [] });
  $('#print').onclick = () => window.print();
  $('#add').onclick = () => openJob(null, {});
  $('#fab').onclick = () => openJob(null, isMobile() && (UI.view === 'tech' || UI.view === 'site') ? { date: UI.day } : {});
  MQ.addEventListener('change', render);

  $('#import-file').onchange = async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      if (!Array.isArray(raw.techs) || !Array.isArray(raw.sites) || !Array.isArray(raw.jobs)) throw new Error('format non reconnu');
      const x = normalize(raw);
      if (!(await confirmBox(`Remplacer le planning actuel par cette sauvegarde ?<br><b>${x.categories.length}</b> catégories · <b>${x.techs.length}</b> techniciens · <b>${x.sites.length}</b> chantiers · <b>${x.jobs.length}</b> interventions`, 'Importer'))) return;
      Store.commit(d => { d.categories = x.categories; d.techs = x.techs; d.sites = x.sites; d.jobs = x.jobs; });
      toast('Sauvegarde importée');
    } catch (err) { toast('Import impossible : ' + err.message, 'error'); }
  };

  const view = $('#view');
  view.addEventListener('click', e => {
    const act = e.target.closest('[data-act]');
    if (act) { e.preventDefault(); handleAct(act.dataset.act, act); return; }
    const dayBtn = e.target.closest('[data-day]');
    if (dayBtn) { UI.day = dayBtn.dataset.day; render(); return; }
    const addBtn = e.target.closest('[data-add]');
    if (addBtn && !RO()) { openJob(null, UI.view === 'tech' ? { techIds: [addBtn.dataset.add], date: UI.day } : { siteId: addBtn.dataset.add, date: UI.day }); return; }
    if (RO()) { const c = e.target.closest('.chip, .m-job'); if (c) openJobView(c.dataset.job); return; }
    const chip = e.target.closest('.chip, .m-job');
    if (chip) { openJob(chip.dataset.job); return; }
    const ed = e.target.closest('[data-edit]');
    if (ed) { ({ tech: openTech, site: openSite, cat: openCat })[ed.dataset.edit](ed.dataset.id); return; }
    const cell = e.target.closest('.cell');
    if (cell) openJob(null, UI.view === 'tech' ? { techIds: [cell.dataset.row], date: cell.dataset.date } : { siteId: cell.dataset.row, date: cell.dataset.date });
  });
  let touch = null;
  view.addEventListener('touchstart', e => { touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
  view.addEventListener('touchend', e => {
    if (!touch || !isMobile() || (UI.view !== 'tech' && UI.view !== 'site')) return;
    const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50 && !e.target.closest('.m-days')) shiftDay(dx < 0 ? 1 : -1);
  }, { passive: true });
  view.addEventListener('change', e => {
    if (e.target.id === 'me-tech') { UI.meTech = e.target.value; render(); }
    if (e.target.id === 'me-span') { UI.meSpan = +e.target.value; render(); }
  });

  // Glisser-déposer (Ctrl/Alt = copier)
  const clearOver = () => $$('.cell.over').forEach(x => x.classList.remove('over'));
  view.addEventListener('dragstart', e => {
    const c = e.target.closest?.('.chip'); if (!c) return;
    if (RO()) { e.preventDefault(); return; }
    e.dataTransfer.setData('text/plain', c.dataset.job);
    e.dataTransfer.effectAllowed = 'copyMove';
    UI.dragging = true;
    requestAnimationFrame(() => c.classList.add('dragging'));
  });
  view.addEventListener('dragend', e => { UI.dragging = false; clearOver(); e.target.closest?.('.chip')?.classList.remove('dragging'); });
  view.addEventListener('dragover', e => {
    const cell = e.target.closest('.cell'); if (!cell || !UI.dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.ctrlKey || e.altKey ? 'copy' : 'move';
    if (!cell.classList.contains('over')) { clearOver(); cell.classList.add('over'); }
  });
  view.addEventListener('drop', e => {
    const cell = e.target.closest('.cell'); if (!cell) return;
    e.preventDefault(); clearOver(); UI.dragging = false;
    moveJob(e.dataTransfer.getData('text/plain'), cell.dataset.row, cell.dataset.date, e.ctrlKey || e.altKey);
  });

  document.addEventListener('keydown', e => {
    if ($('#modal-root').childElementCount || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
    if (UI.view !== 'tech' && UI.view !== 'site') return;
    if (e.key === 'ArrowLeft') shift(-1);
    else if (e.key === 'ArrowRight') shift(1);
    else if (e.key === 't') { UI.start = mondayOf(todayISO()); render(); }
    else if (e.key === 'n' && !RO()) { e.preventDefault(); openJob(null, {}); }
  });
}

/* ---------- Démarrage ---------- */
(async function init() {
  const saved = lsJSON(LS_UI) || {};
  for (const k of UI_SAVED) if (saved[k] !== undefined) UI[k] = saved[k];
  if (![1, 2, 4].includes(UI.weeks)) UI.weeks = 1;
  if (!['tech', 'site', 'me', 'res'].includes(UI.view)) UI.view = 'tech';
  const p = new URLSearchParams(location.search);
  if (p.get('tech')) { UI.view = 'me'; UI.meTech = p.get('tech'); }
  else if (!lsGet(LS_UI) && innerWidth < 700) UI.view = 'me';

  bindEvents();
  await Store.init();
  render();
  setInterval(() => Store.poll(), 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) Store.poll(); });
})();
