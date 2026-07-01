export const MITMPROXY_COMMANDS = {
	open: 'mitmproxy.open',
	start: 'mitmproxy.start',
	stop: 'mitmproxy.stop',
	restart: 'mitmproxy.restart',
	toggle: 'mitmproxy.toggle',
} as const;

export const MITMPROXY_COMMAND_IDS = [
	MITMPROXY_COMMANDS.open,
	MITMPROXY_COMMANDS.start,
	MITMPROXY_COMMANDS.stop,
	MITMPROXY_COMMANDS.restart,
	MITMPROXY_COMMANDS.toggle,
];
