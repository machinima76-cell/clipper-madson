const STATUSES = [
  'aguardando',
  'validando',
  'capturando',
  'analisando',
  'identificando',
  'gerando',
  'finalizado',
  'erro',
  'cancelado',
];

const STATUS_LABELS = {
  aguardando: 'Aguardando transmissão',
  validando: 'Validando link',
  capturando: 'Capturando transmissão',
  analisando: 'Analisando conteúdo',
  identificando: 'Identificando melhores momentos',
  gerando: 'Gerando clipes',
  finalizado: 'Finalizado',
  erro: 'Erro de captura',
  cancelado: 'Cancelado',
};

// Ordem do passo a passo exibido no painel
const STEPPER = [
  'aguardando',
  'validando',
  'capturando',
  'analisando',
  'identificando',
  'gerando',
  'finalizado',
];

const PLATFORMS = {
  youtube: { id: 'youtube', label: 'YouTube', color: '#ff0033', text: '#ffffff' },
  twitch: { id: 'twitch', label: 'Twitch', color: '#a970ff', text: '#ffffff' },
  kick: { id: 'kick', label: 'Kick', color: '#53fc18', text: '#06110a' },
  local: { id: 'local', label: 'Arquivo local', color: '#94a3b8', text: '#0b0f14' },
};

module.exports = { STATUSES, STATUS_LABELS, STEPPER, PLATFORMS };
