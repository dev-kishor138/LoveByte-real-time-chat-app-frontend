import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { secureStorage } from './secureStore.ts';

describe('SecureStore Platform Isolation & Concurrency (Stage 2B)', () => {
  beforeEach(() => {
    secureStorage._resetForTesting();
  });

  afterEach(() => {
    secureStorage._resetForTesting();
  });

  it('20. Web Platform Storage Isolation: isAvailable is false, tokens return null, no writes persist, and web storage untouched', async () => {
    secureStorage._setPlatformOverrideForTesting('web');

    // 1. isAvailable must be false on Web
    const available = await secureStorage.isAvailable();
    assert.strictEqual(available, false, 'SecureStore must not be available on Web');

    // 2. setRefreshToken must be a no-op that does not throw
    await secureStorage.setRefreshToken('test-web-refresh-token');

    // 3. getRefreshToken must strictly return null
    const token = await secureStorage.getRefreshToken();
    assert.strictEqual(token, null, 'Web must never return persistent tokens');

    // 4. clearRefreshToken must execute safely without errors
    await secureStorage.clearRefreshToken();

    // 5. Verify localStorage and sessionStorage were never touched
    const globalObj = globalThis as any;
    if (globalObj.localStorage) {
      assert.strictEqual(globalObj.localStorage.getItem('lovebyte_refresh_token'), null);
    }
  });

  it('21. Native Driver Storage Operations: In-memory driver executes sequential FIFO writes, reads, and clears', async () => {
    secureStorage._setPlatformOverrideForTesting('node');

    const available = await secureStorage.isAvailable();
    assert.strictEqual(available, true);

    await secureStorage.setRefreshToken('native-refresh-token-123');
    const readToken = await secureStorage.getRefreshToken();
    assert.strictEqual(readToken, 'native-refresh-token-123');

    await secureStorage.clearRefreshToken();
    const clearedToken = await secureStorage.getRefreshToken();
    assert.strictEqual(clearedToken, null);
  });

  it('22. Stale Login Storage Overwrite Prevention (Storage-Epoch Proof): Slow write from previous session never overwrites new session', async () => {
    let resolveSlowWrite: () => void = () => {};
    const slowWriteGate = new Promise<void>((resolve) => {
      resolveSlowWrite = resolve;
    });

    const mockStorageMap = new Map<string, string>();

    secureStorage._setDriverForTesting({
      setItemAsync: async (key, val) => {
        if (val === 'tokenA-stale') {
          // Delay User A's slow write to simulate hardware/flash memory latency
          await slowWriteGate;
        }
        mockStorageMap.set(key, val);
      },
      getItemAsync: async (key) => mockStorageMap.get(key) ?? null,
      deleteItemAsync: async (key) => {
        mockStorageMap.delete(key);
      },
      isAvailableAsync: async () => true,
    });

    // 1. User A initiates write with epoch 0
    const writeA = secureStorage.setRefreshToken('tokenA-stale');

    // 2. User A logs out: clearRefreshToken increments storageEpoch to 1 and enqueues delete
    const logoutClear = secureStorage.clearRefreshToken();

    // 3. User B logs in: User B initiates write with epoch 1
    const writeB = secureStorage.setRefreshToken('tokenB-active');

    // 4. Release User A's slow write
    resolveSlowWrite();

    // Wait for all queued operations to settle
    await Promise.all([writeA, logoutClear, writeB]);

    // 5. Verify: Storage strictly contains User B's token; User A's write was discarded/purged
    const finalStoredToken = await secureStorage.getRefreshToken();
    assert.strictEqual(finalStoredToken, 'tokenB-active', 'Storage must strictly preserve User B token');
  });

  it('23. Key-Scoped Epoch Invalidation: Deleting a queue message key does NOT cancel concurrent in-flight refresh token writes', async () => {
    let resolveSlowWrite: () => void = () => {};
    const slowWriteGate = new Promise<void>((resolve) => {
      resolveSlowWrite = resolve;
    });

    const mockStorageMap = new Map<string, string>();

    secureStorage._setDriverForTesting({
      setItemAsync: async (key, val) => {
        if (key === 'lovebyte_refresh_token') {
          // Simulate latency on refresh token write
          await slowWriteGate;
        }
        mockStorageMap.set(key, val);
      },
      getItemAsync: async (key) => mockStorageMap.get(key) ?? null,
      deleteItemAsync: async (key) => {
        mockStorageMap.delete(key);
      },
      isAvailableAsync: async () => true,
    });

    // 1. In-flight refresh token write starts
    const writeTokenPromise = secureStorage.setRefreshToken('valid-session-refresh-token');

    // 2. Concurrently, a message queue item is deleted (e.g. dequeued after send)
    const queueKey = 'lovebyte_queue_msg_user123_mut456';
    mockStorageMap.set(queueKey, JSON.stringify({ content: 'hello' }));
    const deleteQueuePromise = secureStorage.deleteItem(queueKey);

    // 3. Release the slow refresh token write
    resolveSlowWrite();

    await Promise.all([writeTokenPromise, deleteQueuePromise]);

    // 4. Verify: The queue item was deleted, but the refresh token MUST still be persisted!
    const storedToken = await secureStorage.getRefreshToken();
    assert.strictEqual(
      storedToken,
      'valid-session-refresh-token',
      'Deleting unrelated queue key must not drop concurrent refresh token write'
    );
    assert.strictEqual(mockStorageMap.get(queueKey), undefined, 'Queue key must be deleted');
  });
});

