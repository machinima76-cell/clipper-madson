const EventEmitter = require('events');
const config = require('./config');
const Pipeline = require('./pipeline');
const { uid, clampInt, formatDuration } = require('./util');
const { STATUS_LABELS, PLATFORMS } = require('./status');

class JobManager extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map();
    this.order = [];
    this.pipelines = new Map();
    this.running = 0;
  }

  create(data) {
    const job = {
      id: uid('j'),
      url: data.url || null,
      platform: data.platform || 'local',
      demo: !!data.demo,
      demoDuration: clampInt(data.demoDuration, 20, 900, config.demoDurationDefault),
      maxClips: clampInt(data.maxClips, 1, 10, config.maxClipsDefault),
      autoPublish: !!data.autoPublish,
      publishTargets: Array.isArray(data.targets) && data.targets.length ? data.targets.filter((t) => ['youtube', 'twitch', 'kick'].includes(t)) : ['youtube'],

      status: 'aguardando',
      progress: 0,
      streamSeconds: 0,
      moments: [],
      clips: [],
      events: [],
      seq: 0,
      removedCount: 0,

      streamer: null,
      title: null,
      thumbUrl: null,
      thumbPath: null,
      isLive: false,
      error: null,
      errorCode: null,

      paused: false,
      cancelRequested: false,
      endRequested: false,
      running: false,
      queuePos: null,

      captureMode: null,
      mediaPath: null,

      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,

      originalName: data.originalName || null,
      uploadPath: data.uploadPath || null,
      demoStreamer: data.demoStreamer || null,
    };
    this.jobs.set(job.id, job);
    this.order.push(job.id);
    this.pump();
    this.broadcast();
    return job;
  }

  pump() {
    const queued = this.order
      .map((id) => this.jobs.get(id))
      .filter((j) => j && j.status === 'aguardando' && !j.running);
    let started = 0;
    while (this.running < config.capacity && started < queued.length) {
      const job = queued[started++];
      job.running = true;
      job.queuePos = null;
      this.running++;
      const pipeline = new Pipeline(job, this);
      this.pipelines.set(job.id, pipeline);
      pipeline.run();
    }
    let pos = 1;
    for (const j of queued.slice(started)) j.queuePos = pos++;
  }

  onJobFinished(job) {
    this.running = Math.max(0, this.running - 1);
    this.pipelines.delete(job.id);
    this.pump();
    this.broadcast();
  }

  log(job, msg) {
    job.seq += 1;
    job.events.push({ seq: job.seq, t: Date.now(), msg });
    if (job.events.length > 40) job.events = job.events.slice(-40);
    this.broadcast();
  }

  touch(job) {
    this.broadcast();
  }

  pause(id) {
    const j = this.jobs.get(id);
    if (!j) return null;
    j.paused = true;
    this.broadcast();
    return j;
  }

  resume(id) {
    const j = this.jobs.get(id);
    if (!j) return null;
    j.paused = false;
    this.broadcast();
    return j;
  }

  cancel(id) {
    const j = this.jobs.get(id);
    if (!j) return null;
    j.cancelRequested = true;
    if (j.status === 'aguardando') {
      j.status = 'cancelado';
      j.endedAt = Date.now();
      this.pump();
    }
    this.broadcast();
    return j;
  }

  end(id) {
    const j = this.jobs.get(id);
    if (!j) return null;
    j.endRequested = true;
    const p = this.pipelines.get(id);
    if (p) p.handleEnd();
    this.broadcast();
    return j;
  }

  publish(id, targets) {
    const j = this.jobs.get(id);
    if (!j) return null;
    const t = Array.isArray(targets) && targets.length ? targets : j.publishTargets;
    j.publishTargets = t;
    const clips = j.clips.filter((c) => c.status === 'pronto' || c.status === 'pronto-sem-video');
    if (!clips.length) return j;
    const { publishClip } = require('./publish');
    (async () => {
      for (const c of clips) {
        await publishClip(j, c, t);
        this.touch(j);
      }
      this.log(j, `Clipes publicados em ${t.join(', ')} (simulação).`);
    })();
    return j;
  }

  serializeJob(job) {
    const plat = PLATFORMS[job.platform] || PLATFORMS.local;
    let progress = job.progress || 0;
    if (job.status === 'aguardando') progress = 0;
    else if (job.status === 'validando') progress = 12;
    else if (job.status === 'capturando') {
      if (job.captureMode === 'demo' && job.demoDuration) {
        progress = Math.min(70, Math.round((job.streamSeconds / job.demoDuration) * 70));
      } else {
        progress = -1; // indeterminado (live real)
      }
    } else if (job.status === 'analisando') progress = 45;
    else if (job.status === 'identificando') progress = 58;
    else if (job.status === 'gerando') progress = Math.max(80, job.progress || 80);
    else if (job.status === 'finalizado') progress = 100;

    return {
      id: job.id,
      url: job.url,
      platform: job.platform,
      platformLabel: plat.label,
      platformColor: plat.color,
      demo: job.demo,
      demoDuration: job.demoDuration,
      maxClips: job.maxClips,
      autoPublish: job.autoPublish,
      publishTargets: job.publishTargets,

      status: job.status,
      statusLabel: STATUS_LABELS[job.status] || job.status,
      progress,
      streamSeconds: job.streamSeconds,
      streamLabel: formatDuration(job.streamSeconds),
      moments: job.moments.map((m) => ({
        id: m.id, start: m.start, end: m.end, score: m.score,
        label: m.label, reason: m.reason, clipId: m.clipId, selected: m.selected,
      })),
      clips: job.clips.map((c) => ({
        id: c.id, momentId: c.momentId, label: c.label, title: c.title,
        description: c.description, start: c.start, end: c.end,
        duration: c.duration, score: c.score, status: c.status,
        hasVideo: c.hasVideo, files: c.files, publish: c.publish,
      })),
      removedCount: job.removedCount,
      events: job.events.slice(-25),
      seq: job.seq,

      streamer: job.streamer,
      title: job.title,
      thumbPath: job.thumbPath,
      isLive: job.isLive,
      error: job.error,
      errorCode: job.errorCode,

      paused: job.paused,
      queuePos: job.queuePos,
      captureMode: job.captureMode,
      originalName: job.originalName,

      createdAt: job.createdAt,
      startedAt: job.startedAt,
      endedAt: job.endedAt,
    };
  }

  serializeAll() {
    return this.order.map((id) => this.jobs.get(id)).filter(Boolean).map((j) => this.serializeJob(j));
  }

  broadcast() {
    this.emit('update', {
      type: 'state',
      jobs: this.serializeAll(),
      capacity: config.capacity,
      running: this.running,
      ytdlp: !!config.ytdlpBin,
      serverTime: Date.now(),
    });
  }
}

module.exports = JobManager;
