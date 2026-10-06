/** Parse a date supplied as ISO string, RFC822 string, epoch seconds/ms or Date. */
export function parseDate(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }

  if (typeof value === 'number') {
    // Heuristic: values below 1e12 are epoch seconds, above are epoch ms.
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{10}$/.test(trimmed) || /^\d{13}$/.test(trimmed)) {
      return parseDate(Number(trimmed));
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed;

    // "2026-10-05T05:15:43" without timezone is treated as UTC.
    const isoNoTz = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(:\d{2})?)$/.exec(trimmed);
    if (isoNoTz) {
      const withTz = new Date(`${isoNoTz[1]}T${isoNoTz[2]}Z`);
      if (!Number.isNaN(withTz.getTime())) return withTz;
    }
  }

  return undefined;
}

export function ageHours(date: Date | undefined, now: Date = new Date()): number | undefined {
  if (!date) return undefined;
  return (now.getTime() - date.getTime()) / 3_600_000;
}

export function relativeTime(date: Date | undefined, now: Date = new Date()): string {
  if (!date) return 'Recently';
  const hours = (now.getTime() - date.getTime()) / 3_600_000;
  if (hours < 0) return 'Just now';
  if (hours < 0.15) return 'Just now';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} minutes ago`;
  if (hours < 24) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days <= 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

/** e.g. "06 October 2026" rendered in the given timezone. */
export function dateLabel(now: Date = new Date(), timeZone = 'Asia/Dhaka'): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone,
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
