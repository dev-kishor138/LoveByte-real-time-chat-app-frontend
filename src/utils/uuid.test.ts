import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateUUID, isCanonicalUuid, CANONICAL_UUID_REGEX } from './uuid.ts';

describe('UUID Utility (frontend/src/utils/uuid.ts)', () => {
  it('generates a valid canonical UUID v4', () => {
    const id = generateUUID();
    assert.strictEqual(typeof id, 'string');
    assert.strictEqual(id.length, 36);
    assert.strictEqual(isCanonicalUuid(id), true);
    assert.strictEqual(CANONICAL_UUID_REGEX.test(id), true);
    // RFC 4122 v4 version character at index 14 is '4'
    assert.strictEqual(id.charAt(14), '4');
    // RFC 4122 variant character at index 19 is one of '8', '9', 'a', 'b'
    assert.match(id.charAt(19), /^[89ab]$/i);
  });

  it('generates unique UUIDs across multiple invocations', () => {
    const set = new Set<string>();
    const count = 100;
    for (let i = 0; i < count; i++) {
      const id = generateUUID();
      assert.strictEqual(set.has(id), false, `Collision detected on invocation ${i}: ${id}`);
      set.add(id);
    }
    assert.strictEqual(set.size, count);
  });

  it('isCanonicalUuid correctly validates conforming and non-conforming inputs', () => {
    assert.strictEqual(isCanonicalUuid('123e4567-e89b-12d3-a456-426614174000'), true);
    assert.strictEqual(isCanonicalUuid('00000000-0000-0000-0000-000000000000'), true);
    assert.strictEqual(isCanonicalUuid('ffffffff-ffff-ffff-ffff-ffffffffffff'), true);

    // Rejections
    assert.strictEqual(isCanonicalUuid(''), false);
    assert.strictEqual(isCanonicalUuid('not-a-uuid'), false);
    assert.strictEqual(isCanonicalUuid(' 123e4567-e89b-12d3-a456-426614174000'), false); // leading space
    assert.strictEqual(isCanonicalUuid('123e4567-e89b-12d3-a456-426614174000 '), false); // trailing space
    assert.strictEqual(isCanonicalUuid('123e4567e89b12d3a456426614174000'), false); // missing hyphens
    assert.strictEqual(isCanonicalUuid(null), false);
    assert.strictEqual(isCanonicalUuid(undefined), false);
    assert.strictEqual(isCanonicalUuid(12345), false);
  });

  it('uses crypto.getRandomValues when crypto.randomUUID is unavailable', () => {
    const originalCrypto = globalThis.crypto;
    try {
      // Mock environment where randomUUID is missing but getRandomValues exists
      const mockCrypto = {
        getRandomValues: (buffer: Uint8Array) => {
          for (let i = 0; i < buffer.length; i++) {
            buffer[i] = (i * 17 + 42) & 0xff;
          }
          return buffer;
        },
      } as any;

      Object.defineProperty(globalThis, 'crypto', {
        value: mockCrypto,
        configurable: true,
        writable: true,
      });

      const fallbackId = generateUUID();
      assert.strictEqual(isCanonicalUuid(fallbackId), true);
      assert.strictEqual(fallbackId.charAt(14), '4');
      assert.match(fallbackId.charAt(19), /^[89ab]$/i);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto,
        configurable: true,
        writable: true,
      });
    }
  });

  it('fails closed and throws an error if cryptographically secure randomness is unavailable', () => {
    const originalCrypto = globalThis.crypto;
    try {
      // Mock environment where neither randomUUID nor getRandomValues exists
      Object.defineProperty(globalThis, 'crypto', {
        value: {},
        configurable: true,
        writable: true,
      });

      assert.throws(
        () => generateUUID(),
        /Cryptographically secure randomness is not available in the current runtime environment/
      );
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto,
        configurable: true,
        writable: true,
      });
    }
  });
});

