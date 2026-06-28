<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { apiGet, apiWrite, ApiError } from '$lib/api';
	import { pickDefaultCategoryId } from '$lib/default-category';
	import type { Category, Expense, Preferences } from '$lib/types';
	import {
		dateInputValue,
		displayCategoryIcon,
		formatDate,
		newId,
		nowMillis,
		nowSeconds,
		unixFromDateInput
	} from '$lib/util';

	let categories = $state<Category[]>([]);
	let prefs = $state<Preferences | null>(null);
	let error = $state('');
	let ready = $state(false);

	// Keypad state
	let amountCents = $state('');
	let merchant = $state('');
	let selectedCategoryId = $state('');
	let showCategoryPicker = $state(false);
	let merchantFocused = $state(false);
	let dateValue = $state(dateInputValue(nowSeconds()));

	const amountDisplay = $derived(() => {
		if (!amountCents) return '0.00';
		const padded = amountCents.padStart(3, '0');
		const major = padded.slice(0, -2);
		const minor = padded.slice(-2);
		return `${parseInt(major).toLocaleString()}.${minor}`;
	});

	const selectedCategory = $derived(
		categories.find((c) => c.id === selectedCategoryId) ?? null
	);

	onMount(async () => {
		try {
			const [c, p] = await Promise.all([
				apiGet<{ categories: Category[] }>('/api/categories'),
				apiGet<Preferences>('/api/preferences')
			]);
			categories = (c.categories ?? []).filter((cat) => !cat.deleted_at);
			prefs = p;
			selectedCategoryId = pickDefaultCategoryId(categories);
		} catch (e) {
			if (e instanceof ApiError && e.status !== 401) error = e.message;
		} finally {
			ready = true;
		}
	});

	function appendDigit(digit: string) {
		if (amountCents.length >= 10) return;
		amountCents += digit;
	}

	function deleteDigit() {
		amountCents = amountCents.slice(0, -1);
	}

	async function submit() {
		const amount = parseInt(amountCents || '0');
		if (amount <= 0) {
			error = 'Enter an amount greater than zero.';
			setTimeout(() => { error = ''; }, 2000);
			return;
		}
		if (!selectedCategoryId) {
			error = 'Pick a category.';
			setTimeout(() => { error = ''; }, 2000);
			return;
		}

		const id = newId();
		const body = {
			id,
			amount,
			currency: prefs?.currency || 'SGD',
			category_id: selectedCategoryId,
			merchant: merchant.trim(),
			description: '',
			date: unixFromDateInput(dateValue),
			client_updated_at: nowMillis()
		};

		const result = await apiWrite<Expense>('POST', '/api/expenses', body, `expense:${id}`);
		if (result.kind === 'error') {
			error = result.error.message;
			return;
		}
		await goto('/');
	}

	function selectCategory(cat: Category) {
		selectedCategoryId = cat.id;
		setTimeout(() => { showCategoryPicker = false; }, 200);
	}
</script>

<div class="add-screen">
	<!-- Top Bar -->
	<div class="top-bar">
		<a href="/" class="close-btn" aria-label="Close">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
				<line x1="18" y1="6" x2="6" y2="18"/>
				<line x1="6" y1="6" x2="18" y2="18"/>
			</svg>
		</a>
		<span class="top-title">Expense</span>
		<div class="top-spacer"></div>
	</div>

	<!-- Amount Display -->
	<div class="amount-section">
		<span class="dollar-sign">$</span>
		<span class="amount-value">{amountDisplay()}</span>
	</div>

	<!-- Merchant Field -->
	<div class="merchant-wrap">
		<div class="merchant-field" class:focused={merchantFocused}>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
				<rect x="3" y="3" width="7" height="18" rx="1"/>
				<rect x="14" y="3" width="7" height="18" rx="1"/>
			</svg>
			<input
				type="text"
				placeholder="Merchant"
				bind:value={merchant}
				onfocus={() => merchantFocused = true}
				onblur={() => merchantFocused = false}
			/>
		</div>
	</div>

	{#if error}
		<div class="toast">{error}</div>
	{/if}

	<!-- Controls Row -->
	{#if !showCategoryPicker}
		<div class="controls-row">
			<button type="button" class="control-pill" class:selected={!!selectedCategory} onclick={() => showCategoryPicker = true}>
				{#if selectedCategory}
					<span>{displayCategoryIcon(selectedCategory)}</span>
					<span>{selectedCategory.name}</span>
				{:else}
					<span>📂</span>
					<span>Category</span>
				{/if}
			</button>
			<label class="control-pill date-pill">
				<span>📅</span>
				<span>{formatDate(unixFromDateInput(dateValue))}</span>
				<input type="date" bind:value={dateValue} aria-label="Date" />
			</label>
		</div>
	{/if}

	<!-- Keypad or Category Picker -->
	<div class="input-panel">
		{#if showCategoryPicker}
			<div class="category-picker">
				<div class="picker-header">
					<button type="button" class="close-picker" onclick={() => showCategoryPicker = false}>Close</button>
				</div>
				<div class="category-grid">
					{#each categories as cat (cat.id)}
						<button
							type="button"
							class="cat-btn"
							class:selected={cat.id === selectedCategoryId}
							onclick={() => selectCategory(cat)}
						>
							<span class="cat-icon">{displayCategoryIcon(cat)}</span>
							<span class="cat-name">{cat.name}</span>
						</button>
					{/each}
				</div>
			</div>
		{:else}
			<div class="keypad">
				{#each ['1','2','3','4','5','6','7','8','9'] as digit}
					<button type="button" class="key" onclick={() => appendDigit(digit)}>{digit}</button>
				{/each}
				<button type="button" class="key key-action" onclick={deleteDigit} aria-label="Delete">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/>
						<line x1="18" y1="9" x2="12" y2="15"/>
						<line x1="12" y1="9" x2="18" y2="15"/>
					</svg>
				</button>
				<button type="button" class="key" onclick={() => appendDigit('0')}>0</button>
				<button type="button" class="key key-submit" onclick={submit} aria-label="Save">
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="20 6 9 17 4 12"/>
					</svg>
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.add-screen {
		position: fixed;
		inset: 0;
		background: white;
		display: flex;
		flex-direction: column;
		z-index: 100;
		padding: 8px 16px;
		padding-top: calc(env(safe-area-inset-top, 0px) + 8px);
		padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 8px);
	}

	.top-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-shrink: 0;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: #f5f5f5;
		color: #1a1a1a;
		text-decoration: none;
		-webkit-tap-highlight-color: transparent;
	}

	.top-title {
		font-size: 16px;
		font-weight: 600;
	}

	.top-spacer {
		width: 32px;
	}

	/* Amount */
	.amount-section {
		flex: 1 1 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 3px;
		min-height: 80px;
		max-height: 140px;
	}

	.dollar-sign {
		font-size: 26px;
		font-weight: 300;
		color: #999;
	}

	.amount-value {
		font-size: 42px;
		font-weight: 400;
		letter-spacing: -1px;
	}

	@media (min-height: 700px) {
		.amount-section { max-height: 180px; }
		.dollar-sign { font-size: 32px; }
		.amount-value { font-size: 52px; }
	}

	/* Merchant */
	.merchant-wrap {
		display: flex;
		justify-content: center;
		flex-shrink: 0;
		margin-bottom: 10px;
	}

	.merchant-field {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 9px 14px;
		border: 1.5px solid #e0e0e0;
		border-radius: 999px;
		width: 100%;
		max-width: 240px;
		color: #999;
		transition: border-color 0.15s;
	}

	.merchant-field.focused {
		border-color: #007AFF;
	}

	.merchant-field input {
		border: none;
		outline: none;
		font-size: 14px;
		font-weight: 500;
		flex: 1;
		background: none;
		width: 0;
	}

	.merchant-field input::placeholder {
		color: #bbb;
	}

	/* Toast */
	.toast {
		text-align: center;
		padding: 8px 12px;
		margin: 6px 0;
		background: #fef2f2;
		color: #dc2626;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 500;
		flex-shrink: 0;
	}

	/* Controls */
	.controls-row {
		display: flex;
		justify-content: center;
		gap: 8px;
		margin-bottom: 10px;
		flex-shrink: 0;
	}

	.control-pill {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 7px 14px;
		border: 1.5px solid #e0e0e0;
		border-radius: 999px;
		background: white;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		color: #666;
		-webkit-tap-highlight-color: transparent;
	}

	.control-pill.selected {
		border-color: #007AFF;
		background: #007AFF;
		color: white;
	}

	.date-pill {
		position: relative;
		overflow: hidden;
	}

	.date-pill input[type='date'] {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		border: none;
		padding: 0;
		margin: 0;
		cursor: pointer;
		-webkit-appearance: none;
		appearance: none;
	}

	/* Keypad — takes remaining space */
	.input-panel {
		flex: 2 1 0;
		min-height: 200px;
		display: flex;
		flex-direction: column;
	}

	.keypad {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
		flex: 1;
	}

	.key {
		display: flex;
		align-items: center;
		justify-content: center;
		background: #f5f5f5;
		border: none;
		border-radius: 12px;
		font-size: 24px;
		font-weight: 400;
		cursor: pointer;
		color: #1a1a1a;
		user-select: none;
		-webkit-user-select: none;
		-webkit-tap-highlight-color: transparent;
		transition: background 0.08s;
		min-height: 0;
	}

	.key:active {
		background: #e8e8e8;
	}

	.key-action {
		background: #f5f5f5;
	}

	.key-submit {
		background: #1a1a1a;
		color: white;
	}

	.key-submit:active {
		background: #333;
	}

	@media (min-height: 700px) {
		.keypad { gap: 10px; }
		.key { border-radius: 14px; font-size: 28px; }
	}

	/* Category Picker */
	.category-picker {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.picker-header {
		display: flex;
		justify-content: flex-end;
		margin-bottom: 10px;
		flex-shrink: 0;
	}

	.close-picker {
		padding: 6px 12px;
		border: 1.5px solid rgba(220, 38, 38, 0.3);
		border-radius: 999px;
		background: none;
		color: #dc2626;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}

	.category-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 8px;
		overflow-y: auto;
		flex: 1;
		-webkit-overflow-scrolling: touch;
	}

	.cat-btn {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 10px 12px;
		border: none;
		border-radius: 10px;
		background: #f5f5f5;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		color: #1a1a1a;
		text-align: left;
		-webkit-tap-highlight-color: transparent;
	}

	.cat-btn.selected {
		background: #007AFF;
		color: white;
	}

	.cat-btn:active:not(.selected) {
		background: #eee;
	}

	.cat-icon {
		font-size: 15px;
	}

	.cat-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
