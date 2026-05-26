<script lang="ts">
	import { goto } from '$app/navigation';
	import { markAuthenticated } from '$lib/stores';

	let username = $state('');
	let password = $state('');
	let error = $state('');
	let busy = $state(false);

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (!username.trim() || !password.trim()) {
			error = 'Please enter both username and password.';
			return;
		}
		busy = true;
		try {
			const res = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({ username: username.trim(), password: password.trim() })
			});
			if (res.status === 204) {
				markAuthenticated();
				await goto('/');
			} else {
				const body = await res.json().catch(() => ({ error: 'Login failed' }));
				error = body.error || 'Login failed';
			}
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="login-page">
	<div class="login-card">
		<div class="logo">💰</div>
		<h1>Expense Tracker</h1>
		<p class="subtitle">Sign in to continue</p>

		<form onsubmit={handleSubmit}>
			<div class="field">
				<input
					type="text"
					placeholder="Username"
					autocomplete="username"
					bind:value={username}
				/>
			</div>
			<div class="field">
				<input
					type="password"
					placeholder="Password"
					autocomplete="current-password"
					bind:value={password}
				/>
			</div>
			{#if error}
				<p class="error">{error}</p>
			{/if}
			<button type="submit" class="btn-login" disabled={busy}>
				{busy ? 'Signing in…' : 'Sign In'}
			</button>
		</form>
	</div>
</div>

<style>
	.login-page {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		background: #ffffff;
	}

	.login-card {
		width: 100%;
		max-width: 360px;
		text-align: center;
	}

	.logo {
		font-size: 48px;
		margin-bottom: 8px;
	}

	h1 {
		margin: 0 0 4px;
		font-size: 24px;
		font-weight: 700;
		color: #1a1a1a;
	}

	.subtitle {
		margin: 0 0 28px;
		font-size: 15px;
		color: #888;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.field input {
		width: 100%;
		padding: 14px 16px;
		border: 1.5px solid #e0e0e0;
		border-radius: 12px;
		font-size: 16px;
		background: #f9fafb;
		transition: border-color 0.15s;
	}

	.field input:focus {
		outline: none;
		border-color: #007AFF;
		background: white;
	}

	.error {
		margin: 0;
		font-size: 14px;
		color: #dc2626;
		text-align: left;
	}

	.btn-login {
		margin-top: 4px;
		padding: 14px;
		border: none;
		border-radius: 12px;
		background: #1a1a1a;
		color: white;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.btn-login:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-login:not(:disabled):active {
		opacity: 0.8;
	}
</style>
