const crypto = require('crypto');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const uid = (prefix = '') => prefix + crypto.randomBytes(4).toString('hex');

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return clamp(n, min, max);
}

module.exports = { sleep, uid, formatDuration, clamp, clampInt, pick };
