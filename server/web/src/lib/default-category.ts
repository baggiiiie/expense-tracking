import type { Category } from './types';

// Match the iOS app's UserDefaults key so the web app has the same concept
// when running as an installed PWA on one device/browser profile.
const DEFAULT_CATEGORY_KEY = 'defaultCategoryId';

export function getDefaultCategoryId(): string {
	if (typeof localStorage === 'undefined') return '';
	return localStorage.getItem(DEFAULT_CATEGORY_KEY) ?? '';
}

export function setDefaultCategoryId(id: string | null): void {
	if (typeof localStorage === 'undefined') return;
	if (id) localStorage.setItem(DEFAULT_CATEGORY_KEY, id);
	else localStorage.removeItem(DEFAULT_CATEGORY_KEY);
}

export function pickDefaultCategoryId(categories: Category[], fallback = ''): string {
	const stored = getDefaultCategoryId();
	if (stored && categories.some((cat) => cat.id === stored)) return stored;
	if (fallback && categories.some((cat) => cat.id === fallback)) return fallback;
	return categories[0]?.id ?? '';
}
