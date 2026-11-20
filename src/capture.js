const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { getAdapter } = require('./adapters');
const { sleep } = require('./util');

function execFileAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout || 120000 }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(err.message);
        e.stderr = stderr;
        reject(e);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Inicia captura real de uma transmissão ao vivo via yt-dlp.
 * Retorna handle com pause/resume/cancel e callback de fim de stream.
 */
function startYtdlpCapture(job, url) {
  return new Promise((resolve, reject) => {
    const adapter = getAdapter(job.platform);
    if (!adapter) {
      reject(new Error('Plataforma sem adaptador de captura.'));
      return;
    }
    if (!config.ytdlpBin) {
      reject(new Error('A ferramenta de captura (yt-dlp) não está disponível neste servidor.'));
      return;
    }
    const outPath = path.join(config.capturesDir, `${job.id}.mp4`);
    const args = adapter.captureArgs(url, outPath);
    let stderrTail = '';
    let started = false;
    let onEndCb = null;

    const proc = spawn(config.ytdlpBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const finish = (code) => {
      if (onEndCb) onEndCb(code);
    };

    proc.stderr.on('data', (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-6000);
      if (!started && /Writing.*?to|Destination:|\[download\]/i.test(stderrTail)) {
        // yt-dlp começou a baixar
      }
    });

    proc.on('error', (err) => {
      if (!started) reject(new Error(`Falha ao iniciar a captura: ${err.message}`));
      else finish(-1);
    });

    proc.on('exit', (code, signal) => {
      if (!started) {
        const msg = stderrTail.split('\n').filter(Boolean).slice(-3).join(' ');
        reject(new Error(mapCaptureError(msg || `Processo encerrado (code ${code})`)));
      } else {
        finish(code);
      }
    });

    // Se o processo permanecer vivo por 1.5s, consideramos captura iniciada
    setTimeout(() => {
      if (proc.exitCode === null && !started) {
        started = true;
        resolve({
          proc,
          outPath,
          pause() { try { proc.kill('SIGSTOP'); } catch (e) { /* noop */ } },
          resume() { try { proc.kill('SIGCONT'); } catch (e) { /* noop */ } },
          cancel() {
            try { proc.kill('SIGINT'); } catch (e) { /* noop */ }
            setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) { /* noop */ } }, 4000);
          },
          onEnd(cb) { onEndCb = cb; },
        });
      }
    }, 1500);
  });
}

function mapCaptureError(raw) {
  const s = (raw || '').toLowerCase();
  if (s.includes('not currently live')) return 'O canal não está ao vivo.';
  if (s.includes('403') || s.includes('forbidden')) return 'Acesso negado pela plataforma durante a captura (403).';
  if (s.includes('429')) return 'Limite de requisições atingido. Tente em instantes.';
  if (s.includes('error 400') || s.includes('bad request')) return 'A plataforma recusou a captura (HTTP 400).';
  return `Captura encerrada inesperadamente: ${(raw || '').slice(0, 220)}`;
}

/**
 * Gera a mídia da transmissão simulada (modo demonstração) e retorna
 * o caminho do arquivo + plano de momentos plantados.
 * `shouldAbort` permite interromper o processo durante o preparo.
 */
async function generateDemoMedia(job, shouldAbort) {
  const outPath = path.join(config.capturesDir, `${job.id}.mp4`);
  const sidecar = path.join(config.dataDir, `${job.id}.demo.json`);
  const args = [
    config.demoScript,
    '--out', outPath,
    '--duration', String(job.demoDuration || config.demoDurationDefault),
    '--sidecar', sidecar,
    '--seed', String((Date.now() % 100000) + job.id.length),
  ];

  await new Promise((resolve, reject) => {
    const proc = spawn('python3', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let done = false;
    const finish = (fn, arg) => { if (!done) { done = true; clearInterval(timer); fn(arg); } };
    const timer = setInterval(() => {
      if (shouldAbort && shouldAbort()) {
        try { proc.kill('SIGKILL'); } catch (e) { /* noop */ }
        const e = new Error('Geração da transmissão de demonstração abortada.');
        e.code = 'abortado';
        finish(reject, e);
      }
    }, 250);
    proc.on('error', (err) => finish(reject, new Error(`Falha ao gerar transmissão demo: ${err.message}`)));
    proc.on('exit', (code) => {
      if (code === 0) finish(resolve);
      else finish(reject, new Error(`Falha ao gerar a transmissão de demonstração (código ${code}).`));
    });
  });

  if (!fs.existsSync(outPath)) throw new Error('Falha ao gerar a transmissão de demonstração.');
  let plan = { highlights: [], segments: [], duration: job.demoDuration };
  try {
    if (fs.existsSync(sidecar)) plan = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  } catch (e) { /* usa padrão */ }
  return {
    outPath,
    plan,
    pause() { /* demo: o controle é feito no loop */ },
    resume() { /* demo */ },
    cancel() { /* demo */ },
    onEnd() { /* demo */ },
  };
}

module.exports = { startYtdlpCapture, generateDemoMedia };
