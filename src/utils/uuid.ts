/**
 * Cryptographically secure UUID v4 generator for React Native / Expo and Node test runners.
 *
 * Uses standard Web Crypto API:
 * 1. Primary: globalThis.crypto.randomUUID()
 * 2. Secondary: globalThis.crypto.getRandomValues(new Uint8Array(16)) formatted per RFC 4122 v4
 *
 * SAFE FAILURE STRATEGY:
 * If cryptographically secure randomness is unavailable in the execution environment,
 * this function strictly throws an Error (fail-closed) rather than silently degrading
 * to weak, predictable pseudo-random values (such as Math.random()).
 */

export const CANONICAL_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_UUID_REGEX.test(value);
}

export function generateUUID(): string {
  const cryptoObj = globalThis.crypto;

  if (typeof cryptoObj?.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }

  if (typeof cryptoObj?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    // RFC 4122 v4 variant (10xx) and version (0100) bits
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10xx
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  throw new Error(
    'Cryptographically secure randomness is not available in the current runtime environment. Cannot generate UUID safely.'
  );
}

