<script lang="ts">
	import { untrack } from 'svelte';
	import { pickDefaultCategoryId } from './default-category';
	import type { Category, Expense } from './types';
	import {
		dateTimeInputValue,
		displayCategoryIcon,
		parseAmount,
		unixFromDateTimeInput
	} from './util';

	type FormValue = {
		amount: number;
		currency: string;
		category_id: string;
		merchant: string;
		description: string;
		date: number;
	};

	let {
		initial,
		categories,
		defaultCurrency,
		submitLabel = 'Save',
		onSubmit,
		onCancel,
		defaultCategoryId = ''
	}: {
		initial?: Partial<Expense>;
		categories: Category[];
		defaultCurrency: string;
		submitLabel?: string;
		onSubmit: (value: FormValue) => void | Promise<void>;
		onCancel?: () => void;
		defaultCategoryId?: string;
	} = $props();

	let amountText = $state(
		untrack(() => (initial?.amount != null ? (initial.amount / 100).toFixed(2) : ''))
	);
	let currency = $state(untrack(() => initial?.currency || defaultCurrency));
	let categoryId = $state(
		untrack(() => initial?.category_id || pickDefaultCategoryId(categories, defaultCategoryId))
	);
	let merchant = $state(untrack(() => initial?.merchant || ''));
	let description = $state(untrack(() => initial?.description || ''));
	let dateValue = $state(
		untrack(() => dateTimeInputValue(initial?.date ?? Math.floor(Date.now() / 1000)))
	);

	let error = $state('');
	let busy = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		const amount = parseAmount(amountText);
		if (amount == null || amount <= 0) {
			error = 'Enter an amount greater than zero.';
			return;
		}
		if (!categoryId) {
			error = 'Pick a category first (add one under the Categories tab).';
			return;
		}
		busy = true;
		try {
			await onSubmit({
				amount,
				currency: currency.toUpperCase(),
				category_id: categoryId,
				merchant: merchant.trim(),
				description: description.trim(),
				date: unixFromDateTimeInput(dateValue)
			});
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={submit}>
	<div class="form-grid">
		<label class="field">
			<span class="field-label">Amount</span>
			<input
				type="number"
				step="0.01"
				min="0"
				inputmode="decimal"
				bind:value={amountText}
				required
			/>
		</label>
		<label class="field">
			<span class="field-label">Currency</span>
			<input type="text" maxlength="3" bind:value={currency} required />
		</label>
	</div>

	<label class="field">
		<span class="field-label">Category</span>
		<select bind:value={categoryId} required>
			{#each categories as cat}
				<option value={cat.id}>{displayCategoryIcon(cat)} {cat.name}</option>
			{/each}
		</select>
	</label>

	<label class="field">
		<span class="field-label">Merchant</span>
		<input type="text" placeholder="Where did you spend?" bind:value={merchant} />
	</label>

	<label class="field">
		<span class="field-label">Note</span>
		<input type="text" placeholder="Optional note" bind:value={description} />
	</label>

	<label class="field">
		<span class="field-label">Date</span>
		<input type="datetime-local" bind:value={dateValue} required />
	</label>

	{#if error}<p class="error">{error}</p>{/if}

	<div class="actions">
		<button type="submit" class="btn-submit" disabled={busy}>{submitLabel}</button>
		{#if onCancel}
			<button type="button" class="btn-cancel" onclick={onCancel} disabled={busy}>Cancel</button>
		{/if}
	</div>
</form>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.form-grid {
		display: grid;
		grid-template-columns: 1fr 100px;
		gap: 10px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.field-label {
		font-size: 13px;
		font-weight: 600;
		color: #666;
	}

	input,
	select {
		padding: 12px 14px;
		border: 1.5px solid #e0e0e0;
		border-radius: 12px;
		font-size: 16px;
		background: #fafafa;
		transition: border-color 0.15s;
	}

	input:focus,
	select:focus {
		outline: none;
		border-color: #007AFF;
		background: white;
	}

	input::placeholder {
		color: #bbb;
	}

	.actions {
		display: flex;
		gap: 10px;
		margin-top: 8px;
	}

	.btn-submit {
		flex: 1;
		padding: 14px;
		border: none;
		border-radius: 12px;
		background: #1a1a1a;
		color: white;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
	}

	.btn-submit:disabled {
		opacity: 0.5;
	}

	.btn-cancel {
		flex: 1;
		padding: 14px;
		border: 1.5px solid #e0e0e0;
		border-radius: 12px;
		background: white;
		color: #1a1a1a;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
	}

	.error {
		margin: 0;
		padding: 10px 14px;
		background: #fef2f2;
		color: #dc2626;
		border-radius: 10px;
		font-size: 14px;
		font-weight: 500;
	}
</style>
