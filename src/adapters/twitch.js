const { runYtdlpJson, ProbeError, pickThumb } = require('./probe');

const RESERVED = new Set([
  'videos', 'directory', 'settings', 'clip', 'clips', 'p', 'popout', 'downloads',
  'inventory', 'payments', 'subscriptions', 'turbo', 'prime', 'moderation',
  'following', 'broadcast', 'about', 'jobs', 'store', 'wallet', 'login', 'signup', 'search',
]);

// twitch.tv/NOME  (exatamente um segmento de caminho)
const RE = /^(?:https?:\/\/)?(?:www\.)?twitch\.tv\/([A-Za-z0-9_][A-Za-z0-9_]{2,24})\/?$/i;

function matches(url) {
  const m = (url || '').match(RE);
  if (!m) return false;
  return !RESERVED.has(m[1].toLowerCase());
}

function extractName(url) {
  const m = (url || '').match(RE);
  return m ? m[1] : null;
}

function normalize(url) {
  const name = extractName(url);
  return name ? `https://www.twitch.tv/${name}` : url;
}

async function resolveStream(url) {
  let data;
  try {
    data = await runYtdlpJson(normalize(url));
  } catch (e) {
    if (e instanceof ProbeError) throw e;
    throw new ProbeError(e.message || 'Falha ao consultar a Twitch.', 'probe-falhou');
  }
  return {
    platform: 'twitch',
    streamer: data.channel || data.uploader || data.creator_name || extractName(url) || null,
    title: data.title || null,
    thumbnail: pickThumb(data),
    isLive: data.is_live === true || data.live_status === 'is_live' || (data.formats && data.formats.length > 0 && data.is_live !== false),
    isUpcoming: false,
    formats: Array.isArray(data.formats) ? data.formats.length : 0,
    webpage: data.webpage_url || normalize(url),
  };
}

function captureArgs(url, outPath) {
  return [
    '-f', 'best[height<=720]/best',
    '--no-playlist',
    '--socket-timeout', '15',
    '-o', outPath,
    normalize(url),
  ];
}

module.exports = { matches, extractName, normalize, resolveStream, captureArgs };
