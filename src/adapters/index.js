const youtube = require('./youtube');
const twitch = require('./twitch');
const kick = require('./kick');

const ADAPTERS = { youtube, twitch, kick };

function detectPlatform(url) {
  if (youtube.matches(url)) return 'youtube';
  if (twitch.matches(url)) return 'twitch';
  if (kick.matches(url)) return 'kick';
  return null;
}

function getAdapter(platform) {
  return ADAPTERS[platform] || null;
}

module.exports = { detectPlatform, getAdapter, ADAPTERS };
