import test from 'node:test'
import assert from 'node:assert/strict'
import { nativeMediaFile } from '../lib/media.js'

test('Gemini little-endian PCM becomes a playable 24kHz mono 16-bit WAV without changing samples', () => {
  const pcm = Buffer.from([0x34, 0x12, 0xcc, 0xed])
  const result = nativeMediaFile(pcm, 'audio/L16;codec=pcm;rate=24000')
  assert.equal(result.extension, 'wav')
  assert.equal(result.data.toString('ascii', 0, 4), 'RIFF')
  assert.equal(result.data.readUInt32LE(4), 40)
  assert.equal(result.data.toString('ascii', 8, 16), 'WAVEfmt ')
  assert.equal(result.data.readUInt32LE(16), 16)
  assert.equal(result.data.readUInt16LE(20), 1)
  assert.equal(result.data.readUInt16LE(22), 1)
  assert.equal(result.data.readUInt32LE(24), 24000)
  assert.equal(result.data.readUInt32LE(28), 48000)
  assert.equal(result.data.readUInt16LE(32), 2)
  assert.equal(result.data.readUInt16LE(34), 16)
  assert.equal(result.data.toString('ascii', 36, 40), 'data')
  assert.equal(result.data.readUInt32LE(40), pcm.length)
  assert.deepEqual(result.data.subarray(44), pcm)
  assert.equal(pcm.readInt16LE(0), 0x1234)
})

test('PCM defaults and explicit quoted sample rate/channel parameters are respected', () => {
  const defaults = nativeMediaFile(Buffer.alloc(2), 'audio/l16')
  assert.equal(defaults.data.readUInt32LE(24), 24000)
  const stereo = nativeMediaFile(Buffer.alloc(8), ' Audio/L16 ; RATE="16000" ; channels=2 ; codec=PCM ')
  assert.equal(stereo.data.readUInt16LE(22), 2)
  assert.equal(stereo.data.readUInt32LE(24), 16000)
  assert.equal(stereo.data.readUInt32LE(28), 64000)
  assert.equal(stereo.data.readUInt16LE(32), 4)
})

test('malformed or unsupported PCM is rejected instead of producing a corrupt WAV', () => {
  for (const mime of ['audio/L16;rate=0', 'audio/L16;rate=NaN', 'audio/L16;rate=1e4',
    'audio/L16;channels=0', 'audio/L16;channels=65536', 'audio/L16;codec=opus',
    'audio/L16;rate=24000;rate=16000', 'audio/L16;rate=4294967295']) {
    assert.throws(() => nativeMediaFile(Buffer.alloc(4), mime), error => error.code === 'INVALID_RESPONSE', mime)
  }
  assert.throws(() => nativeMediaFile(Buffer.alloc(3), 'audio/L16'), error => error.code === 'INVALID_RESPONSE')
  assert.throws(() => nativeMediaFile(Buffer.alloc(2), 'audio/L16;channels=2'), error => error.code === 'INVALID_RESPONSE')
})

test('container formats preserve exact bytes and get usable extensions', () => {
  const data = Buffer.from('native media bytes')
  const formats = [
    ['audio/wav', 'wav'], ['audio/mpeg', 'mp3'], ['audio/ogg;codecs=opus', 'ogg'],
    ['audio/flac', 'flac'], ['audio/aac', 'aac'], ['audio/mp4', 'm4a'], ['audio/webm', 'weba'],
    ['video/mp4', 'mp4'], ['video/webm', 'webm'], ['video/quicktime', 'mov'],
    ['application/pdf', 'pdf'], ['application/json', 'json'], ['text/plain;charset=utf-8', 'txt'],
    ['application/problem+json', 'json'], ['application/unknown', 'bin'],
  ]
  for (const [mime, extension] of formats) {
    const result = nativeMediaFile(data, mime)
    assert.equal(result.extension, extension, mime)
    assert.equal(result.data, data, mime)
  }
})
