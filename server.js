const path = require('path');
const http = require('http');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const { WebSocketServer } = require('ws');

const config = require('./src/config');
const JobManager = require('./src/jobs');
const { detectPlatform } = require('./src/adapters');

const mgr = new JobManager();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(config.mediaDir, { fallthrough: true, maxAge: '1h' }));

// ------------------------------------------------------------------
// Upload de gravação local
// ------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadsDir),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.mp4').toLowerCase();
    cb(null, `up_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes },
  fileFilter: (req, file, cb) => {
    const ok = /^video\//.test(file.mimetype) || /\.(mp4|mkv|mov|ts|avi|webm|m4v)$/i.test(file.originalname);
    if (ok) cb(null, true);
    else cb(new Error('Formato não suportado. Envie um vídeo (MP4, MKV, MOV, TS, AVI ou WEBM).'));
  },
});

// ------------------------------------------------------------------
// API
// ------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ytdlp: !!config.ytdlpBin, capacity: config.capacity, running: mgr.running });
});

function safeName(s) {
  return String(s || 'clipe')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9\-_ ]+/g, '')
    .trim().replace(/\s+/g, '-')
    .slice(0, 60) || 'clipe';
}

// Download de todos os clipes da análise em um ZIP
app.get('/api/jobs/:id/download', (req, res) => {
  const j = mgr.jobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: 'Análise não encontrada.' });
  const clips = (j.clips || []).filter((c) => c.files);
  if (!clips.length) return res.status(400).json({ error: 'Ainda não há clipes para baixar.' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="madson-cobra-${j.id}.zip"`);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (e) => console.error('[zip]', e.message));
  archive.pipe(res);

  const used = new Set();
  const unique = (name) => {
    let n = name, i = 2;
    while (used.has(n)) n = name.replace(/(\.[^.]+)$/, `-${i++}$1`);
    used.add(n);
    return n;
  };

  for (const c of clips) {
    const base = `${safeName(c.title)}-${c.id.slice(0, 6)}`;
    const f = c.files;
    if (f.mp4) archive.file(path.join(config.mediaDir, f.mp4.replace(/^\/media\//, '')), { name: unique(`${base}.mp4`) });
    if (f.srt) archive.file(path.join(config.mediaDir, f.srt.replace(/^\/media\//, '')), { name: unique(`${base}.srt`) });
    if (f.pkg) archive.file(path.join(config.mediaDir, f.pkg.replace(/^\/media\//, '')), { name: unique(`${base}-pacote.txt`) });
    if (f.thumb) archive.file(path.join(config.mediaDir, f.thumb.replace(/^\/media\//, '')), { name: unique(`${base}-thumb.jpg`) });
  }
  archive.finalize();
});

app.get('/api/state', (req, res) => {
  res.json({ jobs: mgr.serializeAll(), capacity: config.capacity, running: mgr.running, ytdlp: !!config.ytdlpBin });
});

function readSettings(body) {
  let targets = body.targets;
  if (typeof targets === 'string') {
    try { targets = JSON.parse(targets); } catch (e) { targets = undefined; }
  }
  const autoPublish = typeof body.autoPublish === 'string'
    ? body.autoPublish === 'true'
    : !!body.autoPublish;
  return {
    maxClips: body.maxClips,
    autoPublish,
    targets: Array.isArray(targets) ? targets : undefined,
    demoDuration: body.demoDuration,
  };
}

function deriveName(url) {
  if (!url) return null;
  const m = String(url).match(/(?:twitch\.tv|kick\.com)\/([A-Za-z0-9_]+)/i);
  return m ? m[1] : null;
}

// Criar análise a partir de link (ou demonstração)
app.post('/api/jobs', (req, res) => {
  const { url, demo } = req.body || {};
  const settings = readSettings(req.body || {});
  if (demo) {
    const platform = detectPlatform(url) || 'twitch';
    const job = mgr.create({
      url: url || 'https://www.twitch.tv/madsoncobra',
      platform,
      demo: true,
      demoStreamer: deriveName(url) || 'Madson Cobra',
      ...settings,
    });
    return res.status(201).json({ job: mgr.serializeJob(job) });
  }
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Cole o link da live para iniciar.' });
  }
  const platform = detectPlatform(url);
  if (!platform) {
    return res.status(400).json({
      error: 'Link não reconhecido. Aceitamos YouTube Live, Twitch e Kick. Exemplos: https://www.youtube.com/watch?v=ID · https://www.twitch.tv/NOME · https://kick.com/NOME',
    });
  }
  const job = mgr.create({ url, platform, ...settings });
  res.status(201).json({ job: mgr.serializeJob(job) });
});

// Criar análise a partir de gravação local
app.post('/api/jobs/local', (req, res) => {
  upload.single('video')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'Arquivo muito grande (máximo 2 GB).'
        : (err.message || 'Falha no upload.');
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const settings = readSettings(req.body || {});
    const job = mgr.create({
      platform: 'local',
      uploadPath: req.file.path,
      originalName: req.file.originalname,
      ...settings,
    });
    res.status(201).json({ job: mgr.serializeJob(job) });
  });
});

function ctrl(action) {
  return (req, res) => {
    const j = mgr[action](req.params.id);
    if (!j) return res.status(404).json({ error: 'Análise não encontrada.' });
    res.json({ job: mgr.serializeJob(j) });
  };
}
app.post('/api/jobs/:id/pause', ctrl('pause'));
app.post('/api/jobs/:id/resume', ctrl('resume'));
app.post('/api/jobs/:id/cancel', ctrl('cancel'));
app.post('/api/jobs/:id/end', ctrl('end'));

app.post('/api/jobs/:id/publish', (req, res) => {
  const j = mgr.publish(req.params.id, (req.body || {}).targets);
  if (!j) return res.status(404).json({ error: 'Análise não encontrada.' });
  res.json({ job: mgr.serializeJob(j) });
});

app.post('/api/jobs/:id/clips/:cid/publish', (req, res) => {
  const j = mgr.jobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: 'Análise não encontrada.' });
  const clip = j.clips.find((c) => c.id === req.params.cid);
  if (!clip) return res.status(404).json({ error: 'Clipe não encontrado.' });
  const targets = (req.body || {}).targets || j.publishTargets || ['youtube'];
  const { publishClip } = require('./src/publish');
  publishClip(j, clip, targets).then(() => mgr.touch(j));
  res.json({ ok: true });
});

// ------------------------------------------------------------------
// WebSocket — estado em tempo real
// ------------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    type: 'state',
    jobs: mgr.serializeAll(),
    capacity: config.capacity,
    running: mgr.running,
    ytdlp: !!config.ytdlpBin,
    serverTime: Date.now(),
  }));
});

mgr.on('update', (state) => {
  const payload = JSON.stringify(state);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
});

server.listen(config.port, config.host, () => {
  console.log(`[Madson Cobra Clipper] rodando em http://${config.host}:${config.port}`);
  console.log(`[Madson Cobra Clipper] yt-dlp: ${config.ytdlpBin || 'NÃO ENCONTRADO'} | capacidade: ${config.capacity}`);
});
