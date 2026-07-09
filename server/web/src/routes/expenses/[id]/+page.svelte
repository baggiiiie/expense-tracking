<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { apiGet, apiWrite, ApiError } from '$lib/api';
	import ExpenseKeypadScreen from '$lib/ExpenseKeypadScreen.svelte';
	import type { Category, Expense } from '$lib/types';
	import { nowMillis } from '$lib/util';

	type ExpenseFormValue = {
		amount: number;
		category_id: string;
		merchant: string;
		date: number;
	};

	const id = $derived(page.params.id as string);

	let expense = $state<Expense | null>(null);
	let categories = $state<Category[]>([]);
	let ready = $state(false);
	let error = $state('');
	let busy = $state(false);
	let deleting = $state(false);

	onMount(async () => {
		try {
			const [expenseData, categoryData] = await Promise.all([
				apiGet<Expense>(`/api/expenses/${id}`),
				apiGet<{ categories: Category[] }>('/api/categories')
			]);
			expense = expenseData;
			categories = (categoryData.categories ?? []).filter((category) => !category.deleted_at);
		} catch (e) {
			if (e instanceof ApiError && e.status !== 401) error = e.message;
			else if (!(e instanceof ApiError)) error = String(e);
		} finally {
			ready = true;
		}
	});

	function showError(message: string) {
		error = message;
		setTimeout(() => {
			if (error === message) error = '';
		}, 2000);
	}

	async function submit(value: ExpenseFormValue) {
		if (!expense || busy) return;

		busy = true;
		error = '';
		const body = {
			amount: value.amount,
			currency: expense.currency,
			category_id: value.category_id,
			merchant: value.merchant,
			description: expense.description ?? '',
			date: value.date,
			client_updated_at: nowMillis()
		};
		const result = await apiWrite<Expense>('PUT', `/api/expenses/${id}`, body, `expense:${id}`);
		busy = false;
		if (result.kind === 'error') {
			showError(result.error.message);
			return;
		}
		await goto('/');
	}

	async function removeExpense() {
		if (!confirm('Delete this expense?')) return;

		deleting = true;
		error = '';
		const result = await apiWrite<void>('DELETE', `/api/expenses/${id}`, null, `expense:${id}`);
		deleting = false;
		if (result.kind === 'error') {
			showError(result.error.message);
			return;
		}
		await goto('/');
	}
</script>

{#if !ready}
	<div class="state-screen">
		<div class="state-icon">⏳</div>
		<p class="state-title">Loading…</p>
	</div>
{:else if !expense}
	<div class="state-screen">
		<div class="state-icon">⚠️</div>
		<p class="state-title">{error || 'Expense not found.'}</p>
	</div>
{:else}
	<ExpenseKeypadScreen
		categories={categories}
		initialKey={expense.id}
		initialAmount={expense.amount}
		initialMerchant={expense.merchant ?? ''}
		initialDate={expense.date}
		initialCategoryId={expense.category_id}
		error={error}
		busy={busy}
		deleteBusy={deleting}
		onCancel={() => goto('/')}
		onDelete={removeExpense}
		onSubmit={submit}
	/>
{/if}

<style>
	.state-screen {
		position: fixed;
		inset: 0;
		z-index: 80;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 60px 20px;
		background: white;
		text-align: center;
	}

	.state-icon {
		margin-bottom: 16px;
		font-size: 48px;
		opacity: 0.6;
	}

	.state-title {
		margin: 0;
		color: #666;
		font-size: 18px;
		font-weight: 600;
	}
</style>
