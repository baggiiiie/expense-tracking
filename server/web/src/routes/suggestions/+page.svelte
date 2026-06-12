<script lang="ts">
	import { onMount } from 'svelte';
	import { apiGet, apiWrite, ApiError } from '$lib/api';
	import type { Category, Expense, Preferences, WalletSuggestion } from '$lib/types';
	import { formatDateTime, formatMoney, newId, nowMillis } from '$lib/util';
	import ExpenseForm from '$lib/ExpenseForm.svelte';

	let suggestions = $state<WalletSuggestion[]>([]);
	let categories = $state<Category[]>([]);
	let prefs = $state<Preferences | null>(null);
	let loading = $state(true);
	let error = $state('');
	let notice = $state('');
	let active = $state<WalletSuggestion | null>(null);

	async function load() {
		loading = true;
		try {
			const [s, c, p] = await Promise.all([
				apiGet<{ wallet_suggestions: WalletSuggestion[] }>('/api/wallet-suggestions?status=pending'),
				apiGet<{ categories: Category[] }>('/api/categories'),
				apiGet<Preferences>('/api/preferences')
			]);
			suggestions = s.wallet_suggestions ?? [];
			categories = (c.categories ?? []).filter((x) => !x.deleted_at);
			prefs = p;
		} catch (e) {
			if (e instanceof ApiError && e.status !== 401) error = e.message;
		} finally {
			loading = false;
		}
	}

	function openSuggestion(s: WalletSuggestion) {
		active = s;
		error = '';
		notice = '';
	}

	async function confirm(value: {
		amount: number;
		currency: string;
		category_id: string;
		merchant: string;
		description: string;
		date: number;
	}) {
		if (!active) return;
		error = '';
		notice = '';
		const confirmedId = active.id;
		const body = { ...value, id: newId(), client_updated_at: nowMillis() };
		const result = await apiWrite<{ wallet_suggestion: WalletSuggestion; expense: Expense }>(
			'POST',
			`/api/wallet-suggestions/${confirmedId}/confirm`,
			body,
			`wallet_suggestion:${confirmedId}`
		);
		if (result.kind === 'error') {
			error = result.error.message;
			return;
		}
		suggestions = suggestions.filter((s) => s.id !== confirmedId);
		active = null;
		if (result.kind === 'queued') {
			notice = 'Confirm queued. It will sync when the server is reachable.';
			return;
		}
		await load();
	}

	async function dismiss(id: string) {
		error = '';
		notice = '';
		const result = await apiWrite<WalletSuggestion>(
			'POST',
			`/api/wallet-suggestions/${id}/dismiss`,
			null,
			`wallet_suggestion:${id}`
		);
		if (result.kind === 'error') {
			error = result.error.message;
			return;
		}
		suggestions = suggestions.filter((s) => s.id !== id);
		if (active?.id === id) active = null;
		if (result.kind === 'queued') {
			notice = 'Dismiss queued. It will sync when the server is reachable.';
			return;
		}
		await load();
	}

	onMount(load);
</script>

{#if active && prefs}
	<!-- Confirm suggestion view -->
	<div class="confirm-view">
		<button type="button" class="back-btn" onclick={() => { active = null; error = ''; }}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
				<polyline points="15 18 9 12 15 6"/>
			</svg>
			Back
		</button>

		<div class="suggestion-card">
			<div class="suggestion-header">
				<span class="card-icon">💳</span>
				<div>
					<div class="suggestion-merchant">{active.merchant}</div>
					<div class="suggestion-meta">
						{formatDateTime(active.captured_at)} · {active.source}
					</div>
				</div>
			</div>
		</div>

		{#if error}<div class="error-banner">{error}</div>{/if}

		<ExpenseForm
			initial={{
				amount: active.amount ?? 0,
				currency: active.currency,
				merchant: active.merchant,
				date: active.captured_at
			}}
			{categories}
			defaultCurrency={prefs.currency}
			submitLabel="Confirm & Save"
			onSubmit={confirm}
			onCancel={() => { active = null; error = ''; }}
		/>

		<button type="button" class="dismiss-btn" onclick={() => dismiss(active!.id)}>
			Dismiss instead
		</button>
	</div>
{:else if loading}
	<div class="empty-state">
		<div class="empty-icon">⏳</div>
		<p class="empty-title">Loading…</p>
	</div>
{:else if error}
	<div class="empty-state">
		<div class="empty-icon">⚠️</div>
		<p class="empty-title">Error</p>
		<p class="empty-desc">{error}</p>
	</div>
{:else if suggestions.length === 0}
	{#if notice}<div class="notice-banner">{notice}</div>{/if}
	<div class="empty-state">
		<div class="empty-icon">💳</div>
		<p class="empty-title">No Pending Suggestions</p>
		<p class="empty-desc">Apple Pay transactions will appear here</p>
	</div>
{:else}
	{#if notice}<div class="notice-banner">{notice}</div>{/if}
	<div class="suggestions-list">
		{#each suggestions as s (s.id)}
			<div class="suggestion-row">
				<button type="button" class="suggestion-content" onclick={() => openSuggestion(s)}>
					<div class="row-left">
						<span class="card-badge">💳</span>
						<div>
							<div class="row-merchant">{s.merchant}</div>
							<div class="row-meta">
								{formatDateTime(s.captured_at)}
								{#if s.card_name}· {s.card_name}{/if}
							</div>
						</div>
					</div>
					<div class="row-amount">{formatMoney(s.amount ?? null, s.currency)}</div>
				</button>
				<div class="row-actions">
					<button type="button" class="action-add" onclick={() => openSuggestion(s)}>
						Add
					</button>
					<button type="button" class="action-dismiss" onclick={() => dismiss(s.id)} aria-label="Dismiss">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
							<line x1="18" y1="6" x2="6" y2="18"/>
							<line x1="6" y1="6" x2="18" y2="18"/>
						</svg>
					</button>
				</div>
			</div>
		{/each}
	</div>
{/if}

<style>
	/* Suggestions List */
	.suggestions-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 12px;
	}

	.suggestion-row {
		background: white;
		border: 1px solid #f0f0f0;
		border-radius: 14px;
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.suggestion-content {
		display: flex;
		align-items: center;
		justify-content: space-between;
		border: none;
		background: none;
		cursor: pointer;
		text-align: left;
		width: 100%;
		color: inherit;
		padding: 0;
	}

	.row-left {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.card-badge {
		font-size: 20px;
	}

	.row-merchant {
		font-size: 16px;
		font-weight: 600;
	}

	.row-meta {
		font-size: 13px;
		color: #888;
		margin-top: 2px;
	}

	.row-amount {
		font-size: 17px;
		font-weight: 600;
	}

	.row-actions {
		display: flex;
		gap: 8px;
	}

	.action-add {
		flex: 1;
		padding: 8px;
		border: none;
		border-radius: 8px;
		background: #007AFF;
		color: white;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
	}

	.action-dismiss {
		width: 36px;
		height: 36px;
		border: 1.5px solid #fecaca;
		border-radius: 8px;
		background: white;
		color: #dc2626;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}

	/* Confirm View */
	.confirm-view {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.back-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		border: none;
		background: none;
		cursor: pointer;
		font-size: 15px;
		font-weight: 500;
		color: #007AFF;
		padding: 0;
	}

	.suggestion-card {
		background: #f8f9fa;
		border-radius: 12px;
		padding: 14px;
	}

	.suggestion-header {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.card-icon {
		font-size: 24px;
	}

	.suggestion-merchant {
		font-size: 16px;
		font-weight: 600;
	}

	.suggestion-meta {
		font-size: 13px;
		color: #888;
		margin-top: 2px;
	}

	.dismiss-btn {
		margin-top: 8px;
		padding: 12px;
		border: 1.5px solid #fecaca;
		border-radius: 12px;
		background: white;
		color: #dc2626;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		width: 100%;
	}

	.error-banner,
	.notice-banner {
		padding: 10px 14px;
		border-radius: 10px;
		font-size: 14px;
		font-weight: 500;
	}

	.error-banner {
		background: #fef2f2;
		color: #dc2626;
	}

	.notice-banner {
		margin: 8px 0 12px;
		background: #eff6ff;
		color: #1d4ed8;
	}

	/* Empty State */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 80px 20px;
		text-align: center;
	}

	.empty-icon {
		font-size: 48px;
		margin-bottom: 16px;
		opacity: 0.6;
	}

	.empty-title {
		margin: 0;
		font-size: 20px;
		font-weight: 700;
	}

	.empty-desc {
		margin: 6px 0 0;
		font-size: 15px;
		color: #999;
	}
</style>
