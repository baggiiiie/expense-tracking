import { apiGet, apiWrite, type WriteResult } from '$lib/api';
import type { Category, Expense, Preferences, WalletSuggestion } from '$lib/types';
import { newId, nowMillis } from '$lib/util';
import { activeCategories } from './categories';

export type SuggestionInboxModel = {
	suggestions: WalletSuggestion[];
	categories: Category[];
	prefs: Preferences;
};

export type ConfirmSuggestionValue = {
	amount: number;
	currency: string;
	category_id: string;
	merchant: string;
	description: string;
	date: number;
};

export async function loadSuggestionInbox(): Promise<SuggestionInboxModel> {
	const [suggestionData, categoryData, prefs] = await Promise.all([
		apiGet<{ wallet_suggestions: WalletSuggestion[] }>('/api/wallet-suggestions?status=pending'),
		apiGet<{ categories: Category[] }>('/api/categories'),
		apiGet<Preferences>('/api/preferences')
	]);
	return {
		suggestions: suggestionData.wallet_suggestions ?? [],
		categories: activeCategories(categoryData.categories ?? []),
		prefs
	};
}

export async function confirmSuggestion(
	suggestionId: string,
	value: ConfirmSuggestionValue
): Promise<WriteResult<{ wallet_suggestion: WalletSuggestion; expense: Expense }>> {
	return apiWrite<{ wallet_suggestion: WalletSuggestion; expense: Expense }>(
		'POST',
		`/api/wallet-suggestions/${suggestionId}/confirm`,
		{ ...value, id: newId(), client_updated_at: nowMillis() },
		`wallet_suggestion:${suggestionId}`
	);
}

export async function dismissSuggestion(
	suggestionId: string
): Promise<WriteResult<WalletSuggestion>> {
	return apiWrite<WalletSuggestion>(
		'POST',
		`/api/wallet-suggestions/${suggestionId}/dismiss`,
		null,
		`wallet_suggestion:${suggestionId}`
	);
}
