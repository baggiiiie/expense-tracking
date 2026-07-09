<script lang="ts">
	import { onMount } from 'svelte';
	import { apiGet, apiWrite, ApiError } from '$lib/api';
	import { getDefaultCategoryId, setDefaultCategoryId } from '$lib/default-category';
	import type { Category } from '$lib/types';
	import { displayCategoryIcon, formatMoney, nowMillis, parseAmount } from '$lib/util';

	let categories = $state<Category[]>([]);
	let loading = $state(true);
	let error = $state('');

	let editingId = $state<string | null>(null);
	let name = $state('');
	let icon = $state('💸');
	let budgetText = $state('');
	let busy = $state(false);
	let showForm = $state(false);
	let defaultCategoryId = $state('');

	async function load() {
		loading = true;
		try {
			const data = await apiGet<{ categories: Category[] }>('/api/categories');
			categories = (data.categories ?? []).filter((c) => !c.deleted_at);
			const storedDefault = getDefaultCategoryId();
			defaultCategoryId = categories.some((cat) => cat.id === storedDefault) ? storedDefault : '';
			if (storedDefault && !defaultCategoryId) setDefaultCategoryId(null);
		} catch (e) {
			if (e instanceof ApiError && e.status !== 401) error = e.message;
		} finally {
			loading = false;
		}
	}

	function reset() {
		editingId = null;
		name = '';
		icon = '💸';
		budgetText = '';
		error = '';
		showForm = false;
	}

	function startEdit(cat: Category) {
		editingId = cat.id;
		name = cat.name;
		icon = displayCategoryIcon(cat);
		budgetText = cat.budget != null ? (cat.budget / 100).toFixed(2) : '';
		showForm = true;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim()) {
			error = 'Name is required.';
			return;
		}
		busy = true;
		const budget = budgetText.trim() === '' ? null : parseAmount(budgetText);
		const body = {
			name: name.trim(),
			icon: icon.trim() || '💸',
			budget,
			client_updated_at: nowMillis()
		};

		const url = editingId ? `/api/categories/${editingId}` : '/api/categories';
		const method = editingId ? 'PUT' : 'POST';
		const targetKey = `category:${editingId ?? name.toLowerCase()}`;

		const result = await apiWrite<Category>(method, url, body, targetKey);
		busy = false;
		if (result.kind === 'error') {
			error = result.error.message;
			return;
		}
		reset();
		await load();
	}

	function toggleDefault(cat: Category) {
		const next = defaultCategoryId === cat.id ? '' : cat.id;
		defaultCategoryId = next;
		setDefaultCategoryId(next || null);
	}

	async function remove(id: string) {
		if (!confirm('Delete this category?')) return;
		const before = categories;
		categories = categories.filter((c) => c.id !== id);
		if (defaultCategoryId === id) {
			defaultCategoryId = '';
			setDefaultCategoryId(null);
		}
		const result = await apiWrite<void>('DELETE', `/api/categories/${id}`, null, `category:${id}`);
		if (result.kind === 'error') {
			categories = before;
			error = result.error.message;
		}
	}

	onMount(load);
</script>

{#if showForm}
	<!-- Form Modal -->
	<button type="button" class="modal-overlay" onclick={reset} aria-label="Close modal"></button>
	<div class="modal">
		<div class="modal-header">
			<h3>{editingId ? 'Edit Category' : 'New Category'}</h3>
			<button type="button" class="modal-close" onclick={reset} aria-label="Close modal">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
					<line x1="18" y1="6" x2="6" y2="18"/>
					<line x1="6" y1="6" x2="18" y2="18"/>
				</svg>
			</button>
		</div>
		<form onsubmit={submit}>
			<div class="form-row">
				<label class="icon-field">
					<input type="text" maxlength="4" bind:value={icon} class="icon-input" />
				</label>
				<label class="name-field">
					<input type="text" placeholder="Category name" bind:value={name} required />
				</label>
			</div>
			<label class="budget-field">
				<span>Monthly budget (optional)</span>
				<input type="number" step="0.01" min="0" inputmode="decimal" placeholder="0.00" bind:value={budgetText} />
			</label>
			{#if error}<p class="error">{error}</p>{/if}
			<button type="submit" class="submit-btn" disabled={busy}>
				{editingId ? 'Save Changes' : 'Add Category'}
			</button>
		</form>
	</div>
{/if}

{#if loading}
	<div class="empty-state">
		<div class="empty-icon">⏳</div>
		<p class="empty-title">Loading…</p>
	</div>
{:else if categories.length === 0}
	<div class="empty-state">
		<div class="empty-icon">🏷️</div>
		<p class="empty-title">No Categories</p>
		<p class="empty-desc">Tap + to create your first category</p>
	</div>
{:else}
	<div class="category-list">
		{#each categories as cat (cat.id)}
			<div class="category-row" class:is-default={defaultCategoryId === cat.id}>
				<button type="button" class="category-main" onclick={() => startEdit(cat)}>
					<div class="cat-icon">{displayCategoryIcon(cat)}</div>
					<div class="cat-info">
						<div class="cat-name">{cat.name}</div>
						{#if defaultCategoryId === cat.id}
							<div class="cat-default">Default category</div>
						{:else if cat.budget != null}
							<div class="cat-budget">Budget: {formatMoney(cat.budget)}</div>
						{/if}
					</div>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="2" stroke-linecap="round">
						<polyline points="9 18 15 12 9 6"/>
					</svg>
				</button>
				<button
					type="button"
					class="default-btn"
					class:active={defaultCategoryId === cat.id}
					onclick={() => toggleDefault(cat)}
					aria-label={defaultCategoryId === cat.id ? `Unset ${cat.name} as default` : `Set ${cat.name} as default`}
				>
					★
				</button>
			</div>
		{/each}
	</div>
{/if}

<button type="button" class="fab" onclick={() => { showForm = true; }} aria-label="Add Category">
	<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
		<line x1="12" y1="5" x2="12" y2="19"/>
		<line x1="5" y1="12" x2="19" y2="12"/>
	</svg>
</button>

<style>
	/* Category List */
	.category-list {
		display: flex;
		flex-direction: column;
		margin-top: 20px;
	}

	.category-row {
		display: flex;
		align-items: center;
		gap: 8px;
		border-bottom: 0.5px solid #f2f2f2;
		min-height: 52px;
	}

	.category-row.is-default {
		padding-right: 4px;
	}

	.category-row:last-child {
		border-bottom: none;
	}

	.category-main {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 4px;
		border: none;
		background: none;
		cursor: pointer;
		text-align: left;
		width: 100%;
		color: inherit;
		min-height: 52px;
		-webkit-tap-highlight-color: transparent;
	}

	.category-main:active {
		background: #f8f8f8;
		border-radius: 10px;
	}

	.cat-icon {
		font-size: 24px;
		width: 32px;
		text-align: center;
	}

	.cat-info {
		flex: 1;
	}

	.cat-name {
		font-size: 17px;
		font-weight: 400;
	}

	.cat-budget,
	.cat-default {
		font-size: 13px;
		color: #888;
		margin-top: 2px;
	}

	.cat-default {
		color: #007AFF;
		font-weight: 600;
	}

	.default-btn {
		width: 40px;
		height: 40px;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: #c7c7cc;
		font-size: 20px;
		line-height: 1;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		flex-shrink: 0;
	}

	.default-btn.active {
		color: #ffcc00;
	}

	/* Empty State */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 140px 16px 60px;
		text-align: center;
	}

	.empty-icon {
		font-size: 48px;
		margin-bottom: 18px;
		color: #8e8e93;
	}

	.empty-title {
		margin: 0;
		font-size: 24px;
		font-weight: 700;
	}

	.empty-desc {
		margin: 6px 0 0;
		font-size: 16px;
		color: #8e8e93;
	}

	/* Modal */
	.modal-overlay {
		position: fixed;
		inset: 0;
		border: none;
		padding: 0;
		background: rgba(0, 0, 0, 0.3);
		z-index: 50;
	}

	.modal {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
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

	.form-row {
		display: flex;
		gap: 10px;
	}

	.icon-field {
		flex: 0 0 56px;
	}

	.icon-input {
		width: 100%;
		text-align: center;
		font-size: 24px;
		padding: 10px;
		border: 1.5px solid #e0e0e0;
		border-radius: 12px;
		background: #fafafa;
	}

	.name-field {
		flex: 1;
	}

	.name-field input {
		width: 100%;
		padding: 14px;
		border: 1.5px solid #e0e0e0;
		border-radius: 12px;
		font-size: 16px;
		font-weight: 500;
		background: #fafafa;
	}

	.budget-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.budget-field span {
		font-size: 13px;
		font-weight: 600;
		color: #666;
	}

	.budget-field input {
		padding: 14px;
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

	.fab {
		position: fixed;
		top: calc(env(safe-area-inset-top, 0px) + 22px);
		right: 16px;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: transparent;
		color: #007AFF;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: none;
		border: none;
		cursor: pointer;
		z-index: 20;
		-webkit-tap-highlight-color: transparent;
	}

	.fab:active {
		transform: scale(0.9);
	}
</style>
