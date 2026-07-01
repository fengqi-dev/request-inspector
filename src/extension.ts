import * as vscode from 'vscode';

import { registerMitmproxyCommands } from './commands/register';
import { DynamicProxyDebugEnvironmentProvider, buildAutomaticDebugInjectionEnabledMessage } from './debug/environmentProvider';
import {
	DEFAULT_MITMPROXY_VERSION,
	DEFAULT_RUNTIME_RELEASE_OWNER,
	DEFAULT_RUNTIME_RELEASE_REPO,
	ensureManagedMitmproxyInstalled,
} from './mitmproxy/installer';
import { findAvailablePort } from './mitmproxy/port';
import { MitmproxyTerminalManager, type MitmproxyStartOptions } from './mitmproxy/terminalManager';
import { buildMitmproxyStatusBarPresentation } from './statusBar/presentation';

let terminalManager: MitmproxyTerminalManager | undefined;

export function activate(context: vscode.ExtensionContext) {
	terminalManager = new MitmproxyTerminalManager((options) => vscode.window.createTerminal({
		name: options.name,
		shellPath: options.shellPath,
		shellArgs: options.shellArgs,
	}));
	const debugEnvironmentProvider = new DynamicProxyDebugEnvironmentProvider();
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	let managedMitmproxyCommand = prepareManagedMitmproxy(DEFAULT_MITMPROXY_VERSION);
	let activeProxyPort: number | undefined;

	const updateStatusBar = () => {
		if (!terminalManager) {
			return;
		}

		const presentation = buildMitmproxyStatusBarPresentation({
			status: terminalManager.status,
			proxyPort: activeProxyPort,
		});
		statusBarItem.text = presentation.text;
		statusBarItem.tooltip = presentation.tooltip;
		statusBarItem.command = presentation.command;
		statusBarItem.color = presentation.colorThemeId ? new vscode.ThemeColor(presentation.colorThemeId) : undefined;
		statusBarItem.show();
	};

	const getStartOptions = async (): Promise<MitmproxyStartOptions> => {
		const command = await managedMitmproxyCommand;
		if (!command) {
			throw new Error('Managed mitmproxy is not installed.');
		}
		return {
			command,
			proxyPort: await findAvailablePort(),
		};
	};

	async function prepareManagedMitmproxy(version: string): Promise<string | undefined> {
		try {
			return await Promise.resolve(vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: `Installing mitmproxy ${version} for Request Inspector`,
			}, async (progress) => {
				let lastDownloadPercent = 0;
				return ensureManagedMitmproxyInstalled({
					version,
					releaseOwner: DEFAULT_RUNTIME_RELEASE_OWNER,
					releaseRepo: DEFAULT_RUNTIME_RELEASE_REPO,
					onDownloadProgress: ({ downloadedBytes, totalBytes }) => {
						if (totalBytes !== undefined) {
							const downloadPercent = Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100));
							const increment = downloadPercent - lastDownloadPercent;
							if (increment > 0) {
								lastDownloadPercent = downloadPercent;
								progress.report({
									increment,
									message: `Downloading ${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`,
								});
							}
							return;
						}

						progress.report({ message: `Downloading ${formatBytes(downloadedBytes)}` });
					},
					onInstalled: ({ executablePath }) => {
						vscode.window.showInformationMessage(`mitmproxy ${version} installed successfully for Request Inspector: ${executablePath}`);
					},
				});
			}));
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to install managed mitmproxy: ${error instanceof Error ? error.message : String(error)}`);
			return undefined;
		}
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1024) {
			return `${bytes} B`;
		}
		const kibibytes = bytes / 1024;
		if (kibibytes < 1024) {
			return `${kibibytes.toFixed(1)} KiB`;
		}
		return `${(kibibytes / 1024).toFixed(1)} MiB`;
	}

	const renderPanel = () => {
		terminalManager?.reveal();
	};

	const startMitmproxy = async () => {
		try {
			const options = await getStartOptions();
			activeProxyPort = options.proxyPort;
			const status = await terminalManager?.start(options);
			renderPanel();

			if (status?.state === 'running') {
				debugEnvironmentProvider.enable(options.proxyPort);
				vscode.window.showInformationMessage(buildAutomaticDebugInjectionEnabledMessage(options.proxyPort));
			}
		} catch (error) {
			activeProxyPort = undefined;
			updateStatusBar();
			vscode.window.showErrorMessage(`Failed to start mitmproxy: ${error instanceof Error ? error.message : String(error)}`);
		}
	};

	const stopMitmproxy = () => {
		terminalManager?.stop();
		activeProxyPort = undefined;
		updateStatusBar();
		vscode.window.showInformationMessage('mitmproxy stopped.');
	};

	const restartMitmproxy = async () => {
		try {
			const options = await getStartOptions();
			activeProxyPort = options.proxyPort;
			const status = await terminalManager?.restart(options);
			renderPanel();

			if (status?.state === 'running') {
				debugEnvironmentProvider.enable(options.proxyPort);
				vscode.window.showInformationMessage(buildAutomaticDebugInjectionEnabledMessage(options.proxyPort));
			}
		} catch (error) {
			activeProxyPort = undefined;
			updateStatusBar();
			vscode.window.showErrorMessage(`Failed to restart mitmproxy: ${error instanceof Error ? error.message : String(error)}`);
		}
	};

	const toggleMitmproxy = async () => {
		if (terminalManager?.status.state === 'running') {
			stopMitmproxy();
			return;
		}

		await startMitmproxy();
	};

	updateStatusBar();

	context.subscriptions.push(
		statusBarItem,
		vscode.debug.registerDebugConfigurationProvider('*', {
			resolveDebugConfiguration: async (
				_folder: vscode.WorkspaceFolder | undefined,
				debugConfiguration: vscode.DebugConfiguration,
			): Promise<vscode.DebugConfiguration> => {
				return debugEnvironmentProvider.resolveDebugConfiguration(_folder, debugConfiguration) as Promise<vscode.DebugConfiguration>;
			},
		}),
		vscode.window.onDidCloseTerminal((terminal: vscode.Terminal) => {
			terminalManager?.handleTerminalClosed(terminal);
		}),
		vscode.window.onDidChangeTerminalState((terminal: vscode.Terminal) => {
			terminalManager?.handleTerminalStateChanged(terminal);
		}),
		terminalManager.onDidChangeStatus((status) => {
			if (status.state !== 'running') {
				activeProxyPort = undefined;
			}
			updateStatusBar();

			if (status.state !== 'running') {
				debugEnvironmentProvider.disable();
			}

			if (status.state === 'error' && status.error) {
				vscode.window.showErrorMessage(`Failed to start mitmproxy: ${status.error}`);
			}
		}),
		{ dispose: () => terminalManager?.stop() },
	);

	registerMitmproxyCommands(context, {
		open: renderPanel,
		start: startMitmproxy,
		stop: stopMitmproxy,
		restart: restartMitmproxy,
		toggle: toggleMitmproxy,
	});
}

export function deactivate() {
	terminalManager?.stop();
	terminalManager = undefined;
}
