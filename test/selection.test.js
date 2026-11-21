const test = require('node:test');
const assert = require('node:assert/strict');
const Pipeline = require('../src/pipeline');

test('reconcilia clipes antecipados com o ranking final; aceita sobreposição de 50%', async () => {
  const moments = [
    { id: 'a', start: 0, end: 30, score: 80, clipId: 'ca' },
    { id: 'b', start: 5, end: 35, score: 95, clipId: 'cb' },
    { id: 'c', start: 20, end: 50, score: 75, clipId: 'cc' },
  ];
  const job = { moments, clips: moments.map(m => ({ id: m.clipId, momentId: m.id })), maxClips: 3 };
  const p = new Pipeline(job, { log() {}, touch() {} });
  p.wait = async () => {};
  await p.finalize(job, { alreadyAnalyzed: true });
  assert.deepEqual(job.clips.map(c => c.id), ['cb', 'cc']);
  assert.equal(moments[0].clipId, null);
  assert.equal(job.removedCount, 1);
});
