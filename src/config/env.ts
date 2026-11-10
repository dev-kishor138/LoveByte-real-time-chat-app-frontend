/**
 * Resolves default backend host based on the runtime platform:
 * - Android Emulator routes host loopback through 10.0.2.2.
 * - iOS Simulator, Web, and Node test environments route host loopback through localhost.
 */
function getDefaultBackendUrl(): string {
  try {
    // Dynamic import to avoid Flow parsing errors in Node.js unit test environments
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RN = require('react-native');
    if (RN?.Platform?.OS === 'android') {
      return 'http://10.0.2.2:5000';
    }
  } catch {
    // Fallback for non-React Native environments (e.g. Node test runner)
  }
  return 'http://localhost:5000';
}

const defaultUrl = getDefaultBackendUrl();

export const ENV = {
  API_URL: process.env.EXPO_PUBLIC_API_URL || defaultUrl,
  SOCKET_URL: process.env.EXPO_PUBLIC_SOCKET_URL || defaultUrl,
  IS_DEV: typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production',
} as const;

export type Environment = typeof ENV;

