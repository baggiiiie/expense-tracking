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
	import FeedbackButton from '$lib/FeedbackButton.svelte';

	let { children } = $props();

	const tabs = [
		{ href: '/', label: 'Expenses', icon: '💰', match: (path: string) => path === '/' || path.startsWith('/expenses') },
		{ href: '/categories', label: 'Categories', icon: '🏷️', match: (path: string) => path.startsWith('/categories') },
		{ href: '/recurring', label: 'Recurring', icon: '🔄', match: (path: string) => path.startsWith('/recurring') },
		{ href: '/suggestions', label: 'Wallet', icon: '💳', match: (path: string) => path.startsWith('/suggestions') },
		{ href: '/settings', label: 'Settings', icon: '⚙️', match: (path: string) => path.startsWith('/settings') }
	];

	const path = $derived(page.url.pathname);
	const isLoginPage = $derived(path === '/login');
	const currentTitle = $derived(
		tabs.find((t) => t.match(path))?.label ?? 'Expenses'
	);

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

{#if isLoginPage}
	{@render children()}
{:else}
	<div class="shell">
		<header class="header">
			<SyncStatusPill />
			<h1>{currentTitle}</h1>
			<a href="/settings" class="settings-btn" aria-label="Settings">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="12" cy="12" r="3"/>
					<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-1.42 3.42 2 2 0 0 1-1.42-.59l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-3.42-1.42 2 2 0 0 1 .59-1.42l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 1.42-3.42 2 2 0 0 1 1.42.59l.06.06A1.65 1.65 0 0 0 9 4.6h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 3.42 1.42 2 2 0 0 1-.59 1.42l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
				</svg>
			</a>
		</header>

		<main class="main">
			{@render children()}
		</main>

		<nav class="tabs" aria-label="Primary">
			{#each tabs as tab}
				<a href={tab.href} class:active={tab.match(path)}>
					<span class="tab-icon">{tab.icon}</span>
					<span class="tab-label">{tab.label}</span>
				</a>
			{/each}
		</nav>
	</div>

	<FeedbackButton />
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

	.shell {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		max-width: 100vw;
		overflow-x: hidden;
	}

	.header {
		position: sticky;
		top: 0;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 16px;
		padding-top: calc(env(safe-area-inset-top, 0px) + 10px);
		background: rgba(255, 255, 255, 0.92);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
	}

	.header h1 {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		margin: 0;
		font-size: 17px;
		font-weight: 600;
	}

	.settings-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: #f5f5f5;
		color: #1a1a1a;
		text-decoration: none;
	}

	.main {
		flex: 1;
		width: 100%;
		padding: 0 16px 88px;
	}

	/* On larger screens, constrain the content width */
	@media (min-width: 640px) {
		.main {
			max-width: 480px;
			margin: 0 auto;
		}
	}

	.tabs {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		background: rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-top: 0.5px solid #e5e5e5;
		padding: 6px 0 calc(env(safe-area-inset-bottom, 0px) + 6px);
		z-index: 10;
	}

	.tabs a {
		text-decoration: none;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		padding: 4px 2px 2px;
		color: #999;
		transition: color 0.15s;
		-webkit-tap-highlight-color: transparent;
	}

	.tabs a.active {
		color: #007AFF;
	}

	.tab-icon {
		font-size: 18px;
		line-height: 1.2;
	}

	.tab-label {
		font-size: 10px;
		font-weight: 500;
		letter-spacing: -0.1px;
	}
</style>
