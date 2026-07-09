<script lang="ts">
	import { onMount } from 'svelte';
	import { ApiError } from '$lib/api';
	import { categoryIcon } from '$lib/features/categories';
	import {
		draftFromRecurring,
		emptyRecurringDraft,
		loadRecurringPage,
		recurringCategoryIcon,
		recurringCategoryName,
		saveRecurringExpense,
		scheduleSummary,
		type RecurringDraft
	} from '$lib/features/recurring';
	import type { Category, Preferences, RecurringExpense } from '$lib/types';
	import {
		formatDate,
		formatMoney
	} from '$lib/util';

	let rows = $state<RecurringExpense[]>([]);
	let categories = $state<Category[]>([]);
	let prefs = $state<Preferences | null>(null);
	let loading = $state(true);
	let error = $state('');

	let showForm = $state(false);
	let draft = $state<RecurringDraft>(emptyRecurringDraft('USD', ''));
	let defaultCategoryId = $state('');
	let busy = $state(false);

	async function load() {
		loading = true;
		try {
			const model = await loadRecurringPage();
			rows = model.rows;
			categories = model.categories;
			prefs = model.prefs;
			defaultCategoryId = model.defaultCategoryId;
			if (!showForm) draft = emptyRecurringDraft(model.prefs.currency, model.defaultCategoryId);
		} catch (e) {
			if (e instanceof ApiError && e.status !== 401) error = e.message;
		} finally {
			loading = false;
		}
	}

	function reset() {
		showForm = false;
		draft = emptyRecurringDraft(prefs?.currency ?? 'USD', defaultCategoryId);
		error = '';
	}

	function startEdit(row: RecurringExpense) {
		draft = draftFromRecurring(row);
		showForm = true;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		busy = true;
		const result = await saveRecurringExpense(draft);
		busy = false;
		if (result.kind === 'validation-error') {
			error = result.message;
			return;
		}
		if (result.kind === 'error') {
			error = result.error.message;
			return;
		}
		reset();
		await load();
	}

	onMount(load);
</script>

{#if showForm}
	<button type="button" class="shared-modal-overlay" onclick={reset} aria-label="Close modal"></button>
	<div class="shared-modal">
		<div class="shared-modal-header">
			<h3>{draft.editingId ? 'Edit Recurring' : 'New Recurring'}</h3>
			<button type="button" class="shared-modal-close" onclick={reset} aria-label="Close">
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
					<input type="number" step="0.01" min="0" inputmode="decimal" bind:value={draft.amountText} required />
				</label>
				<label>
					<span>Currency</span>
					<input type="text" maxlength="3" bind:value={draft.currency} required />
				</label>
			</div>
			<label>
				<span>Category</span>
				<select bind:value={draft.categoryId} required>
					{#each categories as cat}
						<option value={cat.id}>{categoryIcon(cat)} {cat.name}</option>
					{/each}
				</select>
			</label>
			<label>
				<span>Merchant</span>
				<input type="text" bind:value={draft.merchant} />
			</label>
			<label>
				<span>Note</span>
				<input type="text" bind:value={draft.description} />
			</label>
			<label>
				<span>Frequency</span>
				<select bind:value={draft.frequency}>
					<option value="weekly">Weekly</option>
					<option value="monthly">Monthly</option>
					<option value="yearly">Yearly</option>
				</select>
			</label>
			{#if draft.frequency === 'monthly'}
				<label>
					<span>Day of month</span>
					<input type="number" min="1" max="31" bind:value={draft.dayOfMonthText} placeholder="1" />
				</label>
			{/if}
			<div class="form-grid">
				<label>
					<span>Start date</span>
					<input type="date" bind:value={draft.startDate} required />
				</label>
				<label>
					<span>End date</span>
					<input type="date" bind:value={draft.endDate} />
				</label>
			</div>
			{#if error}<p class="shared-error">{error}</p>{/if}
			<button type="submit" class="shared-submit-btn" disabled={busy}>
				{draft.editingId ? 'Save Changes' : 'Add Recurring'}
			</button>
		</form>
	</div>
{/if}

{#if loading}
	<div class="shared-empty-state">
		<div class="shared-empty-icon">⏳</div>
		<p class="shared-empty-title">Loading…</p>
	</div>
{:else if rows.length === 0}
	<div class="shared-empty-state">
		<div class="shared-empty-icon">🔄</div>
		<p class="shared-empty-title">No Recurring Expenses</p>
		<p class="shared-empty-desc">Add rent, subscriptions, or bills that repeat automatically</p>
	</div>
{:else}
	<div class="recurring-list">
		{#each rows as row (row.id)}
			<button type="button" class="recurring-row" onclick={() => startEdit(row)}>
				<div class="row-icon-circle">
					{recurringCategoryIcon(categories, row.category_id)}
				</div>
				<div class="row-info">
					<div class="row-merchant">{row.merchant || row.description || recurringCategoryName(categories, row.category_id)}</div>
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

<button type="button" class="shared-fab" onclick={() => { showForm = true; }} aria-label="Add Recurring">
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
		margin-top: 20px;
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
		font-size: 17px;
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
		max-width: 42%;
	}

	.row-amount {
		font-size: 17px;
		font-weight: 600;
		white-space: nowrap;
	}

	.row-next {
		font-size: 13px;
		color: #888;
		margin-top: 2px;
		white-space: nowrap;
	}

	.shared-modal {
		--modal-max-height: 85vh;
	}

	.form-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 10px;
	}

	@media (min-width: 360px) {
		.form-grid {
			grid-template-columns: 1fr 1fr;
		}
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
		width: 100%;
		min-height: 48px;
		padding: 12px 14px;
		border: 1.5px solid #e0e0e0;
		border-radius: 12px;
		font-size: 16px;
		background: #fafafa;
	}

	.shared-submit-btn {
		margin-top: 4px;
	}
</style>
