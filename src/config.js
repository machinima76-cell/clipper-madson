const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');

function findYtDlp() {
  const candidates = [
    process.env.YTDLP_BIN,
    path.join(os.homedir(), '.local', 'bin', 'yt-dlp'),
    path.join(os.homedir(), '.local', 'bin', 'yt-dlp.exe'),
  ].filter(Boolean);
  for (const c of candidates) {
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch (e) { /* ignore */ }
  }
  try {
    const r = require('child_process').spawnSync('which', ['yt-dlp'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  } catch (e) { /* ignore */ }
  return null;
}

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',

  // Limite de analises simultaneas (capacidade do servidor)
  capacity: parseInt(process.env.CAPACITY || '3', 10),

  root: ROOT,
  dataDir: path.join(ROOT, 'data'),
  mediaDir: path.join(ROOT, 'media'),
  capturesDir: path.join(ROOT, 'media', 'captures'),
  clipsDir: path.join(ROOT, 'media', 'clips'),
  thumbsDir: path.join(ROOT, 'media', 'thumbs'),
  uploadsDir: path.join(ROOT, 'media', 'uploads'),

  ytdlpBin: findYtDlp(),
  ffmpegBin: process.env.FFMPEG_BIN || 'ffmpeg',
  ffprobeBin: process.env.FFPROBE_BIN || 'ffprobe',
  demoScript: path.join(ROOT, 'tools', 'make_demo_stream.py'),

  maxClipsDefault: 6,
  demoDurationDefault: 90,
  maxUploadBytes: 2 * 1024 * 1024 * 1024,
};

for (const d of [config.dataDir, config.mediaDir, config.capturesDir, config.clipsDir, config.thumbsDir, config.uploadsDir]) {
  fs.mkdirSync(d, { recursive: true });
}

module.exports = config;
