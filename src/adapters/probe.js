const { execFile } = require('child_process');
const config = require('../config');

class ProbeError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ProbeError';
    this.code = code || 'probe-falhou';
  }
}

function runYtdlpJson(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (!config.ytdlpBin) {
      reject(new ProbeError('A ferramenta de captura (yt-dlp) não está disponível neste servidor.', 'sem-ferramenta'));
      return;
    }
    execFile(
      config.ytdlpBin,
      [url, '-J', '--no-warnings', '--no-playlist', '--socket-timeout', '15'],
      { maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (err) {
          const raw = `${stderr || ''}\n${err.message || ''}`;
          reject(new ProbeError(mapYtdlpError(raw), classifyYtdlpError(raw)));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(new ProbeError('Não foi possível interpretar a resposta da plataforma.', 'resposta-invalida'));
        }
      }
    );
  });
}

function classifyYtdlpError(raw) {
  const s = (raw || '').toLowerCase();
  if (s.includes('not currently live') || s.includes('not live')) return 'not-live';
  if (s.includes('live stream recording is not available')) return 'not-live';
  if (s.includes('sign in to confirm') || s.includes('login required') || s.includes('authenticat')) return 'auth';
  if (s.includes('private video') || s.includes('private')) return 'private';
  if (s.includes('members-only') || s.includes('members only')) return 'members';
  if (s.includes('not available in your country') || s.includes('geo') || s.includes('blocked it in your country')) return 'geo';
  if (s.includes('unsupported url')) return 'unsupported';
  if (s.includes('video unavailable') || s.includes(' unavailable')) return 'unavailable';
  if (s.includes('error 403') || s.includes('403 forbidden')) return 'forbidden';
  if (s.includes('error 429') || s.includes('too many requests')) return 'rate-limit';
  return 'probe-falhou';
}

function mapYtdlpError(raw) {
  const s = (raw || '').toLowerCase();
  if (s.includes('not currently live')) return 'Este canal NÃO está ao vivo no momento. Aguarde a transmissão começar.';
  if (s.includes('live stream recording is not available')) return 'Esta live não está ao vivo (ou a gravação não está disponível). Cole o link enquanto a transmissão estiver rolando.';
  if (s.includes('sign in to confirm your age')) return 'A plataforma exige login para confirmar sua idade.';
  if (s.includes('sign in to confirm') || s.includes("you're not a bot")) return 'A plataforma exige autenticação/login para acessar este conteúdo.';
  if (s.includes('private video')) return 'Este conteúdo é PRIVADO. Sem acesso autorizado.';
  if (s.includes('members-only') || s.includes('members only')) return 'Este conteúdo é exclusivo para MEMBROS do canal.';
  if (s.includes('not available in your country') || s.includes('blocked it in your country')) return 'Conteúdo bloqueado por RESTRIÇÃO GEOGRÁFICA.';
  if (s.includes('unsupported url')) return 'Este link não é suportado.';
  if (s.includes('video unavailable') || s.includes('unavailable')) return 'Transmissão indisponível (pode ter terminado ou sido removida).';
  if (s.includes('403')) return 'Acesso negado pela plataforma (403). O conteúdo pode exigir conta ou permissão.';
  if (s.includes('429')) return 'Muitas requisições. Tente novamente em instantes.';
  const first = (raw || '').split('\n').filter(Boolean).slice(-1)[0] || 'Erro desconhecido.';
  return `Não foi possível acessar a transmissão: ${first.slice(0, 220)}`;
}

function pickThumb(data) {
  if (!data) return null;
  if (Array.isArray(data.thumbnails) && data.thumbnails.length) {
    const sorted = [...data.thumbnails].filter((t) => t.url).sort((a, b) => (a.width || 0) - (b.width || 0));
    const mid = sorted.find((t) => (t.width || 0) >= 640) || sorted[sorted.length - 1];
    return mid.url;
  }
  return data.thumbnail || null;
}

module.exports = { runYtdlpJson, ProbeError, pickThumb, mapYtdlpError };
