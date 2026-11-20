/* ============ MADSON COBRA CLIPPER — frontend ============ */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const PLAT_META = {
  youtube: { label: 'YouTube', color: '#ff0033', text: '#ffffff' },
  twitch: { label: 'Twitch', color: '#a970ff', text: '#ffffff' },
  kick: { label: 'Kick', color: '#53fc18', text: '#06110a' },
  local: { label: 'Arquivo local', color: '#94a3b8', text: '#0b0f14' },
};

const RX = {
  youtube: /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^#]*v=|live\/|shorts\/|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i,
  twitch: /^(?:https?:\/\/)?(?:www\.)?twitch\.tv\/([A-Za-z0-9_][A-Za-z0-9_]{2,24})\/?$/i,
  kick: /^(?:https?:\/\/)?(?:www\.)?kick\.com\/([A-Za-z0-9_][A-Za-z0-9_]{2,24})\/?$/i,
};

const STEPPER = ['aguardando', 'validando', 'capturando', 'analisando', 'identificando', 'gerando', 'finalizado'];
const STEPPER_LABELS = {
  aguardando: 'Aguardando', validando: 'Validando', capturando: 'Capturando',
  analisando: 'Analisando', identificando: 'Identificando', gerando: 'Gerando', finalizado: 'Finalizado',
};

const openDetails = new Set();
const openDescs = new Set();
const lastEventSeq = new Map();
let firstRender = true;

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDur(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

function detectPlatform(url) {
  for (const k of ['youtube', 'twitch', 'kick']) if (RX[k].test(url || '')) return k;
  return null;
}

function initials(name) {
  return String(name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function platMeta(job) {
  return PLAT_META[job.platform] || PLAT_META.local;
}

// ------------------------------------------------------------------
// toasts
// ------------------------------------------------------------------
function toast(msg, type = 'ok') {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  box.appendChild(el);
  while (box.children.length > 5) box.removeChild(box.firstChild);
  setTimeout(() => {
    el.classList.add('fade');
    setTimeout(() => el.remove(), 350);
  }, 5200);
}

// ------------------------------------------------------------------
// render
// ------------------------------------------------------------------
let lastSig = '';

function render(state) {
  // capacidade
  $('#capacity-text').textContent = `${state.running}/${state.capacity}`;

  const jobs = state.jobs || [];
  $('#jobs-count').textContent = jobs.length
    ? `${jobs.length} transmissão(ões) · ${state.running} ativa(s)`
    : '';

  const grid = $('#jobs-grid');
  const empty = $('#empty-state');
  empty.classList.toggle('hidden', jobs.length > 0);

  // Assinatura estrutural: só reconstrói os cards quando algo estrutural muda.
  // Assim os botões não "escapam" do clique durante o progresso em tempo real.
  const sig = jobs.map((j) => [
    j.id, j.status, j.paused ? 1 : 0, j.queuePos || 0,
    j.moments.length, j.moments.map((m) => m.selected ? 1 : 0).join(''),
    j.clips.map((c) => c.id + ':' + c.status + ':' + (c.publish ? c.publish.status : '')).join(','),
    j.error ? 1 : 0, j.captureMode, j.streamer, j.thumbPath || '',
    (j.clips.find((c) => c.files && c.files.thumb) || {}).id || '',
  ].join('|')).join('#');

  if (sig !== lastSig) {
    lastSig = sig;
    grid.innerHTML = jobs.map(cardHtml).join('');
    // preserva descrições de clipes abertas entre re-renders
    $$('details.clip-desc[data-cid]').forEach((d) => {
      if (openDescs.has(d.dataset.cid)) d.open = true;
    });
  } else {
    for (const j of jobs) updateDynamic(j);
  }

  // toasts de eventos novos
  for (const job of jobs) {
    const last = lastEventSeq.get(job.id);
    if (last == null) {
      lastEventSeq.set(job.id, job.seq || 0);
      continue;
    }
    const news = (job.events || []).filter((e) => e.seq > last);
    if (news.length && !firstRender) {
      const lastOne = news[news.length - 1];
      const isErr = /erro|falha|indispon/i.test(lastOne.msg);
      toast(`${job.streamer ? job.streamer + ': ' : ''}${lastOne.msg}`, isErr ? 'error' : 'info');
    }
    lastEventSeq.set(job.id, job.seq || 0);
  }
  firstRender = false;
}

/** Atualiza apenas os campos dinâmicos (tempo, progresso, contadores) sem reconstruir o card. */
function updateDynamic(job) {
  const card = document.querySelector(`.card[data-id="${cssEsc(job.id)}"]`);
  if (!card) return;

  const bar = card.querySelector('.progress .bar');
  if (bar) {
    if (job.progress === -1) {
      bar.classList.add('indeterminate');
      bar.style.width = '';
    } else {
      bar.classList.remove('indeterminate');
      bar.style.width = Math.max(2, Math.min(100, job.progress || 0)) + '%';
    }
  }

  const tb = card.querySelector('.badge-time');
  if (tb) {
    tb.textContent = '⏱ ' + job.streamLabel + (job.demo && job.status !== 'finalizado' ? ' / ' + fmtDur(job.demoDuration) : '');
  }

  const stats = card.querySelectorAll('.stat b');
  if (stats.length === 3) {
    stats[0].textContent = job.streamLabel;
    stats[1].textContent = job.moments.length;
    stats[2].textContent = job.clips.length;
  }
}

function cssEsc(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

function cardHtml(job) {
  const plat = platMeta(job);
  const active = ['capturando', 'analisando', 'identificando', 'gerando'].includes(job.status);
  const stepIdx = STEPPER.indexOf(job.status);
  const curIdx = job.status === 'erro' || job.status === 'cancelado' ? -1 : stepIdx;

  const thumb = job.thumbPath
    ? `<img src="${esc(job.thumbPath)}" alt="miniatura" loading="lazy">`
    : (job.clips.find((c) => c.files && c.files.thumb)
      ? `<img src="${esc(job.clips.find((c) => c.files && c.files.thumb).files.thumb)}" alt="miniatura" loading="lazy">`
      : `<div class="placeholder" style="background:linear-gradient(135deg, ${esc(plat.color)}33, #0a0e13 70%)">
           <span class="initials" style="color:${esc(plat.color)}">${esc(initials(job.streamer))}</span>
           ${job.demo ? '<span class="demo-tag">DEMONSTRAÇÃO</span>' : ''}
         </div>`);

  const liveBadge = job.isLive && ['capturando', 'analisando', 'identificando', 'gerando'].includes(job.status)
    ? '<span class="badge badge-live">AO VIVO</span>' : '';
  const timeBadge = job.status !== 'aguardando'
    ? `<span class="badge badge-time">⏱ ${esc(job.streamLabel)}${job.demo && job.status !== 'finalizado' ? ' / ' + fmtDur(job.demoDuration) : ''}</span>` : '';
  const queueBadge = job.queuePos ? `<span class="badge badge-queue">⏳ fila #${job.queuePos}</span>` : '';
  const pausedBadge = job.paused ? `<span class="badge badge-paused">⏸ pausado</span>` : '';

  const progressBar = job.progress === -1
    ? '<div class="bar indeterminate"></div>'
    : `<div class="bar" style="width:${Math.max(2, Math.min(100, job.progress || 0))}%"></div>`;

  const stepper = STEPPER.map((key, i) => {
    const cls = i < curIdx ? 'done' : i === curIdx ? 'active' : '';
    return `<div class="step ${cls}"><span class="s-dot"></span><span class="s-label">${STEPPER_LABELS[key]}</span></div>`;
  }).join('');

  const actions = actionsHtml(job);
  const detail = detailHtml(job);

  return `
  <article class="card st-${esc(job.status)}" data-id="${esc(job.id)}">
    <div class="media">
      ${thumb}
      <span class="badge badge-plat" style="background:${esc(plat.color)};color:${esc(plat.text)}">${esc(job.platformLabel)}</span>
      ${liveBadge}
      ${timeBadge}
      ${queueBadge}
      ${pausedBadge}
    </div>
    <div class="card-body">
      <div class="card-title-row">
        <h3 title="${esc(job.streamer || '')}">${esc(job.streamer || 'Canal desconhecido')}</h3>
        <span class="status-pill st-${esc(job.status)}">${esc(job.statusLabel)}</span>
      </div>
      <div class="card-sub" title="${esc(job.title || '')}">${esc(job.title || job.platformLabel)}${job.demo ? ' · modo demonstração' : ''}</div>
      <div class="stepper">${stepper}</div>
      <div class="progress">${progressBar}</div>
      <div class="stats">
        <div class="stat"><b>${esc(job.streamLabel)}</b><span>analisado</span></div>
        <div class="stat"><b>${job.moments.length}</b><span>momentos</span></div>
        <div class="stat"><b>${job.clips.length}</b><span>clipes</span></div>
      </div>
      ${job.url ? `<div class="orig-link" title="${esc(job.url)}">🔗 <a href="${esc(job.url)}" target="_blank" rel="noopener">${esc(job.url)}</a></div>` : '<div class="orig-link">📁 ' + esc(job.originalName || 'arquivo local') + '</div>'}
      ${job.status === 'erro' && job.error ? `<div class="error-box">⚠ ${esc(job.error)}</div>` : ''}
      <div class="actions">${actions}</div>
      <div class="detail ${openDetails.has(job.id) ? '' : 'hidden'}">${detail}</div>
    </div>
  </article>`;
}

function actionsHtml(job) {
  const btns = [];
  const canPause = ['capturando', 'analisando', 'identificando', 'gerando'].includes(job.status);
  if (canPause && !job.paused) btns.push(`<button class="action-btn" data-action="pause">⏸ Pausar</button>`);
  if (canPause && job.paused) btns.push(`<button class="action-btn accent" data-action="resume">▶ Retomar</button>`);
  if (canPause && job.platform !== 'local') btns.push(`<button class="action-btn" data-action="end">⏹ Encerrar live</button>`);
  if (['aguardando', 'validando', 'capturando', 'analisando', 'identificando', 'gerando'].includes(job.status)) {
    btns.push(`<button class="action-btn danger" data-action="cancel">✖ Cancelar</button>`);
  }
  if (job.status === 'erro') {
    if (job.url) btns.push(`<button class="action-btn accent" data-action="demo-retry">🔁 Testar em modo demonstração</button>`);
    btns.push(`<button class="action-btn" data-action="upload">📁 Enviar gravação local</button>`);
  }
  if (job.status === 'finalizado') {
    const pendente = job.clips.filter((c) => !c.publish || c.publish.status !== 'publicado').length;
    if (pendente) btns.push(`<button class="action-btn accent" data-action="publish-all">🚀 Publicar clipes (${pendente})</button>`);
  }
  if (job.clips.length) {
    btns.push(`<button class="action-btn accent" data-action="download-all">⬇ Baixar tudo (${job.clips.length})</button>`);
  }
  if (job.moments.length || job.clips.length) {
    btns.push(`<button class="action-btn" data-action="toggle-detail">${openDetails.has(job.id) ? '▴ Detalhes' : '▾ Detalhes'}</button>`);
  }
  return btns.join('');
}

function detailHtml(job) {
  if (!job.moments.length && !job.clips.length) {
    return '<h4>Sem dados ainda</h4><div class="orig-link">A IA ainda não identificou momentos nesta transmissão.</div>';
  }
  const clipById = {};
  for (const c of job.clips) clipById[c.id] = c;

  const moments = job.moments.slice().sort((a, b) => a.start - b.start);
  const momentsHtml = moments.length ? moments.map((m) => {
    const clip = m.clipId ? clipById[m.clipId] : null;
    const clipTxt = clip
      ? `<span class="m-clip">🎬 ${esc(clip.status === 'pronto' || clip.status === 'pronto-sem-video' ? 'clipe gerado' : clip.status)}</span>`
      : `<span class="m-clip none">${m.selected ? '⏳ na fila' : 'sem clipe'}</span>`;
    return `<div class="moment ${m.selected ? '' : 'not-selected'}">
      <span class="m-time">${fmtDur(m.start)}–${fmtDur(m.end)}</span>
      <span class="m-label">${esc(m.label)}</span>
      ${clipTxt}
      <span class="m-score ${m.score < 70 ? 'low' : ''}">${m.score}</span>
    </div>`;
  }).join('') : '<div class="orig-link">Nenhum momento identificado ainda.</div>';

  const clips = job.clips.slice().sort((a, b) => b.score - a.score);
  const clipsHtml = clips.length ? clips.map((c) => {
    const files = c.files || {};
    const pub = c.publish || {};
    const pubBadge = pub.status === 'publicado'
      ? `<span class="chip-btn pub">✓ publicado (simulação)</span>`
      : pub.status === 'publicando'
        ? `<span class="chip-btn pub">publicando…</span>`
        : `<button class="chip-btn accent" data-action="publish-clip" data-cid="${esc(c.id)}">🚀 Publicar</button>`;
    return `<div class="clip">
      ${files.thumb ? `<div class="clip-thumb"><img src="${esc(files.thumb)}" alt="clipe" loading="lazy"></div>` : ''}
      <div class="clip-info">
        <h5>${esc(c.title || c.label)}</h5>
        <div class="clip-meta">${c.duration}s · score ${c.score}/100 · ${esc(c.label)} · ${fmtDur(c.start)}</div>
        <div class="clip-actions">
          ${files.mp4 ? `<a class="chip-btn accent" href="${esc(files.mp4)}" download>⬇ Baixar MP4</a>` : `<span class="chip-btn">⬇ MP4 indisponível</span>`}
          ${files.srt ? `<a class="chip-btn" href="${esc(files.srt)}" download>📝 legenda</a>` : ''}
          ${files.pkg ? `<a class="chip-btn" href="${esc(files.pkg)}" download>📦 pacote</a>` : ''}
          ${pubBadge}
        </div>
        ${c.description ? `<details class="clip-desc" data-cid="${esc(c.id)}"><summary>descrição gerada</summary><p>${esc(c.description)}</p></details>` : ''}
      </div>
    </div>`;
  }).join('') : '';

  return `
    <h4>Melhores momentos ${job.removedCount ? `<span class="muted">· ${job.removedCount} trecho(s) inadequado(s) removido(s) pela IA</span>` : ''}</h4>
    ${momentsHtml}
    ${clips ? `<h4>Clipes gerados (${clips.length}/${job.maxClips})</h4>${clipsHtml}` : ''}
  `;
}

// ------------------------------------------------------------------
// websocket
// ------------------------------------------------------------------
let ws = null;
function connect() {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  ws = new WebSocket(`${proto}${location.host}/ws`);
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'state') {
        lastState = msg;
        render(msg);
        setWs(true);
      }
    } catch (e) { /* ignora */ }
  };
  ws.onclose = () => { setWs(false); setTimeout(connect, 1500); };
  ws.onerror = () => setWs(false);
}

function setWs(on) {
  const pill = $('#ws-pill');
  pill.classList.toggle('offline', !on);
  pill.innerHTML = on ? '<span class="dot"></span> tempo real' : '<span class="dot"></span> reconectando…';
}

// ------------------------------------------------------------------
// api + interações
// ------------------------------------------------------------------
function readSettings() {
  const targets = $$('input[name="tgt"]:checked').map((i) => i.value);
  return {
    maxClips: $('#sel-maxclips').value,
    autoPublish: $('#chk-autopublish').checked,
    targets: targets.length ? targets : ['youtube'],
    demoDuration: parseInt($('#sel-demodur').value, 10),
  };
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

async function startAnalysis(url) {
  const btn = $('#btn-start');
  btn.disabled = true;
  $('.btn-primary-spin').classList.remove('hidden');
  $('#link-error').classList.add('hidden');
  try {
    const job = await api('/api/jobs', { method: 'POST', body: JSON.stringify({ url, ...readSettings() }) });
    $('#input-link').value = '';
    updateChip();
    toast(`Análise iniciada: ${job.job.streamer || 'live'} (${job.job.platformLabel})`, 'info');
  } catch (e) {
    const box = $('#link-error');
    box.textContent = e.message;
    box.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    $('.btn-primary-spin').classList.add('hidden');
  }
}

async function startDemo(url) {
  try {
    const job = await api('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ url: url || undefined, demo: true, ...readSettings() }),
    });
    toast('Demonstração iniciada — transmissão simulada sendo analisada.', 'info');
    return job;
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function uploadLocal(file) {
  if (!file) return;
  const fd = new FormData();
  fd.append('video', file);
  const s = readSettings();
  fd.append('maxClips', s.maxClips);
  fd.append('autoPublish', String(s.autoPublish));
  fd.append('targets', JSON.stringify(s.targets));
  fd.append('demoDuration', String(s.demoDuration));
  toast(`Enviando "${file.name}"…`, 'info');
  try {
    const res = await fetch('/api/jobs/local', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha no upload.');
    toast(`Gravação enviada: análise de "${file.name}" iniciada.`, 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function updateChip() {
  const url = $('#input-link').value.trim();
  const chip = $('#platform-chip');
  const p = detectPlatform(url);
  if (p) {
    const meta = PLAT_META[p];
    chip.textContent = meta.label;
    chip.style.background = meta.color;
    chip.style.color = meta.text;
    chip.classList.remove('hidden');
  } else {
    chip.classList.add('hidden');
  }
}

// ------------------------------------------------------------------
// eventos
// ------------------------------------------------------------------
function wire() {
  $('#form-link').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = $('#input-link').value.trim();
    if (!url) {
      const box = $('#link-error');
      box.textContent = 'Cole o link da live antes de iniciar.';
      box.classList.remove('hidden');
      return;
    }
    startAnalysis(url);
  });

  $('#input-link').addEventListener('input', updateChip);

  $('#btn-paste').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        $('#input-link').value = text.trim();
        updateChip();
      }
    } catch (e) {
      toast('Não consegui ler a área de transferência — cole com Ctrl+V.', 'error');
    }
  });

  $$('.example').forEach((b) => b.addEventListener('click', () => {
    $('#input-link').value = b.dataset.url;
    updateChip();
    $('#input-link').focus();
  }));

  $('#btn-demo-example').addEventListener('click', () => {
    startDemo($('#input-link').value.trim() || 'https://www.twitch.tv/madsoncobra');
  });
  $('#btn-demo-empty').addEventListener('click', () => startDemo());

  $('#btn-upload').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) uploadLocal(e.target.files[0]);
    e.target.value = '';
  });

  // sincroniza descrições de clipes abertas (toggle nativo do <details>)
  $('#jobs-grid').addEventListener('toggle', (e) => {
    const det = e.target;
    if (det && det.matches && det.matches('details.clip-desc[data-cid]')) {
      if (det.open) openDescs.add(det.dataset.cid);
      else openDescs.delete(det.dataset.cid);
    }
  }, true);

  // delegação de ações nos cards
  $('#jobs-grid').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const card = e.target.closest('.card');
    const id = card && card.dataset.id;
    const action = btn.dataset.action;

    if (action === 'toggle-detail') {
      if (openDetails.has(id)) openDetails.delete(id); else openDetails.add(id);
      lastSig = ''; // força reconstrução para refletir a abertura dos detalhes
      render(lastState);
      return;
    }
    if (action === 'upload') { $('#file-input').click(); return; }
    if (action === 'download-all') {
      window.location.href = `/api/jobs/${id}/download`;
      return;
    }
    if (action === 'demo-retry') {
      const job = lastState.jobs.find((j) => j.id === id);
      if (job) startDemo(job.url);
      return;
    }
    if (action === 'pause' || action === 'resume' || action === 'cancel' || action === 'end') {
      try {
        await api(`/api/jobs/${id}/${action}`, { method: 'POST', body: '{}' });
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    if (action === 'publish-all') {
      const job = lastState.jobs.find((j) => j.id === id);
      try {
        await api(`/api/jobs/${id}/publish`, { method: 'POST', body: JSON.stringify({ targets: job ? job.publishTargets : undefined }) });
        toast('Publicação iniciada (simulada).', 'info');
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    if (action === 'publish-clip') {
      const job = lastState.jobs.find((j) => j.id === id);
      try {
        await api(`/api/jobs/${id}/clips/${btn.dataset.cid}/publish`, {
          method: 'POST',
          body: JSON.stringify({ targets: job ? job.publishTargets : undefined }),
        });
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
  });
}

// ------------------------------------------------------------------
// boot
// ------------------------------------------------------------------
let lastState = { jobs: [], capacity: 3, running: 0 };
(async function boot() {
  wire();
  updateChip();
  connect();
  try {
    const res = await fetch('/api/state');
    lastState = await res.json();
    render(lastState);
  } catch (e) { /* websocket assume */ }
})();
