<script lang="ts">
	import { onMount } from 'svelte';
	import { apiGet, apiWrite, ApiError } from '$lib/api';
	import type { Category, Expense, ExpenseListResponse } from '$lib/types';
	import { dayKey, displayCategoryIcon, formatDate, formatMoney, formatTime } from '$lib/util';

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

	let expenses = $state<Expense[]>([]);
	let categories = $state<Category[]>([]);
	let cursor = $state<number | undefined>(undefined);
	let loading = $state(true);
	let loadingMore = $state(false);
	let error = $state('');

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

	const monthlyTotal = $derived.by(() => {
		const now = new Date();
		const currentMonth = now.getMonth();
		const currentYear = now.getFullYear();
		let total = 0;
		let currency = 'SGD';
		for (const e of expenses) {
			const d = new Date(e.date * 1000);
			if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
				total += e.amount;
				currency = e.currency;
			}
		}
		return { total, currency };
	});

	async function loadFirstPage() {
		loading = true;
		error = '';
		try {
			const [expenseData, categoryData] = await Promise.all([
				apiGet<ExpenseListResponse>('/api/expenses'),
				apiGet<{ categories: Category[] }>('/api/categories')
			]);
			expenses = expenseData.expenses ?? [];
			categories = (categoryData.categories ?? []).filter((category) => !category.deleted_at);
			cursor = expenseData.next_before;
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
			const data = await apiGet<ExpenseListResponse>(`/api/expenses?before=${cursor}`);
			expenses = [...expenses, ...(data.expenses ?? [])];
			cursor = data.next_before;
		} catch (e) {
			if (e instanceof ApiError && e.status !== 401) error = e.message;
		} finally {
			loadingMore = false;
		}
	}

	async function remove(id: string) {
		if (!confirm('Delete this expense?')) return;
		const before = expenses;
		expenses = expenses.filter((e) => e.id !== id);
		const result = await apiWrite<void>('DELETE', `/api/expenses/${id}`, null, `expense:${id}`);
		if (result.kind === 'error') {
			expenses = before;
			error = result.error.message;
		}
	}

	function formatMonthlyAmount(cents: number): string {
		const major = cents / 100;
		return major.toFixed(2);
	}

	onMount(loadFirstPage);
</script>

<!-- Monthly total header -->
<div class="monthly-header">
	<div class="monthly-label">
		<span>Spent</span>
		<span class="month-pill">this month</span>
	</div>
	<div class="monthly-amount">
		<span class="currency">{monthlyTotal.currency}</span>
		<span class="amount">{formatMonthlyAmount(monthlyTotal.total)}</span>
	</div>
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
{:else if expenses.length === 0}
	<div class="empty-state">
		<div class="empty-icon">📥</div>
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
		padding: 20px 0 16px;
	}

	.monthly-label {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		font-size: 16px;
		font-weight: 600;
		color: #1a1a1a;
	}

	.month-pill {
		padding: 2px 10px;
		border: 1.5px solid #e8e8e8;
		border-radius: 999px;
		font-size: 16px;
		font-weight: 600;
	}

	.monthly-amount {
		margin-top: 8px;
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 3px;
	}

	.monthly-amount .currency {
		font-size: 22px;
		font-weight: 400;
		color: #999;
	}

	.monthly-amount .amount {
		font-size: 38px;
		font-weight: 400;
		letter-spacing: -1px;
	}

	@media (min-width: 640px) {
		.monthly-amount .currency { font-size: 28px; }
		.monthly-amount .amount { font-size: 48px; }
		.monthly-label { font-size: 18px; }
		.month-pill { font-size: 18px; }
	}

	/* Empty State */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 60px 16px;
		text-align: center;
	}

	.empty-icon {
		font-size: 40px;
		margin-bottom: 12px;
		opacity: 0.6;
	}

	.empty-title {
		margin: 0;
		font-size: 18px;
		font-weight: 700;
		color: #1a1a1a;
	}

	.empty-desc {
		margin: 4px 0 0;
		font-size: 14px;
		color: #999;
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
		bottom: calc(70px + env(safe-area-inset-bottom, 0px));
		right: 16px;
		width: 52px;
		height: 52px;
		border-radius: 50%;
		background: #007AFF;
		color: white;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 4px 14px rgba(0, 122, 255, 0.3);
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
			width: 56px;
			height: 56px;
			right: 20px;
			bottom: 90px;
		}
	}
</style>
