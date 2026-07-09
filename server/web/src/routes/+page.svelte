<script lang="ts">
	import { onMount } from 'svelte';
	import { ApiError } from '$lib/api';
	import {
		categoryColor,
		categoryIcon,
		categoryLookup,
		expenseCategory
	} from '$lib/features/categories';
	import {
		formatSummaryAmount,
		groupExpenses,
		initialExpenseRange,
		loadExpenseFeed,
		loadOlderExpenses,
		rangeValidationError,
		summarizeExpenses,
		type ExpenseRange,
		type ExpenseRangePreset
	} from '$lib/features/expenses';
	import type { Category, Expense } from '$lib/types';
	import {
		formatDate,
		formatMoney,
		formatTime
	} from '$lib/util';

	const initialRange = initialExpenseRange();

	let expenses = $state<Expense[]>([]);
	let categories = $state<Category[]>([]);
	let cursor = $state<number | undefined>(undefined);
	let loading = $state(true);
	let loadingMore = $state(false);
	let error = $state('');
	let rangePreset = $state<ExpenseRangePreset>(initialRange.preset);
	let customStart = $state(initialRange.customStart);
	let customEnd = $state(initialRange.customEnd);
	let rangeTotal = $state(0);
	let pendingSuggestionCount = $state(0);

	const categoriesById: Map<string, Category> = $derived.by(() => categoryLookup(categories));
	const groups = $derived.by(() => groupExpenses(expenses));

	const summaryTotal = $derived.by(() => summarizeExpenses(expenses, rangeTotal));

	function currentRange(): ExpenseRange {
		return { preset: rangePreset, customStart, customEnd };
	}

	async function loadFirstPage() {
		const range = currentRange();
		const validationError = rangeValidationError(range);
		if (validationError) {
			error = validationError;
			return;
		}
		loading = true;
		error = '';
		try {
			const model = await loadExpenseFeed(range);
			expenses = model.expenses;
			categories = model.categories;
			cursor = model.cursor;
			rangeTotal = model.rangeTotal;
			pendingSuggestionCount = model.pendingSuggestionCount;
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
			const data = await loadOlderExpenses(currentRange(), cursor);
			expenses = [...expenses, ...(data.expenses ?? [])];
			cursor = data.cursor;
		} catch (e) {
			if (e instanceof ApiError && e.status !== 401) error = e.message;
		} finally {
			loadingMore = false;
		}
	}

	async function changeRange(event: Event) {
		rangePreset = (event.currentTarget as HTMLSelectElement).value as ExpenseRangePreset;
		await loadFirstPage();
	}

	async function applyCustomRange() {
		await loadFirstPage();
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
		<span class="amount">{formatSummaryAmount(summaryTotal.total)}</span>
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
					{@const category = expenseCategory(exp, categoriesById)}
					<a class="expense-row" href={`/expenses/${exp.id}`}>
						<div class="row-icon" style="background: {categoryColor(category.name)}20; color: {categoryColor(category.name)}">
							{categoryIcon(category)}
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
		padding: 56px 0 18px;
	}

	.monthly-label {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
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
		max-width: 100%;
		min-height: 38px;
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
		max-width: 100%;
	}

	.custom-range input,
	.custom-range button {
		padding: 7px 8px;
		border: 1.5px solid #e5e5ea;
		border-radius: 10px;
		background: white;
		font-size: 13px;
		font-weight: 600;
		min-height: 38px;
	}

	.custom-range input {
		flex: 1 1 118px;
		min-width: 0;
		max-width: 150px;
	}

	.custom-range button {
		border-color: #007AFF;
		background: #007AFF;
		color: white;
		cursor: pointer;
		flex: 0 0 auto;
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
		font-size: 52px;
		font-weight: 400;
		letter-spacing: 0;
	}

	@media (min-height: 740px) {
		.monthly-header {
			padding-top: 78px;
		}

		.monthly-amount .amount {
			font-size: 56px;
		}
	}

	/* Empty State */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 96px 12px 52px;
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

	@media (min-height: 740px) {
		.empty-state {
			padding-top: 152px;
		}
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
