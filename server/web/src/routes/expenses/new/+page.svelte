<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ApiError } from '$lib/api';
	import ExpenseKeypadScreen from '$lib/ExpenseKeypadScreen.svelte';
	import {
		createExpense,
		loadNewExpenseContext,
		type ExpenseFormValue
	} from '$lib/features/expenses';
	import type { Category, Preferences } from '$lib/types';
	import { nowSeconds } from '$lib/util';

	let categories = $state<Category[]>([]);
	let prefs = $state<Preferences | null>(null);
	let error = $state('');
	let defaultCategoryId = $state('');
	const initialDate = nowSeconds();

	onMount(async () => {
		try {
			const context = await loadNewExpenseContext();
			categories = context.categories;
			prefs = context.prefs;
			defaultCategoryId = context.defaultCategoryId;
		} catch (e) {
			if (e instanceof ApiError && e.status !== 401) error = e.message;
			else if (!(e instanceof ApiError)) error = String(e);
		}
	});

	async function submit(value: ExpenseFormValue) {
		if (!prefs) return;
		error = '';
		const result = await createExpense(value, prefs);
		if (result.kind === 'error') {
			error = result.error.message;
			return;
		}
		await goto('/');
	}
</script>

<ExpenseKeypadScreen
	categories={categories}
	initialKey="new"
	initialCategoryId={defaultCategoryId}
	initialDate={initialDate}
	error={error}
	onCancel={() => goto('/')}
	onSubmit={submit}
/>
