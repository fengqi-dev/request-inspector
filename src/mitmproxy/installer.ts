import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { downloadArchive } from './runtimeDownload';
import {
	ensureMitmproxyExecutableExists,
	getExistingInstallExecutable,
	rewriteMitmproxyLauncherShebang,
	validateRuntimeManifest,
} from './runtimeInstallState';
import { buildMitmproxyDownload, getManagedMitmproxyPaths } from './runtimePaths';
import { extractMitmproxyArchive } from './tarGz';
import type { InstallManifest, ManagedMitmproxyInstallOptions } from './installerTypes';

export {
	DEFAULT_MITMPROXY_VERSION,
	DEFAULT_RUNTIME_RELEASE_OWNER,
	DEFAULT_RUNTIME_RELEASE_REPO,
	type DownloadProgress,
	type DownloadProgressReporter,
	type ManagedMitmproxyInstallOptions,
	type ManagedMitmproxyInstallResult,
	type ManagedMitmproxyPathOptions,
	type ManagedMitmproxyPaths,
	type MitmproxyArchiveType,
	type MitmproxyDownload,
	type MitmproxyDownloadOptions,
} from './installerTypes';
export {
	buildMitmproxyDownload,
	getManagedMitmproxyPaths,
	getRequestInspectorHome,
	resolveDownloadRedirectUrl,
} from './runtimePaths';

export async function ensureManagedMitmproxyInstalled(options: ManagedMitmproxyInstallOptions): Promise<string> {
	const paths = getManagedMitmproxyPaths(options);
	const existingExecutable = await getExistingInstallExecutable(paths, options.version, options.platform);
	if (existingExecutable) {
		return existingExecutable;
	}

	const download = buildMitmproxyDownload(options);
	const downloadFile = options.downloadFile ?? downloadArchive;
	const extractArchive = options.extractArchive ?? extractMitmproxyArchive;
	await fsPromises.mkdir(paths.rootDir, { recursive: true });
	const tempDir = await fsPromises.mkdtemp(path.join(paths.rootDir, 'install-'));
	const archivePath = path.join(tempDir, download.assetName);

	try {
		await downloadFile(download.url, archivePath, options.onDownloadProgress);
		await fsPromises.rm(paths.installDir, { recursive: true, force: true });
		await fsPromises.mkdir(paths.installDir, { recursive: true });
		await extractArchive(archivePath, paths.installDir, download.archiveType);
		await rewriteMitmproxyLauncherShebang(paths, options.platform);
		await ensureMitmproxyExecutableExists(paths.executablePath);
		await validateRuntimeManifest(paths.installDir, options.version);
		if (process.platform !== 'win32') {
			await fsPromises.chmod(paths.executablePath, 0o755);
		}
		await fsPromises.writeFile(paths.manifestPath, JSON.stringify({
			version: options.version,
			executablePath: paths.executablePath,
		} satisfies InstallManifest, undefined, 2));
		options.onInstalled?.({ executablePath: paths.executablePath, version: options.version });
		return paths.executablePath;
	} finally {
		await fsPromises.rm(tempDir, { recursive: true, force: true });
	}
}
