<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { registerServiceWorker } from '$lib/sw-client';
	import { startOutboxDraining } from '$lib/outbox';
	import { syncState, setSyncPhase, authState } from '$lib/stores';
	import UpdateBanner from '$lib/UpdateBanner.svelte';
	import IosInstallHint from '$lib/IosInstallHint.svelte';
	import SyncStatusPill from '$lib/SyncStatusPill.svelte';

	let { children } = $props();

	const path = $derived(page.url.pathname);
	const isLoginPage = $derived(path === '/login');
	const isExpenseFullScreen = $derived(path.startsWith('/expenses/'));
	const screen = $derived.by(() => {
		if (path.startsWith('/categories')) return { title: 'Categories', backHref: '/settings', backLabel: 'Settings' };
		if (path.startsWith('/recurring')) return { title: 'Recurring', backHref: '/settings', backLabel: 'Settings' };
		if (path.startsWith('/suggestions')) return { title: 'Wallet', backHref: '/settings', backLabel: 'Settings' };
		if (path.startsWith('/settings')) return { title: 'Settings', backHref: '/', backLabel: 'Expenses' };
		return { title: 'Expenses', backHref: '', backLabel: '' };
	});

	onMount(() => {
		registerServiceWorker();
		startOutboxDraining();

		const online = () => setSyncPhase('synced');
		const offline = () => setSyncPhase('offline');
		window.addEventListener('online', online);
		window.addEventListener('offline', offline);
		return () => {
			window.removeEventListener('online', online);
			window.removeEventListener('offline', offline);
		};
	});

	$effect(() => {
		void $syncState;
	});

	// Redirect to login when auth state becomes unauthenticated
	$effect(() => {
		if ($authState === 'unauthenticated' && !isLoginPage) {
			goto('/login');
		}
	});
</script>

{#if isLoginPage || isExpenseFullScreen}
	{@render children()}
{:else}
	<div class="shell">
		<header class="header">
			<div class="toolbar">
				{#if screen.backHref}
					<a href={screen.backHref} class="back-btn" aria-label="Back to {screen.backLabel}">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<polyline points="15 18 9 12 15 6" />
						</svg>
						<span>{screen.backLabel}</span>
					</a>
				{:else}
					<SyncStatusPill />
				{/if}

				{#if !screen.backHref}
					<a href="/settings" class="settings-btn" aria-label="Settings">
						<svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<circle cx="12" cy="12" r="3" />
							<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-1.42 3.42 2 2 0 0 1-1.42-.59l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-3.42-1.42 2 2 0 0 1 .59-1.42l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 1.42-3.42 2 2 0 0 1 1.42.59l.06.06A1.65 1.65 0 0 0 9 4.6h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 3.42 1.42 2 2 0 0 1-.59 1.42l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
						</svg>
					</a>
				{:else}
					<span class="toolbar-spacer" aria-hidden="true"></span>
				{/if}
			</div>
			<h1>{screen.title}</h1>
		</header>

		<main class="main">
			{@render children()}
		</main>
	</div>
{/if}

{#if !isLoginPage}
	<UpdateBanner />
	<IosInstallHint />
{/if}

<style>
	:global(*, *::before, *::after) {
		box-sizing: border-box;
	}

	:global(html, body) {
		margin: 0;
		padding: 0;
		background: #ffffff;
		color: #1a1a1a;
		font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Rounded', 'SF Pro Display', 'Segoe UI', system-ui, sans-serif;
		-webkit-font-smoothing: antialiased;
		-webkit-text-size-adjust: 100%;
		overflow-x: hidden;
	}

	:global(button),
	:global(input),
	:global(select),
	:global(textarea) {
		font: inherit;
	}

	:global(a) {
		color: inherit;
	}

	:global(.shared-empty-state) {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 140px 16px 60px;
		text-align: center;
	}

	:global(.shared-empty-icon) {
		font-size: 48px;
		margin-bottom: 18px;
		color: #8e8e93;
	}

	:global(.shared-empty-title) {
		margin: 0;
		font-size: 24px;
		font-weight: 700;
	}

	:global(.shared-empty-desc) {
		margin: 6px 0 0;
		font-size: 16px;
		color: #8e8e93;
	}

	:global(.shared-modal-overlay) {
		position: fixed;
		inset: 0;
		border: none;
		padding: 0;
		background: rgba(0, 0, 0, 0.3);
		z-index: 50;
	}

	:global(.shared-modal) {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		max-height: var(--modal-max-height, 86dvh);
		overflow-y: auto;
		background: white;
		border-radius: 20px 20px 0 0;
		padding: 20px;
		padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 20px);
		z-index: 51;
		-webkit-overflow-scrolling: touch;
	}

	:global(.shared-modal-header) {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 20px;
	}

	:global(.shared-modal-header h3) {
		margin: 0;
		font-size: 18px;
		font-weight: 700;
	}

	:global(.shared-modal-close) {
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

	:global(.shared-modal form) {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	:global(.shared-submit-btn) {
		min-height: 48px;
		padding: 14px;
		border: none;
		border-radius: 12px;
		background: #1a1a1a;
		color: white;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
	}

	:global(.shared-submit-btn:disabled) {
		opacity: 0.5;
	}

	:global(.shared-error) {
		margin: 0;
		color: #dc2626;
		font-size: 14px;
		font-weight: 500;
	}

	:global(.shared-fab) {
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

	:global(.shared-fab:active) {
		transform: scale(0.9);
	}

	.shell {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		max-width: 100vw;
		overflow-x: hidden;
	}

	.header {
		z-index: 10;
		padding: 18px 16px 0;
		padding-top: calc(env(safe-area-inset-top, 0px) + 18px);
		background: #ffffff;
	}

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 54px;
	}

	.header h1 {
		margin: 0;
		padding: 18px 0 0 0;
		font-size: 34px;
		line-height: 1.05;
		font-weight: 800;
		letter-spacing: 0;
	}

	.settings-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 52px;
		height: 52px;
		border-radius: 50%;
		background: #ffffff;
		color: #1a1a1a;
		text-decoration: none;
		box-shadow: 0 12px 34px rgba(0, 0, 0, 0.08);
		-webkit-tap-highlight-color: transparent;
	}

	.back-btn {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		min-height: 44px;
		color: #007aff;
		font-size: 17px;
		font-weight: 500;
		text-decoration: none;
		-webkit-tap-highlight-color: transparent;
	}

	.toolbar-spacer {
		width: 44px;
		height: 44px;
	}

	.main {
		flex: 1;
		width: 100%;
		padding: 0 16px calc(env(safe-area-inset-bottom, 0px) + 32px);
	}

	/* On larger screens, constrain the content width */
	@media (min-width: 640px) {
		.main {
			max-width: 480px;
			margin: 0 auto;
		}
	}
</style>
