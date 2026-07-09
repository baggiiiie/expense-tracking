import { apiGet, apiWrite, type WriteResult } from '$lib/api';
import { getDefaultCategoryId, setDefaultCategoryId } from '$lib/default-category';
import type { Category, Expense } from '$lib/types';
import { displayCategoryIcon, nowMillis, parseAmount } from '$lib/util';

const categoryColors: Record<string, string> = {
	Food: '#FF9500',
	'Food & Dining': '#FF9500',
	Transport: '#007AFF',
	Shopping: '#FF2D55',
	Entertainment: '#AF52DE',
	Bills: '#FF3B30',
	Health: '#34C759',
	Education: '#5856D6',
	Travel: '#00C7BE',
	Other: '#8E8E93'
};

export type CategoryDraft = {
	editingId: string | null;
	name: string;
	icon: string;
	budgetText: string;
};

export type CategoryListModel = {
	categories: Category[];
	defaultCategoryId: string;
};

export type CategorySaveResult =
	| { kind: 'validation-error'; message: string }
	| WriteResult<Category>;

export function activeCategories(categories: Category[]): Category[] {
	return categories.filter((category) => !category.deleted_at);
}

export async function loadCategoryList(): Promise<CategoryListModel> {
	const data = await apiGet<{ categories: Category[] }>('/api/categories');
	const categories = activeCategories(data.categories ?? []);
	const storedDefault = getDefaultCategoryId();
	const defaultCategoryId = categories.some((category) => category.id === storedDefault)
		? storedDefault
		: '';
	if (storedDefault && !defaultCategoryId) setDefaultCategoryId(null);
	return { categories, defaultCategoryId };
}

export function emptyCategoryDraft(): CategoryDraft {
	return {
		editingId: null,
		name: '',
		icon: '💸',
		budgetText: ''
	};
}

export function draftFromCategory(category: Category): CategoryDraft {
	return {
		editingId: category.id,
		name: category.name,
		icon: categoryIcon(category),
		budgetText: category.budget != null ? (category.budget / 100).toFixed(2) : ''
	};
}

export async function saveCategory(draft: CategoryDraft): Promise<CategorySaveResult> {
	const name = draft.name.trim();
	if (!name) {
		return { kind: 'validation-error', message: 'Name is required.' };
	}

	const budget =
		draft.budgetText.trim() === '' ? null : parseAmount(draft.budgetText);
	if (draft.budgetText.trim() !== '' && budget == null) {
		return { kind: 'validation-error', message: 'Enter a valid budget amount.' };
	}
	if (budget != null && budget < 0) {
		return { kind: 'validation-error', message: 'Budget must be zero or greater.' };
	}

	const body = {
		name,
		icon: draft.icon.trim() || '💸',
		budget,
		client_updated_at: nowMillis()
	};
	const url = draft.editingId ? `/api/categories/${draft.editingId}` : '/api/categories';
	const method = draft.editingId ? 'PUT' : 'POST';
	const targetKey = `category:${draft.editingId ?? name.toLowerCase()}`;
	return apiWrite<Category>(method, url, body, targetKey);
}

export function toggleDefaultCategory(currentDefaultId: string, category: Category): string {
	const next = currentDefaultId === category.id ? '' : category.id;
	setDefaultCategoryId(next || null);
	return next;
}

export function categoryIcon(category: { name: string; icon: string }): string {
	return displayCategoryIcon(category);
}

export function categoryColor(categoryName: string): string {
	return categoryColors[categoryName] || '#8E8E93';
}

export function categoryLookup(categories: Category[]): Map<string, Category> {
	return new Map(categories.map((category) => [category.id, category]));
}

export function expenseCategory(expense: Expense, categoriesById: Map<string, Category>): Category {
	return (
		categoriesById.get(expense.category_id) ?? {
			id: expense.category_id,
			name: expense.category || 'Other',
			icon: '',
			budget: null,
			created_at: 0,
			updated_at: 0,
			client_updated_at: 0
		}
	);
}
