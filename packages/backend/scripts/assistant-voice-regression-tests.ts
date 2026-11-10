import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  assistantSpeech,
  assistantTranscription,
  assistantVoices,
  parseMistralVoices,
  pickMistralVoices,
} from '../src/services/assistant/voice.js';
import {
  playbackSegments,
  recognitionLocale,
  splitSpeech,
} from '../../frontend/src/components/assistant/voiceSegments.js';
const calls: Array<{ url: string; body: string; user: string }> = [];
const server = createServer(async (req, res) => {
  const buffers = [];
  for await (const chunk of req) buffers.push(chunk);
  const body = Buffer.concat(buffers).toString();
  calls.push({ url: req.url!, body, user: String(req.headers['remote-user']) });
  if (req.url === '/api/voices') {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify([
        { engine: 'omnivoice', id: 'rufus' },
        { engine: 'kokoro', id: 'other' },
      ])
    );
  } else if (req.url === '/api/generate') {
    res.setHeader('Content-Type', 'audio/wav');
    res.end(Buffer.from('RIFF-test-wave'));
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        text: 'Äpfel essen',
        words: [
          { word: 'Äpfel', start: 0.1, end: 0.7 },
          { word: 'essen', start: 0.8, end: 1.1 },
        ],
      })
    );
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
process.env.PLUM_VOCARIUM_URL = `http://127.0.0.1:${address.port}`;
try {
  const voices = await assistantVoices('alice');
  assert.equal(voices.length, 1);
  assert.equal((voices[0] as { engine: string }).engine, 'omnivoice');
  assert.equal(
    (
      await assistantSpeech('alice', { text: 'Hallo', voice: 'Rufus Beck', language: 'German' })
    ).toString(),
    'RIFF-test-wave'
  );
  const generation = JSON.parse(calls[1]!.body);
  assert.equal(generation.engine, 'omnivoice');
  assert.equal(generation.voice_id, 'Rufus Beck');
  const transcript = await assistantTranscription(
    'bob',
    { buffer: Buffer.from('fixture'), originalname: 'aufnahme.webm', mimetype: 'audio/webm' },
    'de'
  );
  assert.equal(transcript.text, 'Äpfel essen');
  assert.equal(transcript.words?.length, 2);
  assert.ok(calls[2]!.body.includes('name="response_format"\r\n\r\nverbose_json'));
  assert.ok(calls[2]!.body.includes('name="timestamp_granularities[]"\r\n\r\nword'));
  assert.notEqual(calls[0]!.user, calls[2]!.user);
  assert.ok(!calls[0]!.user.includes('alice'));
  for (const input of [
    'Hallo '.repeat(2400),
    'x'.repeat(4499) + '😀' + 'z'.repeat(5000),
    'Äpfel\n\n'.repeat(1000),
  ]) {
    const pieces = splitSpeech(input);
    assert.equal(pieces.join(''), input);
    assert.ok(pieces.every((piece) => piece.length <= 4500));
    assert.ok(pieces.every((piece) => !/[\uD800-\uDBFF]$/.test(piece)));
  }
  assert.throws(() => splitSpeech('test', 1));

  // Spoken playback: a short first piece at a sentence end, nothing lost.
  const answer =
    'Morgen wird es in Zürich bewölkt. Am Nachmittag zieht Regen durch, nimm einen Schirm mit! ' +
    'Ab Dienstag wird es freundlicher, mit bis zu zwölf Grad. '.repeat(30) +
    'Gute Reise.';
  const spoken = playbackSegments(answer);
  assert.equal(spoken.join(''), answer);
  assert.ok(spoken.length >= 3, String(spoken.length));
  assert.ok(spoken[0]!.length <= 220 && /[.!?]\s*$/.test(spoken[0]!), spoken[0]);
  assert.ok(spoken.slice(1, -1).every((piece) => piece.length <= 900 && /[.!?]\s*$/.test(piece)));
  assert.deepEqual(playbackSegments('Kurz.'), ['Kurz.']);
  assert.deepEqual(playbackSegments('   '), []);
  // One long sentence without a stop still splits losslessly within the size limit.
  const runOn = 'wort '.repeat(2000);
  assert.equal(playbackSegments(runOn).join(''), runOn);
  assert.ok(playbackSegments(runOn).every((piece) => piece.length <= 4500));
  assert.equal(recognitionLocale('German'), 'de-CH');
  assert.equal(recognitionLocale('English'), 'en-US');

  // Mistral's catalogue: one page of `items` with languages; the pickers get
  // German first, then French, Italian and English, labelled, other languages left out.
  const page = parseMistralVoices({
    items: [
      { id: 'en-1', name: 'James', languages: ['en_us'] },
      { id: 'ja-1', name: 'Haruto', languages: ['ja'] },
      { id: 'fr-1', name: 'Marie', languages: ['fr_fr'] },
      { id: 'de-1', name: 'Heidi', languages: ['de'] },
      { id: 'en-2', name: 'Harriet', languages: ['en_GB'] },
    ],
    total: 66,
  });
  assert.deepEqual(
    pickMistralVoices(page).map((voice) => [voice.id, voice.name]),
    [
      ['mistral:de-1', 'Heidi · Deutsch'],
      ['mistral:fr-1', 'Marie · Französisch'],
      ['mistral:en-2', 'Harriet · Englisch'],
      ['mistral:en-1', 'James · Englisch'],
    ]
  );
  console.log(
    'PASS: OmniVoice-only synthesis, tenant attribution, Whisper word timestamps and lossless long-text segments'
  );
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}
