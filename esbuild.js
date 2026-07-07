'use strict';

// Bundles the extension host code into a single `dist/extension.js` (CJS).
// `vscode` is the only external — it is provided by the runtime host.
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

/** Extension host bundle (CJS, node). `vscode` is the only external. */
/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
	entryPoints: ['src/extension.ts'],
	bundle: true,
	outfile: 'dist/extension.js',
	platform: 'node',
	format: 'cjs',
	target: 'node18',
	external: ['vscode'],
	sourcemap: !production,
	minify: production,
	logLevel: 'info',
};

/** Webview bundles (browser IIFE). Each shares `src/shared/messages.ts` with the
 * host so the message protocol/validators are a single source of truth. One
 * entry per webview: the form editor, the transcript viewer, the memory panel. */
/** @param {string} entry @param {string} outfile @returns {import('esbuild').BuildOptions} */
const webviewBundle = (entry, outfile) => ({
	entryPoints: [entry],
	bundle: true,
	outfile,
	platform: 'browser',
	format: 'iife',
	target: 'es2020',
	sourcemap: !production,
	minify: production,
	logLevel: 'info',
});

const webviewOptionsList = [
	webviewBundle('src/webview/main.ts', 'media/webview.js'),
	webviewBundle('src/webview/transcript.ts', 'media/transcript.js'),
	webviewBundle('src/webview/memory.ts', 'media/memory.js'),
];

async function main() {
	const allOptions = [extensionOptions, ...webviewOptionsList];
	if (watch) {
		const contexts = await Promise.all(allOptions.map((o) => esbuild.context(o)));
		await Promise.all(contexts.map((ctx) => ctx.watch()));
		console.log('esbuild: watching for changes...');
	} else {
		await Promise.all(allOptions.map((o) => esbuild.build(o)));
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
