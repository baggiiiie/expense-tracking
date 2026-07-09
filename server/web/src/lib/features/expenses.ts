import { apiGet, apiWrite, type WriteResult } from '$lib/api';
import { pickDefaultCategoryId } from '$lib/default-category';
import type { Category, Expense, ExpenseListResponse, Preferences, WalletSuggestion } from '$lib/types';
import {
	dateInputValue,
	dayKey,
	newId,
	nowMillis,
	nowSeconds,
	unixFromDateInput
} from '$lib/util';
import { activeCategories } from './categories';

export type ExpenseRangePreset = 'month' | 'week' | 'custom';

export type ExpenseRange = {
	preset: ExpenseRangePreset;
	customStart: string;
	customEnd: string;
};

export type ExpenseFeedModel = {
	expenses: Expense[];
	categories: Category[];
	cursor?: number;
	rangeTotal: number;
	pendingSuggestionCount: number;
};

export type ExpenseGroup = {
	dayKey: string;
	date: number;
	items: Expense[];
	dailyTotal: number;
};

export type ExpenseSummary = {
	total: number;
	currency: string;
};

export type ExpenseFormValue = {
	amount: number;
	category_id: string;
	merchant: string;
	date: number;
};

export type NewExpenseContext = {
	categories: Category[];
	prefs: Preferences;
	defaultCategoryId: string;
};

export type ExistingExpenseContext = {
	expense: Expense;
	categories: Category[];
};

export function initialExpenseRange(): ExpenseRange {
	const now = new Date();
	const monthStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
	return {
		preset: 'month',
		customStart: dateInputValue(monthStart),
		customEnd: dateInputValue(nowSeconds())
	};
}

export function rangeValidationError(range: ExpenseRange): string {
	const bounds = rangeBounds(range);
	return bounds.before <= bounds.since ? 'Choose an end date after the start date.' : '';
}

export function rangeBounds(range: ExpenseRange): { since: number; before: number } {
	const now = new Date();
	const beforeNow = Math.floor(Date.now() / 1000) + 1;
	if (range.preset === 'week') {
		const start = new Date(now);
		start.setHours(0, 0, 0, 0);
		start.setDate(start.getDate() - start.getDay());
		return { since: Math.floor(start.getTime() / 1000), before: beforeNow };
	}
	if (range.preset === 'custom') {
		const since = unixFromDateInput(range.customStart);
		const end = new Date(unixFromDateInput(range.customEnd) * 1000);
		end.setDate(end.getDate() + 1);
		return { since, before: Math.floor(end.getTime() / 1000) };
	}
	const start = new Date(now.getFullYear(), now.getMonth(), 1);
	return { since: Math.floor(start.getTime() / 1000), before: beforeNow };
}

export async function loadExpenseFeed(range: ExpenseRange): Promise<ExpenseFeedModel> {
	const [expenseData, categoryData, suggestionData] = await Promise.all([
		apiGet<ExpenseListResponse>(expensesURL(range)),
		apiGet<{ categories: Category[] }>('/api/categories'),
		apiGet<{ wallet_suggestions: WalletSuggestion[]; count: number }>(
			'/api/wallet-suggestions?status=pending'
		)
	]);
	const expenses = expenseData.expenses ?? [];
	return {
		expenses,
		categories: activeCategories(categoryData.categories ?? []),
		cursor: expenseData.next_before,
		rangeTotal: expenseData.total ?? expenses.reduce((sum, expense) => sum + expense.amount, 0),
		pendingSuggestionCount:
			suggestionData.count ?? suggestionData.wallet_suggestions?.length ?? 0
	};
}

export async function loadOlderExpenses(
	range: ExpenseRange,
	cursor: number
): Promise<Pick<ExpenseFeedModel, 'expenses' | 'cursor'>> {
	const data = await apiGet<ExpenseListResponse>(expensesURL(range, cursor));
	return {
		expenses: data.expenses ?? [],
		cursor: data.next_before
	};
}

export function groupExpenses(expenses: Expense[]): ExpenseGroup[] {
	const map = new Map<string, ExpenseGroup>();
	for (const expense of expenses) {
		const key = dayKey(expense.date);
		const existing = map.get(key);
		if (existing) {
			existing.items.push(expense);
			existing.dailyTotal += expense.amount;
		} else {
			map.set(key, {
				dayKey: key,
				date: expense.date,
				items: [expense],
				dailyTotal: expense.amount
			});
		}
	}
	return Array.from(map.values()).sort((a, b) => b.date - a.date);
}

export function summarizeExpenses(expenses: Expense[], rangeTotal: number): ExpenseSummary {
	return {
		total: rangeTotal,
		currency: expenses.find((expense) => expense.currency)?.currency ?? 'SGD'
	};
}

export function formatSummaryAmount(cents: number): string {
	return (cents / 100).toFixed(2);
}

export async function loadNewExpenseContext(): Promise<NewExpenseContext> {
	const [categoryData, prefs] = await Promise.all([
		apiGet<{ categories: Category[] }>('/api/categories'),
		apiGet<Preferences>('/api/preferences')
	]);
	const categories = activeCategories(categoryData.categories ?? []);
	return {
		categories,
		prefs,
		defaultCategoryId: pickDefaultCategoryId(categories)
	};
}

export async function createExpense(
	value: ExpenseFormValue,
	prefs: Preferences
): Promise<WriteResult<Expense>> {
	const id = newId();
	return apiWrite<Expense>(
		'POST',
		'/api/expenses',
		{
			id,
			amount: value.amount,
			currency: prefs.currency || 'SGD',
			category_id: value.category_id,
			merchant: value.merchant,
			description: '',
			date: value.date,
			client_updated_at: nowMillis()
		},
		`expense:${id}`
	);
}

export async function loadExistingExpenseContext(id: string): Promise<ExistingExpenseContext> {
	const [expense, categoryData] = await Promise.all([
		apiGet<Expense>(`/api/expenses/${id}`),
		apiGet<{ categories: Category[] }>('/api/categories')
	]);
	return {
		expense,
		categories: activeCategories(categoryData.categories ?? [])
	};
}

export async function updateExpense(
	id: string,
	expense: Expense,
	value: ExpenseFormValue
): Promise<WriteResult<Expense>> {
	return apiWrite<Expense>(
		'PUT',
		`/api/expenses/${id}`,
		{
			amount: value.amount,
			currency: expense.currency,
			category_id: value.category_id,
			merchant: value.merchant,
			description: expense.description ?? '',
			date: value.date,
			client_updated_at: nowMillis()
		},
		`expense:${id}`
	);
}

export async function deleteExpense(id: string): Promise<WriteResult<void>> {
	return apiWrite<void>('DELETE', `/api/expenses/${id}`, null, `expense:${id}`);
}

function expensesURL(range: ExpenseRange, beforeOverride?: number): string {
	const bounds = rangeBounds(range);
	const params = new URLSearchParams({
		since: String(bounds.since),
		before: String(beforeOverride ?? bounds.before)
	});
	return `/api/expenses?${params.toString()}`;
}
