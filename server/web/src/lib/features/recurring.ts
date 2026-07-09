import { apiGet, apiWrite, type WriteResult } from '$lib/api';
import { pickDefaultCategoryId } from '$lib/default-category';
import type { Category, Preferences, RecurringExpense } from '$lib/types';
import {
	dateInputValue,
	nowMillis,
	nowSeconds,
	parseAmount,
	unixFromDateInput
} from '$lib/util';
import { activeCategories, categoryIcon } from './categories';

export type RecurringFrequency = 'weekly' | 'monthly' | 'yearly';

export type RecurringPageModel = {
	rows: RecurringExpense[];
	categories: Category[];
	prefs: Preferences;
	defaultCategoryId: string;
};

export type RecurringDraft = {
	editingId: string | null;
	amountText: string;
	currency: string;
	categoryId: string;
	merchant: string;
	description: string;
	frequency: RecurringFrequency;
	dayOfMonthText: string;
	startDate: string;
	endDate: string;
};

export type RecurringSaveResult =
	| { kind: 'validation-error'; message: string }
	| WriteResult<RecurringExpense>;

export async function loadRecurringPage(): Promise<RecurringPageModel> {
	const [recurringData, categoryData, prefs] = await Promise.all([
		apiGet<{ recurring_expenses: RecurringExpense[] }>('/api/recurring-expenses'),
		apiGet<{ categories: Category[] }>('/api/categories'),
		apiGet<Preferences>('/api/preferences')
	]);
	const categories = activeCategories(categoryData.categories ?? []);
	return {
		rows: (recurringData.recurring_expenses ?? []).filter((row) => !row.deleted_at),
		categories,
		prefs,
		defaultCategoryId: pickDefaultCategoryId(categories)
	};
}

export function emptyRecurringDraft(currency: string, categoryId: string): RecurringDraft {
	return {
		editingId: null,
		amountText: '',
		currency,
		categoryId,
		merchant: '',
		description: '',
		frequency: 'monthly',
		dayOfMonthText: '',
		startDate: dateInputValue(nowSeconds()),
		endDate: ''
	};
}

export function draftFromRecurring(row: RecurringExpense): RecurringDraft {
	return {
		editingId: row.id,
		amountText: (row.amount / 100).toFixed(2),
		currency: row.currency,
		categoryId: row.category_id,
		merchant: row.merchant,
		description: row.description,
		frequency: (row.frequency as RecurringFrequency) || 'monthly',
		dayOfMonthText: row.day_of_month != null ? String(row.day_of_month) : '',
		startDate: dateInputValue(row.start_date),
		endDate: row.end_date != null ? dateInputValue(row.end_date) : ''
	};
}

export function recurringCategoryName(categories: Category[], id: string): string {
	return categories.find((category) => category.id === id)?.name ?? '—';
}

export function recurringCategoryIcon(categories: Category[], id: string): string {
	const category = categories.find((candidate) => candidate.id === id);
	return category ? categoryIcon(category) : '💸';
}

export function scheduleSummary(row: RecurringExpense): string {
	switch (row.frequency) {
		case 'weekly':
			return 'Every week';
		case 'monthly':
			return `Every month on day ${row.day_of_month ?? 1}`;
		case 'yearly':
			return 'Every year';
		default:
			return row.frequency;
	}
}

export async function saveRecurringExpense(draft: RecurringDraft): Promise<RecurringSaveResult> {
	const amount = parseAmount(draft.amountText);
	if (amount == null || amount <= 0) {
		return { kind: 'validation-error', message: 'Enter an amount greater than zero.' };
	}
	if (!draft.categoryId) {
		return { kind: 'validation-error', message: 'Pick a category.' };
	}

	const dayOfMonth =
		draft.frequency === 'monthly' && draft.dayOfMonthText.trim() !== ''
			? Number(draft.dayOfMonthText)
			: null;
	if (dayOfMonth != null && (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)) {
		return { kind: 'validation-error', message: 'Enter a day of month from 1 to 31.' };
	}

	const body = {
		amount,
		currency: draft.currency.toUpperCase(),
		category_id: draft.categoryId,
		merchant: draft.merchant.trim(),
		description: draft.description.trim(),
		frequency: draft.frequency,
		day_of_month: dayOfMonth,
		start_date: unixFromDateInput(draft.startDate),
		end_date: draft.endDate ? unixFromDateInput(draft.endDate) : null,
		client_updated_at: nowMillis()
	};
	const url = draft.editingId
		? `/api/recurring-expenses/${draft.editingId}`
		: '/api/recurring-expenses';
	const method = draft.editingId ? 'PUT' : 'POST';
	const targetKey = `recurring:${draft.editingId ?? 'new'}:${nowMillis()}`;
	return apiWrite<RecurringExpense>(method, url, body, targetKey);
}
