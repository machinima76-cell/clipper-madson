const { execFile } = require('child_process');
const fs = require('fs');
const config = require('./config');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout || 600000 }, (err, stdout, stderr) => {
      if (err && !stderr) {
        reject(new Error(`${cmd} falhou: ${err.message}`));
        return;
      }
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function probeDuration(filePath) {
  const { stdout } = await run(config.ffprobeBin, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ], { timeout: 60000 });
  const d = parseFloat(stdout.trim());
  return Number.isFinite(d) ? d : 0;
}

/**
 * Detecta cortes de cena via ffmpeg (filtro select scene + metadata print).
 * Retorna [{ t, score }].
 */
async function detectScenes(filePath) {
  const { stdout } = await run(config.ffmpegBin, [
    '-i', filePath,
    '-vf', "select='gt(scene,0.28)',metadata=print:file=-",
    '-an',
    '-f', 'null',
    '-',
  ]);
  const out = [];
  let curT = null;
  for (const line of stdout.split('\n')) {
    const mt = line.match(/pts_time:([0-9.]+)/);
    if (mt) { curT = parseFloat(mt[1]); continue; }
    const ms = line.match(/lavfi\.scene_score=([0-9.]+)/);
    if (ms && curT != null) {
      out.push({ t: curT, score: parseFloat(ms[1]) });
      curT = null;
    }
  }
  return out;
}

/**
 * Detecta regiões de áudio "alto" (não-silências) via silencedetect.
 * Retorna [{ start, end }].
 */
async function detectLoudRegions(filePath) {
  const { stderr } = await run(config.ffmpegBin, [
    '-i', filePath,
    '-af', 'silencedetect=noise=-30dB:d=1.0',
    '-vn',
    '-f', 'null',
    '-',
  ]);
  const silences = [];
  let curStart = null;
  for (const line of stderr.split('\n')) {
    const ms = line.match(/silence_start:\s*([0-9.]+)/);
    if (ms) { curStart = parseFloat(ms[1]); continue; }
    const me = line.match(/silence_end:\s*([0-9.]+)/);
    if (me && curStart != null) {
      silences.push({ start: curStart, end: parseFloat(me[1]) });
      curStart = null;
    }
  }
  return silences;
}

function complementRegions(silences, duration) {
  const regions = [];
  let cursor = 0;
  for (const s of silences.sort((a, b) => a.start - b.start)) {
    if (s.start - cursor >= 1.0) regions.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (duration - cursor >= 1.0) regions.push({ start: cursor, end: duration });
  return regions;
}

function inRegions(t, regions, pad = 0) {
  return regions.some((r) => t >= r.start - pad && t <= r.end + pad);
}

/**
 * Detecta janelas de áudio mais energéticas (possíveis reações/hype)
 * usando astats em janelas de 2s.
 * Retorna [{ t, rms }].
 */
async function detectAudioPeaks(filePath) {
  const { stdout } = await run(config.ffmpegBin, [
    '-i', filePath,
    '-af', 'asetnsamples=n=88200,astats=metadata=1:reset=1,ametadata=print:file=-',
    '-vn',
    '-f', 'null',
    '-',
  ]);
  const wins = [];
  let curT = null;
  for (const line of stdout.split('\n')) {
    const mt = line.match(/pts_time:([0-9.]+)/);
    if (mt) { curT = parseFloat(mt[1]); continue; }
    const mr = line.match(/lavfi\.astats\.Overall\.RMS_level=(-?[0-9.]+)/);
    if (mr && curT != null) {
      wins.push({ t: curT, rms: parseFloat(mr[1]) });
      curT = null;
    }
  }
  return wins;
}

/**
 * Analisa um arquivo de mídia e retorna momentos candidatos com pontuação.
 * Combinacão de cortes de cena + picos de áudio (reações).
 */
async function analyzeMedia(filePath) {
  if (!fs.existsSync(filePath)) throw new Error('Arquivo de mídia não encontrado para análise.');
  const duration = await probeDuration(filePath);
  if (!duration) throw new Error('Não foi possível ler a duração da mídia.');

  const [scenes, silences, peaks] = await Promise.all([
    detectScenes(filePath),
    detectLoudRegions(filePath),
    detectAudioPeaks(filePath),
  ]);
  const loud = complementRegions(silences, duration);

  const candidates = [];
  for (const sc of scenes) {
    const t = sc.t;
    if (t < 3 || t > duration - 4) continue;
    const loudHit = inRegions(t, loud, 1.5);
    const score = Math.round(Math.min(99, 58 + Math.min(34, ((sc.score - 0.28) / 0.6) * 34) + (loudHit ? 7 : 0)));
    const start = Math.max(0, t - 2.5);
    const end = Math.min(duration, t + 9.5);
    if (end - start < 5) continue;
    candidates.push({
      start: round1(start),
      end: round1(end),
      score,
      reason: loudHit ? 'Corte de cena + pico de áudio (reação)' : 'Corte de cena',
      source: 'cena',
    });
  }

  // Picos de áudio sem corte de cena próximo também viram candidatos
  for (const r of loud) {
    const t = r.start + 0.5;
    if (t < 3 || t > duration - 4) continue;
    const nearScene = scenes.some((s) => Math.abs(s.t - t) < 3.5);
    if (nearScene) continue;
    const len = Math.min(9, r.end - r.start);
    if (len < 2) continue;
    candidates.push({
      start: round1(Math.max(0, t - 1)),
      end: round1(Math.min(duration, t + Math.max(6, len))),
      score: 62,
      reason: 'Pico de áudio (reação do streamer/chat)',
      source: 'audio',
    });
  }

  // Picos de energia de áudio (reações/hype) — cobre streams de áudio contínuo
  const validPeaks = peaks.filter((w) => w.rms > -60 && w.t >= 3 && w.t <= duration - 4);
  if (validPeaks.length >= 3) {
    const vals = validPeaks.map((w) => w.rms);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length) || 1;
    for (const w of validPeaks) {
      if (w.rms < mean + 0.45 * std) continue;
      if (w.rms < -28) continue;
      const nearScene = scenes.some((s) => Math.abs(s.t - w.t) < 4);
      if (nearScene) continue; // já coberto por um candidato de cena
      candidates.push({
        start: round1(Math.max(0, w.t - 1)),
        end: round1(Math.min(duration, w.t + 8)),
        score: Math.round(Math.min(96, Math.max(62, 64 + (w.rms - mean) * 2))),
        reason: 'Pico de energia de áudio (reação/hype)',
        source: 'pico',
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return { duration, candidates, loudRegions: loud };
}

function round1(v) { return Math.round(v * 10) / 10; }

module.exports = { analyzeMedia, probeDuration };
