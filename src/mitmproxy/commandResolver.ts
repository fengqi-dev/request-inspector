export const DEFAULT_MITMPROXY_COMMAND = 'mitmproxy';

export interface MitmproxyCommandResolutionOptions {
	configuredCommand: string;
	defaultCommand?: string;
}

export function resolveMitmproxyCommand(options: MitmproxyCommandResolutionOptions): string {
	const defaultCommand = options.defaultCommand ?? DEFAULT_MITMPROXY_COMMAND;
	if (options.configuredCommand.trim() !== defaultCommand) {
		return options.configuredCommand;
	}

	return defaultCommand;
}
