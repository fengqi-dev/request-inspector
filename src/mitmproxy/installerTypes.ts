export const DEFAULT_MITMPROXY_VERSION = '12.2.3';
export const DEFAULT_RUNTIME_RELEASE_OWNER = 'fengqi-dev';
export const DEFAULT_RUNTIME_RELEASE_REPO = 'mimtproxy-release';

export type MitmproxyArchiveType = 'tar.gz';

export interface MitmproxyDownloadOptions {
	version: string;
	platform?: NodeJS.Platform;
	arch?: string;
	releaseOwner?: string;
	releaseRepo?: string;
	releaseTag?: string;
}

export interface MitmproxyDownload {
	assetName: string;
	archiveType: MitmproxyArchiveType;
	platformKey: string;
	url: string;
}

export interface ManagedMitmproxyPathOptions extends MitmproxyDownloadOptions {
	homeDir?: string;
}

export interface ManagedMitmproxyPaths {
	rootDir: string;
	installDir: string;
	manifestPath: string;
	executablePath: string;
}

export interface DownloadProgress {
	downloadedBytes: number;
	totalBytes?: number;
}

export type DownloadProgressReporter = (progress: DownloadProgress) => void;

export interface ManagedMitmproxyInstallResult {
	executablePath: string;
	version: string;
}

export interface ManagedMitmproxyInstallOptions extends ManagedMitmproxyPathOptions {
	downloadFile?: (url: string, destinationPath: string, onDownloadProgress?: DownloadProgressReporter) => Promise<void>;
	extractArchive?: (archivePath: string, destinationDir: string, archiveType: MitmproxyArchiveType) => Promise<void>;
	onDownloadProgress?: DownloadProgressReporter;
	onInstalled?: (result: ManagedMitmproxyInstallResult) => void;
}

export interface InstallManifest {
	version: string;
	executablePath: string;
}
