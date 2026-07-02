import * as assert from 'assert';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

import { MITMPROXY_COMMANDS, MITMPROXY_COMMAND_IDS } from '../commands/ids';
import { DynamicProxyDebugEnvironmentProvider, buildAutomaticDebugInjectionEnabledMessage, type DebugConfigurationWithEnvironment } from '../debug/environmentProvider';
import { resolveMitmproxyCommand } from '../mitmproxy/commandResolver';
import { findAvailablePort } from '../mitmproxy/port';
import { buildMissingMitmproxyMessage, isMitmproxyCommandAvailable, type CommandProbe } from '../mitmproxy/systemCommand';
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

	test('uses system mitmproxy command when command setting is default', async () => {
		const command = await resolveMitmproxyCommand({
			configuredCommand: 'mitmproxy',
		});

		assert.strictEqual(command, 'mitmproxy');
	});

	test('uses custom mitmproxy command when configured', async () => {
		const command = await resolveMitmproxyCommand({
			configuredCommand: '/usr/local/bin/mitmproxy',
		});

		assert.strictEqual(command, '/usr/local/bin/mitmproxy');
	});

	test('detects available system mitmproxy command', async () => {
		const available = await isMitmproxyCommandAvailable('mitmproxy', (_command, _args, _options, callback) => {
			callback(null);
		});

		assert.strictEqual(available, true);
	});

	test('detects missing system mitmproxy command', async () => {
		const probe: CommandProbe = (_command, _args, _options, callback) => {
			const error = new Error('spawn mitmproxy ENOENT') as Error & { code: string };
			error.code = 'ENOENT';
			callback(error);
		};

		const available = await isMitmproxyCommandAvailable('mitmproxy', probe);

		assert.strictEqual(available, false);
	});

	test('builds missing mitmproxy install prompt message', () => {
		assert.strictEqual(
			buildMissingMitmproxyMessage('mitmproxy'),
			'Request Inspector could not find "mitmproxy". Install mitmproxy and make sure it is available on your PATH.',
		);
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
			REQUESTS_CA_BUNDLE: path.join(os.homedir(), '.mitmproxy', 'mitmproxy-ca-cert.pem'),
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
			REQUESTS_CA_BUNDLE: path.join(os.homedir(), '.mitmproxy', 'mitmproxy-ca-cert.pem'),
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
