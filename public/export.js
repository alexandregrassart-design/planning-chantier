'use strict';

/* =====================================================================
   Export hebdomadaire : une feuille de route par technicien
   (impression / PDF, une page A4 par technicien) ou texte à coller
   dans un SMS, WhatsApp ou e-mail.
   Utilise les fonctions et données définies dans app.js.
   ===================================================================== */

const DAY_LONG = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

function weekDaysOf(mon, weekend) {
  const out = [];
  for (let i = 0; i < (weekend ? 7 : 5); i++) out.push(addDays(mon, i));
  return out;
}

function weekRangeLabel(mon, weekend) {
  const end = addDays(mon, weekend ? 6 : 4);
  return `du ${fmt(mon, { weekday: 'long', day: 'numeric', month: mon.slice(5, 7) === end.slice(5, 7) ? undefined : 'long' })} au ${fmt(end, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`;
}

/** Semaine proposée par défaut : la suivante à partir du jeudi. */
function defaultExportWeek() {
  const mon = mondayOf(todayISO());
  return dow(todayISO()) >= 3 ? addDays(mon, 7) : mon;
}

function colleagues(j) {
  return [...new Set(D().jobs
    .filter(x => x.siteId === j.siteId && x.date === j.date && x.techId !== j.techId && x.kind !== 'absence')
    .map(x => techById(x.techId)?.name).filter(Boolean))];
}

const jobsOf = (techId, date) => D().jobs.filter(j => j.techId === techId && j.date === date).sort(bySlot);

/* ---------- Feuille imprimable ---------- */
function sheetHTML(t, mon, weekend) {
  const days = weekDaysOf(mon, weekend);
  const cat = catById(t.categoryId);
  const sites = new Set();
  let rows = '', workDays = 0;

  for (const d of days) {
    const list = jobsOf(t.id, d);
    const hol = holidayName(d);
    const dayCell = n => `<td class="d" rowspan="${n}"><b>${DAY_LONG[dow(d)]}</b><span>${d.slice(8)}/${d.slice(5, 7)}</span>${hol ? `<em>${esc(hol)}</em>` : ''}</td>`;
    if (!list.length) {
      rows += `<tr class="free">${dayCell(1)}<td colspan="4">${hol ? 'Jour férié' : 'Pas d\'intervention prévue'}</td></tr>`;
      continue;
    }
    workDays += Math.min(1, list.filter(j => j.kind !== 'absence').reduce((n, j) => n + (j.slot === 'day' ? 1 : 0.5), 0));
    list.forEach((j, i) => {
      const first = i === 0 ? dayCell(list.length) : '';
      if (j.kind === 'absence') {
        rows += `<tr class="abs">${first}<td class="slot">${SLOTS[j.slot]}</td><td colspan="3"><b>${esc(j.label || 'Absence')}</b>${j.notes ? `<small>${esc(j.notes)}</small>` : ''}</td></tr>`;
        return;
      }
      const s = siteById(j.siteId) || { name: 'Chantier supprimé' };
      sites.add(j.siteId);
      const mates = colleagues(j);
      rows += `<tr>${first}<td class="slot">${SLOTS[j.slot]}</td>
        <td class="site">${s.number ? `<span class="n">${esc(s.number)}</span>` : ''}<b>${esc(s.name)}</b>
          ${s.client ? `<small>${esc(s.client)}</small>` : ''}${s.address ? `<small>${esc(s.address)}</small>` : ''}</td>
        <td>${j.task ? `<b>${esc(j.task)}</b>` : ''}${j.notes ? `<small>${esc(j.notes)}</small>` : ''}
          ${s.notes ? `<small>Chantier : ${esc(s.notes)}</small>` : ''}${mates.length ? `<small>Avec : ${esc(mates.join(', '))}</small>` : ''}</td>
        <td>${esc(s.contact || '')}${s.phone ? `<small>${esc(s.phone)}</small>` : ''}</td></tr>`;
    });
  }

  return `<section class="sheet">
    <header>
      <img src="logo-sygmatel.png" alt="Sygmatel">
      <div class="t"><h1>Planning de la semaine ${isoWeek(mon)}</h1><p>${esc(weekRangeLabel(mon, weekend))}</p></div>
      <div class="who"><b>${esc(t.name)}</b><span>${esc([t.role, cat?.name].filter(Boolean).join(' · '))}</span></div>
    </header>
    <p class="meta"><b>${fmtNum(workDays)}</b> jour${workDays > 1 ? 's' : ''} planifié${workDays > 1 ? 's' : ''} · <b>${sites.size}</b> chantier${sites.size > 1 ? 's' : ''}</p>
    <table>
      <thead><tr><th>Jour</th><th>Créneau</th><th>Chantier</th><th>Travaux / consignes</th><th>Contact sur site</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <footer>Édité le ${esc(fmt(todayISO(), { day: 'numeric', month: 'long', year: 'numeric' }))} · Ce planning peut évoluer : en cas de doute, contactez votre responsable.</footer>
  </section>`;
}

function printSheets(techIds, mon, weekend) {
  const box = $('#sheets');
  box.innerHTML = techIds.map(id => sheetHTML(techById(id), mon, weekend)).join('');
  const oldTitle = document.title;
  // Nom proposé pour le fichier PDF
  document.title = `Planning S${isoWeek(mon)}${techIds.length === 1 ? ' - ' + techById(techIds[0]).name : ''}`;
  document.body.classList.add('print-sheets');
  const done = () => {
    document.body.classList.remove('print-sheets');
    box.innerHTML = '';
    document.title = oldTitle;
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  const img = $('img', box);
  const go = () => setTimeout(() => window.print(), 50);
  if (img && !img.complete) { img.onload = go; img.onerror = go; } else go();
}

/* ---------- Version texte (SMS, WhatsApp, e-mail) ---------- */
function weekText(t, mon, weekend) {
  const lines = [`📅 Planning S${isoWeek(mon)} – ${t.name}`, `${weekRangeLabel(mon, weekend)[0].toUpperCase()}${weekRangeLabel(mon, weekend).slice(1)}`, ''];
  for (const d of weekDaysOf(mon, weekend)) {
    const hol = holidayName(d);
    lines.push(`▸ ${DAY_LONG[dow(d)].toUpperCase()} ${d.slice(8)}/${d.slice(5, 7)}${hol ? ` (${hol})` : ''}`);
    const list = jobsOf(t.id, d);
    if (!list.length) lines.push(hol ? '   Jour férié' : '   Pas d\'intervention prévue');
    for (const j of list) {
      if (j.kind === 'absence') { lines.push(`   • ${SLOTS[j.slot]} : ${j.label || 'Absence'}${j.notes ? ' – ' + j.notes : ''}`); continue; }
      const s = siteById(j.siteId) || { name: 'Chantier supprimé' };
      lines.push(`   • ${SLOTS[j.slot]} : ${s.number ? s.number + ' ' : ''}${s.name}${s.client ? ' (' + s.client + ')' : ''}`);
      if (j.task) lines.push(`     ${j.task}`);
      if (s.address) lines.push(`     📍 ${s.address}`);
      if (s.contact || s.phone) lines.push(`     👤 ${[s.contact, s.phone].filter(Boolean).join(' – ')}`);
      if (j.notes) lines.push(`     📝 ${j.notes}`);
      if (s.notes) lines.push(`     ℹ️ Chantier : ${s.notes}`);
      const mates = colleagues(j);
      if (mates.length) lines.push(`     Avec : ${mates.join(', ')}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Texte copié : collez-le dans un SMS, WhatsApp ou un e-mail');
  } catch {
    openModal({
      title: 'Texte à copier', body: `<textarea rows="16" readonly style="width:100%;font-size:13px">${esc(text)}</textarea>`,
      buttons: [{ label: 'Fermer', cls: 'primary' }],
      onMount: f => { const a = $('textarea', f); a.focus(); a.select(); },
    });
  }
}

/* ---------- Fenêtre d'export ---------- */
function openWeekExport(preset = {}) {
  const techs = D().techs.filter(t => t.active !== false).sort((a, b) => cmp(a.name, b.name));
  if (!techs.length) return toast('Aucun technicien à exporter', 'error');
  const sel = new Set(preset.techIds?.length ? preset.techIds : techs.map(t => t.id));
  const thisMon = mondayOf(todayISO()), def = preset.mon || defaultExportWeek();
  const weeks = [-1, 0, 1, 2, 3].map(n => addDays(thisMon, n * 7));
  if (!weeks.includes(def)) weeks.push(def);
  const tag = m => (m === thisMon ? ' (cette semaine)' : m === addDays(thisMon, 7) ? ' (semaine prochaine)' : '');

  const read = f => ({
    mon: $('#x-week', f).value,
    weekend: $('#x-we', f).checked,
    ids: $$('#f-techs input:checked', f).map(i => i.value),
  });
  const needOne = (f, ids) => {
    if (ids.length) return true;
    const w = $('#f-warn', f); w.hidden = false; w.textContent = 'Sélectionnez au moins un technicien.';
    return false;
  };

  openModal({
    title: 'Export de la semaine',
    body: `<div class="field"><label for="x-week">Semaine</label>
        <select id="x-week">${weeks.sort().map(m => `<option value="${m}" ${m === def ? 'selected' : ''}>S${isoWeek(m)} · ${esc(fmt(m, { day: 'numeric', month: 'short' }))} – ${esc(fmt(addDays(m, 4), { day: 'numeric', month: 'short' }))}${tag(m)}</option>`).join('')}</select></div>
      <label class="chk"><input type="checkbox" id="x-we" ${UI.weekend ? 'checked' : ''}> Inclure le samedi et le dimanche</label>
      <div class="field"><label>Techniciens <span class="linkbtns"><button type="button" class="linkbtn" data-x="all">Tous</button> · <button type="button" class="linkbtn" data-x="none">Aucun</button></span></label>
        <div class="pick" id="f-techs">${pickHTML(techs, sel)}</div></div>
      <p class="small-note"><b>Imprimer / PDF</b> : une page par technicien. Dans la fenêtre d'impression, choisissez « Enregistrer au format PDF » pour obtenir un fichier à envoyer.<br>
        <b>Copier le texte</b> : version courte à coller dans un SMS, WhatsApp ou e-mail.</p>
      <div class="warn err" id="f-warn" hidden></div>`,
    buttons: [
      { label: 'Copier le texte', cls: 'ghost', action: f => {
        const v = read(f);
        if (!needOne(f, v.ids)) return false;
        copyText(v.ids.map(id => weekText(techById(id), v.mon, v.weekend)).join('\n\n────────────\n\n'));
        return false;
      } },
      { label: 'Imprimer / PDF', cls: 'primary', submit: true, action: f => {
        const v = read(f);
        if (!needOne(f, v.ids)) return false;
        setTimeout(() => printSheets(v.ids, v.mon, v.weekend), 0);
      } },
    ],
    onMount: f => {
      f.addEventListener('click', e => {
        const all = e.target.closest('.pick-all');
        if (all) { const boxes = $$('input', all.parentElement); const on = boxes.every(x => x.checked); boxes.forEach(x => { x.checked = !on; }); return; }
        const x = e.target.closest('[data-x]');
        if (x) $$('#f-techs input', f).forEach(i => { i.checked = x.dataset.x === 'all'; });
      });
    },
  });
}
