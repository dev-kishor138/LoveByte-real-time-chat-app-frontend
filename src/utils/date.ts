/**
 * Date and Time formatting utilities for LoveByte.
 * Zero external dependencies — implemented using standard ECMAScript Date and Intl APIs.
 */

/**
 * Checks whether two dates fall on the exact same local calendar day.
 */
export function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

/**
 * Checks whether d1 was yesterday relative to reference date d2.
 */
export function isYesterday(d1: Date, d2: Date): boolean {
  const yesterday = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate() - 1);
  return isSameDay(d1, yesterday);
}

/**
 * Formats a Date into standard 12-hour or locale time string, e.g. "10:45 AM".
 */
export function formatTime(date: Date): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  } catch {
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
  }
}

/**
 * Formats conversation snippet timestamp for the conversation list.
 *
 * Rules:
 * - Same day: "10:45 AM"
 * - Yesterday: "Yesterday"
 * - Within past 6 days: Short day name (e.g. "Mon", "Tue")
 * - Older in current year: "MMM d" (e.g. "Nov 8")
 * - Different year: "MMM d, yyyy" (e.g. "Nov 8, 2025")
 */
export function formatConversationTimestamp(
  dateInput?: string | Date | null,
  nowInput?: Date
): string {
  if (!dateInput) return '';

  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '';

  const now = nowInput || new Date();

  if (isSameDay(date, now)) {
    return formatTime(date);
  }

  if (isYesterday(date, now)) {
    return 'Yesterday';
  }

  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays >= 0 && diffDays < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
  }

  if (date.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

/**
 * Formats a partner's last seen presence timestamp for status badges.
 *
 * Rules:
 * - isOnline === true: "Online"
 * - lastSeenAt missing / null: "Offline"
 * - < 1 min ago: "Last seen just now"
 * - < 60 min ago: "Last seen Xm ago"
 * - Today: "Last seen today at 10:45 AM"
 * - Yesterday: "Last seen yesterday at 8:30 PM"
 * - Older: "Last seen MMM d"
 */
export function formatLastSeenPresence(
  lastSeenInput?: string | Date | null,
  isOnline: boolean = false,
  nowInput?: Date
): string {
  if (isOnline) {
    return 'Online';
  }

  if (!lastSeenInput) {
    return 'Offline';
  }

  const date = typeof lastSeenInput === 'string' ? new Date(lastSeenInput) : lastSeenInput;
  if (isNaN(date.getTime())) {
    return 'Offline';
  }

  const now = nowInput || new Date();
  const diffMs = now.getTime() - date.getTime();

  // If in future (clock skew), treat as just now
  if (diffMs < 60 * 1000) {
    return 'Last seen just now';
  }

  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  if (diffMinutes < 60) {
    return `Last seen ${diffMinutes}m ago`;
  }

  if (isSameDay(date, now)) {
    return `Last seen today at ${formatTime(date)}`;
  }

  if (isYesterday(date, now)) {
    return `Last seen yesterday at ${formatTime(date)}`;
  }

  const dateStr = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  return `Last seen ${dateStr}`;
}

/**
 * Formats calendar day dividers for chat message streams.
 *
 * Rules:
 * - Same day as now: "Today"
 * - Yesterday relative to now: "Yesterday"
 * - Same year: "MMMM d" (e.g. "November 8")
 * - Previous/future years: "MMMM d, yyyy" (e.g. "December 25, 2025")
 * - Invalid/null/empty inputs safely return ""
 */
export function formatDateSeparator(
  dateInput?: string | Date | null,
  nowInput?: Date
): string {
  if (!dateInput) return '';

  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '';

  const now = nowInput || new Date();

  if (isSameDay(date, now)) {
    return 'Today';
  }

  if (isYesterday(date, now)) {
    return 'Yesterday';
  }

  try {
    if (date.getFullYear() === now.getFullYear()) {
      return new Intl.DateTimeFormat(undefined, {
        month: 'long',
        day: 'numeric',
      }).format(date);
    }

    return new Intl.DateTimeFormat(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  } catch {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const month = months[date.getMonth()];
    const day = date.getDate();
    if (date.getFullYear() === now.getFullYear()) {
      return `${month} ${day}`;
    }
    return `${month} ${day}, ${date.getFullYear()}`;
  }
}

