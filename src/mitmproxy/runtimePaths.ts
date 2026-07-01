import * as os from 'os';
import * as path from 'path';

import {
	DEFAULT_RUNTIME_RELEASE_OWNER,
	DEFAULT_RUNTIME_RELEASE_REPO,
	type ManagedMitmproxyPathOptions,
	type ManagedMitmproxyPaths,
	type MitmproxyArchiveType,
	type MitmproxyDownload,
	type MitmproxyDownloadOptions,
} from './installerTypes';

export function getRequestInspectorHome(homeDir = os.homedir()): string {
	return path.join(homeDir, '.request-inspector');
}

export function buildMitmproxyDownload(options: MitmproxyDownloadOptions): MitmproxyDownload {
	const platform = options.platform ?? process.platform;
	const arch = options.arch ?? process.arch;
	const platformKey = getMitmproxyPlatformKey(platform, arch);
	const archiveType: MitmproxyArchiveType = 'tar.gz';
	const assetName = `request-inspector-mitmproxy-${options.version}-${platformKey}.${archiveType}`;
	const releaseOwner = options.releaseOwner ?? DEFAULT_RUNTIME_RELEASE_OWNER;
	const releaseRepo = options.releaseRepo ?? DEFAULT_RUNTIME_RELEASE_REPO;
	const releaseTag = options.releaseTag ?? options.version;

	return {
		assetName,
		archiveType,
		platformKey,
		url: `https://gh.fengqi.dev/https://github.com/${releaseOwner}/${releaseRepo}/releases/download/${releaseTag}/${assetName}`,
	};
}

export function resolveDownloadRedirectUrl(requestUrl: string, location: string): string {
	const redirectedUrl = new URL(location, requestUrl);
	if (redirectedUrl.protocol !== 'https:') {
		throw new Error(`Refusing to follow non-HTTPS mitmproxy download redirect: ${redirectedUrl.toString()}`);
	}
	return redirectedUrl.toString();
}

export function getManagedMitmproxyPaths(options: ManagedMitmproxyPathOptions): ManagedMitmproxyPaths {
	const download = buildMitmproxyDownload(options);
	const rootDir = getRequestInspectorHome(options.homeDir);
	const installDir = path.join(rootDir, 'mitmproxy', options.version, download.platformKey);
	const executablePath = path.join(
		installDir,
		'python',
		process.platform === 'win32' || options.platform === 'win32' ? 'Scripts' : 'bin',
		process.platform === 'win32' || options.platform === 'win32' ? 'mitmproxy.exe' : 'mitmproxy',
	);

	return {
		rootDir,
		installDir,
		manifestPath: path.join(installDir, 'install.json'),
		executablePath,
	};
}

function getMitmproxyPlatformKey(platform: NodeJS.Platform, arch: string): string {
	if (platform === 'darwin' && arch === 'arm64') {
		return 'macos-arm64';
	}
	if (platform === 'darwin' && arch === 'x64') {
		return 'macos-x86_64';
	}
	if (platform === 'linux' && arch === 'x64') {
		return 'linux-x86_64';
	}
	if (platform === 'linux' && arch === 'arm64') {
		return 'linux-arm64';
	}
	if (platform === 'win32' && arch === 'x64') {
		return 'windows-x86_64';
	}

	throw new Error(`Unsupported platform for managed mitmproxy: ${platform}-${arch}`);
}
