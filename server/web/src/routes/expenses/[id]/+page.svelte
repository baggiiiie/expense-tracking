<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { apiGet, apiWrite, ApiError } from '$lib/api';
	import type { Category, Expense, Preferences } from '$lib/types';
	import { nowMillis } from '$lib/util';
	import ExpenseForm from '$lib/ExpenseForm.svelte';

	const id = $derived(page.params.id as string);

	let expense = $state<Expense | null>(null);
	let categories = $state<Category[]>([]);
	let prefs = $state<Preferences | null>(null);
	let error = $state('');
	let ready = $state(false);

	onMount(async () => {
		try {
			const [exp, cats, p] = await Promise.all([
				apiGet<Expense>(`/api/expenses/${id}`),
				apiGet<{ categories: Category[] }>('/api/categories'),
				apiGet<Preferences>('/api/preferences')
			]);
			expense = exp;
			categories = (cats.categories ?? []).filter((c) => !c.deleted_at);
			prefs = p;
		} catch (e) {
			if (e instanceof ApiError && e.status !== 401) error = e.message;
		} finally {
			ready = true;
		}
	});

	async function submit(value: {
		amount: number;
		currency: string;
		category_id: string;
		merchant: string;
		description: string;
		date: number;
	}) {
		const body = { ...value, client_updated_at: nowMillis() };
		const result = await apiWrite<Expense>('PUT', `/api/expenses/${id}`, body, `expense:${id}`);
		if (result.kind === 'error') {
			error = result.error.message;
			return;
		}
		await goto('/');
	}
</script>

<div class="edit-screen">
	<div class="top-bar">
		<a href="/" class="back-btn">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
				<polyline points="15 18 9 12 15 6"/>
			</svg>
			Back
		</a>
		<span class="top-title">Edit Expense</span>
		<div class="top-spacer"></div>
	</div>

	{#if !ready}
		<div class="empty-state">
			<div class="empty-icon">⏳</div>
			<p class="empty-title">Loading…</p>
		</div>
	{:else if !expense || !prefs}
		<div class="empty-state">
			<div class="empty-icon">⚠️</div>
			<p class="empty-title">{error || 'Expense not found.'}</p>
		</div>
	{:else}
		{#if error}<div class="error-banner">{error}</div>{/if}
		<ExpenseForm
			initial={expense}
			{categories}
			defaultCurrency={prefs.currency}
			submitLabel="Save Changes"
			onSubmit={submit}
			onCancel={() => goto('/')}
		/>
	{/if}
</div>

<style>
	.edit-screen {
		padding-top: 8px;
	}

	.top-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 20px;
	}

	.back-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		text-decoration: none;
		font-size: 15px;
		font-weight: 500;
		color: #007AFF;
	}

	.top-title {
		font-size: 17px;
		font-weight: 600;
	}

	.top-spacer {
		width: 60px;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 60px 20px;
		text-align: center;
	}

	.empty-icon {
		font-size: 48px;
		margin-bottom: 16px;
		opacity: 0.6;
	}

	.empty-title {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
		color: #666;
	}

	.error-banner {
		padding: 10px 14px;
		background: #fef2f2;
		color: #dc2626;
		border-radius: 10px;
		font-size: 14px;
		font-weight: 500;
		margin-bottom: 16px;
	}
</style>
