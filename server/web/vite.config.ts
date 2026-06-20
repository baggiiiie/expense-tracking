import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

function gitInfo(format: string, fallback: string) {
	try {
		return execSync(`git log -1 --format=${format}`).toString().trim();
	} catch {
		return fallback;
	}
}

export default defineConfig({
	define: {
		__COMMIT_HASH__: JSON.stringify(gitInfo('%h', 'dev')),
		__COMMIT_MESSAGE__: JSON.stringify(gitInfo('%s', ''))
	},
	plugins: [sveltekit()],
	server: {
		proxy: {
			'/api': 'http://localhost:8080'
		}
	}
});
