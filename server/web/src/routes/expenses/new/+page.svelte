<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { apiGet, apiWrite, ApiError } from '$lib/api';
	import ExpenseKeypadScreen from '$lib/ExpenseKeypadScreen.svelte';
	import { pickDefaultCategoryId } from '$lib/default-category';
	import type { Category, Expense, Preferences } from '$lib/types';
	import { newId, nowMillis, nowSeconds } from '$lib/util';

	type ExpenseFormValue = {
		amount: number;
		category_id: string;
		merchant: string;
		date: number;
	};

	let categories = $state<Category[]>([]);
	let prefs = $state<Preferences | null>(null);
	let error = $state('');
	let defaultCategoryId = $state('');
	const initialDate = nowSeconds();

	onMount(async () => {
		try {
			const [categoryData, preferenceData] = await Promise.all([
				apiGet<{ categories: Category[] }>('/api/categories'),
				apiGet<Preferences>('/api/preferences')
			]);
			categories = (categoryData.categories ?? []).filter((category) => !category.deleted_at);
			prefs = preferenceData;
			defaultCategoryId = pickDefaultCategoryId(categories);
		} catch (e) {
			if (e instanceof ApiError && e.status !== 401) error = e.message;
			else if (!(e instanceof ApiError)) error = String(e);
		}
	});

	async function submit(value: ExpenseFormValue) {
		error = '';
		const id = newId();
		const body = {
			id,
			amount: value.amount,
			currency: prefs?.currency || 'SGD',
			category_id: value.category_id,
			merchant: value.merchant,
			description: '',
			date: value.date,
			client_updated_at: nowMillis()
		};

		const result = await apiWrite<Expense>('POST', '/api/expenses', body, `expense:${id}`);
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
