import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';

import type { InstallManifest, ManagedMitmproxyPaths } from './installerTypes';

export async function getExistingInstallExecutable(paths: ManagedMitmproxyPaths, version: string, platform?: NodeJS.Platform): Promise<string | undefined> {
	try {
		const manifest = JSON.parse(await fsPromises.readFile(paths.manifestPath, 'utf8')) as InstallManifest;
		await fsPromises.access(paths.executablePath, fs.constants.F_OK);
		await rewriteMitmproxyLauncherShebang(paths, platform);
		if (await hasDeprecatedPythonModuleLauncher(paths.executablePath)) {
			return undefined;
		}
		return manifest.version === version && manifest.executablePath === paths.executablePath ? paths.executablePath : undefined;
	} catch {
		return undefined;
	}
}

export async function rewriteMitmproxyLauncherShebang(paths: ManagedMitmproxyPaths, platform?: NodeJS.Platform): Promise<void> {
	if (platform === 'win32' || process.platform === 'win32') {
		return;
	}

	const pythonPath = path.join(paths.installDir, 'python', 'bin', 'python3');
	try {
		const launcher = await fsPromises.readFile(paths.executablePath, 'utf8');
		if (!launcher.startsWith('#!')) {
			return;
		}

		const newlineIndex = launcher.indexOf('\n');
		const firstLine = newlineIndex === -1 ? launcher : launcher.slice(0, newlineIndex);
		if (!firstLine.includes('python')) {
			return;
		}

		const rest = newlineIndex === -1 ? '' : launcher.slice(newlineIndex);
		await fsPromises.writeFile(paths.executablePath, `#!${pythonPath}${rest}`);
	} catch {
		// Missing launcher is handled by executable validation.
	}
}

export async function ensureMitmproxyExecutableExists(executablePath: string): Promise<void> {
	if (!await fileExists(executablePath)) {
		throw new Error(`Packaged runtime must contain ${path.relative(path.dirname(path.dirname(path.dirname(executablePath))), executablePath)}.`);
	}
}

export async function validateRuntimeManifest(installDir: string, version: string): Promise<void> {
	const manifestPath = path.join(installDir, 'request-inspector-runtime.json');
	if (!await fileExists(manifestPath)) {
		return;
	}

	const manifest = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8')) as { version?: string };
	if (manifest.version !== version) {
		throw new Error(`Runtime manifest version mismatch: expected ${version}, got ${manifest.version ?? 'unknown'}.`);
	}
}

async function hasDeprecatedPythonModuleLauncher(executablePath: string): Promise<boolean> {
	try {
		const launcher = await fsPromises.readFile(executablePath, 'utf8');
		return /python(?:3|(?:\\|\/)python\.exe)?"?\s+-m\s+"?mitmproxy"?/.test(launcher);
	} catch {
		return false;
	}
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fsPromises.access(filePath, fs.constants.F_OK);
		return true;
	} catch {
		return false;
	}
}
