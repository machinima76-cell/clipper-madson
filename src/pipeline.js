const fs = require('fs');
const path = require('path');
const config = require('./config');
const clipWindow = require('./clip-window');
const { sleep, uid, clamp, formatDuration } = require('./util');
const { PLATFORMS } = require('./status');
const { getAdapter } = require('./adapters');
const capture = require('./capture');
const { analyzeMedia } = require('./analysis');
const render = require('./render');
const { publishClip } = require('./publish');

class Cancelled extends Error {}

class Pipeline {
  constructor(job, mgr) {
    this.job = job;
    this.mgr = mgr;
    this.capture = null;
    this.streamEnded = false;
    this.streamEndCode = null;
    this.demoPlan = null;
    this.pendingRenders = [];
    this.lastGenAt = 0;
    this.pulse = 0;
    this.pulseStatus = null;
  }

  /** sleep que respeita pausa e cancelamento */
  async wait(ms) {
    let t = 0;
    while (t < ms) {
      if (this.job.cancelRequested) throw new Cancelled();
      if (!this.job.paused) t += 200;
      await sleep(200);
    }
  }

  async run() {
    const job = this.job;
    try {
      if (job.platform === 'local') await this.runLocal();
      else await this.runStream();
    } catch (e) {
      await this.cleanupCapture();
      if (e instanceof Cancelled || job.cancelRequested) {
        job.status = 'cancelado';
        job.endedAt = Date.now();
        this.mgr.log(job, 'Análise cancelada pelo usuário.');
      } else {
        job.status = 'erro';
        job.error = (e && e.message) || String(e);
        job.endedAt = Date.now();
        this.mgr.log(job, `Erro de captura: ${job.error}`);
      }
      this.mgr.touch(job);
    } finally {
      job.running = false;
      this.mgr.onJobFinished(job);
    }
  }

  // ------------------------------------------------------------------
  // FLUXO DE LIVE (YouTube / Twitch / Kick)
  // ------------------------------------------------------------------
  async runStream() {
    const job = this.job;

    // 1) VALIDANDO LINK
    job.status = 'validando';
    this.mgr.touch(job);

    if (!job.demo) {
      const adapter = getAdapter(job.platform);
      if (!adapter) throw new Error('Plataforma não suportada.');
      let info;
      try {
        info = await adapter.resolveStream(job.url);
      } catch (e) {
        const err = new Error(e.message || 'Não foi possível validar o link.');
        err.code = e.code || 'probe-falhou';
        throw err;
      }
      job.streamer = info.streamer || 'Canal desconhecido';
      job.title = info.title || null;
      job.thumbUrl = info.thumbnail || null;
      job.isLive = info.isLive;
      if (!info.isLive) {
        const err = new Error('ESTA TRANSMISSÃO NÃO ESTÁ AO VIVO no momento. Cole o link enquanto a live estiver rolando — ou envie uma gravação local.');
        err.code = 'not-live';
        throw err;
      }
      if (!info.formats) {
        const err = new Error('A plataforma não disponibilizou fontes de transmissão para este conteúdo (pode exigir conta, membresia ou acesso autorizado).');
        err.code = 'no-source';
        throw err;
      }
      job.captureMode = 'real';
      await this.fetchThumbnail(job);
    } else {
      // MODO DEMONSTRAÇÃO — transmissão simulada processada localmente
      await this.wait(1600);
      job.streamer = job.demoStreamer || deriveName(job.url) || 'Madson Cobra';
      job.title = `LIVE DE DEMONSTRAÇÃO — ${job.streamer}`;
      job.thumbUrl = null;
      job.isLive = true;
      job.captureMode = 'demo';
    }

    this.mgr.log(job, `Live validada: ${job.streamer} está AO VIVO. Captura iniciada.`);
    this.mgr.touch(job);

    // 2) CAPTURA
    job.status = 'capturando';
    job.startedAt = Date.now();
    job.streamSeconds = 0;
    this.mgr.touch(job);

    if (job.captureMode === 'demo') {
      this.mgr.log(job, 'Preparando transmissão simulada para análise…');
      try {
        this.capture = await capture.generateDemoMedia(job, () => job.cancelRequested);
      } catch (e) {
        if (e.code === 'abortado' || job.cancelRequested) throw new Cancelled();
        throw e;
      }
      job.mediaPath = this.capture.outPath;
      this.demoPlan = this.capture.plan || { highlights: [] };
    } else {
      this.capture = await capture.startYtdlpCapture(job, job.url);
      this.capture.onEnd((code) => { this.streamEnded = true; this.streamEndCode = code; });
      job.mediaPath = this.capture.outPath;
    }

    // 3) LOOP DE CAPTURA + ANÁLISE EM TEMPO REAL
    if (job.captureMode === 'demo') await this.demoLoop(job);
    else await this.realLoop(job);

    if (job.endRequested) {
      this.mgr.log(job, 'Transmissão encerrada pelo usuário. Iniciando finalização…');
    }

    // 4) FINALIZAÇÃO
    await this.finalize(job, { alreadyAnalyzed: job.captureMode === 'demo' });
  }

  async demoLoop(job) {
    const duration = job.demoDuration || config.demoDurationDefault;
    const highlights = ((this.demoPlan && this.demoPlan.highlights) || []).map((h) => ({ ...h, done: false }));
    this.mgr.log(job, `IA monitorando a transmissão (${highlights.length} janelas de atenção).`);

    while (job.streamSeconds < duration && !job.endRequested) {
      if (job.cancelRequested) throw new Cancelled();
      if (!job.paused) {
        job.streamSeconds += 1;

        // Detecção de momentos em tempo real
        for (const h of highlights) {
          if (!h.done && job.streamSeconds >= h.t) {
            h.done = true;
            this.registerMoment(job, {
              ...clipWindow(h.t, duration),
              score: h.score,
              label: h.label,
              reason: h.reason || 'Detectado pela IA durante a transmissão',
            });
          }
        }

        // Pulso visual de status
        if (this.pulse > 0) {
          this.pulse -= 1;
          if (this.pulse === 0) job.status = 'capturando';
        } else if (job.streamSeconds % 25 === 0) {
          job.status = 'analisando';
          this.pulse = 2;
          this.mgr.log(job, 'IA analisando áudio, vídeo e contexto da gameplay…');
        }

        this.maybeGenerateClip(job);
        this.mgr.touch(job);
      }
      await sleep(1000);
    }
  }

  async realLoop(job) {
    this.mgr.log(job, 'Captura em andamento. A IA começa a análise assim que a transmissão terminar (ou envie o arquivo depois).');
    while (!this.streamEnded) {
      if (job.cancelRequested) throw new Cancelled();
      if (!job.paused) {
        job.streamSeconds += 1;
        if (this.pulse > 0) {
          this.pulse -= 1;
          if (this.pulse === 0) job.status = 'capturando';
        } else if (job.streamSeconds % 30 === 0) {
          job.status = 'analisando';
          this.pulse = 2;
          this.mgr.log(job, 'Monitorando a transmissão…');
        }
        this.mgr.touch(job);
      }
      await sleep(1000);
    }
    if (!job.endRequested && this.streamEndCode !== 0) {
      throw new Error(`A transmissão foi encerrada pelo servidor de origem (código ${this.streamEndCode}).`);
    }
  }

  registerMoment(job, m) {
    m.id = uid('m');
    m.clipId = null;
    m.selected = false;
    job.moments.push(m);
    job.status = 'identificando';
    this.pulse = 2;
    this.mgr.log(job, `✨ Momento identificado: ${m.label} (score ${m.score}/100)`);
  }

  maybeGenerateClip(job) {
    const now = Date.now();
    if (now - this.lastGenAt < 5000) return;
    if (job.clips.length >= job.maxClips) return;
    const candidate = job.moments
      .filter((m) => !m.clipId && m.score >= 70)
      .sort((a, b) => b.score - a.score)[0];
    if (!candidate) return;
    this.lastGenAt = now;
    this.createClip(job, candidate, { sync: false });
  }

  createClip(job, moment, { sync }) {
    const clip = {
      id: uid('c'),
      momentId: moment.id,
      label: moment.label || 'Momento',
      title: render.makeTitle(moment.label, job.streamer),
      description: null,
      start: moment.start,
      end: moment.end,
      duration: Math.max(1, Math.round(moment.end - moment.start)),
      score: moment.score,
      status: 'renderizando',
      hasVideo: false,
      files: null,
      publish: { status: 'pendente', targets: [] },
    };
    clip.description = render.makeDescription(job, clip);
    moment.clipId = clip.id;
    moment.selected = true;
    job.clips.push(clip);
    this.mgr.log(job, `🎬 Clipe gerado: ${clip.title}`);
    if (sync) {
      // render síncrono (finalização)
      return render.renderClip(job, clip, job.mediaPath).then(() => this.mgr.touch(job));
    }
    // render assíncrono (during capture) — não bloqueia o loop
    this.pendingRenders.push(render.renderClip(job, clip, job.mediaPath)
      .catch((e) => { clip.status = 'erro'; clip.error = e.message; })
      .finally(() => this.mgr.touch(job)));
    job.status = 'gerando';
    this.pulse = 2;
  }

  // ------------------------------------------------------------------
  // FINALIZAÇÃO
  // ------------------------------------------------------------------
  async finalize(job, { alreadyAnalyzed }) {
    job.status = 'gerando';
    job.progress = 80;
    this.mgr.touch(job);

    await this.cleanupCapture();

    const src = job.mediaPath;

    // Análise do conteúdo (para capturas reais, roda aqui no arquivo completo)
    if (!alreadyAnalyzed) {
      job.status = 'analisando';
      this.mgr.log(job, 'Analisando áudio, vídeo, falas e reações da transmissão…');
      this.mgr.touch(job);
      try {
        const res = await analyzeMedia(src);
        job.moments = res.candidates.map((c) => ({
          id: uid('m'),
          start: c.start,
          end: c.end,
          score: c.score,
          label: guessLabel(c),
          reason: c.reason,
          clipId: null,
          selected: false,
        }));
        this.mgr.log(job, `${job.moments.length} momentos candidatos identificados.`);
      } catch (e) {
        this.mgr.log(job, `Aviso: análise automática indisponível (${e.message}). Finalizando com os momentos já detectados.`);
      }
    }

    // Seleção dos melhores momentos: remove inadequados, duplicados e respeita o limite
    const all = job.moments || [];
    await Promise.all(this.pendingRenders);
    const before = all.length;
    let selected = all.filter((m) => m.score >= 58);
    selected.sort((a, b) => b.score - a.score);
    const dedup = [];
    for (const c of selected) {
      const duplicate = dedup.some((d) => {
        const overlap = Math.min(c.end, d.end) - Math.max(c.start, d.start);
        return overlap > Math.min(c.end - c.start, d.end - d.start) / 2;
      });
      if (!duplicate) dedup.push(c);
    }
    selected = dedup.slice(0, job.maxClips).sort((a, b) => a.start - b.start);
    job.removedCount = Math.max(0, before - selected.length);
    const selectedIds = new Set(selected.map((m) => m.id));
    for (const m of all) {
      m.selected = selectedIds.has(m.id);
      if (!m.selected) m.clipId = null;
    }
    // A seleção final também vale para os clipes antecipados da demonstração.
    for (const clip of job.clips.filter((c) => !selectedIds.has(c.momentId))) {
      for (const url of Object.values(clip.files || {})) {
        if (url) await fs.promises.rm(path.join(config.mediaDir, url.slice('/media/'.length)), { force: true });
      }
    }
    job.clips = job.clips.filter((c) => selectedIds.has(c.momentId));

    job.status = 'identificando';
    job.moments = [...all];
    this.mgr.touch(job);
    await this.wait(1200);

    // Renderização dos clipes selecionados
    job.status = 'gerando';
    this.mgr.log(job, `Renderizando ${selected.length} clipes (legendas, títulos e descrições incluídos)…`);
    this.mgr.touch(job);
    for (const m of selected) {
      if (m.clipId) continue; // já gerado durante a transmissão
      if (job.cancelRequested) throw new Cancelled();
      await this.createClip(job, m, { sync: true });
      this.mgr.touch(job);
    }

    // Publicação automática (simulada) conforme configuração do usuário
    if (job.autoPublish && job.clips.length) {
      const targets = job.publishTargets && job.publishTargets.length ? job.publishTargets : ['youtube'];
      this.mgr.log(job, `Publicando clipes em ${targets.join(', ')}…`);
      for (const clip of job.clips) {
        if (clip.status === 'pronto' || clip.status === 'pronto-sem-video') {
          await publishClip(job, clip, targets);
        }
      }
      this.mgr.log(job, `Publicação concluída (simulada): ${targets.join(', ')}.`);
    }

    job.progress = 100;
    job.status = 'finalizado';
    job.endedAt = Date.now();
    this.mgr.log(job, '✅ Análise finalizada. Clipes prontos para publicação.');
    this.mgr.touch(job);
  }

  // ------------------------------------------------------------------
  // FLUXO DE ARQUIVO LOCAL
  // ------------------------------------------------------------------
  async runLocal() {
    const job = this.job;
    job.status = 'validando';
    this.mgr.touch(job);
    await this.wait(900);

    job.streamer = (job.originalName || 'Gravação local').replace(/\.[^.]+$/, '');
    job.title = 'Gravação local enviada pelo usuário';
    job.isLive = false;
    job.captureMode = 'local';
    job.mediaPath = job.uploadPath;

    job.status = 'capturando';
    this.mgr.log(job, 'Arquivo recebido. Iniciando leitura da gravação…');
    this.mgr.touch(job);
    await this.wait(1200);

    job.status = 'analisando';
    this.mgr.log(job, 'IA analisando áudio, vídeo, falas e reações…');
    this.mgr.touch(job);
    const res = await analyzeMedia(job.mediaPath);
    job.moments = res.candidates.map((c) => ({
      id: uid('m'),
      start: c.start,
      end: c.end,
      score: c.score,
      label: guessLabel(c),
      reason: c.reason,
      clipId: null,
      selected: false,
    }));
    job.streamSeconds = Math.round(res.duration);

    job.status = 'identificando';
    this.mgr.log(job, `${job.moments.length} momentos identificados na gravação.`);
    this.mgr.touch(job);
    await this.wait(1200);

    await this.finalize(job, { alreadyAnalyzed: true });
  }

  async cleanupCapture() {
    if (this.capture && this.job.captureMode === 'real') {
      try { this.capture.cancel(); } catch (e) { /* noop */ }
    }
  }

  async fetchThumbnail(job) {
    if (!job.thumbUrl) return;
    try {
      const res = await fetch(job.thumbUrl, { signal: AbortSignal.timeout(9000) });
      if (!res.ok) return;
      const ct = res.headers.get('content-type') || 'image/jpeg';
      const ext = ct.includes('webp') ? 'webp' : ct.includes('png') ? 'png' : 'jpg';
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 500) return;
      const p = path.join(config.thumbsDir, `${job.id}.${ext}`);
      fs.writeFileSync(p, buf);
      job.thumbPath = `/media/thumbs/${job.id}.${ext}`;
    } catch (e) {
      // miniatura opcional — placeholder gerado no frontend
    }
  }

  handleEnd() {
    if (this.capture && this.job.captureMode === 'real') {
      try { this.capture.cancel(); } catch (e) { /* noop */ }
    }
  }
}

function deriveName(url) {
  if (!url) return null;
  const m = String(url).match(/(?:twitch\.tv|kick\.com)\/([A-Za-z0-9_]+)/i);
  if (m) return m[1];
  return null;
}

function guessLabel(c) {
  if (c.reason && /reação/i.test(c.reason)) return 'Reação épica';
  if (c.source === 'audio') return pickLabel(['Reação épica', 'Momento emocionante', 'Quadrinho do chat']);
  return pickLabel(['Jogada insana', 'Clutch', 'Estratégia genial', 'Reviravolta', 'Fail hilário']);
}

function pickLabel(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

module.exports = Pipeline;
