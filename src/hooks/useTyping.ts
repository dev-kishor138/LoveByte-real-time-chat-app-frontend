import { useState, useEffect, useRef, useCallback } from 'react';
import { socketClient } from '../services/socket/socketClient.ts';

export interface UseTypingResult {
  isPartnerTyping: boolean;
  startTyping: () => void;
  stopTyping: () => void;
}

/**
 * Hook for managing conversation typing indicators.
 * Debounces and throttles outgoing typing emissions and auto-clears stale partner typing states.
 */
export function useTyping(conversationId: string): UseTypingResult {
  const [isPartnerTyping, setIsPartnerTyping] = useState<boolean>(false);
  const isLocallyTypingRef = useRef<boolean>(false);
  const autoStopTimerRef = useRef<NodeJS.Timeout | null>(null);
  const safetyClearTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Stop local typing emission
  const stopTyping = useCallback(() => {
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }

    if (isLocallyTypingRef.current) {
      isLocallyTypingRef.current = false;
      socketClient.typingStop(conversationId).catch(() => {});
    }
  }, [conversationId]);

  // Start local typing emission (throttled with 3-second auto-stop)
  const startTyping = useCallback(() => {
    // Reset auto-stop timer on every keystroke
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
    }

    if (!isLocallyTypingRef.current) {
      isLocallyTypingRef.current = true;
      socketClient.typingStart(conversationId).catch(() => {});
    }

    // Auto-stop after 3 seconds of typing inactivity
    autoStopTimerRef.current = setTimeout(() => {
      stopTyping();
    }, 3000);
  }, [conversationId, stopTyping]);

  // Listen for partner typing events
  useEffect(() => {
    const unsubscribe = socketClient.on('user_typing', (payload) => {
      if (payload.conversationId === conversationId) {
        setIsPartnerTyping(payload.isTyping);

        if (safetyClearTimerRef.current) {
          clearTimeout(safetyClearTimerRef.current);
          safetyClearTimerRef.current = null;
        }

        // Safety fallback: auto-clear after 5 seconds in case partner never sends typing_stop
        if (payload.isTyping) {
          safetyClearTimerRef.current = setTimeout(() => {
            setIsPartnerTyping(false);
          }, 5000);
        }
      }
    });

    return () => {
      unsubscribe();
      if (safetyClearTimerRef.current) {
        clearTimeout(safetyClearTimerRef.current);
      }
      stopTyping();
    };
  }, [conversationId, stopTyping]);

  return {
    isPartnerTyping,
    startTyping,
    stopTyping,
  };
}

