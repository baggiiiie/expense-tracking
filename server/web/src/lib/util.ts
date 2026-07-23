// Small client-only helpers shared across pages.

export function newId(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return crypto.randomUUID();
	}
	// Fallback (older Safari). Not cryptographically strong but adequate
	// for a single-user expense ID.
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === 'x' ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

export function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

export function nowMillis(): number {
	return Date.now();
}

export function formatMoney(cents: number | null | undefined, currency = 'USD'): string {
	if (cents == null) return '—';
	const major = cents / 100;
	try {
		return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(major);
	} catch {
		return `${currency} ${major.toFixed(2)}`;
	}
}

export function parseAmount(input: string | number): number | null {
	// `<input type="number">` bindings hand us a number (or '' when blank),
	// while text inputs hand us a string. Accept both so callers don't crash
	// calling string methods on a number.
	const value = typeof input === 'number' ? input : Number(input.trim());
	if (typeof input === 'string' && input.trim() === '') return null;
	if (!Number.isFinite(value)) return null;
	return Math.round(value * 100);
}

export function formatDate(unixSeconds: number): string {
	const d = new Date(unixSeconds * 1000);
	return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(unixSeconds: number): string {
	const d = new Date(unixSeconds * 1000);
	return d.toLocaleString();
}

export function formatTime(unixSeconds: number): string {
	const d = new Date(unixSeconds * 1000);
	return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

// dayKey produces a "YYYY-MM-DD" bucket using the local timezone, suitable
// for grouping the expense feed.
export function dayKey(unixSeconds: number): string {
	const d = new Date(unixSeconds * 1000);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

// dateInputValue converts unix seconds to the "YYYY-MM-DD" shape an
// <input type="date"> wants.
export function dateInputValue(unixSeconds: number): string {
	return dayKey(unixSeconds);
}

// unixFromDateInput parses an "YYYY-MM-DD" value back to unix seconds at
// local midnight.
export function unixFromDateInput(value: string): number {
	const [y, m, d] = value.split('-').map((n) => Number(n));
	const date = new Date(y, (m ?? 1) - 1, d ?? 1);
	return Math.floor(date.getTime() / 1000);
}

// dateTimeInputValue converts unix seconds to the "YYYY-MM-DDTHH:mm" shape
// an <input type="datetime-local"> wants, using the local timezone.
export function dateTimeInputValue(unixSeconds: number): string {
	const d = new Date(unixSeconds * 1000);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	const hh = String(d.getHours()).padStart(2, '0');
	const mm = String(d.getMinutes()).padStart(2, '0');
	return `${y}-${m}-${day}T${hh}:${mm}`;
}

// unixFromDateTimeInput parses an "YYYY-MM-DDTHH:mm" value back to unix
// seconds at the local timezone.
export function unixFromDateTimeInput(value: string): number {
	const [datePart, timePart = '00:00'] = value.split('T');
	const [y, m, d] = datePart.split('-').map((n) => Number(n));
	const [hh, mm] = timePart.split(':').map((n) => Number(n));
	const date = new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0);
	return Math.floor(date.getTime() / 1000);
}

// Default emoji icons for the seeded category names. Used as a fallback
// when the stored icon is empty or is a non-emoji SF Symbol name written
// by the iOS client.
const defaultCategoryEmojis: Record<string, string> = {
	Food: '🍽️',
	'Food & Dining': '🍽️',
	Groceries: '🛒',
	Transport: '🚌',
	Shopping: '🛍️',
	Entertainment: '🎬',
	Bills: '📄',
	Health: '💊',
	Education: '📚',
	Travel: '✈️',
	Other: '📦'
};

// displayCategoryIcon returns a renderable icon for a category. If the
// stored icon is empty or looks like an SF Symbol name (ASCII letters,
// digits, dots, etc.), fall back to the default emoji for the category
// name so the web UI doesn't show raw text like "cart" next to "Groceries".
export function displayCategoryIcon(category: { name: string; icon: string }): string {
	const trimmed = (category.icon ?? '').trim();
	const looksLikeSymbolName = trimmed === '' || /^[\x20-\x7E]+$/.test(trimmed);
	if (looksLikeSymbolName) {
		return defaultCategoryEmojis[category.name] ?? '💸';
	}
	return trimmed;
}
