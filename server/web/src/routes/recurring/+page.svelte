<script lang="ts">
	import { onMount } from 'svelte';
	import { apiGet, apiWrite, ApiError } from '$lib/api';
	import type { Category, Preferences, RecurringExpense } from '$lib/types';
	import {
		dateInputValue,
		displayCategoryIcon,
		formatDate,
		formatMoney,
		nowMillis,
		nowSeconds,
		parseAmount,
		unixFromDateInput
	} from '$lib/util';

	let rows = $state<RecurringExpense[]>([]);
	let categories = $state<Category[]>([]);
	let prefs = $state<Preferences | null>(null);
	let loading = $state(true);
	let error = $state('');

	let showForm = $state(false);
	let editingId = $state<string | null>(null);
	let amountText = $state('');
	let currency = $state('USD');
	let categoryId = $state('');
	let merchant = $state('');
	let description = $state('');
	let frequency = $state<'weekly' | 'monthly' | 'yearly'>('monthly');
	let dayOfMonthText = $state('');
	let startDate = $state(dateInputValue(nowSeconds()));
	let endDate = $state('');
	let busy = $state(false);

	const categoryName = $derived((id: string) => categories.find((c) => c.id === id)?.name ?? '—');
	const categoryIcon = $derived((id: string) => {
		const cat = categories.find((c) => c.id === id);
		return cat ? displayCategoryIcon(cat) : '💸';
	});

	function scheduleSummary(row: RecurringExpense): string {
		switch (row.frequency) {
			case 'weekly': return 'Every week';
			case 'monthly': return `Every month on day ${row.day_of_month ?? 1}`;
			case 'yearly': return 'Every year';
			default: return row.frequency;
		}
	}

	async function load() {
		loading = true;
		try {
			const [r, c, p] = await Promise.all([
				apiGet<{ recurring_expenses: RecurringExpense[] }>('/api/recurring-expenses'),
				apiGet<{ categories: Category[] }>('/api/categories'),
				apiGet<Preferences>('/api/preferences')
			]);
			rows = (r.recurring_expenses ?? []).filter((x) => !x.deleted_at);
			categories = (c.categories ?? []).filter((x) => !x.deleted_at);
			prefs = p;
			if (!currency || currency === 'USD') currency = p.currency;
			if (!categoryId && categories[0]) categoryId = categories[0].id;
		} catch (e) {
			if (e instanceof ApiError && e.status !== 401) error = e.message;
		} finally {
			loading = false;
		}
	}

	function reset() {
		editingId = null;
		showForm = false;
		amountText = '';
		merchant = '';
		description = '';
		frequency = 'monthly';
		dayOfMonthText = '';
		startDate = dateInputValue(nowSeconds());
		endDate = '';
		error = '';
	}

	function startEdit(row: RecurringExpense) {
		editingId = row.id;
		amountText = (row.amount / 100).toFixed(2);
		currency = row.currency;
		categoryId = row.category_id;
		merchant = row.merchant;
		description = row.description;
		frequency = (row.frequency as 'weekly' | 'monthly' | 'yearly') || 'monthly';
		dayOfMonthText = row.day_of_month != null ? String(row.day_of_month) : '';
		startDate = dateInputValue(row.start_date);
		endDate = row.end_date != null ? dateInputValue(row.end_date) : '';
		showForm = true;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		const amount = parseAmount(amountText);
		if (amount == null || amount <= 0) {
			error = 'Enter an amount greater than zero.';
			return;
		}
		if (!categoryId) {
			error = 'Pick a category.';
			return;
		}
		busy = true;

		const dayOfMonth =
			frequency === 'monthly' && dayOfMonthText.trim() !== ''
				? Number(dayOfMonthText)
				: null;

		const body = {
			amount,
			currency: currency.toUpperCase(),
			category_id: categoryId,
			merchant: merchant.trim(),
			description: description.trim(),
			frequency,
			day_of_month: dayOfMonth,
			start_date: unixFromDateInput(startDate),
			end_date: endDate ? unixFromDateInput(endDate) : null,
			client_updated_at: nowMillis()
		};

		const url = editingId ? `/api/recurring-expenses/${editingId}` : '/api/recurring-expenses';
		const method = editingId ? 'PUT' : 'POST';
		const targetKey = `recurring:${editingId ?? 'new'}:${nowMillis()}`;

		const result = await apiWrite<RecurringExpense>(method, url, body, targetKey);
		busy = false;
		if (result.kind === 'error') {
			error = result.error.message;
			return;
		}
		reset();
		await load();
	}

	async function remove(id: string) {
		if (!confirm('Delete this recurring expense?')) return;
		const before = rows;
		rows = rows.filter((r) => r.id !== id);
		const result = await apiWrite<void>('DELETE', `/api/recurring-expenses/${id}`, null, `recurring:${id}`);
		if (result.kind === 'error') {
			rows = before;
			error = result.error.message;
		}
	}

	onMount(load);
</script>

{#if showForm}
	<div class="modal-overlay" onclick={reset}></div>
	<div class="modal">
		<div class="modal-header">
			<h3>{editingId ? 'Edit Recurring' : 'New Recurring'}</h3>
			<button type="button" class="modal-close" onclick={reset} aria-label="Close">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
					<line x1="18" y1="6" x2="6" y2="18"/>
					<line x1="6" y1="6" x2="18" y2="18"/>
				</svg>
			</button>
		</div>
		<form onsubmit={submit}>
			<div class="form-grid">
				<label>
					<span>Amount</span>
					<input type="number" step="0.01" min="0" inputmode="decimal" bind:value={amountText} required />
				</label>
				<label>
					<span>Currency</span>
					<input type="text" maxlength="3" bind:value={currency} required />
				</label>
			</div>
			<label>
				<span>Category</span>
				<select bind:value={categoryId} required>
					{#each categories as cat}
						<option value={cat.id}>{displayCategoryIcon(cat)} {cat.name}</option>
					{/each}
				</select>
			</label>
			<label>
				<span>Merchant</span>
				<input type="text" bind:value={merchant} />
			</label>
			<label>
				<span>Note</span>
				<input type="text" bind:value={description} />
			</label>
			<label>
				<span>Frequency</span>
				<select bind:value={frequency}>
					<option value="weekly">Weekly</option>
					<option value="monthly">Monthly</option>
					<option value="yearly">Yearly</option>
				</select>
			</label>
			{#if frequency === 'monthly'}
				<label>
					<span>Day of month</span>
					<input type="number" min="1" max="31" bind:value={dayOfMonthText} placeholder="1" />
				</label>
			{/if}
			<div class="form-grid">
				<label>
					<span>Start date</span>
					<input type="date" bind:value={startDate} required />
				</label>
				<label>
					<span>End date</span>
					<input type="date" bind:value={endDate} />
				</label>
			</div>
			{#if error}<p class="error">{error}</p>{/if}
			<button type="submit" class="submit-btn" disabled={busy}>
				{editingId ? 'Save Changes' : 'Add Recurring'}
			</button>
		</form>
	</div>
{/if}

{#if loading}
	<div class="empty-state">
		<div class="empty-icon">⏳</div>
		<p class="empty-title">Loading…</p>
	</div>
{:else if rows.length === 0}
	<div class="empty-state">
		<div class="empty-icon">🔄</div>
		<p class="empty-title">No Recurring Expenses</p>
		<p class="empty-desc">Add rent, subscriptions, or bills that repeat automatically</p>
	</div>
{:else}
	<div class="recurring-list">
		{#each rows as row (row.id)}
			<button type="button" class="recurring-row" onclick={() => startEdit(row)}>
				<div class="row-icon-circle">
					{categoryIcon(row.category_id)}
				</div>
				<div class="row-info">
					<div class="row-merchant">{row.merchant || row.description || categoryName(row.category_id)}</div>
					<div class="row-schedule">{scheduleSummary(row)}</div>
				</div>
				<div class="row-right">
					<div class="row-amount">{formatMoney(row.amount, row.currency)}</div>
					<div class="row-next">{formatDate(row.next_run_date)}</div>
				</div>
			</button>
		{/each}
	</div>
{/if}

<button type="button" class="fab" onclick={() => { showForm = true; }} aria-label="Add Recurring">
	<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
		<line x1="12" y1="5" x2="12" y2="19"/>
		<line x1="5" y1="12" x2="19" y2="12"/>
	</svg>
</button>

<style>
	/* List */
	.recurring-list {
		display: flex;
		flex-direction: column;
		margin-top: 12px;
	}

	.recurring-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 4px;
		border: none;
		border-bottom: 0.5px solid #f2f2f2;
		background: none;
		cursor: pointer;
		text-align: left;
		width: 100%;
		color: inherit;
		min-height: 56px;
		-webkit-tap-highlight-color: transparent;
	}

	.recurring-row:active {
		background: #f8f8f8;
		border-radius: 10px;
	}

	.recurring-row:last-child {
		border-bottom: none;
	}

	.row-icon-circle {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: #007AFF;
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
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.row-schedule {
		font-size: 13px;
		color: #888;
		margin-top: 2px;
	}

	.row-right {
		text-align: right;
		flex-shrink: 0;
	}

	.row-amount {
		font-size: 15px;
		font-weight: 600;
	}

	.row-next {
		font-size: 13px;
		color: #888;
		margin-top: 2px;
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
	}

	.empty-desc {
		margin: 4px 0 0;
		font-size: 14px;
		color: #999;
	}

	/* Modal */
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.3);
		z-index: 50;
	}

	.modal {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		max-height: 85vh;
		overflow-y: auto;
		background: white;
		border-radius: 20px 20px 0 0;
		padding: 20px;
		padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 20px);
		z-index: 51;
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 20px;
	}

	.modal-header h3 {
		margin: 0;
		font-size: 18px;
		font-weight: 700;
	}

	.modal-close {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		border: none;
		background: #f5f5f5;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.form-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	label span {
		font-size: 13px;
		font-weight: 600;
		color: #666;
	}

	input, select {
		padding: 12px 14px;
		border: 1.5px solid #e0e0e0;
		border-radius: 12px;
		font-size: 16px;
		background: #fafafa;
	}

	.submit-btn {
		padding: 14px;
		border: none;
		border-radius: 12px;
		background: #1a1a1a;
		color: white;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		margin-top: 4px;
	}

	.submit-btn:disabled {
		opacity: 0.5;
	}

	.error {
		margin: 0;
		color: #dc2626;
		font-size: 14px;
		font-weight: 500;
	}

	/* FAB */
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
		border: none;
		cursor: pointer;
		z-index: 5;
		-webkit-tap-highlight-color: transparent;
	}

	.fab:active {
		transform: scale(0.9);
	}
</style>
