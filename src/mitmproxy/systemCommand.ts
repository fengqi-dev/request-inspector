import { execFile } from 'child_process';

import { DEFAULT_MITMPROXY_COMMAND } from './commandResolver';

export const MITMPROXY_INSTALLATION_URL = 'https://docs.mitmproxy.org/stable/overview-installation/';
export const INSTALL_MITMPROXY_ACTION = 'Install mitmproxy';

export type CommandProbe = (
	command: string,
	args: string[],
	options: { timeout: number },
	callback: (error: Error | null) => void,
) => void;

export function buildMissingMitmproxyMessage(command = DEFAULT_MITMPROXY_COMMAND): string {
	return `Request Inspector could not find "${command}". Install mitmproxy and make sure it is available on your PATH.`;
}

export function isMitmproxyCommandAvailable(
	command = DEFAULT_MITMPROXY_COMMAND,
	probe: CommandProbe = defaultCommandProbe,
): Promise<boolean> {
	return new Promise((resolve) => {
		probe(command, ['--version'], { timeout: 5000 }, (error) => {
			resolve(error === null);
		});
	});
}

const defaultCommandProbe: CommandProbe = (command, args, options, callback) => {
	execFile(command, args, options, (error) => callback(error));
};
