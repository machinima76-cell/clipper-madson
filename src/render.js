const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { sleep, pick } = require('./util');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, timeout: opts.timeout || 300000 }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(err.message);
        e.stderr = stderr;
        reject(e);
        return;
      }
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

const TITLE_TEMPLATES = {
  'Reação épica': [
    (s) => `A REAÇÃO MAIS INSANA DE ${s.toUpperCase()}`,
    (s) => `ELE SURTOU NO MEIO DA LIVE`,
  ],
  'Jogada insana': [
    () => 'ESSA JOGADA FOI INSANA DEMAIS',
    () => 'NINGUÉM ESPERAVA ESSA JOGADA',
  ],
  'Clutch': [
    (s) => `CLUTCH IMPOSSÍVEL DE ${s.toUpperCase()}`,
    () => 'O CLUTCH QUE QUEBROU O CHAT',
  ],
  'Fail hilário': [
    () => 'O FAIL MAIS ENGRAÇADO DA LIVE',
    () => 'ELE ERROU FEIO E O CHAT RIDORIZOU',
  ],
  'Quadrinho do chat': [
    () => 'O CHAT PEDIU E ELE FEZ',
    () => 'O MEME QUE O CHAT ESCOLHEU',
  ],
  'Estratégia genial': [
    () => 'ESTRATÉGIA QUE NINGUÉM ESPERAVA',
    () => 'O PLANO MAIS BIZARRO QUE DEU CERTO',
  ],
  'Momento emocionante': [
    () => 'MOMENTO QUE ARREPIOU A LIVE',
    () => `TODO MUNDO CHOROU COM ${'ESSA'} VIRADA`,
  ],
  'Reviravolta': [
    () => 'REVIRAVOLTA ÉPICA NO FINAL',
    () => 'DE MOTORISTA DE TÁXI A LENDA EM 10 SEGUNDOS',
  ],
};

function makeTitle(label, streamer) {
  const s = streamer || 'O STREAMER';
  const templates = TITLE_TEMPLATES[label] || [() => `${(label || 'MOMENTO').toUpperCase()} ÉPICO`];
  return pick(templates)(s);
}

function makeDescription(job, clip) {
  const { PLATFORMS } = require('./status');
  const plat = PLATFORMS[job.platform] ? PLATFORMS[job.platform].label : job.platform;
  const mm = formatMMSS(clip.start);
  return [
    `Melhor momento da live de ${job.streamer || 'desconhecido'} (${plat}) — ${clip.label} aos ${mm}.`,
    `Detectado e gerado automaticamente por Madson Cobra Clipper. Score IA: ${clip.score}/100.`,
    `Link original: ${job.url || '(arquivo local)'}`,
  ].join('\n');
}

function formatMMSS(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function srtTime(sec) {
  const s = Math.max(0, sec || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.floor((s - Math.floor(s)) * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(ss)},${String(ms).padStart(3, '0')}`;
}

const SUBS = {
  'Reação épica': ['[gritos e comemoração]', 'CHAT: ISSO É INSANO DEMAIS', '[gente gritando no chat]'],
  'Jogada insana': ['[partida em andamento]', 'ELE NÃO PODE FAZER ISSO... FEZ!', '[comemoração intensa]'],
  'Clutch': ['[jogo tenso, contagem regressiva]', 'SÓ ELE CONTRA O TIME TODO', '[explosão de emoção]'],
  'Fail hilário': ['[algo deu muito errado]', '[risadas sem controle]', 'O CHAT NÃO PARA DE RIR'],
  'Quadrinho do chat': ['[meme tocando]', '[reações do chat]', '[comemoração]'],
  'Estratégia genial': ['[silêncio tenso na live]', 'NINGUÉM ENTENDEU AINDA', '[clicinhos de aprovação]'],
  'Momento emocionante': ['[voz embargada]', '[música emocionante]', 'CHAT: EU CHOREI TAMBÉM'],
  'Reviravolta': ['[tudo perdido...]', 'ESPERA... ELE AINDA ESTÁ VIVO!', '[reviravolta completa]'],
};

function buildSrt(clip) {
  const lines = SUBS[clip.label] || ['[momento da live]', '[reação]', '[comemoração]'];
  const chunk = 3;
  let out = '';
  lines.forEach((text, i) => {
    const a = i * chunk;
    const b = Math.min((i + 1) * chunk, Math.max(chunk, Math.floor(clip.duration || 9)));
    out += `${i + 1}\n${srtTime(a)} --> ${srtTime(b)}\n${text}\n\n`;
  });
  return out;
}

function buildPackage(job, clip) {
  return [
    '====================================================',
    '  MADSON COBRA CLIPPER — PACOTE DE PUBLICAÇÃO',
    '====================================================',
    `TÍTULO:       ${clip.title}`,
    `DURAÇÃO:      ${clip.duration}s`,
    `SCORE IA:     ${clip.score}/100`,
    `MOMENTO EM:   ${formatMMSS(clip.start)} da live`,
    '',
    'DESCRIÇÃO:',
    clip.description,
    '',
    'HASHTAGS:',
    '#shorts #clip #' + (job.platform || 'live') + ' #gameplay #paracea',
    '',
    'ARQUIVOS:',
    '  • Vídeo:  ' + (clip.hasVideo ? clip.files.mp4 : '(indisponível nesta demonstração)'),
    '  • Legenda (.srt): ' + clip.files.srt,
    '  • Miniatura: ' + clip.files.thumb,
    '',
    'Gerado em ' + new Date().toISOString() + ' por Madson Cobra Clipper',
  ].join('\n');
}

function relToMedia(absPath) {
  return '/media/' + path.relative(config.mediaDir, absPath).split(path.sep).join('/');
}

async function cutClip(src, start, end, outPath) {
  const dur = Math.max(1, end - start);
  await run(config.ffmpegBin, [
    '-y',
    '-ss', start.toFixed(2),
    '-i', src,
    '-t', dur.toFixed(2),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    outPath,
  ], { timeout: 300000 });
}

async function makeThumb(src, at, outPath) {
  await run(config.ffmpegBin, [
    '-y',
    '-ss', Math.max(0, at).toFixed(2),
    '-i', src,
    '-frames:v', '1',
    '-vf', 'scale=480:-2',
    '-q:v', '4',
    outPath,
  ], { timeout: 120000 });
}

async function makePlaceholderThumb(outPath, label) {
  await run(config.ffmpegBin, [
    '-y',
    '-f', 'lavfi',
    '-i', 'color=c=0x0d1117:s=480x270:d=1',
    '-vf', `drawtext=text='${(label || 'CLIP').slice(0, 22).replace(/'/g, '')}':fontcolor=0x4ade80:fontsize=28:x=(w-text_w)/2:y=(h-text_h)/2:borderw=0`,
    '-frames:v', '1',
    outPath,
  ], { timeout: 60000 }).catch(() => {
    // drawtext pode falhar sem fontes; tenta sem texto
    return run(config.ffmpegBin, ['-y', '-f', 'lavfi', '-i', 'color=c=0x1c232d:s=480x270:d=1', '-frames:v', '1', outPath], { timeout: 60000 });
  });
}

/**
 * Renderiza um clipe: corta o vídeo, gera miniatura, legenda e pacote de publicação.
 */
async function renderClip(job, clip, srcPath) {
  const dir = path.join(config.clipsDir, job.id);
  fs.mkdirSync(dir, { recursive: true });
  const mp4 = path.join(dir, `${clip.id}.mp4`);
  const thumb = path.join(dir, `${clip.id}.jpg`);
  const srt = path.join(dir, `${clip.id}.srt`);
  const pkg = path.join(dir, `${clip.id}.txt`);

  clip.status = 'renderizando';
  clip.hasVideo = false;

  if (srcPath && fs.existsSync(srcPath)) {
    try {
      await cutClip(srcPath, clip.start, clip.end, mp4);
      clip.hasVideo = fs.existsSync(mp4);
      await makeThumb(mp4, Math.min(2, Math.max(0, (clip.end - clip.start) / 2)), thumb);
    } catch (e) {
      // Se o corte falhar, tenta miniatura do source; vídeo marcado como indisponível
      try { await makeThumb(srcPath, clip.start + 1, thumb); } catch (e2) { /* ignore */ }
      clip.videoError = 'Não foi possível renderizar o vídeo nesta transmissão.';
    }
  }
  if (!fs.existsSync(thumb)) {
    try { await makePlaceholderThumb(thumb, clip.label); } catch (e) { /* ignore */ }
  }

  fs.writeFileSync(srt, buildSrt(clip), 'utf8');

  clip.files = {
    mp4: fs.existsSync(mp4) ? relToMedia(mp4) : null,
    thumb: fs.existsSync(thumb) ? relToMedia(thumb) : null,
    srt: relToMedia(srt),
    pkg: relToMedia(pkg),
  };

  // pacote precisa dos files definidos
  fs.writeFileSync(pkg, buildPackage(job, clip), 'utf8');

  clip.status = clip.hasVideo ? 'pronto' : 'pronto-sem-video';
  await sleep(50);
  return clip;
}

module.exports = { renderClip, makeTitle, makeDescription, formatMMSS };
