<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { apiGet, apiWrite, exchangeSecret, ApiError } from '$lib/api';
	import { authState } from '$lib/stores';
	import { discard, drain, listAll, retry, type OutboxRecord } from '$lib/outbox';
	import type { Preferences } from '$lib/types';
	import { formatDateTime } from '$lib/util';

	const reauthHinted = $derived(page.url.searchParams.get('reauth') === '1');

	let secret = $state('');
	let secretMessage = $state('');
	let secretBusy = $state(false);

	let prefs = $state<Preferences | null>(null);
	let prefsMessage = $state('');
	let prefsBusy = $state(false);

	let failed = $state<OutboxRecord[]>([]);

	async function loadPrefs() {
		try {
			prefs = await apiGet<Preferences>('/api/preferences');
		} catch (e) {
			if (e instanceof ApiError) prefsMessage = e.message;
		}
	}

	async function refreshOutbox() {
		const all = await listAll();
		failed = all.filter((r) => r.status === 'failed').sort((a, b) => b.createdAt - a.createdAt);
	}

	async function saveSecret(event: SubmitEvent) {
		event.preventDefault();
		secretMessage = '';
		if (!secret.trim()) return;
		secretBusy = true;
		try {
			await exchangeSecret(secret.trim());
			secret = '';
			secretMessage = 'Secret saved. Reloading…';
			await loadPrefs();
			secretMessage = 'Secret saved.';
		} catch (e) {
			secretMessage = e instanceof ApiError ? e.message : String(e);
		} finally {
			secretBusy = false;
		}
	}

	async function savePrefs(event: SubmitEvent) {
		event.preventDefault();
		if (!prefs) return;
		prefsBusy = true;
		prefsMessage = '';
		const result = await apiWrite<Preferences>('PUT', '/api/preferences', prefs, 'preferences');
		prefsBusy = false;
		if (result.kind === 'error') {
			prefsMessage = result.error.message;
			return;
		}
		if (result.kind === 'ok') prefs = result.value;
		prefsMessage = 'Saved.';
	}

	async function onRetry(id: number) {
		await retry(id);
		await drain();
		await refreshOutbox();
	}

	async function onDiscard(id: number) {
		if (!confirm('Discard this failed write?')) return;
		await discard(id);
		await refreshOutbox();
	}

	onMount(async () => {
		await loadPrefs();
		await refreshOutbox();
	});

	$effect(() => {
		void $authState;
	});
</script>

{#if reauthHinted || $authState === 'unauthenticated'}
	<div class="hint-banner">
		<span>⚠️</span>
		<span>Your session expired. Paste the sync secret to reconnect.</span>
	</div>
{/if}

<div class="settings-section">
	<div class="section-card nav-card">
		<a href="/categories" class="nav-row">
			<span class="nav-icon">🏷️</span>
			<span>Categories</span>
			<span class="chevron">›</span>
		</a>
		<a href="/recurring" class="nav-row">
			<span class="nav-icon">🔄</span>
			<span>Recurring</span>
			<span class="chevron">›</span>
		</a>
		<a href="/suggestions" class="nav-row">
			<span class="nav-icon">💳</span>
			<span>Wallet Suggestions</span>
			<span class="chevron">›</span>
		</a>
	</div>
</div>

<!-- Server section -->
<div class="settings-section">
	<div class="section-title">Server</div>
	<div class="section-card">
		<form onsubmit={saveSecret}>
			<div class="field">
				<label for="secret">Sync Secret</label>
				<input
					id="secret"
					type="password"
					placeholder="Paste secret from server"
					autocomplete="current-password"
					bind:value={secret}
				/>
			</div>
			<button type="submit" class="btn-primary" disabled={secretBusy}>
				{secretBusy ? 'Saving…' : 'Save Secret'}
			</button>
		</form>
		{#if secretMessage}
			<p class="msg" class:success={secretMessage.includes('saved')}>{secretMessage}</p>
		{/if}
	</div>
</div>

<!-- Preferences section -->
<div class="settings-section">
	<div class="section-title">Preferences</div>
	<div class="section-card">
		{#if prefs}
			<form onsubmit={savePrefs}>
				<div class="field">
					<label for="currency">Currency</label>
					<input id="currency" type="text" maxlength="3" bind:value={prefs.currency} />
				</div>
				<div class="field">
					<label for="timezone">Timezone</label>
					<input id="timezone" type="text" bind:value={prefs.timezone} />
				</div>
				<button type="submit" class="btn-primary" disabled={prefsBusy}>
					{prefsBusy ? 'Saving…' : 'Save Preferences'}
				</button>
			</form>
			{#if prefsMessage}
				<p class="msg" class:success={prefsMessage === 'Saved.'}>{prefsMessage}</p>
			{/if}
		{:else}
			<p class="loading">Loading…</p>
		{/if}
	</div>
</div>

<!-- Sync Errors section -->
{#if failed.length > 0}
	<div class="settings-section">
		<div class="section-title">Sync Errors ({failed.length})</div>
		<div class="errors-list">
			{#each failed as record (record.id)}
				<div class="error-card">
					<div class="error-info">
						<code>{record.method} {record.url}</code>
						<small>{formatDateTime(Math.floor(record.createdAt / 1000))}</small>
						{#if record.lastError}<p class="error-msg">{record.lastError}</p>{/if}
					</div>
					<div class="error-actions">
						<button type="button" class="btn-small" onclick={() => onRetry(record.id!)}>Retry</button>
						<button type="button" class="btn-small btn-ghost" onclick={() => onDiscard(record.id!)}>Discard</button>
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}

<!-- About -->
<div class="settings-section">
	<div class="section-title">About</div>
	<div class="section-card">
		<div class="about-row">
			<span>Version</span>
			<span class="about-value">{__COMMIT_HASH__}</span>
		</div>
		{#if __COMMIT_MESSAGE__}
			<div class="about-row">
				<span>Commit</span>
				<span class="about-value">{__COMMIT_MESSAGE__}</span>
			</div>
		{/if}
	</div>
</div>

<style>
	.settings-section {
		margin-top: 24px;
	}

	.settings-section:first-child {
		margin-top: 12px;
	}

	.section-title {
		font-size: 13px;
		font-weight: 600;
		color: #888;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin-bottom: 8px;
		padding: 0 4px;
	}

	.section-card {
		background: #f2f2f7;
		border-radius: 12px;
		padding: 0 16px;
	}

	.nav-card {
		overflow: hidden;
	}

	.nav-row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 48px;
		color: #1a1a1a;
		text-decoration: none;
		border-bottom: 0.5px solid #d1d1d6;
		-webkit-tap-highlight-color: transparent;
	}

	.nav-row:last-child {
		border-bottom: none;
	}

	.nav-icon {
		width: 24px;
		text-align: center;
	}

	.chevron {
		margin-left: auto;
		color: #8e8e93;
		font-size: 24px;
		line-height: 1;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 16px 0;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.field label {
		font-size: 13px;
		font-weight: 600;
		color: #666;
	}

	.field input {
		padding: 12px 14px;
		border: 1.5px solid #e0e0e0;
		border-radius: 12px;
		font-size: 16px;
		background: white;
	}

	.btn-primary {
		padding: 14px;
		border: none;
		border-radius: 12px;
		background: #1a1a1a;
		color: white;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
	}

	.btn-primary:disabled {
		opacity: 0.5;
	}

	.btn-small {
		padding: 8px 14px;
		border: none;
		border-radius: 8px;
		background: #1a1a1a;
		color: white;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}

	.btn-ghost {
		background: #f5f5f5;
		color: #1a1a1a;
	}

	.msg {
		margin: 10px 0 0;
		font-size: 14px;
		color: #dc2626;
	}

	.msg.success {
		color: #16a34a;
	}

	.loading {
		margin: 0;
		padding: 16px 0;
		color: #888;
	}

	.hint-banner {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 12px 14px;
		background: #fefce8;
		border: 1px solid #fde68a;
		border-radius: 12px;
		font-size: 14px;
		color: #92400e;
		margin-top: 12px;
	}

	.errors-list {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.error-card {
		background: white;
		border: 1.5px solid #fecaca;
		border-radius: 12px;
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.error-info code {
		font-size: 13px;
		display: block;
	}

	.error-info small {
		color: #888;
		font-size: 12px;
	}

	.error-msg {
		margin: 4px 0 0;
		color: #dc2626;
		font-size: 13px;
	}

	.error-actions {
		display: flex;
		gap: 8px;
	}

	.error-actions .btn-small {
		flex: 1;
		min-height: 40px;
	}

	.about-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		min-height: 48px;
		border-bottom: 0.5px solid #d1d1d6;
	}

	.about-row:last-child {
		border-bottom: none;
	}

	.about-value {
		color: #888;
		min-width: 0;
		max-width: 62%;
		text-align: right;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
