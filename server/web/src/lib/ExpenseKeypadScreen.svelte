<script lang="ts">
	import type { Category } from './types';
	import {
		dateTimeInputValue,
		displayCategoryIcon,
		formatDate,
		formatTime,
		nowSeconds,
		unixFromDateTimeInput
	} from './util';

	type SubmitValue = {
		amount: number;
		category_id: string;
		merchant: string;
		date: number;
	};

	let {
		categories,
		initialKey = 'expense',
		initialAmount = 0,
		initialMerchant = '',
		initialDate = nowSeconds(),
		initialCategoryId = '',
		error = '',
		busy = false,
		deleteBusy = false,
		onSubmit,
		onCancel,
		onDelete
	}: {
		categories: Category[];
		initialKey?: string;
		initialAmount?: number;
		initialMerchant?: string;
		initialDate?: number;
		initialCategoryId?: string;
		error?: string;
		busy?: boolean;
		deleteBusy?: boolean;
		onSubmit: (value: SubmitValue) => void | Promise<void>;
		onCancel: () => void | Promise<void>;
		onDelete?: () => void | Promise<void>;
	} = $props();

	let initializedKey = $state('');
	let amountCents = $state('');
	let merchant = $state('');
	let selectedCategoryId = $state('');
	let showCategoryPicker = $state(false);
	let merchantFocused = $state(false);
	let dateValue = $state('');
	let localError = $state('');

	const selectedCategory = $derived(
		categories.find((category) => category.id === selectedCategoryId) ?? null
	);
	const displayError = $derived(error || localError);

	$effect(() => {
		if (initialKey !== initializedKey) {
			amountCents = initialAmount > 0 ? String(initialAmount) : '';
			merchant = initialMerchant;
			selectedCategoryId = initialCategoryId;
			dateValue = dateTimeInputValue(initialDate);
			showCategoryPicker = false;
			localError = '';
			initializedKey = initialKey;
			return;
		}

		if (!selectedCategoryId && initialCategoryId) {
			selectedCategoryId = initialCategoryId;
		}
	});

	function amountDisplay(): string {
		if (!amountCents) return '0.00';
		const padded = amountCents.padStart(3, '0');
		const major = padded.slice(0, -2);
		const minor = padded.slice(-2);
		return `${parseInt(major, 10).toLocaleString()}.${minor}`;
	}

	function appendDigit(digit: string) {
		if (amountCents.length >= 10) return;
		amountCents += digit;
	}

	function deleteDigit() {
		amountCents = amountCents.slice(0, -1);
	}

	function selectCategory(category: Category) {
		selectedCategoryId = category.id;
		setTimeout(() => {
			showCategoryPicker = false;
		}, 200);
	}

	function showLocalError(message: string) {
		localError = message;
		setTimeout(() => {
			if (localError === message) localError = '';
		}, 2000);
	}

	function formattedControlDate(): string {
		const timestamp = unixFromDateTimeInput(dateValue);
		const value = new Date(timestamp * 1000);
		const today = new Date();
		const sameDay =
			value.getFullYear() === today.getFullYear() &&
			value.getMonth() === today.getMonth() &&
			value.getDate() === today.getDate();
		const dayMonth = value.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
		return sameDay ? `Today, ${dayMonth}` : formatDate(timestamp);
	}

	async function submit() {
		if (busy) return;
		const amount = parseInt(amountCents || '0', 10);
		if (amount <= 0) {
			showLocalError('Enter an amount greater than zero.');
			return;
		}
		if (!selectedCategoryId) {
			showLocalError('Pick a category.');
			return;
		}

		await onSubmit({
			amount,
			category_id: selectedCategoryId,
			merchant: merchant.trim(),
			date: unixFromDateTimeInput(dateValue)
		});
	}
</script>

<div class="expense-screen">
	<div class="top-bar">
		<button type="button" class="close-btn" onclick={onCancel} aria-label="Close">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
				<line x1="18" y1="6" x2="6" y2="18" />
				<line x1="6" y1="6" x2="18" y2="18" />
			</svg>
		</button>
		<span class="top-title">Expense</span>
		{#if onDelete}
			<button type="button" class="delete-btn" onclick={() => onDelete?.()} disabled={deleteBusy} aria-label="Delete Expense">
				<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M3 6h18" />
					<path d="M8 6V4h8v2" />
					<path d="M19 6l-1 14H6L5 6" />
					<path d="M10 11v5" />
					<path d="M14 11v5" />
				</svg>
			</button>
		{:else}
			<div class="top-spacer"></div>
		{/if}
	</div>

	<div class="amount-section">
		<span class="dollar-sign">$</span>
		<span class="amount-value">{amountDisplay()}</span>
	</div>

	<div class="merchant-wrap">
		<div class="merchant-field" class:focused={merchantFocused}>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
				<rect x="3" y="3" width="7" height="18" rx="1" />
				<rect x="14" y="3" width="7" height="18" rx="1" />
			</svg>
			<input
				type="text"
				placeholder="Merchant"
				bind:value={merchant}
				onfocus={() => (merchantFocused = true)}
				onblur={() => (merchantFocused = false)}
			/>
		</div>
	</div>

	{#if displayError}
		<div class="toast">{displayError}</div>
	{/if}

	{#if !showCategoryPicker}
		<div class="controls-row">
			<label class="control-pill date-pill">
				<span>📅</span>
				<span class="date-text">{formattedControlDate()}</span>
				<span class="time-text">{formatTime(unixFromDateTimeInput(dateValue))}</span>
				<input type="datetime-local" bind:value={dateValue} aria-label="Date and time" />
			</label>
			<button type="button" class="control-pill category-pill" class:selected={!!selectedCategory} onclick={() => (showCategoryPicker = true)}>
				{#if selectedCategory}
					<span>{displayCategoryIcon(selectedCategory)}</span>
					<span>{selectedCategory.name}</span>
				{:else}
					<span>📂</span>
					<span>Category</span>
				{/if}
			</button>
		</div>
	{/if}

	<div class="input-panel">
		{#if showCategoryPicker}
			<div class="category-picker">
				<div class="picker-header">
					<button type="button" class="close-picker" onclick={() => (showCategoryPicker = false)}>Close</button>
				</div>
				<div class="category-grid">
					{#each categories as category (category.id)}
						<button
							type="button"
							class="cat-btn"
							class:selected={category.id === selectedCategoryId}
							onclick={() => selectCategory(category)}
						>
							<span class="cat-icon">{displayCategoryIcon(category)}</span>
							<span class="cat-name">{category.name}</span>
						</button>
					{/each}
				</div>
			</div>
		{:else}
			<div class="keypad">
				{#each ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as digit}
					<button type="button" class="key" onclick={() => appendDigit(digit)}>{digit}</button>
				{/each}
				<button type="button" class="key key-action" onclick={deleteDigit} aria-label="Delete">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
						<line x1="18" y1="9" x2="12" y2="15" />
						<line x1="12" y1="9" x2="18" y2="15" />
					</svg>
				</button>
				<button type="button" class="key" onclick={() => appendDigit('0')}>0</button>
				<button type="button" class="key key-submit" onclick={submit} disabled={busy} aria-label="Save">
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<polyline points="20 6 9 17 4 12" />
					</svg>
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.expense-screen {
		position: fixed;
		inset: 0;
		height: 100dvh;
		width: 100%;
		max-width: 480px;
		margin: 0 auto;
		background: white;
		display: flex;
		flex-direction: column;
		z-index: 80;
		overflow: hidden;
		padding: 12px 14px;
		padding-top: calc(env(safe-area-inset-top, 0px) + 12px);
		padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 12px);
		/* Prevent text selection and double-tap-to-zoom, which caused the
		   layout to jump up/down when tapping or double-tapping keypad keys. */
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		touch-action: manipulation;
	}

	.expense-screen input {
		user-select: text;
		-webkit-user-select: text;
	}

	.top-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-shrink: 0;
		min-height: 40px;
	}

	.close-btn,
	.delete-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border: none;
		border-radius: 50%;
		background: #f5f5f5;
		color: #1a1a1a;
		text-decoration: none;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}

	.delete-btn {
		color: #dc2626;
	}

	.delete-btn:disabled {
		opacity: 0.5;
	}

	.top-title {
		font-size: 16px;
		font-weight: 600;
	}

	.top-spacer {
		width: 36px;
	}

	.amount-section {
		flex: 1 1 0;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		gap: 3px;
		min-height: 86px;
		max-height: 140px;
		padding-bottom: 14px;
	}

	.dollar-sign {
		font-size: 26px;
		font-weight: 300;
		color: #999;
	}

	.amount-value {
		font-size: 42px;
		font-weight: 400;
		letter-spacing: 0;
	}

	@media (min-height: 700px) {
		.amount-section {
			max-height: 180px;
			padding-bottom: 22px;
		}

		.dollar-sign {
			font-size: 32px;
		}

		.amount-value {
			font-size: 52px;
		}
	}

	.merchant-wrap {
		display: flex;
		justify-content: center;
		flex-shrink: 0;
		margin-bottom: 42px;
	}

	.merchant-field {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		max-width: 260px;
		min-height: 42px;
		padding: 9px 14px;
		border: 1.5px solid #e0e0e0;
		border-radius: 999px;
		color: #999;
		transition: border-color 0.15s;
	}

	.merchant-field.focused {
		border-color: #007AFF;
	}

	.merchant-field input {
		width: 0;
		flex: 1;
		border: none;
		outline: none;
		background: none;
		font-size: 14px;
		font-weight: 500;
	}

	.merchant-field input::placeholder {
		color: #bbb;
	}

	.toast {
		flex-shrink: 0;
		margin: 6px 0;
		padding: 8px 12px;
		border-radius: 8px;
		background: #fef2f2;
		color: #dc2626;
		text-align: center;
		font-size: 13px;
		font-weight: 500;
	}

	.controls-row {
		display: flex;
		align-items: stretch;
		justify-content: center;
		gap: 6px;
		flex-shrink: 0;
		margin-bottom: 10px;
	}

	.control-pill {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 44px;
		padding: 7px 10px;
		border: 1.5px solid #e0e0e0;
		border-radius: 999px;
		background: white;
		color: #1a1a1a;
		font-size: 13px;
		font-weight: 700;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}

	.control-pill.selected {
		border-color: #007AFF;
		background: #007AFF;
		color: white;
	}

	.date-pill {
		position: relative;
		flex: 1;
		justify-content: flex-start;
		overflow: hidden;
	}

	.date-text,
	.category-pill span:last-child {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.time-text {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
	}

	.category-pill {
		flex: 0 0 auto;
		max-width: 124px;
	}

	.date-pill input[type='datetime-local'] {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		padding: 0;
		border: none;
		opacity: 0;
		cursor: pointer;
		-webkit-appearance: none;
		appearance: none;
	}

	.input-panel {
		flex: 1.8 1 232px;
		min-height: 232px;
		display: flex;
		flex-direction: column;
	}

	.keypad {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		grid-template-rows: repeat(4, minmax(52px, 1fr));
		gap: 8px;
		flex: 1;
	}

	.key {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 0;
		border: none;
		border-radius: 12px;
		background: #f5f5f5;
		color: #1a1a1a;
		font-size: 24px;
		font-weight: 400;
		cursor: pointer;
		user-select: none;
		-webkit-user-select: none;
		-webkit-tap-highlight-color: transparent;
		transition: background 0.08s;
	}

	.key:active {
		background: #e8e8e8;
	}

	.key-submit {
		background: #1a1a1a;
		color: white;
	}

	.key-submit:disabled {
		opacity: 0.55;
	}

	.key-submit:active {
		background: #333;
	}

	@media (min-height: 700px) {
		.merchant-wrap {
			margin-bottom: 72px;
		}

		.keypad {
			gap: 10px;
		}

		.key {
			border-radius: 14px;
			font-size: 28px;
		}
	}

	@media (min-height: 780px) {
		.merchant-wrap {
			margin-bottom: 96px;
		}
	}

	@media (max-height: 620px) {
		.amount-section {
			max-height: 112px;
		}

		.merchant-wrap {
			margin-bottom: 24px;
		}

		.input-panel {
			flex-basis: 212px;
			min-height: 212px;
		}
	}

	.category-picker {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.picker-header {
		display: flex;
		justify-content: flex-end;
		flex-shrink: 0;
		margin-bottom: 10px;
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
		grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
		gap: 8px;
		flex: 1;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
	}

	.cat-btn {
		display: flex;
		align-items: center;
		gap: 7px;
		min-height: 44px;
		padding: 10px 12px;
		border: none;
		border-radius: 10px;
		background: #f5f5f5;
		color: #1a1a1a;
		text-align: left;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
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
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
