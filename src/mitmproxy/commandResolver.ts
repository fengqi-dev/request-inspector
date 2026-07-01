export const DEFAULT_MITMPROXY_COMMAND = 'mitmproxy';

export interface MitmproxyCommandResolutionOptions {
	configuredCommand: string;
	managedCommand: () => Promise<string>;
	defaultCommand?: string;
}

export async function resolveMitmproxyCommand(options: MitmproxyCommandResolutionOptions): Promise<string> {
	const defaultCommand = options.defaultCommand ?? DEFAULT_MITMPROXY_COMMAND;
	if (options.configuredCommand.trim() !== defaultCommand) {
		return options.configuredCommand;
	}

	return options.managedCommand();
}
