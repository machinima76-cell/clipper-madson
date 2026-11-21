const config = require('./config');

// Inclui contexto antes do destaque; nas bordas, desloca o corte sem encurtá-lo.
function clipWindow(highlight, mediaDuration, seconds = config.clipSeconds) {
  const length = Math.min(seconds, mediaDuration);
  const start = Math.max(0, Math.min(highlight - Math.min(config.clipBefore, length / 2), mediaDuration - length));
  return { start, end: start + length };
}

module.exports = clipWindow;
