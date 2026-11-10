import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isSameDay,
  isYesterday,
  formatConversationTimestamp,
  formatLastSeenPresence,
  formatDateSeparator,
} from './date.ts';

describe('Date Formatting Utilities (frontend/src/utils/date.ts)', () => {
  // Use local Date constructors so tests are 100% deterministic in any timezone
  const refNow = new Date(2026, 10, 9, 14, 30, 0); // Nov 9, 2026, 14:30

  describe('isSameDay & isYesterday', () => {
    it('detects same calendar day accurately', () => {
      const d1 = new Date(2026, 10, 9, 8, 0, 0);
      const d2 = new Date(2026, 10, 9, 22, 0, 0);
      const d3 = new Date(2026, 10, 10, 1, 0, 0);

      assert.strictEqual(isSameDay(d1, d2), true);
      assert.strictEqual(isSameDay(d1, d3), false);
    });

    it('detects yesterday accurately', () => {
      const today = new Date(2026, 10, 9, 12, 0, 0);
      const yesterday = new Date(2026, 10, 8, 20, 0, 0);
      const twoDaysAgo = new Date(2026, 10, 7, 12, 0, 0);

      assert.strictEqual(isYesterday(yesterday, today), true);
      assert.strictEqual(isYesterday(twoDaysAgo, today), false);
    });
  });

  describe('formatConversationTimestamp', () => {
    it('returns empty string for null, undefined, or invalid inputs', () => {
      assert.strictEqual(formatConversationTimestamp(null, refNow), '');
      assert.strictEqual(formatConversationTimestamp(undefined, refNow), '');
      assert.strictEqual(formatConversationTimestamp('invalid-date', refNow), '');
    });

    it('formats same-day timestamps as time (e.g. 10:45 AM)', () => {
      const todayMsg = new Date(2026, 10, 9, 10, 15, 0);
      const result = formatConversationTimestamp(todayMsg, refNow);
      assert.match(result, /\d{1,2}:\d{2}/);
    });

    it('formats yesterday timestamps as "Yesterday"', () => {
      const yesterdayMsg = new Date(2026, 10, 8, 18, 0, 0);
      const result = formatConversationTimestamp(yesterdayMsg, refNow);
      assert.strictEqual(result, 'Yesterday');
    });

    it('formats dates within the past 6 days as weekday names', () => {
      const fourDaysAgo = new Date(2026, 10, 5, 12, 0, 0);
      const result = formatConversationTimestamp(fourDaysAgo, refNow);
      assert.match(result, /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/);
    });

    it('formats dates in current year older than 6 days as "MMM d"', () => {
      const olderDate = new Date(2026, 9, 15, 10, 0, 0); // Oct 15, 2026
      const result = formatConversationTimestamp(olderDate, refNow);
      assert.match(result, /^Oct\s+15/);
    });

    it('formats dates from previous years with full year "MMM d, yyyy"', () => {
      const lastYearDate = new Date(2025, 11, 25, 10, 0, 0); // Dec 25, 2025
      const result = formatConversationTimestamp(lastYearDate, refNow);
      assert.match(result, /2025/);
    });
  });

  describe('formatLastSeenPresence', () => {
    it('returns "Online" immediately when isOnline is true regardless of lastSeenAt', () => {
      assert.strictEqual(formatLastSeenPresence(null, true, refNow), 'Online');
      assert.strictEqual(formatLastSeenPresence(new Date(2026, 10, 8, 10, 0), true, refNow), 'Online');
    });

    it('returns "Offline" when lastSeenAt is missing or invalid and isOnline is false', () => {
      assert.strictEqual(formatLastSeenPresence(null, false, refNow), 'Offline');
      assert.strictEqual(formatLastSeenPresence(undefined, false, refNow), 'Offline');
      assert.strictEqual(formatLastSeenPresence('invalid-date', false, refNow), 'Offline');
    });

    it('formats timestamps < 1 min ago as "Last seen just now"', () => {
      const justNow = new Date(refNow.getTime() - 20 * 1000); // 20s ago
      assert.strictEqual(formatLastSeenPresence(justNow, false, refNow), 'Last seen just now');
    });

    it('formats timestamps < 60 mins ago as "Last seen Xm ago"', () => {
      const tenMinsAgo = new Date(refNow.getTime() - 10 * 60 * 1000); // 10m ago
      assert.strictEqual(formatLastSeenPresence(tenMinsAgo, false, refNow), 'Last seen 10m ago');
    });

    it('formats earlier same-day timestamps as "Last seen today at ..."', () => {
      const earlierToday = new Date(2026, 10, 9, 8, 0, 0);
      const result = formatLastSeenPresence(earlierToday, false, refNow);
      assert.match(result, /^Last seen today at \d{1,2}:\d{2}/);
    });

    it('formats yesterday timestamps as "Last seen yesterday at ..."', () => {
      const yesterday = new Date(2026, 10, 8, 20, 0, 0);
      const result = formatLastSeenPresence(yesterday, false, refNow);
      assert.match(result, /^Last seen yesterday at \d{1,2}:\d{2}/);
    });

    it('formats older timestamps as "Last seen MMM d"', () => {
      const older = new Date(2026, 9, 20, 10, 0, 0); // Oct 20, 2026
      const result = formatLastSeenPresence(older, false, refNow);
      assert.match(result, /^Last seen Oct\s+20/);
    });
  });

  describe('formatDateSeparator', () => {
    it('returns empty string for null, undefined, or invalid inputs', () => {
      assert.strictEqual(formatDateSeparator(null, refNow), '');
      assert.strictEqual(formatDateSeparator(undefined, refNow), '');
      assert.strictEqual(formatDateSeparator('', refNow), '');
      assert.strictEqual(formatDateSeparator('invalid-date-string', refNow), '');
    });

    it('returns "Today" for any timestamp on the same local calendar day', () => {
      const earlierToday = new Date(2026, 10, 9, 0, 1, 0);
      const laterToday = new Date(2026, 10, 9, 23, 59, 0);

      assert.strictEqual(formatDateSeparator(earlierToday, refNow), 'Today');
      assert.strictEqual(formatDateSeparator(laterToday, refNow), 'Today');
    });

    it('returns "Yesterday" for timestamps on the previous local calendar day', () => {
      const yesterdayMorning = new Date(2026, 10, 8, 8, 30, 0);
      const yesterdayNight = new Date(2026, 10, 8, 23, 45, 0);

      assert.strictEqual(formatDateSeparator(yesterdayMorning, refNow), 'Yesterday');
      assert.strictEqual(formatDateSeparator(yesterdayNight, refNow), 'Yesterday');
    });

    it('correctly handles month boundaries for yesterday', () => {
      const firstOfMonth = new Date(2026, 10, 1, 10, 0, 0); // Nov 1, 2026
      const lastOfPrevMonth = new Date(2026, 9, 31, 22, 0, 0); // Oct 31, 2026

      assert.strictEqual(formatDateSeparator(lastOfPrevMonth, firstOfMonth), 'Yesterday');
    });

    it('formats other dates in the same calendar year without year (e.g. "November 5")', () => {
      const fourDaysAgo = new Date(2026, 10, 5, 12, 0, 0); // Nov 5, 2026
      const result = formatDateSeparator(fourDaysAgo, refNow);
      assert.match(result, /^November\s+5/);

      const lastMonth = new Date(2026, 9, 15, 10, 0, 0); // Oct 15, 2026
      const result2 = formatDateSeparator(lastMonth, refNow);
      assert.match(result2, /^October\s+15/);
    });

    it('formats dates in previous or future years with full year (e.g. "December 25, 2025")', () => {
      const lastYear = new Date(2025, 11, 25, 10, 0, 0); // Dec 25, 2025
      const result = formatDateSeparator(lastYear, refNow);
      assert.match(result, /December\s+25,\s+2025/);

      const nextYear = new Date(2027, 0, 1, 10, 0, 0); // Jan 1, 2027
      const resultNext = formatDateSeparator(nextYear, refNow);
      assert.match(resultNext, /January\s+1,\s+2027/);
    });

    it('accepts ISO date string input properly', () => {
      const todayIso = new Date(2026, 10, 9, 10, 0, 0).toISOString();
      assert.strictEqual(formatDateSeparator(todayIso, refNow), 'Today');
    });
  });
});
