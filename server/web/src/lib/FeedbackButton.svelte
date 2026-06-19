<script lang="ts">
	import { page } from '$app/state';
	import { version } from '$app/environment';

	let open = $state(false);
	let body = $state('');
	let images = $state<{ data: string; contentType: string; preview: string }[]>([]);
	let submitting = $state(false);
	let submitted = $state(false);
	let error = $state('');

	const route = $derived(page.url.pathname);

	function toggle() {
		if (!open) {
			body = '';
			images = [];
			submitted = false;
			error = '';
		}
		open = !open;
	}

	function handlePaste(e: ClipboardEvent) {
		const items = e.clipboardData?.items;
		if (!items) return;

		for (const item of items) {
			if (item.type.startsWith('image/')) {
				e.preventDefault();
				const file = item.getAsFile();
				if (file) addImage(file);
			}
		}
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		const files = e.dataTransfer?.files;
		if (!files) return;
		for (const file of files) {
			if (file.type.startsWith('image/')) {
				addImage(file);
			}
		}
	}

	function addImage(file: File) {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result as string;
			// result is like "data:image/png;base64,iVBOR..."
			const base64 = result.split(',')[1];
			images = [...images, { data: base64, contentType: file.type, preview: result }];
		};
		reader.readAsDataURL(file);
	}

	function removeImage(index: number) {
		images = images.filter((_, i) => i !== index);
	}

	async function submit() {
		if (!body.trim() && images.length === 0) return;

		submitting = true;
		error = '';

		try {
			const payload = {
				route,
				version,
				body: body.trim(),
				images: images.map((img) => ({ data: img.data, contentType: img.contentType }))
			};

			const resp = await fetch('/api/feedback', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			if (!resp.ok) {
				const text = await resp.text();
				throw new Error(text || `HTTP ${resp.status}`);
			}

			submitted = true;
			setTimeout(() => {
				open = false;
			}, 1500);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			submitting = false;
		}
	}
</script>

<!-- Feedback FAB -->
<button class="feedback-fab" onclick={toggle} aria-label="Send Feedback" title="Send Feedback">
	<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
		<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
	</svg>
</button>

<!-- Feedback Dialog -->
{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="overlay" onclick={toggle} onkeydown={(e) => e.key === 'Escape' && toggle()}></div>
	<div class="feedback-dialog" role="dialog" aria-label="Send Feedback">
		{#if submitted}
			<div class="success">
				<span class="success-icon">✓</span>
				<span>Feedback submitted!</span>
			</div>
		{:else}
			<div class="dialog-header">
				<h3>Send Feedback</h3>
				<button class="close-btn" onclick={toggle} aria-label="Close">✕</button>
			</div>

			<div class="route-badge">
				<span class="route-label">Page:</span>
				<code>{route}</code>
			</div>

			<textarea
				class="feedback-input"
				bind:value={body}
				placeholder="Describe the issue or suggestion…"
				rows="4"
				onpaste={handlePaste}
				ondrop={handleDrop}
				ondragover={(e) => e.preventDefault()}
			></textarea>

			<p class="hint">Paste or drop images here</p>

			{#if images.length > 0}
				<div class="image-previews">
					{#each images as img, i}
						<div class="image-thumb">
							<img src={img.preview} alt="Attached {i + 1}" />
							<button class="remove-img" onclick={() => removeImage(i)} aria-label="Remove image">✕</button>
						</div>
					{/each}
				</div>
			{/if}

			{#if error}
				<p class="error-msg">{error}</p>
			{/if}

			<button
				class="submit-btn"
				onclick={submit}
				disabled={submitting || (!body.trim() && images.length === 0)}
			>
				{submitting ? 'Submitting…' : 'Submit Feedback'}
			</button>
		{/if}
	</div>
{/if}

<style>
	.feedback-fab {
		position: fixed;
		bottom: calc(70px + env(safe-area-inset-bottom, 0px));
		left: 16px;
		width: 52px;
		height: 52px;
		border-radius: 50%;
		background: #6c6c6c;
		color: white;
		border: none;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
		cursor: pointer;
		z-index: 5;
		-webkit-tap-highlight-color: transparent;
		transition: transform 0.12s ease;
	}

	.feedback-fab:active {
		transform: scale(0.9);
	}

	@media (min-width: 640px) {
		.feedback-fab {
			width: 56px;
			height: 56px;
			left: 20px;
			bottom: 90px;
		}
	}

	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.3);
		z-index: 100;
	}

	.feedback-dialog {
		position: fixed;
		bottom: 80px;
		left: 16px;
		right: 16px;
		max-width: 400px;
		margin: 0 auto;
		background: white;
		border-radius: 16px;
		padding: 20px;
		box-shadow: 0 8px 40px rgba(0, 0, 0, 0.2);
		z-index: 101;
		max-height: 70vh;
		overflow-y: auto;
	}

	.dialog-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 12px;
	}

	.dialog-header h3 {
		margin: 0;
		font-size: 17px;
		font-weight: 600;
	}

	.close-btn {
		background: none;
		border: none;
		font-size: 18px;
		color: #999;
		cursor: pointer;
		padding: 4px 8px;
		border-radius: 6px;
	}

	.close-btn:hover {
		background: #f0f0f0;
	}

	.route-badge {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 12px;
		font-size: 13px;
	}

	.route-label {
		color: #888;
		font-weight: 500;
	}

	.route-badge code {
		background: #f5f5f5;
		padding: 2px 8px;
		border-radius: 4px;
		font-size: 12px;
		color: #333;
	}

	.feedback-input {
		width: 100%;
		border: 1.5px solid #e0e0e0;
		border-radius: 10px;
		padding: 12px;
		font-size: 15px;
		resize: vertical;
		min-height: 80px;
		outline: none;
		transition: border-color 0.15s;
		font-family: inherit;
	}

	.feedback-input:focus {
		border-color: #007AFF;
	}

	.hint {
		margin: 6px 0 0;
		font-size: 12px;
		color: #aaa;
	}

	.image-previews {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 10px;
	}

	.image-thumb {
		position: relative;
		width: 60px;
		height: 60px;
		border-radius: 8px;
		overflow: hidden;
		border: 1px solid #e0e0e0;
	}

	.image-thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.remove-img {
		position: absolute;
		top: 2px;
		right: 2px;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.6);
		color: white;
		border: none;
		font-size: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}

	.error-msg {
		margin: 8px 0 0;
		font-size: 13px;
		color: #FF3B30;
	}

	.submit-btn {
		width: 100%;
		margin-top: 14px;
		padding: 12px;
		border: none;
		border-radius: 10px;
		background: #007AFF;
		color: white;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		transition: opacity 0.15s;
	}

	.submit-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.submit-btn:active:not(:disabled) {
		opacity: 0.8;
	}

	.success {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 24px;
		font-size: 16px;
		font-weight: 600;
		color: #34C759;
	}

	.success-icon {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: #34C759;
		color: white;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 14px;
	}
</style>
