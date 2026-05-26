<script lang="ts">
	import { syncState } from './stores';

	const state = $derived($syncState);

	const labels = {
		synced: 'Synced',
		offline: 'Offline',
		syncing: 'Syncing',
		errors: 'Sync errors'
	} as const;

	const label = $derived(
		state.phase === 'errors'
			? `${state.failedWrites}`
			: state.phase === 'syncing' && state.pendingWrites > 0
				? `${state.pendingWrites}`
				: ''
	);
</script>

<a href="/settings" class="indicator" data-phase={state.phase} aria-label="Sync status: {labels[state.phase]}">
	{#if state.phase === 'synced'}
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
			<polyline points="20 6 9 17 4 12"/>
		</svg>
	{:else if state.phase === 'syncing'}
		<svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
			<path d="M21 12a9 9 0 1 1-6.2-8.6"/>
		</svg>
	{:else if state.phase === 'offline'}
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
			<line x1="1" y1="1" x2="23" y2="23"/>
			<path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
			<path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
			<path d="M10.71 5.05A16 16 0 0 1 22.56 9"/>
			<path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
			<path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
			<line x1="12" y1="20" x2="12.01" y2="20"/>
		</svg>
	{:else}
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
			<circle cx="12" cy="12" r="10"/>
			<line x1="12" y1="8" x2="12" y2="12"/>
			<line x1="12" y1="16" x2="12.01" y2="16"/>
		</svg>
		{#if label}<span class="badge">{label}</span>{/if}
	{/if}
</a>

<style>
	.indicator {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: #f0fdf4;
		color: #16a34a;
		text-decoration: none;
		position: relative;
	}

	.indicator[data-phase='offline'] {
		background: #fefce8;
		color: #ca8a04;
	}

	.indicator[data-phase='syncing'] {
		background: #eff6ff;
		color: #2563eb;
	}

	.indicator[data-phase='errors'] {
		background: #fef2f2;
		color: #dc2626;
	}

	.badge {
		position: absolute;
		top: -2px;
		right: -2px;
		background: #dc2626;
		color: white;
		font-size: 9px;
		font-weight: 700;
		min-width: 14px;
		height: 14px;
		border-radius: 7px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 3px;
	}

	.spin {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}
</style>
