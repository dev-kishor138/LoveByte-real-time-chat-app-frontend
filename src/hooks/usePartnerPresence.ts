import { useState, useEffect } from 'react';
import { socketClient } from '../services/socket/socketClient.ts';

export interface UsePartnerPresenceResult {
  isOnline: boolean;
  lastSeenAt: string | null;
}

/**
 * Hook for observing real-time online/offline presence and lastSeenAt for a partner.
 * Listens directly to verified user_presence socket events.
 */
export function usePartnerPresence(
  partnerId?: string | null,
  initialStatus: 'online' | 'offline' = 'offline',
  initialLastSeen: string | null = null
): UsePartnerPresenceResult {
  const [isOnline, setIsOnline] = useState<boolean>(initialStatus === 'online');
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(initialLastSeen);

  useEffect(() => {
    if (!partnerId) {
      setIsOnline(false);
      setLastSeenAt(null);
      return;
    }

    const unsubscribe = socketClient.on('user_presence', (payload) => {
      if (payload.userId === partnerId) {
        setIsOnline(payload.status === 'online');
        setLastSeenAt(payload.lastSeenAt);
      }
    });

    return unsubscribe;
  }, [partnerId]);

  return {
    isOnline,
    lastSeenAt,
  };
}

