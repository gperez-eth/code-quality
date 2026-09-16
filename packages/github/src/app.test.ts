import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { appJwt, credentialsFromEnv, normalizePrivateKey } from './app.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

test('normalizePrivateKey puts back newlines a dotenv line escaped', () => {
  const escaped = String.raw`-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----`;
  const restored = normalizePrivateKey(escaped);

  assert.equal(restored.includes(String.raw`\n`), false);
  assert.equal(restored.split('\n').length, 3);
});

test('normalizePrivateKey strips quotes a parser left behind', () => {
  assert.equal(normalizePrivateKey('"-----BEGIN KEY-----"'), '-----BEGIN KEY-----');
});

test('appJwt signs a verifiable RS256 token', () => {
  const token = appJwt({ appId: '123456', privateKey });
  const [header, payload, signature] = token.split('.');

  assert.ok(header && payload && signature);
  assert.deepEqual(decodeSegment(header), { alg: 'RS256', typ: 'JWT' });

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${header}.${payload}`);
  verifier.end();
  assert.equal(verifier.verify(publicKey, Buffer.from(signature, 'base64url')), true);
});

test('appJwt backdates iat so a fast clock does not cause a 401', () => {
  const now = new Date('2026-09-16T12:00:00Z');
  const claims = decodeSegment(appJwt({ appId: '1', privateKey }, now).split('.')[1]!);

  const issued = claims['iat'] as number;
  assert.equal(issued, Math.floor(now.getTime() / 1000) - 60);
  // GitHub refuses anything more than ten minutes out.
  assert.ok((claims['exp'] as number) - issued <= 600);
  assert.equal(claims['iss'], '1');
});

test('credentialsFromEnv treats an unconfigured app as absent, not broken', () => {
  assert.equal(credentialsFromEnv({}), null);
  assert.equal(credentialsFromEnv({ GITHUB_APP_ID: '1' }), null);
  assert.equal(credentialsFromEnv({ GITHUB_APP_PRIVATE_KEY: 'k' }), null);

  const found = credentialsFromEnv({ GITHUB_APP_ID: ' 1 ', GITHUB_APP_PRIVATE_KEY: 'k' });
  assert.equal(found?.appId, '1');
});
