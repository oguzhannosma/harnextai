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

/** Webview bundle (browser IIFE). Shares `src/shared/messages.ts` with the host
 * so the message protocol/validators are a single source of truth. */
/** @type {import('esbuild').BuildOptions} */
const webviewOptions = {
	entryPoints: ['src/webview/main.ts'],
	bundle: true,
	outfile: 'media/webview.js',
	platform: 'browser',
	format: 'iife',
	target: 'es2020',
	sourcemap: !production,
	minify: production,
	logLevel: 'info',
};

async function main() {
	if (watch) {
		const contexts = await Promise.all([
			esbuild.context(extensionOptions),
			esbuild.context(webviewOptions),
		]);
		await Promise.all(contexts.map((ctx) => ctx.watch()));
		console.log('esbuild: watching for changes...');
	} else {
		await Promise.all([esbuild.build(extensionOptions), esbuild.build(webviewOptions)]);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
