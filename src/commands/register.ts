import * as vscode from 'vscode';

import { MITMPROXY_COMMANDS } from './ids';

export interface MitmproxyCommandHandlers {
	open: () => unknown;
	start: () => unknown;
	stop: () => unknown;
	restart: () => unknown;
	toggle: () => unknown;
}

export function registerMitmproxyCommands(
	context: vscode.ExtensionContext,
	handlers: MitmproxyCommandHandlers,
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(MITMPROXY_COMMANDS.open, handlers.open),
		vscode.commands.registerCommand(MITMPROXY_COMMANDS.start, handlers.start),
		vscode.commands.registerCommand(MITMPROXY_COMMANDS.stop, handlers.stop),
		vscode.commands.registerCommand(MITMPROXY_COMMANDS.restart, handlers.restart),
		vscode.commands.registerCommand(MITMPROXY_COMMANDS.toggle, handlers.toggle),
	);
}
