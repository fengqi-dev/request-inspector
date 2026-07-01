import { MITMPROXY_COMMANDS } from '../commands/ids';
import type { MitmproxyStatus } from '../mitmproxy/terminalManager';

export interface MitmproxyStatusBarPresentation {
	text: string;
	tooltip: string;
	command: string;
	colorThemeId?: string;
}

export interface MitmproxyStatusBarOptions {
	status: MitmproxyStatus;
	proxyPort?: number;
}

export function buildMitmproxyStatusBarPresentation(options: MitmproxyStatusBarOptions): MitmproxyStatusBarPresentation {
	const tooltipBase = [
		`Status: ${formatStatus(options.status)}`,
		options.proxyPort === undefined ? 'Proxy: automatic port' : `Proxy: 127.0.0.1:${options.proxyPort}`,
	];

	if (options.status.state === 'running') {
		tooltipBase.push('Click to stop mitmproxy.');
	} else if (options.status.state === 'error') {
		tooltipBase.push(`Error: ${options.status.error ?? 'unknown'}`, 'Click to start mitmproxy.');
	} else {
		tooltipBase.push('Click to start mitmproxy.');
	}

	const tooltip = tooltipBase.join('\n');

	if (options.status.state === 'running') {
		return {
			text: '$(debug-stop) mitmproxy',
			tooltip,
			command: MITMPROXY_COMMANDS.toggle,
			colorThemeId: 'charts.green',
		};
	}

	if (options.status.state === 'error') {
		return {
			text: '$(error) mitmproxy',
			tooltip,
			command: MITMPROXY_COMMANDS.toggle,
		};
	}

	return {
		text: '$(play) mitmproxy',
		tooltip,
		command: MITMPROXY_COMMANDS.toggle,
	};
}

function formatStatus(status: MitmproxyStatus): string {
	if (status.state === 'running') {
		return status.terminalName ? `running (${status.terminalName})` : 'running';
	}

	return status.state;
}
