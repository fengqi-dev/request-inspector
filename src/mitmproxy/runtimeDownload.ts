import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as https from 'https';
import * as path from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';

import { resolveDownloadRedirectUrl } from './runtimePaths';
import type { DownloadProgressReporter } from './installerTypes';

export async function downloadArchive(url: string, destinationPath: string, onDownloadProgress?: DownloadProgressReporter, redirectCount = 0): Promise<void> {
	await fsPromises.mkdir(path.dirname(destinationPath), { recursive: true });
	await new Promise<void>((resolve, reject) => {
		https.get(url, (response) => {
			if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
				response.resume();
				if (!response.headers.location) {
					reject(new Error(`Failed to download mitmproxy: HTTP ${response.statusCode} without redirect location`));
					return;
				}
				if (redirectCount >= 5) {
					reject(new Error('Failed to download mitmproxy: too many redirects'));
					return;
				}

				downloadArchive(resolveDownloadRedirectUrl(url, response.headers.location), destinationPath, onDownloadProgress, redirectCount + 1).then(resolve, reject);
				return;
			}

			if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
				response.resume();
				reject(new Error(`Failed to download mitmproxy: HTTP ${response.statusCode ?? 'unknown'}`));
				return;
			}

			const totalBytes = parseContentLength(response.headers['content-length']);
			let downloadedBytes = 0;
			const progressStream = new Transform({
				transform(chunk: Buffer, _encoding, callback) {
					downloadedBytes += chunk.length;
					onDownloadProgress?.({ downloadedBytes, totalBytes });
					callback(undefined, chunk);
				},
			});

			pipeline(response, progressStream, fs.createWriteStream(destinationPath)).then(resolve, reject);
		}).on('error', reject);
	});
}

function parseContentLength(contentLength: string | string[] | undefined): number | undefined {
	if (Array.isArray(contentLength)) {
		return parseContentLength(contentLength[0]);
	}
	if (!contentLength) {
		return undefined;
	}

	const parsed = Number.parseInt(contentLength, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
