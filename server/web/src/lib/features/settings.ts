import { apiGet, apiWrite, exchangeSecret, type WriteResult } from '$lib/api';
import { discard, drain, listAll, retry, type OutboxRecord } from '$lib/outbox';
import type { Preferences } from '$lib/types';

export async function loadPreferences(): Promise<Preferences> {
	return apiGet<Preferences>('/api/preferences');
}

export async function savePreferences(prefs: Preferences): Promise<WriteResult<Preferences>> {
	return apiWrite<Preferences>('PUT', '/api/preferences', prefs, 'preferences');
}

export async function saveSyncSecret(secret: string): Promise<void> {
	await exchangeSecret(secret);
}

export async function listFailedWrites(): Promise<OutboxRecord[]> {
	const all = await listAll();
	return all.filter((record) => record.status === 'failed').sort((a, b) => b.createdAt - a.createdAt);
}

export async function retryFailedWrite(id: number): Promise<void> {
	await retry(id);
	await drain();
}

export async function discardFailedWrite(id: number): Promise<void> {
	await discard(id);
}
