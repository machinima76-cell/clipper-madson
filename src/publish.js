const { sleep } = require('./util');

/**
 * Publicação preparada para as plataformas suportadas.
 * Nesta versão a publicação é SIMULADA (a plataforma de origem pode restringir
 * envio automatizado); os arquivos ficam prontos para upload manual.
 */
async function publishClip(job, clip, targets) {
  const t = (targets && targets.length ? targets : ['youtube']).filter((x) => ['youtube', 'twitch', 'kick'].includes(x));
  clip.publish = { status: 'publicando', targets: t, at: null };
  await sleep(900);
  clip.publish = {
    status: 'publicado',
    targets: t,
    at: Date.now(),
    simulated: true,
    url: t.map((p) => `https://${p}.com/clip/${job.id}-${clip.id}`),
  };
  return clip;
}

module.exports = { publishClip };
