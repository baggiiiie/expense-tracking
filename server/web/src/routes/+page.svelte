<script lang="ts">
	import { onMount } from 'svelte';
	import { apiGet, ApiError } from '$lib/api';
	import type { Category, Expense, ExpenseListResponse, WalletSuggestion } from '$lib/types';
	import {
		dateInputValue,
		dayKey,
		displayCategoryIcon,
		formatDate,
		formatMoney,
		formatTime,
		nowSeconds,
		unixFromDateInput
	} from '$lib/util';

	const categoryColors: Record<string, string> = {
		'Food': '#FF9500',
		'Transport': '#007AFF',
		'Shopping': '#FF2D55',
		'Entertainment': '#AF52DE',
		'Bills': '#FF3B30',
		'Health': '#34C759',
		'Education': '#5856D6',
		'Travel': '#00C7BE',
		'Other': '#8E8E93',
	};

	function getCategoryColor(category: string): string {
		return categoryColors[category] || '#8E8E93';
	}

	type RangePreset = 'month' | 'week' | 'custom';

	const initialCustomStart = (() => {
		const now = new Date();
		return dateInputValue(Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000));
	})();

	let expenses = $state<Expense[]>([]);
	let categories = $state<Category[]>([]);
	let cursor = $state<number | undefined>(undefined);
	let loading = $state(true);
	let loadingMore = $state(false);
	let error = $state('');
	let rangePreset = $state<RangePreset>('month');
	let customStart = $state(initialCustomStart);
	let customEnd = $state(dateInputValue(nowSeconds()));
	let rangeTotal = $state(0);
	let pendingSuggestionCount = $state(0);

	const categoriesById: Map<string, Category> = $derived.by(
		() => new Map(categories.map((category) => [category.id, category]))
	);

	function getExpenseCategory(expense: Expense): Category {
		return categoriesById.get(expense.category_id) ?? {
			id: expense.category_id,
			name: expense.category || 'Other',
			icon: '',
			budget: null,
			created_at: 0,
			updated_at: 0,
			client_updated_at: 0
		};
	}

	type Group = { dayKey: string; date: number; items: Expense[]; dailyTotal: number };
	const groups: Group[] = $derived.by(() => {
		const map = new Map<string, Group>();
		for (const e of expenses) {
			const key = dayKey(e.date);
			const existing = map.get(key);
			if (existing) {
				existing.items.push(e);
				existing.dailyTotal += e.amount;
			} else {
				map.set(key, { dayKey: key, date: e.date, items: [e], dailyTotal: e.amount });
			}
		}
		return Array.from(map.values()).sort((a, b) => b.date - a.date);
	});

	const summaryTotal = $derived.by(() => ({
		total: rangeTotal,
		currency: expenses.find((e) => e.currency)?.currency ?? 'SGD'
	}));

	function rangeBounds(): { since: number; before: number } {
		const now = new Date();
		const beforeNow = Math.floor(Date.now() / 1000) + 1;
		if (rangePreset === 'week') {
			const start = new Date(now);
			start.setHours(0, 0, 0, 0);
			start.setDate(start.getDate() - start.getDay());
			return { since: Math.floor(start.getTime() / 1000), before: beforeNow };
		}
		if (rangePreset === 'custom') {
			const since = unixFromDateInput(customStart);
			const end = new Date(unixFromDateInput(customEnd) * 1000);
			end.setDate(end.getDate() + 1);
			return { since, before: Math.floor(end.getTime() / 1000) };
		}
		const start = new Date(now.getFullYear(), now.getMonth(), 1);
		return { since: Math.floor(start.getTime() / 1000), before: beforeNow };
	}

	function expensesURL(beforeOverride?: number): string {
		const bounds = rangeBounds();
		const params = new URLSearchParams({
			since: String(bounds.since),
			before: String(beforeOverride ?? bounds.before)
		});
		return `/api/expenses?${params.toString()}`;
	}

	async function loadFirstPage() {
		const bounds = rangeBounds();
		if (bounds.before <= bounds.since) {
			error = 'Choose an end date after the start date.';
			return;
		}
		loading = true;
		error = '';
		try {
			const [expenseData, categoryData, suggestionData] = await Promise.all([
				apiGet<ExpenseListResponse>(expensesURL()),
				apiGet<{ categories: Category[] }>('/api/categories'),
				apiGet<{ wallet_suggestions: WalletSuggestion[]; count: number }>('/api/wallet-suggestions?status=pending')
			]);
			expenses = expenseData.expenses ?? [];
			categories = (categoryData.categories ?? []).filter((category) => !category.deleted_at);
			cursor = expenseData.next_before;
			rangeTotal = expenseData.total ?? expenses.reduce((sum, e) => sum + e.amount, 0);
			pendingSuggestionCount = suggestionData.count ?? suggestionData.wallet_suggestions?.length ?? 0;
		} catch (e) {
			if (e instanceof ApiError && e.status !== 401) error = e.message;
			else if (!(e instanceof ApiError)) error = String(e);
		} finally {
			loading = false;
		}
	}

	async function loadMore() {
		if (loadingMore || cursor == null) return;
		loadingMore = true;
		try {
			const data = await apiGet<ExpenseListResponse>(expensesURL(cursor));
			expenses = [...expenses, ...(data.expenses ?? [])];
			cursor = data.next_before;
		} catch (e) {
			if (e instanceof ApiError && e.status !== 401) error = e.message;
		} finally {
			loadingMore = false;
		}
	}

	async function changeRange(event: Event) {
		rangePreset = (event.currentTarget as HTMLSelectElement).value as RangePreset;
		await loadFirstPage();
	}

	async function applyCustomRange() {
		await loadFirstPage();
	}

	function formatMonthlyAmount(cents: number): string {
		const major = cents / 100;
		return major.toFixed(2);
	}

	onMount(loadFirstPage);
</script>

<div class="monthly-header">
	<div class="monthly-label">
		<span>Spent</span>
		<label class="range-picker" aria-label="Summary range">
			<select value={rangePreset} onchange={changeRange}>
				<option value="month">this month</option>
				<option value="week">this week</option>
				<option value="custom">custom range</option>
			</select>
		</label>
	</div>
	<div class="monthly-amount">
		<span class="currency">{summaryTotal.currency}</span>
		<span class="amount">{formatMonthlyAmount(summaryTotal.total)}</span>
	</div>
	{#if rangePreset === 'custom'}
		<div class="custom-range">
			<input type="date" bind:value={customStart} aria-label="Custom start date" />
			<span>to</span>
			<input type="date" bind:value={customEnd} aria-label="Custom end date" />
			<button type="button" onclick={applyCustomRange}>Apply</button>
		</div>
	{/if}
</div>

{#if loading}
	<div class="empty-state">
		<div class="empty-icon">⏳</div>
		<p class="empty-title">Loading…</p>
	</div>
{:else if error}
	<div class="empty-state">
		<div class="empty-icon">⚠️</div>
		<p class="empty-title">Something went wrong</p>
		<p class="empty-desc">{error}</p>
		<button type="button" class="retry-btn" onclick={loadFirstPage}>Retry</button>
	</div>
{:else}
	{#if pendingSuggestionCount > 0}
		<a href="/suggestions" class="suggestion-link">
			<span class="suggestion-icon">💳</span>
			<span>{pendingSuggestionCount} pending suggestion{pendingSuggestionCount === 1 ? '' : 's'}</span>
			<span class="suggestion-chevron">›</span>
		</a>
	{/if}

	{#if expenses.length === 0}
		<div class="empty-state">
			<svg class="empty-icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M14 30h12a6 6 0 0 0 12 0h12" />
				<path d="M18 18h28l10 14v16a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6V32l10-14Z" />
			</svg>
			<p class="empty-title">No Expenses</p>
			<p class="empty-desc">Tap + to add your first expense</p>
		</div>
	{:else}
		{#each groups as group (group.dayKey)}
			<section class="day-section">
				<div class="day-header">
					<span>{formatDate(group.date)}</span>
					<span>{formatMoney(group.dailyTotal, expenses[0]?.currency)}</span>
				</div>
				{#each group.items as exp (exp.id)}
					{@const category = getExpenseCategory(exp)}
					<a class="expense-row" href={`/expenses/${exp.id}`}>
						<div class="row-icon" style="background: {getCategoryColor(category.name)}20; color: {getCategoryColor(category.name)}">
							{displayCategoryIcon(category)}
						</div>
						<div class="row-info">
							<div class="row-merchant">{exp.merchant || exp.description || exp.category}</div>
							<div class="row-time">{formatTime(exp.date)}</div>
						</div>
						<div class="row-amount">-{formatMoney(exp.amount, exp.currency)}</div>
					</a>
				{/each}
			</section>
		{/each}

		{#if cursor != null}
			<button type="button" class="loadmore" onclick={loadMore} disabled={loadingMore}>
				{loadingMore ? 'Loading…' : 'Load older'}
			</button>
		{/if}
	{/if}
{/if}

<!-- Floating Action Button -->
<a href="/expenses/new" class="fab" aria-label="Add Expense">
	<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
		<line x1="12" y1="5" x2="12" y2="19"/>
		<line x1="5" y1="12" x2="19" y2="12"/>
	</svg>
</a>

<style>
	/* Monthly Total Header — compact for mobile */
	.monthly-header {
		text-align: center;
		padding: 78px 0 16px;
	}

	.monthly-label {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		font-size: 24px;
		font-weight: 700;
		color: #1a1a1a;
	}

	.range-picker {
		position: relative;
		display: inline-flex;
	}

	.range-picker::after {
		content: '';
		position: absolute;
		top: 50%;
		right: 12px;
		width: 8px;
		height: 8px;
		border-right: 1.8px solid #8e8e93;
		border-bottom: 1.8px solid #8e8e93;
		transform: translateY(-65%) rotate(45deg);
		pointer-events: none;
	}

	.range-picker select {
		appearance: none;
		-webkit-appearance: none;
		padding: 2px 14px 3px;
		padding-right: 32px;
		border: 1.5px solid #e5e5ea;
		border-radius: 999px;
		font-size: 24px;
		font-weight: 700;
		background: white;
		color: #1a1a1a;
		cursor: pointer;
	}

	.custom-range {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		flex-wrap: wrap;
		margin: 14px auto 0;
		color: #777;
		font-size: 13px;
	}

	.custom-range input,
	.custom-range button {
		padding: 7px 8px;
		border: 1.5px solid #e5e5ea;
		border-radius: 10px;
		background: white;
		font-size: 13px;
		font-weight: 600;
	}

	.custom-range button {
		border-color: #007AFF;
		background: #007AFF;
		color: white;
		cursor: pointer;
	}

	.monthly-amount {
		margin-top: 28px;
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 4px;
	}

	.monthly-amount .currency {
		font-size: 32px;
		font-weight: 400;
		color: #8e8e93;
	}

	.monthly-amount .amount {
		font-size: 56px;
		font-weight: 400;
		letter-spacing: 0;
	}

	@media (min-width: 640px) {
		.monthly-header {
			padding-top: 86px;
		}
	}

	/* Empty State */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 152px 16px 60px;
		text-align: center;
	}

	.empty-icon {
		width: 66px;
		height: 66px;
		margin-bottom: 24px;
		color: #8e8e93;
	}

	.empty-title {
		margin: 0;
		font-size: 30px;
		font-weight: 800;
		color: #1a1a1a;
	}

	.empty-desc {
		margin: 8px 0 0;
		font-size: 18px;
		color: #8e8e93;
	}

	.retry-btn {
		margin-top: 14px;
		padding: 10px 20px;
		border: 1.5px solid #e0e0e0;
		border-radius: 10px;
		background: white;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}

	.suggestion-link {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		margin: 18px 0 4px;
		padding: 10px 0;
		border-bottom: 0.5px solid #f2f2f2;
		color: #1a1a1a;
		text-decoration: none;
		font-size: 16px;
		font-weight: 500;
		-webkit-tap-highlight-color: transparent;
	}

	.suggestion-icon {
		color: #007AFF;
		font-size: 19px;
	}

	.suggestion-chevron {
		margin-left: auto;
		color: #c7c7cc;
		font-size: 24px;
		line-height: 1;
	}

	/* Day Sections */
	.day-section {
		margin-top: 20px;
	}

	.day-header {
		display: flex;
		justify-content: space-between;
		padding: 0 2px 6px;
		font-size: 13px;
		font-weight: 600;
		color: #888;
	}

	/* Expense Row — touch-friendly */
	.expense-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 2px;
		text-decoration: none;
		color: inherit;
		border-bottom: 0.5px solid #f2f2f2;
		-webkit-tap-highlight-color: transparent;
		min-height: 56px;
	}

	.expense-row:last-child {
		border-bottom: none;
	}

	.expense-row:active {
		background: #f8f8f8;
		border-radius: 12px;
		margin: 0 -8px;
		padding: 10px 10px;
	}

	.row-icon {
		width: 40px;
		height: 40px;
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 18px;
		flex-shrink: 0;
	}

	.row-info {
		flex: 1;
		min-width: 0;
	}

	.row-merchant {
		font-size: 15px;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.row-time {
		font-size: 13px;
		color: #999;
		margin-top: 1px;
	}

	.row-amount {
		font-size: 15px;
		font-weight: 600;
		white-space: nowrap;
		flex-shrink: 0;
	}

	@media (min-width: 640px) {
		.row-icon { width: 44px; height: 44px; font-size: 20px; border-radius: 12px; }
		.row-merchant { font-size: 16px; }
		.row-amount { font-size: 17px; }
	}

	/* Load more */
	.loadmore {
		display: block;
		width: 100%;
		margin: 16px 0;
		padding: 12px;
		border: 1.5px solid #e8e8e8;
		background: white;
		border-radius: 12px;
		font-weight: 600;
		font-size: 14px;
		cursor: pointer;
		color: #666;
		-webkit-tap-highlight-color: transparent;
	}

	.loadmore:active {
		background: #f8f8f8;
	}

	/* FAB — positioned for thumb reach */
	.fab {
		position: fixed;
		bottom: calc(22px + env(safe-area-inset-bottom, 0px));
		right: 20px;
		width: 68px;
		height: 68px;
		border-radius: 50%;
		background: #007AFF;
		color: white;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 10px 30px rgba(0, 122, 255, 0.24);
		text-decoration: none;
		z-index: 5;
		-webkit-tap-highlight-color: transparent;
		transition: transform 0.12s ease;
	}

	.fab:active {
		transform: scale(0.9);
	}

	@media (min-width: 640px) {
		.fab {
			width: 68px;
			height: 68px;
			right: calc((100vw - 480px) / 2 + 20px);
			bottom: 28px;
		}
	}
</style>
