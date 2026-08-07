import adapter from '@sveltejs/adapter-static';
import { execSync } from 'node:child_process';

function gitHash() {
	if (process.env.GIT_SHA) {
		return process.env.GIT_SHA.slice(0, 7);
	}
	try {
		return execSync('git rev-parse --short HEAD').toString().trim();
	} catch {
		return 'unknown';
	}
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter({
			pages: 'dist',
			assets: 'dist',
			fallback: 'index.html',
			precompress: false
		}),
		// We register the service worker manually so we can detect updates and
		// surface a "reload" banner instead of taking control mid-edit. See
		// src/lib/sw-client.ts.
		serviceWorker: {
			register: false
		},
		version: {
			name: gitHash()
		}
	}
};

export default config;
