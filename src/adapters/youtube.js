const { runYtdlpJson, ProbeError, pickThumb } = require('./probe');

// youtube.com/watch?v=ID | youtu.be/ID | youtube.com/live/ID | youtube.com/shorts/ID | youtube.com/embed/ID
const RE = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^#]*v=|live\/|shorts\/|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i;

function matches(url) {
  return RE.test(url || '');
}

function extractId(url) {
  const m = (url || '').match(RE);
  return m ? m[1] : null;
}

function normalize(url) {
  const id = extractId(url);
  return id ? `https://www.youtube.com/watch?v=${id}` : url;
}

async function resolveStream(url) {
  let data;
  try {
    data = await runYtdlpJson(normalize(url));
  } catch (e) {
    if (e instanceof ProbeError) throw e;
    throw new ProbeError(e.message || 'Falha ao consultar o YouTube.', 'probe-falhou');
  }
  return {
    platform: 'youtube',
    streamer: data.uploader || data.channel || data.channel_owner || null,
    title: data.title || null,
    thumbnail: pickThumb(data),
    isLive: data.live_status === 'is_live' || data.is_live === true,
    isUpcoming: data.live_status === 'is_upcoming' || data.release_timestamp != null,
    formats: Array.isArray(data.formats) ? data.formats.length : 0,
    webpage: data.webpage_url || normalize(url),
  };
}

function captureArgs(url, outPath) {
  return [
    '-f', 'best[height<=720]/best',
    '--live-from-start',
    '--no-playlist',
    '--socket-timeout', '15',
    '-o', outPath,
    normalize(url),
  ];
}

module.exports = { matches, extractId, normalize, resolveStream, captureArgs };
