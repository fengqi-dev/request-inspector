import * as vscode from 'vscode';

import { registerMitmproxyCommands } from './commands/register';
import { DynamicProxyDebugEnvironmentProvider, buildAutomaticDebugInjectionEnabledMessage } from './debug/environmentProvider';
import { DEFAULT_MITMPROXY_COMMAND } from './mitmproxy/commandResolver';
import { findAvailablePort } from './mitmproxy/port';
import {
	INSTALL_MITMPROXY_ACTION,
	MITMPROXY_INSTALLATION_URL,
	buildMissingMitmproxyMessage,
	isMitmproxyCommandAvailable,
} from './mitmproxy/systemCommand';
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
		return {
			command: DEFAULT_MITMPROXY_COMMAND,
			proxyPort: await findAvailablePort(),
		};
	};

	const promptInstallMitmproxyIfMissing = async () => {
		if (await isMitmproxyCommandAvailable(DEFAULT_MITMPROXY_COMMAND)) {
			return;
		}

		const selected = await vscode.window.showWarningMessage(
			buildMissingMitmproxyMessage(DEFAULT_MITMPROXY_COMMAND),
			INSTALL_MITMPROXY_ACTION,
		);
		if (selected === INSTALL_MITMPROXY_ACTION) {
			await vscode.env.openExternal(vscode.Uri.parse(MITMPROXY_INSTALLATION_URL));
		}
	};

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
	void promptInstallMitmproxyIfMissing();

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
