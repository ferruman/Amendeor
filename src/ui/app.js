// Одна страница без сборки: список текстов, лист с правками, карточка текущей правки.
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const state = { docs: [], doc: null, current: null, filter: 'pending', poll: null, busy: false, error: '' };
const modeHelp = { mechanical: 'rules (no key needed)', proofread: 'spelling, grammar, punctuation', copy: 'copy edit', full: 'everything' };

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json' } });
  const type = response.headers.get('content-type') ?? '';
  const body = type.includes('json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(body.error ?? response.statusText);
  return body;
}

// Пословный diff (LCS): у правки модели целое предложение, а меняются в нём одно-два слова.
function wordDiff(before, after) {
  const split = (text) => text.match(/\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];
  const a = split(before), b = split(after);
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const out = []; let i = 0, j = 0;
  const push = (kind, text) => { const last = out.at(-1); if (last?.kind === kind) last.text += text; else out.push({ kind, text }); };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { push('same', a[i]); i++; j++; }
    else if (j < b.length && (i === a.length || table[i][j + 1] >= table[i + 1][j])) { push('ins', b[j]); j++; }
    else { push('del', a[i]); i++; }
  }
  // Удалённый или вставленный пробел иначе не виден — показываем его знаком ␣.
  return out.map((part) => part.kind === 'same' ? esc(part.text) : `<${part.kind}>${/^[ \t]+$/.test(part.text) ? '␣'.repeat(part.text.length) : esc(part.text)}</${part.kind}>`).join('');
}

const plain = (text) => esc(text).replace(/&lt;!--[ \t]*scene:[^\n]*?--&gt;[ \t]*\n?/g, '<span class="scene-rule" aria-hidden="true"></span>');

function renderChapter(chapter) {
  const edits = state.doc.proposals.filter((item) => item.chapter === chapter.slug && item.start !== undefined).sort((x, y) => x.start - y.start);
  let html = '', cursor = 0;
  for (const edit of edits) {
    if (edit.start < cursor) continue; // пересекающиеся правки остаются в списке справа
    html += plain(chapter.text.slice(cursor, edit.start));
    const original = chapter.text.slice(edit.start, edit.end);
    const inner = edit.status === 'pending' ? wordDiff(original, edit.replacement) : edit.status === 'accepted' ? esc(edit.replacement) : esc(original);
    html += `<span class="edit ${edit.status}${edit.id === state.current ? ' current' : ''}" data-id="${esc(edit.id)}" title="${esc(edit.category)} · ${esc(edit.status)}">${inner}</span>`;
    cursor = edit.end;
  }
  return html + plain(chapter.text.slice(cursor));
}

const visible = () => state.doc.proposals.filter((item) => state.filter === 'all' || item.status === state.filter);
const count = (status) => state.doc.proposals.filter((item) => item.status === status).length;

function renderCard() {
  const item = state.doc.proposals.find((proposal) => proposal.id === state.current);
  if (!item) {
    const pending = count('pending');
    return `<div class="card"><p class="hint">${state.doc.run ? (pending ? 'Pick an edit on the page or in the list.' : 'Nothing left to review. Download the edited copy, or run a deeper check.') : 'Run a check to see proposed edits.'}</p></div>`;
  }
  const v = item.verification;
  const verification = item.source === 'model'
    ? (item.unverified ? 'not checked by the verifier' : `verifier agreed ${v.agreed}/${v.passes} · meaning risk ${esc(v.semantic_risk)} · voice ${esc(v.voice)}`)
    : 'deterministic rule';
  const decided = item.status !== 'pending';
  const title = item.scene === '@title' ? '<span>chapter title</span>' : '';
  return `<div class="card" aria-live="polite">
    <div class="label"><span>${esc(item.category.replace(/-/g, ' '))}</span><span>${esc(item.impact)}</span>${title}</div>
    <div class="diff">${wordDiff(item.target, item.replacement)}</div>
    ${item.reason ? `<p class="reason">${esc(item.reason)}</p>` : ''}
    <div class="verification">${verification}</div>
    ${decided ? `<div class="decision">${{ accepted: 'Accepted', rejected: 'Rejected', stale: 'The text has changed here; this edit no longer applies.' }[item.status]}</div>` : `
    <div class="actions">
      <button class="button primary" type="button" data-decide="accept" ${state.busy ? 'disabled' : ''}>Accept<kbd>A</kbd></button>
      <button class="button" type="button" data-decide="reject" ${state.busy ? 'disabled' : ''}>Reject<kbd>R</kbd></button>
    </div>`}
    <div class="actions"><button class="button" type="button" data-step="-1">Previous<kbd>K</kbd></button><button class="button" type="button" data-step="1">Next<kbd>J</kbd></button></div>
  </div>`;
}

function renderDoc() {
  const doc = state.doc;
  const words = doc.chapters.reduce((sum, chapter) => sum + (chapter.text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0), 0);
  const run = doc.run;
  const cost = run?.ledger?.cost ? ` · ${run.ledger.cost.toFixed(2)} ${run.ledger.currency ?? ''}` : '';
  const meta = [`${doc.lang}`, `${doc.chapters.length} chapter${doc.chapters.length === 1 ? '' : 's'}`, `${words.toLocaleString()} words`,
    run ? `last check ${new Date(run.finished_at ?? Date.now()).toLocaleString()} (${run.mode ?? '?'})${cost}` : 'not checked yet'].join(' · ');
  const running = doc.job && !doc.job.error;
  const status = running ? `<div class="status-line running" role="status">Checking (${esc(doc.job.mode)})… started ${new Date(doc.job.started_at).toLocaleTimeString()}. A model check can take several minutes.</div>`
    : doc.job?.error ? `<div class="status-line error" role="alert">Check failed: ${esc(doc.job.error)}</div>`
    : state.error ? `<div class="status-line error" role="alert">${esc(state.error)}</div>`
    : run?.failures?.length ? `<div class="status-line error">${run.failures.length} part(s) of the text could not be checked; run the check again to retry them.</div>` : '';
  const options = doc.modes.map((mode) => `<option value="${mode}" ${mode !== 'mechanical' && !doc.model ? 'disabled' : ''}>${mode} — ${modeHelp[mode]}</option>`).join('');
  const mechanical = doc.proposals.filter((item) => item.status === 'pending' && item.impact === 'mechanical');
  const filters = [['pending', 'To review'], ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['stale', 'Outdated'], ['all', 'All']]
    .map(([key, label]) => `<button class="chip" type="button" data-filter="${key}" aria-pressed="${state.filter === key}">${label} ${key === 'all' ? doc.proposals.length : count(key)}</button>`).join('');
  const list = visible().map((item) => `<li><button type="button" data-id="${esc(item.id)}" aria-current="${item.id === state.current}">
      <span class="what">${esc(item.category)} · ${esc(item.status)}</span><span class="snippet">${wordDiff(item.target, item.replacement)}</span></button></li>`).join('');
  const withheld = run?.withheld?.length ? `<details><summary>${run.withheld.length} edit(s) withheld by the guards</summary><ul>${run.withheld.map((item) => `<li>${esc(item.guard)}: ${esc(item.reason)}</li>`).join('')}</ul></details>` : '';
  $('#work').innerHTML = `
    <header class="doc-header">
      <div class="title"><h1>${esc(doc.name)}</h1><div class="meta">${esc(meta)}</div></div>
      <div class="run-controls">
        <select id="mode" aria-label="Check mode">${options}</select>
        <button class="button primary" type="button" id="run" ${running ? 'disabled' : ''}>${run ? 'Check again' : 'Check text'}</button>
        <a class="button" href="/api/docs/${encodeURIComponent(doc.id)}/edited" download="${esc(doc.name)}.edited.md">Download edited</a>
      </div>
    </header>
    ${status}
    <div class="columns">
      <div class="sheet-scroll"><article class="sheet" lang="${esc(doc.lang)}">${doc.chapters.map((chapter) => `${doc.chapters.length > 1 || doc.kind === 'workspace' ? `<h2>${esc(chapter.title)}</h2>` : ''}<div class="chapter-text">${renderChapter(chapter)}</div>`).join('')}</article></div>
      <aside class="side" aria-label="Edits">
        ${renderCard()}
        ${mechanical.length ? `<button class="button" type="button" id="accept-mechanical" ${state.busy ? 'disabled' : ''}>Accept all ${mechanical.length} mechanical fixes</button>` : ''}
        <div class="counters">${filters}</div>
        <ul class="list">${list || '<li class="hint">Nothing here.</li>'}</ul>
        ${withheld}
        ${doc.model ? '' : '<p class="hint">No model is configured, so only rule-based checks are available. See README → Model editing.</p>'}
      </aside>
    </div>`;
  const mode = $('#mode'); mode.value = doc.model ? (run?.mode ?? 'proofread') : 'mechanical';
  document.querySelector('.edit.current')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function renderList() {
  $('#doc-list').innerHTML = state.docs.map((doc) => `<li><a href="#${encodeURIComponent(doc.id)}" ${state.doc?.id === doc.id ? 'aria-current="page"' : ''}>${esc(doc.name)}<span class="kind">${doc.kind === 'workspace' ? 'Codicora book' : 'text'}${doc.running ? ' · checking…' : ''}</span></a></li>`).join('');
}

async function loadDocs() { state.docs = await api('/api/docs'); renderList(); }

async function openDoc(id, keepCurrent = false) {
  state.doc = await api(`/api/docs/${encodeURIComponent(id)}`);
  if (!keepCurrent || !state.doc.proposals.some((item) => item.id === state.current)) state.current = state.doc.proposals.find((item) => item.status === 'pending')?.id ?? null;
  renderList(); renderDoc();
  clearTimeout(state.poll);
  if (state.doc.job && !state.doc.job.error) state.poll = setTimeout(async () => { await openDoc(id, true); await loadDocs(); }, 2000);
}

function step(delta) {
  const items = visible(); if (!items.length) return;
  const index = items.findIndex((item) => item.id === state.current);
  state.current = items[(index + delta + items.length) % items.length].id; renderDoc();
}

async function decide(action, ids) {
  if (state.busy) return;
  state.busy = true; state.error = '';
  try {
    const item = state.doc.proposals.find((proposal) => proposal.id === ids[0]);
    const unverified = action === 'accept' && ids.some((id) => state.doc.proposals.find((proposal) => proposal.id === id)?.unverified);
    if (unverified && !confirm('This edit was not checked by the verifier. Accept it anyway?')) return;
    await api(`/api/docs/${encodeURIComponent(state.doc.id)}/${action}`, { method: 'POST', body: JSON.stringify({ ids, unverified }) });
    // После решения — к следующей непросмотренной правке в порядке списка.
    const order = state.doc.proposals.filter((proposal) => proposal.status === 'pending' && !ids.includes(proposal.id));
    const after = order.find((proposal) => state.doc.proposals.indexOf(proposal) > state.doc.proposals.indexOf(item)) ?? order[0];
    state.current = after?.id ?? null;
    await openDoc(state.doc.id, true);
  } catch (error) { state.error = error.message; renderDoc(); }
  finally { state.busy = false; if (state.doc) renderDoc(); }
}

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-id], [data-decide], [data-step], [data-filter], #run, #accept-mechanical, [data-new], #new-text, #theme');
  if (!target) return;
  if (target.matches('#new-text, [data-new]')) { $('#new-error').textContent = ''; $('#new-dialog').showModal(); }
  else if (target.id === 'theme') toggleTheme();
  else if (target.dataset.decide) decide(target.dataset.decide, [state.current]);
  else if (target.dataset.step) step(Number(target.dataset.step));
  else if (target.dataset.filter) { state.filter = target.dataset.filter; renderDoc(); }
  else if (target.id === 'accept-mechanical') decide('accept', state.doc.proposals.filter((item) => item.status === 'pending' && item.impact === 'mechanical').map((item) => item.id));
  else if (target.id === 'run') {
    state.error = '';
    try { await api(`/api/docs/${encodeURIComponent(state.doc.id)}/run`, { method: 'POST', body: JSON.stringify({ mode: $('#mode').value }) }); await openDoc(state.doc.id, true); await loadDocs(); }
    catch (error) { state.error = error.message; renderDoc(); }
  } else if (target.dataset.id) { state.current = target.dataset.id; renderDoc(); }
});

document.addEventListener('keydown', (event) => {
  if (!state.doc || event.metaKey || event.ctrlKey || event.altKey || event.target.closest?.('input, textarea, select, dialog')) return;
  const item = state.doc.proposals.find((proposal) => proposal.id === state.current);
  if (event.key === 'j') step(1);
  else if (event.key === 'k') step(-1);
  else if (event.key === 'a' && item?.status === 'pending') decide('accept', [item.id]);
  else if (event.key === 'r' && item?.status === 'pending') decide('reject', [item.id]);
});

$('#new-form').addEventListener('submit', async (event) => {
  if (event.submitter?.value !== 'create') return;
  event.preventDefault();
  const form = new FormData(event.target);
  const picked = [...event.target.elements.namedItem('files').files];
  const files = picked.length ? await Promise.all(picked.map(async (file) => ({ name: file.name, text: await file.text() }))) : [{ name: form.get('name'), text: form.get('text') }];
  try {
    const { id } = await api('/api/docs', { method: 'POST', body: JSON.stringify({ name: form.get('name'), lang: form.get('lang'), files }) });
    $('#new-dialog').close(); event.target.reset();
    await loadDocs(); location.hash = encodeURIComponent(id);
  } catch (error) { $('#new-error').textContent = error.message; }
});
$('#new-form').elements.namedItem('files').addEventListener('change', (event) => {
  const name = $('#new-form').elements.namedItem('name');
  if (!name.value && event.target.files[0]) name.value = event.target.files[0].name.replace(/\.(md|txt)$/i, '');
});

function toggleTheme(next) {
  const theme = next ?? (document.documentElement.dataset.theme === 'field' ? 'workbench' : 'field');
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('amendeor-theme', theme); } catch {}
  $('#theme').textContent = theme === 'field' ? 'Dark theme' : 'Light theme';
}

window.addEventListener('hashchange', () => { if (location.hash) openDoc(decodeURIComponent(location.hash.slice(1))).catch((error) => { state.error = error.message; }); });
toggleTheme(document.documentElement.dataset.theme);
await loadDocs();
if (location.hash) await openDoc(decodeURIComponent(location.hash.slice(1)));
