import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';
import * as zlib from 'zlib';

import type { MitmproxyArchiveType } from './installerTypes';

const gunzip = promisify(zlib.gunzip);

export async function extractMitmproxyArchive(archivePath: string, destinationDir: string, archiveType: MitmproxyArchiveType): Promise<void> {
	await fsPromises.mkdir(destinationDir, { recursive: true });
	if (archiveType === 'tar.gz') {
		await extractTarGzArchive(archivePath, destinationDir);
		return;
	}
}

async function extractTarGzArchive(archivePath: string, destinationDir: string): Promise<void> {
	const archive = await gunzip(await fsPromises.readFile(archivePath));
	let offset = 0;

	while (offset + 512 <= archive.length) {
		const header = archive.subarray(offset, offset + 512);
		offset += 512;
		if (header.every((byte) => byte === 0)) {
			break;
		}

		const name = readTarString(header, 0, 100);
		const prefix = readTarString(header, 345, 155);
		const entryName = prefix ? `${prefix}/${name}` : name;
		const size = readTarOctal(header, 124, 12);
		const mode = readTarOctal(header, 100, 8);
		const type = String.fromCharCode(header[156] ?? 0).replace('\0', '');
		const entryPath = resolveTarEntryPath(destinationDir, entryName);
		const fileContent = archive.subarray(offset, offset + size);
		offset += Math.ceil(size / 512) * 512;

		if (type === '5') {
			await fsPromises.mkdir(entryPath, { recursive: true });
			continue;
		}

		if (type === '2') {
			const linkName = readTarString(header, 157, 100);
			if (path.isAbsolute(linkName) || linkName.split('/').includes('..')) {
				throw new Error(`Refusing to extract unsafe tar symlink: ${entryName} -> ${linkName}`);
			}
			await fsPromises.mkdir(path.dirname(entryPath), { recursive: true });
			await fsPromises.rm(entryPath, { force: true });
			await fsPromises.symlink(linkName, entryPath);
			continue;
		}

		if (type !== '' && type !== '0') {
			continue;
		}

		await fsPromises.mkdir(path.dirname(entryPath), { recursive: true });
		await fsPromises.writeFile(entryPath, fileContent);
		if (mode > 0) {
			await fsPromises.chmod(entryPath, mode);
		}
	}
}

function readTarString(header: Buffer, offset: number, length: number): string {
	const value = header.subarray(offset, offset + length);
	const end = value.indexOf(0);
	return value.subarray(0, end === -1 ? value.length : end).toString('utf8').trim();
}

function readTarOctal(header: Buffer, offset: number, length: number): number {
	const value = readTarString(header, offset, length).trim();
	return value === '' ? 0 : Number.parseInt(value, 8);
}

function resolveTarEntryPath(destinationDir: string, entryName: string): string {
	const parts = entryName.split('/').filter((part) => part !== '' && part !== '.');
	if (parts.includes('..') || path.isAbsolute(entryName)) {
		throw new Error(`Refusing to extract unsafe tar path: ${entryName}`);
	}

	const destinationRoot = path.resolve(destinationDir);
	const entryPath = path.resolve(destinationRoot, ...parts);
	if (entryPath !== destinationRoot && !entryPath.startsWith(`${destinationRoot}${path.sep}`)) {
		throw new Error(`Refusing to extract unsafe tar path: ${entryName}`);
	}
	return entryPath;
}
