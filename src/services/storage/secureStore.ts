/**
 * Typed SecureStore Utility
 * Provides secure, hardware-backed encrypted storage for long-lived sensitive tokens on native mobile.
 * Detects web preview mode and safely avoids storing sensitive credentials in insecure web storage.
 * In Node.js test environments, uses an in-memory mock driver to avoid native module missing errors.
 */

export const SECURE_STORAGE_KEYS = {
  REFRESH_TOKEN: 'lovebyte_refresh_token',
} as const;

export type SecureStorageKey =
  | 'lovebyte_refresh_token'
  | (string & {});

export interface SecureStoreDriver {
  setItemAsync: (key: string, value: string) => Promise<void>;
  getItemAsync: (key: string) => Promise<string | null>;
  deleteItemAsync: (key: string) => Promise<void>;
  isAvailableAsync: () => Promise<boolean>;
}

let testPlatformOverride: string | null = null;

function resolvePlatformOS(): string {
  if (testPlatformOverride) {
    return testPlatformOverride;
  }
  try {
    // Dynamic require prevents Flow syntax parsing error in Node test runners
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RN = require('react-native');
    return RN?.Platform?.OS || 'node';
  } catch {
    return 'node';
  }
}

// In-memory driver used as fallback in Node.js test environments
const inMemoryTestMap = new Map<string, string>();
const inMemoryDriver: SecureStoreDriver = {
  async setItemAsync(key: string, value: string): Promise<void> {
    inMemoryTestMap.set(key, value);
  },
  async getItemAsync(key: string): Promise<string | null> {
    return inMemoryTestMap.get(key) ?? null;
  },
  async deleteItemAsync(key: string): Promise<void> {
    inMemoryTestMap.delete(key);
  },
  async isAvailableAsync(): Promise<boolean> {
    return true;
  },
};

function resolveDefaultDriver(): SecureStoreDriver {
  const os = resolvePlatformOS();
  if (os === 'web') {
    return {
      async setItemAsync() {},
      async getItemAsync() {
        return null;
      },
      async deleteItemAsync() {},
      async isAvailableAsync() {
        return false;
      },
    };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SecureStore = require('expo-secure-store');
    if (SecureStore?.setItemAsync) {
      return SecureStore;
    }
  } catch {
    // Fallback to in-memory driver in headless test runner
  }

  return inMemoryDriver;
}

let activeDriver: SecureStoreDriver = resolveDefaultDriver();

/**
 * Self-Contained Storage Mutation Queue & Key-Scoped Epoch Counters
 * Guarantees strictly sequential FIFO execution of all SecureStore mutations
 * and prevents delayed writes from overwriting subsequent clears.
 * Invalidation is scoped per storage key so deleting queue records does not cancel
 * unrelated in-flight writes (e.g. refresh tokens).
 */
let storageQueue: Promise<void> = Promise.resolve();
const keyEpochs = new Map<string, number>();

function getKeyEpoch(key: string): number {
  return keyEpochs.get(key) || 0;
}

function enqueueStorageMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const resultPromise = storageQueue.then(mutation, mutation);
  storageQueue = resultPromise.then(
    () => {},
    () => {}
  );
  return resultPromise;
}

export const secureStorage = {
  async isAvailable(): Promise<boolean> {
    if (resolvePlatformOS() === 'web') {
      return false;
    }
    return activeDriver.isAvailableAsync();
  },

  async setItem(key: SecureStorageKey, value: string): Promise<void> {
    if (resolvePlatformOS() === 'web') {
      console.warn(
        `[SecureStore] Storage key "${key}" not persisted: SecureStore is disabled on web to protect credentials.`
      );
      return;
    }

    const opEpoch = getKeyEpoch(key);

    return enqueueStorageMutation(async () => {
      // Pre-write check: If a clear on this specific key occurred while in queue, abort
      if (opEpoch !== getKeyEpoch(key)) {
        return;
      }

      try {
        await activeDriver.setItemAsync(key, value);
      } catch (error) {
        console.warn(`[SecureStore] Failed to write key "${key}":`, error);
        throw error;
      }

      // Post-write check: If a clear on this specific key occurred during I/O, delete written key
      if (opEpoch !== getKeyEpoch(key)) {
        try {
          await activeDriver.deleteItemAsync(key);
        } catch {
          // Compensating delete best-effort
        }
      }
    });
  },

  async getItem(key: SecureStorageKey): Promise<string | null> {
    if (resolvePlatformOS() === 'web') {
      return null;
    }

    return enqueueStorageMutation(async () => {
      try {
        return await activeDriver.getItemAsync(key);
      } catch (error) {
        console.warn(`[SecureStore] Failed to read key "${key}":`, error);
        return null;
      }
    });
  },

  async deleteItem(key: SecureStorageKey): Promise<void> {
    if (resolvePlatformOS() === 'web') {
      return;
    }

    // Synchronously increment epoch for this specific key
    keyEpochs.set(key, getKeyEpoch(key) + 1);

    return enqueueStorageMutation(async () => {
      try {
        await activeDriver.deleteItemAsync(key);
      } catch (error) {
        console.warn(`[SecureStore] Failed to delete key "${key}":`, error);
      }
    });
  },

  async getRefreshToken(): Promise<string | null> {
    return this.getItem(SECURE_STORAGE_KEYS.REFRESH_TOKEN);
  },

  async setRefreshToken(token: string): Promise<void> {
    return this.setItem(SECURE_STORAGE_KEYS.REFRESH_TOKEN, token);
  },

  async clearRefreshToken(): Promise<void> {
    return this.deleteItem(SECURE_STORAGE_KEYS.REFRESH_TOKEN);
  },

  _resetForTesting(): void {
    testPlatformOverride = null;
    storageQueue = Promise.resolve();
    keyEpochs.clear();
    inMemoryTestMap.clear();
    activeDriver = resolveDefaultDriver();
  },

  _setDriverForTesting(driver: SecureStoreDriver): void {
    activeDriver = driver;
  },

  _setPlatformOverrideForTesting(os: string | null): void {
    testPlatformOverride = os;
    activeDriver = resolveDefaultDriver();
  },

  _getEpochForTesting(key?: SecureStorageKey): number {
    return getKeyEpoch(key || SECURE_STORAGE_KEYS.REFRESH_TOKEN);
  },
};
