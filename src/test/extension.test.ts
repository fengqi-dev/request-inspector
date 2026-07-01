import * as assert from 'assert';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';

import { MITMPROXY_COMMANDS, MITMPROXY_COMMAND_IDS } from '../commands/ids';
import { DynamicProxyDebugEnvironmentProvider, buildAutomaticDebugInjectionEnabledMessage, type DebugConfigurationWithEnvironment } from '../debug/environmentProvider';
import {
	DEFAULT_MITMPROXY_VERSION,
	DEFAULT_RUNTIME_RELEASE_OWNER,
	DEFAULT_RUNTIME_RELEASE_REPO,
	buildMitmproxyDownload,
	ensureManagedMitmproxyInstalled,
	getManagedMitmproxyPaths,
	getRequestInspectorHome,
	resolveDownloadRedirectUrl,
} from '../mitmproxy/installer';
import { resolveMitmproxyCommand } from '../mitmproxy/commandResolver';
import { findAvailablePort } from '../mitmproxy/port';
import { MitmproxyTerminalManager, type MitmproxyTerminalOptions, buildMitmproxyArgs } from '../mitmproxy/terminalManager';
import { buildMitmproxyStatusBarPresentation } from '../statusBar/presentation';

suite('Extension Test Suite', () => {
	const packageJsonPath = path.resolve(__dirname, '../../package.json');
	const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
		contributes: {
			commands: Array<{ command: string; title: string }>;
			viewsContainers?: {
				panel?: Array<{ id: string; title: string; icon: string }>;
			};
			views?: Record<string, Array<{ id: string; name: string; type?: string }>>;
			configuration?: {
				properties: Record<string, { default?: unknown }>;
			};
		};
	};

	test('contributes mitmproxy commands', () => {
		const commandIds = packageJson.contributes.commands.map((command) => command.command);

		assert.deepStrictEqual(commandIds, MITMPROXY_COMMAND_IDS);
	});

	test('does not contribute a custom terminal webview', () => {
		assert.strictEqual(packageJson.contributes.viewsContainers, undefined);
		assert.strictEqual(packageJson.contributes.views, undefined);
	});

	test('does not contribute mitmproxy configuration settings', () => {
		assert.strictEqual(packageJson.contributes.configuration, undefined);
	});

	test('builds mitmproxy arguments from proxy port', () => {
		const args = buildMitmproxyArgs({ proxyPort: 8888 });

		assert.deepStrictEqual(args, [
			'--listen-port',
			'8888',
		]);
	});

	test('finds an available local proxy port', async () => {
		const port = await findAvailablePort();

		assert.strictEqual(Number.isInteger(port), true);
		assert.strictEqual(port > 0, true);
		assert.strictEqual(port <= 65535, true);
	});

	test('uses preferred proxy port when available', async () => {
		const preferredPort = await reserveAndReleasePort();

		const port = await findAvailablePort('127.0.0.1', preferredPort);

		assert.strictEqual(port, preferredPort);
	});

	test('falls back to an available proxy port when preferred port is busy', async () => {
		const server = await listenOnEphemeralPort();
		try {
			const address = server.address();
			assert.ok(address && typeof address !== 'string');

			const port = await findAvailablePort('127.0.0.1', address.port);

			assert.notStrictEqual(port, address.port);
			assert.strictEqual(Number.isInteger(port), true);
			assert.strictEqual(port > 0, true);
			assert.strictEqual(port <= 65535, true);
		} finally {
			await closeServer(server);
		}
	});

	test('builds Request Inspector runtime release asset URL for platform archives', () => {
		assert.deepStrictEqual(buildMitmproxyDownload({
			version: '12.2.3',
			platform: 'darwin',
			arch: 'arm64',
		}), {
			assetName: 'request-inspector-mitmproxy-12.2.3-macos-arm64.tar.gz',
			archiveType: 'tar.gz',
			platformKey: 'macos-arm64',
			url: `https://gh.fengqi.dev/https://github.com/${DEFAULT_RUNTIME_RELEASE_OWNER}/${DEFAULT_RUNTIME_RELEASE_REPO}/releases/download/12.2.3/request-inspector-mitmproxy-12.2.3-macos-arm64.tar.gz`,
		});
		assert.deepStrictEqual(buildMitmproxyDownload({
			version: '12.2.3',
			platform: 'win32',
			arch: 'x64',
			releaseOwner: 'custom-owner',
			releaseRepo: 'custom-repo',
			releaseTag: 'custom-tag',
		}), {
			assetName: 'request-inspector-mitmproxy-12.2.3-windows-x86_64.tar.gz',
			archiveType: 'tar.gz',
			platformKey: 'windows-x86_64',
			url: 'https://gh.fengqi.dev/https://github.com/custom-owner/custom-repo/releases/download/custom-tag/request-inspector-mitmproxy-12.2.3-windows-x86_64.tar.gz',
		});
	});

	test('builds Request Inspector runtime release asset URL for linux arm64 archives', () => {
		assert.deepStrictEqual(buildMitmproxyDownload({
			version: '12.2.3',
			platform: 'linux',
			arch: 'arm64',
		}), {
			assetName: 'request-inspector-mitmproxy-12.2.3-linux-arm64.tar.gz',
			archiveType: 'tar.gz',
			platformKey: 'linux-arm64',
			url: `https://gh.fengqi.dev/https://github.com/${DEFAULT_RUNTIME_RELEASE_OWNER}/${DEFAULT_RUNTIME_RELEASE_REPO}/releases/download/12.2.3/request-inspector-mitmproxy-12.2.3-linux-arm64.tar.gz`,
		});
	});

	test('resolves HTTPS mitmproxy download redirects', () => {
		assert.strictEqual(
			resolveDownloadRedirectUrl(
				'https://github.com/fengqi-dev/mimtproxy-release/releases/download/12.2.3/request-inspector-mitmproxy-12.2.3-macos-arm64.tar.gz',
				'https://objects.githubusercontent.com/github-production-release-asset/example',
			),
			'https://objects.githubusercontent.com/github-production-release-asset/example',
		);
		assert.strictEqual(
			resolveDownloadRedirectUrl('https://github.com/fengqi-dev/mimtproxy-release/releases/download/12.2.3/archive.tar.gz', '../assets/archive.tar.gz'),
			'https://github.com/fengqi-dev/mimtproxy-release/releases/download/assets/archive.tar.gz',
		);
		assert.throws(
			() => resolveDownloadRedirectUrl('https://github.com/fengqi-dev/mimtproxy-release/releases/download/12.2.3/archive.tar.gz', 'http://example.com/archive.tar.gz'),
			/non-HTTPS/,
		);
	});

	test('resolves managed mitmproxy paths under request inspector home', () => {
		const homeDir = path.join(os.tmpdir(), 'request-inspector-test-home');

		assert.strictEqual(getRequestInspectorHome(homeDir), path.join(homeDir, '.request-inspector'));
		assert.deepStrictEqual(getManagedMitmproxyPaths({
			homeDir,
			version: DEFAULT_MITMPROXY_VERSION,
			platform: 'linux',
			arch: 'x64',
		}), {
			rootDir: path.join(homeDir, '.request-inspector'),
			installDir: path.join(homeDir, '.request-inspector', 'mitmproxy', DEFAULT_MITMPROXY_VERSION, 'linux-x86_64'),
			manifestPath: path.join(homeDir, '.request-inspector', 'mitmproxy', DEFAULT_MITMPROXY_VERSION, 'linux-x86_64', 'install.json'),
			executablePath: path.join(homeDir, '.request-inspector', 'mitmproxy', DEFAULT_MITMPROXY_VERSION, 'linux-x86_64', 'python', 'bin', 'mitmproxy'),
		});
		assert.deepStrictEqual(getManagedMitmproxyPaths({
			homeDir,
			version: DEFAULT_MITMPROXY_VERSION,
			platform: 'linux',
			arch: 'arm64',
		}), {
			rootDir: path.join(homeDir, '.request-inspector'),
			installDir: path.join(homeDir, '.request-inspector', 'mitmproxy', DEFAULT_MITMPROXY_VERSION, 'linux-arm64'),
			manifestPath: path.join(homeDir, '.request-inspector', 'mitmproxy', DEFAULT_MITMPROXY_VERSION, 'linux-arm64', 'install.json'),
			executablePath: path.join(homeDir, '.request-inspector', 'mitmproxy', DEFAULT_MITMPROXY_VERSION, 'linux-arm64', 'python', 'bin', 'mitmproxy'),
		});
	});

	test('skips managed mitmproxy download when manifest and executable exist', async () => {
		const homeDir = createTempHomeDir();
		const paths = getManagedMitmproxyPaths({ homeDir, version: '12.2.3', platform: 'linux', arch: 'x64' });
		fs.mkdirSync(path.dirname(paths.executablePath), { recursive: true });
		fs.writeFileSync(paths.executablePath, '');
		fs.writeFileSync(paths.manifestPath, JSON.stringify({ version: '12.2.3', executablePath: paths.executablePath }));
		let downloadCount = 0;

		const executablePath = await ensureManagedMitmproxyInstalled({
			homeDir,
			version: '12.2.3',
			platform: 'linux',
			arch: 'x64',
			downloadFile: async () => {
				downloadCount += 1;
			},
			extractArchive: async () => undefined,
		});

		assert.strictEqual(executablePath, paths.executablePath);
		assert.strictEqual(downloadCount, 0);
	});

	test('redownloads managed mitmproxy when existing launcher uses removed python module entrypoint', async () => {
		const homeDir = createTempHomeDir();
		const paths = getManagedMitmproxyPaths({ homeDir, version: '12.2.3', platform: 'linux', arch: 'x64' });
		fs.mkdirSync(path.dirname(paths.executablePath), { recursive: true });
		fs.writeFileSync(paths.executablePath, 'exec "$ROOT/python/bin/python3" -m "mitmproxy" "$@"');
		fs.writeFileSync(paths.manifestPath, JSON.stringify({ version: '12.2.3', executablePath: paths.executablePath }));
		let downloadCount = 0;

		const executablePath = await ensureManagedMitmproxyInstalled({
			homeDir,
			version: '12.2.3',
			platform: 'linux',
			arch: 'x64',
			downloadFile: async (_url, archivePath) => {
				downloadCount += 1;
				fs.mkdirSync(path.dirname(archivePath), { recursive: true });
				fs.writeFileSync(archivePath, 'archive');
			},
			extractArchive: async (_archivePath, destinationDir) => {
				fs.mkdirSync(path.join(destinationDir, 'python', 'bin'), { recursive: true });
				fs.writeFileSync(path.join(destinationDir, 'python', 'bin', 'mitmproxy'), 'from mitmproxy.tools.main import mitmproxy as main');
			},
		});

		assert.strictEqual(executablePath, paths.executablePath);
		assert.strictEqual(downloadCount, 1);
	});

	test('downloads and extracts managed mitmproxy when missing', async () => {
		const homeDir = createTempHomeDir();
		const paths = getManagedMitmproxyPaths({ homeDir, version: '12.2.3', platform: 'darwin', arch: 'arm64' });
		const downloadedUrls: string[] = [];
		const extractedArchives: string[] = [];
		const downloadProgressEvents: Array<{ downloadedBytes: number; totalBytes?: number }> = [];
		const installedExecutables: string[] = [];

		const executablePath = await ensureManagedMitmproxyInstalled({
			homeDir,
			version: '12.2.3',
			platform: 'darwin',
			arch: 'arm64',
			onDownloadProgress: (progress) => {
				downloadProgressEvents.push(progress);
			},
			onInstalled: ({ executablePath: installedExecutable }) => {
				installedExecutables.push(installedExecutable);
			},
			downloadFile: async (url, archivePath, onDownloadProgress) => {
				downloadedUrls.push(url);
				fs.mkdirSync(path.dirname(archivePath), { recursive: true });
				fs.writeFileSync(archivePath, 'archive');
				onDownloadProgress?.({ downloadedBytes: 7, totalBytes: 10 });
			},
			extractArchive: async (archivePath, destinationDir) => {
				extractedArchives.push(archivePath);
				fs.mkdirSync(path.join(destinationDir, 'python', 'bin'), { recursive: true });
				fs.writeFileSync(path.join(destinationDir, 'python', 'bin', 'mitmproxy'), '');
			},
		});

		assert.strictEqual(executablePath, paths.executablePath);
		assert.deepStrictEqual(downloadedUrls, [`https://gh.fengqi.dev/https://github.com/${DEFAULT_RUNTIME_RELEASE_OWNER}/${DEFAULT_RUNTIME_RELEASE_REPO}/releases/download/12.2.3/request-inspector-mitmproxy-12.2.3-macos-arm64.tar.gz`]);
		assert.strictEqual(extractedArchives.length, 1);
		assert.deepStrictEqual(downloadProgressEvents, [{ downloadedBytes: 7, totalBytes: 10 }]);
		assert.deepStrictEqual(installedExecutables, [paths.executablePath]);
		assert.strictEqual(fs.existsSync(paths.manifestPath), true);
		assert.strictEqual(fs.existsSync(paths.executablePath), true);
	});

	test('extracts managed mitmproxy tar.gz without relying on system tar', async () => {
		const homeDir = createTempHomeDir();
		const paths = getManagedMitmproxyPaths({ homeDir, version: '12.2.3', platform: 'darwin', arch: 'arm64' });

		const executablePath = await ensureManagedMitmproxyInstalled({
			homeDir,
			version: '12.2.3',
			platform: 'darwin',
			arch: 'arm64',
			downloadFile: async (_url, archivePath) => {
				fs.mkdirSync(path.dirname(archivePath), { recursive: true });
				fs.writeFileSync(archivePath, createTarGzArchive({
					'python/bin/mitmproxy': '#!/build/runtime/python/bin/python3\nprint("mitmproxy")\n',
					'request-inspector-runtime.json': JSON.stringify({ version: '12.2.3' }),
				}));
			},
		});

		assert.strictEqual(executablePath, paths.executablePath);
		assert.strictEqual(fs.readFileSync(paths.executablePath, 'utf8').split('\n')[0], `#!${path.join(paths.installDir, 'python', 'bin', 'python3')}`);
		assert.strictEqual(fs.existsSync(paths.manifestPath), true);
	});

	test('does not notify install completion when managed mitmproxy already exists', async () => {
		const homeDir = createTempHomeDir();
		const paths = getManagedMitmproxyPaths({ homeDir, version: '12.2.3', platform: 'linux', arch: 'x64' });
		fs.mkdirSync(path.dirname(paths.executablePath), { recursive: true });
		fs.writeFileSync(paths.executablePath, '');
		fs.writeFileSync(paths.manifestPath, JSON.stringify({ version: '12.2.3', executablePath: paths.executablePath }));
		let installNotificationCount = 0;

		await ensureManagedMitmproxyInstalled({
			homeDir,
			version: '12.2.3',
			platform: 'linux',
			arch: 'x64',
			onInstalled: () => {
				installNotificationCount += 1;
			},
			downloadFile: async () => {
				throw new Error('Unexpected download');
			},
			extractArchive: async () => undefined,
		});

		assert.strictEqual(installNotificationCount, 0);
	});

	test('rejects packaged runtime without python bin mitmproxy launcher', async () => {
		const homeDir = createTempHomeDir();
		const paths = getManagedMitmproxyPaths({ homeDir, version: '12.2.3', platform: 'darwin', arch: 'arm64' });
		const legacyExecutablePath = path.join(paths.installDir, 'mitmproxy');

		await assert.rejects(
			ensureManagedMitmproxyInstalled({
				homeDir,
				version: '12.2.3',
				platform: 'darwin',
				arch: 'arm64',
				downloadFile: async (_url, archivePath) => {
					fs.mkdirSync(path.dirname(archivePath), { recursive: true });
					fs.writeFileSync(archivePath, 'archive');
				},
				extractArchive: async (_archivePath, destinationDir) => {
					fs.mkdirSync(destinationDir, { recursive: true });
					fs.writeFileSync(legacyExecutablePath, '');
				},
			}),
			/Packaged runtime must contain python\/bin\/mitmproxy/,
		);
	});

	test('rewrites packaged launcher shebang to installed python path', async () => {
		const homeDir = createTempHomeDir();
		const paths = getManagedMitmproxyPaths({ homeDir, version: '12.2.3', platform: 'darwin', arch: 'arm64' });

		await ensureManagedMitmproxyInstalled({
			homeDir,
			version: '12.2.3',
			platform: 'darwin',
			arch: 'arm64',
			downloadFile: async (_url, archivePath) => {
				fs.mkdirSync(path.dirname(archivePath), { recursive: true });
				fs.writeFileSync(archivePath, 'archive');
			},
			extractArchive: async (_archivePath, destinationDir) => {
				fs.mkdirSync(path.join(destinationDir, 'python', 'bin'), { recursive: true });
				fs.writeFileSync(path.join(destinationDir, 'python', 'bin', 'mitmproxy'), [
					'#!/Users/runner/work/mimtproxy-release/mimtproxy-release/artifacts/.work/macos-arm64/runtime/python/bin/python3',
					'import sys',
				].join('\n'));
				fs.writeFileSync(path.join(destinationDir, 'python', 'bin', 'mitmdump'), '#!/old/python/bin/python3\n');
				fs.writeFileSync(path.join(destinationDir, 'python', 'bin', 'mitmweb'), '#!/old/python/bin/python3\n');
			},
		});

		const launcher = fs.readFileSync(paths.executablePath, 'utf8');
		assert.strictEqual(launcher.split('\n')[0], `#!${path.join(paths.installDir, 'python', 'bin', 'python3')}`);
		assert.strictEqual(fs.readFileSync(path.join(paths.installDir, 'python', 'bin', 'mitmdump'), 'utf8').split('\n')[0], '#!/old/python/bin/python3');
		assert.strictEqual(fs.readFileSync(path.join(paths.installDir, 'python', 'bin', 'mitmweb'), 'utf8').split('\n')[0], '#!/old/python/bin/python3');
	});

	test('repairs existing packaged launcher shebang without redownloading', async () => {
		const homeDir = createTempHomeDir();
		const paths = getManagedMitmproxyPaths({ homeDir, version: '12.2.3', platform: 'darwin', arch: 'arm64' });
		fs.mkdirSync(path.dirname(paths.executablePath), { recursive: true });
		fs.writeFileSync(paths.executablePath, '#!/Users/runner/work/mimtproxy-release/mimtproxy-release/artifacts/.work/macos-arm64/runtime/python/bin/python3\n');
		fs.writeFileSync(paths.manifestPath, JSON.stringify({ version: '12.2.3', executablePath: paths.executablePath }));
		let downloadCount = 0;

		await ensureManagedMitmproxyInstalled({
			homeDir,
			version: '12.2.3',
			platform: 'darwin',
			arch: 'arm64',
			downloadFile: async () => {
				downloadCount += 1;
			},
			extractArchive: async () => undefined,
		});

		assert.strictEqual(downloadCount, 0);
		assert.strictEqual(fs.readFileSync(paths.executablePath, 'utf8').split('\n')[0], `#!${path.join(paths.installDir, 'python', 'bin', 'python3')}`);
	});

	test('preserves packaged runtime root beside mitmproxy executable', async () => {
		const homeDir = createTempHomeDir();
		const paths = getManagedMitmproxyPaths({ homeDir, version: '12.2.3', platform: 'darwin', arch: 'arm64' });

		await ensureManagedMitmproxyInstalled({
			homeDir,
			version: '12.2.3',
			platform: 'darwin',
			arch: 'arm64',
			downloadFile: async (_url, archivePath) => {
				fs.mkdirSync(path.dirname(archivePath), { recursive: true });
				fs.writeFileSync(archivePath, 'archive');
			},
			extractArchive: async (_archivePath, destinationDir) => {
				fs.mkdirSync(path.join(destinationDir, 'python', 'bin'), { recursive: true });
				fs.writeFileSync(path.join(destinationDir, 'python', 'bin', 'mitmproxy'), '');
				fs.writeFileSync(path.join(destinationDir, 'request-inspector-runtime.json'), JSON.stringify({
					version: '12.2.3',
					platform: 'macos',
					arch: 'arm64',
					executableName: 'python/bin/mitmproxy',
				}));
			},
		});

		assert.strictEqual(fs.existsSync(path.join(paths.installDir, 'python', 'bin', 'mitmproxy')), true);
	});

	test('rejects packaged runtime manifest version mismatch', async () => {
		const homeDir = createTempHomeDir();

		await assert.rejects(
			ensureManagedMitmproxyInstalled({
				homeDir,
				version: '12.2.3',
				platform: 'darwin',
				arch: 'arm64',
				downloadFile: async (_url, archivePath) => {
					fs.mkdirSync(path.dirname(archivePath), { recursive: true });
					fs.writeFileSync(archivePath, 'archive');
				},
				extractArchive: async (_archivePath, destinationDir) => {
					fs.mkdirSync(path.join(destinationDir, 'python', 'bin'), { recursive: true });
					fs.writeFileSync(path.join(destinationDir, 'python', 'bin', 'mitmproxy'), '');
					fs.writeFileSync(path.join(destinationDir, 'request-inspector-runtime.json'), JSON.stringify({
						version: '0.0.0',
					}));
				},
			}),
			/Runtime manifest version mismatch/,
		);
	});

	test('uses managed mitmproxy command when command setting is default', async () => {
		let managedCommandResolved = false;
		const command = await resolveMitmproxyCommand({
			configuredCommand: 'mitmproxy',
			managedCommand: async () => {
				managedCommandResolved = true;
				return '/home/user/.request-inspector/mitmproxy/mitmproxy';
			},
		});

		assert.strictEqual(command, '/home/user/.request-inspector/mitmproxy/mitmproxy');
		assert.strictEqual(managedCommandResolved, true);
	});

	test('uses custom mitmproxy command without waiting for managed install', async () => {
		let managedCommandResolved = false;
		const command = await resolveMitmproxyCommand({
			configuredCommand: '/usr/local/bin/mitmproxy',
			managedCommand: async () => {
				managedCommandResolved = true;
				return '/home/user/.request-inspector/mitmproxy/mitmproxy';
			},
		});

		assert.strictEqual(command, '/usr/local/bin/mitmproxy');
		assert.strictEqual(managedCommandResolved, false);
	});

	test('builds automatic debug injection enabled message', () => {
		assert.strictEqual(
			buildAutomaticDebugInjectionEnabledMessage(8888),
			'mitmproxy started. Future VS Code debug sessions will automatically receive proxy environment variables for http://127.0.0.1:8888.',
		);
	});

	test('automatically injects proxy environment variables and notifies debug configurations', async () => {
		const provider = new DynamicProxyDebugEnvironmentProvider();
		provider.enable(8888);

		const resolved = await provider.resolveConfiguration({
			type: 'node',
			name: 'Launch',
			request: 'launch',
			env: {
				NODE_ENV: 'test',
			},
		});

		assert.deepStrictEqual(resolved.env, {
			NODE_ENV: 'test',
			HTTP_PROXY: 'http://127.0.0.1:8888',
			HTTPS_PROXY: 'http://127.0.0.1:8888',
			ALL_PROXY: 'http://127.0.0.1:8888',
		});
	});

	test('does not mutate debug configurations while injecting proxy environment variables', async () => {
		const provider = new DynamicProxyDebugEnvironmentProvider();
		const configuration: DebugConfigurationWithEnvironment = {
			type: 'node',
			name: 'Launch',
			request: 'launch',
			env: {
				HTTP_PROXY: 'http://example.test:8080',
			},
		};
		provider.enable(9090);

		const resolved = await provider.resolveConfiguration(configuration);

		assert.notStrictEqual(resolved, configuration);
		assert.notStrictEqual(resolved.env, configuration.env);
		assert.ok(resolved.env);
		assert.ok(configuration.env);
		assert.strictEqual(configuration.env.HTTP_PROXY, 'http://example.test:8080');
		assert.strictEqual(resolved.env.HTTP_PROXY, 'http://127.0.0.1:9090');
	});

	test('leaves debug configurations unchanged and does not notify when proxy environment injection is disabled', async () => {
		const provider = new DynamicProxyDebugEnvironmentProvider();
		const configuration = {
			type: 'node',
			name: 'Launch',
			request: 'launch',
			env: {
				NODE_ENV: 'test',
			},
		};

		const resolved = await provider.resolveConfiguration(configuration);

		assert.strictEqual(resolved, configuration);
	});

	test('automatically injects proxy environment variables without requiring a debug-start choice', async () => {
		const provider = new DynamicProxyDebugEnvironmentProvider();
		const configuration: DebugConfigurationWithEnvironment = {
			type: 'node',
			name: 'Launch',
			request: 'launch',
		};
		provider.enable(8888);

		const resolved = await provider.resolveConfiguration(configuration);

		assert.deepStrictEqual(resolved.env, {
			HTTP_PROXY: 'http://127.0.0.1:8888',
			HTTPS_PROXY: 'http://127.0.0.1:8888',
			ALL_PROXY: 'http://127.0.0.1:8888',
		});
	});

	test('stops notifying after disabling proxy environment injection', async () => {
		const provider = new DynamicProxyDebugEnvironmentProvider();
		const configuration = {
			type: 'node',
			name: 'Launch',
			request: 'launch',
		};
		provider.enable(8888);
		provider.disable();

		const resolved = await provider.resolveConfiguration(configuration);

		assert.strictEqual(resolved, configuration);
	});

	test('starts mitmproxy in a VS Code terminal', async () => {
		const createdTerminals: FakeMitmproxyTerminal[] = [];
		const createdOptions: MitmproxyTerminalOptions[] = [];
		const manager = new MitmproxyTerminalManager((options: MitmproxyTerminalOptions) => {
			const terminal = new FakeMitmproxyTerminal(options.name);
			createdOptions.push(options);
			createdTerminals.push(terminal);
			return terminal;
		});

		await manager.start({ command: 'mitmproxy', proxyPort: 9090 });

		assert.strictEqual(manager.status.state, 'running');
		assert.strictEqual(manager.status.terminalName, 'mitmproxy');
		assert.strictEqual(createdTerminals.length, 1);
		assert.deepStrictEqual(createdOptions, [{
			name: 'mitmproxy',
			shellPath: 'mitmproxy',
			shellArgs: ['--listen-port', '9090'],
		}]);
		assert.strictEqual(createdTerminals[0].shown, true);
	});

	test('stops a running VS Code terminal', async () => {
		const terminal = new FakeMitmproxyTerminal('mitmproxy');
		const manager = new MitmproxyTerminalManager(() => terminal);

		await manager.start({ command: 'mitmproxy', proxyPort: 8888 });
		manager.stop();

		assert.strictEqual(terminal.disposed, true);
		assert.strictEqual(manager.status.state, 'stopped');
	});

	test('marks mitmproxy stopped when the managed terminal is closed', async () => {
		const terminal = new FakeMitmproxyTerminal('mitmproxy');
		const manager = new MitmproxyTerminalManager(() => terminal);
		const statuses: string[] = [];
		manager.onDidChangeStatus((status) => statuses.push(status.state));

		await manager.start({ command: 'mitmproxy', proxyPort: 8888 });
		manager.handleTerminalClosed(terminal);

		assert.strictEqual(manager.status.state, 'stopped');
		assert.deepStrictEqual(statuses, ['running', 'stopped']);
	});

	test('marks mitmproxy stopped when the managed terminal process exits', async () => {
		const terminal = new FakeMitmproxyTerminal('mitmproxy');
		const manager = new MitmproxyTerminalManager(() => terminal);
		const statuses: string[] = [];
		manager.onDidChangeStatus((status) => statuses.push(status.state));

		await manager.start({ command: 'mitmproxy', proxyPort: 8888 });
		terminal.exitStatus = { code: 0 };
		manager.handleTerminalStateChanged(terminal);

		assert.strictEqual(manager.status.state, 'stopped');
		assert.deepStrictEqual(statuses, ['running', 'stopped']);
	});

	test('restarts mitmproxy terminal with the latest options', async () => {
		const firstTerminal = new FakeMitmproxyTerminal('mitmproxy');
		const secondTerminal = new FakeMitmproxyTerminal('mitmproxy');
		const pendingTerminals = [firstTerminal, secondTerminal];
		const createdOptions: MitmproxyTerminalOptions[] = [];
		const manager = new MitmproxyTerminalManager((options: MitmproxyTerminalOptions) => {
			const terminal = pendingTerminals.shift();
			assert.ok(terminal);
			createdOptions.push(options);
			return terminal;
		});

		await manager.start({ command: 'mitmproxy', proxyPort: 8888 });
		await manager.restart({ command: 'mitmproxy', proxyPort: 9090 });

		assert.strictEqual(pendingTerminals.length, 0);
		assert.strictEqual(manager.status.state, 'running');
		assert.strictEqual(firstTerminal.disposed, true);
		assert.deepStrictEqual(createdOptions[1], {
			name: 'mitmproxy',
			shellPath: 'mitmproxy',
			shellArgs: ['--listen-port', '9090'],
		});
	});

	test('renders stopped status bar action as start', () => {
		const presentation = buildMitmproxyStatusBarPresentation({
			status: { state: 'stopped' },
		});

		assert.strictEqual(presentation.text, '$(play) mitmproxy');
		assert.strictEqual(
			presentation.tooltip,
			'Status: stopped\nProxy: automatic port\nClick to start mitmproxy.',
		);
		assert.strictEqual(presentation.command, MITMPROXY_COMMANDS.toggle);
		assert.strictEqual(presentation.colorThemeId, undefined);
	});

	test('renders running status bar action as stop', () => {
		const presentation = buildMitmproxyStatusBarPresentation({
			status: { state: 'running', terminalName: 'mitmproxy' },
			proxyPort: 9090,
		});

		assert.strictEqual(presentation.text, '$(debug-stop) mitmproxy');
		assert.strictEqual(
			presentation.tooltip,
			'Status: running (mitmproxy)\nProxy: 127.0.0.1:9090\nClick to stop mitmproxy.',
		);
		assert.strictEqual(presentation.command, MITMPROXY_COMMANDS.toggle);
		assert.strictEqual(presentation.colorThemeId, 'charts.green');
	});

	test('renders error status bar action as retry start', () => {
		const presentation = buildMitmproxyStatusBarPresentation({
			status: { state: 'error', error: 'missing command' },
		});

		assert.strictEqual(presentation.text, '$(error) mitmproxy');
		assert.strictEqual(
			presentation.tooltip,
			'Status: error\nProxy: automatic port\nError: missing command\nClick to start mitmproxy.',
		);
		assert.strictEqual(presentation.command, MITMPROXY_COMMANDS.toggle);
		assert.strictEqual(presentation.colorThemeId, undefined);
	});
});

class FakeMitmproxyTerminal {
	public shown = false;
	public disposed = false;
	public exitStatus: { code: number | undefined } | undefined;

	public constructor(public readonly name: string) { }

	public show(): void {
		this.shown = true;
	}

	public dispose(): void {
		this.disposed = true;
	}
}

class FakeDebugPromptWindow {
	public readonly messages: Array<{ message: string; items: string[] }> = [];

	public showWarningMessage(message: string, ...items: string[]): Promise<string | undefined> {
		this.messages.push({ message, items });
		return Promise.resolve(undefined);
	}
}

function createTempHomeDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'request-inspector-home-'));
}

function createTarGzArchive(files: Record<string, string>): Buffer {
	const chunks: Buffer[] = [];
	for (const [filePath, content] of Object.entries(files)) {
		const contentBuffer = Buffer.from(content);
		const header = Buffer.alloc(512);
		header.write(filePath, 0, 100, 'utf8');
		header.write('0000777\0', 100, 8, 'ascii');
		header.write('0000000\0', 108, 8, 'ascii');
		header.write('0000000\0', 116, 8, 'ascii');
		header.write(contentBuffer.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
		header.write('00000000000\0', 136, 12, 'ascii');
		header.fill(' ', 148, 156);
		header.write('0', 156, 1, 'ascii');
		header.write('ustar\0', 257, 6, 'ascii');
		header.write('00', 263, 2, 'ascii');

		let checksum = 0;
		for (const byte of header) {
			checksum += byte;
		}
		header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');

		chunks.push(header, contentBuffer);
		const padding = (512 - (contentBuffer.length % 512)) % 512;
		if (padding > 0) {
			chunks.push(Buffer.alloc(padding));
		}
	}
	chunks.push(Buffer.alloc(1024));
	return zlib.gzipSync(Buffer.concat(chunks));
}

async function reserveAndReleasePort(): Promise<number> {
	const server = await listenOnEphemeralPort();
	const address = server.address();
	assert.ok(address && typeof address !== 'string');
	const { port } = address;
	await closeServer(server);
	return port;
}

function listenOnEphemeralPort(): Promise<net.Server> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			server.off('error', reject);
			resolve(server);
		});
	});
}

function closeServer(server: net.Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});
}
