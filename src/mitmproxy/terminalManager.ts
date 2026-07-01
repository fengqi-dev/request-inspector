export interface MitmproxyStartOptions {
	command: string;
	proxyPort: number;
}

export type MitmproxyState = 'stopped' | 'running' | 'error';

export interface MitmproxyStatus {
	state: MitmproxyState;
	terminalName?: string;
	error?: string;
}

export interface ManagedMitmproxyTerminal {
	readonly name: string;
	readonly exitStatus?: { code: number | undefined };
	show(): void;
	dispose(): void;
}

export interface MitmproxyTerminalOptions {
	name: string;
	shellPath: string;
	shellArgs: string[];
}

export type MitmproxyTerminalFactory = (options: MitmproxyTerminalOptions) => ManagedMitmproxyTerminal;

export function buildMitmproxyArgs({ proxyPort }: Pick<MitmproxyStartOptions, 'proxyPort'>): string[] {
	return [
		'--listen-port',
		String(proxyPort),
	];
}

export class MitmproxyTerminalManager {
	private terminal: ManagedMitmproxyTerminal | undefined;
	private currentStatus: MitmproxyStatus = { state: 'stopped' };
	private readonly statusListeners = new Set<(status: MitmproxyStatus) => void>();

	public constructor(
		private readonly createTerminal: MitmproxyTerminalFactory,
		private readonly terminalName = 'mitmproxy',
	) {}

	public get status(): MitmproxyStatus {
		return { ...this.currentStatus };
	}

	public onDidChangeStatus(listener: (status: MitmproxyStatus) => void): { dispose: () => void } {
		this.statusListeners.add(listener);
		return {
			dispose: () => this.statusListeners.delete(listener),
		};
	}

	public async start(options: MitmproxyStartOptions): Promise<MitmproxyStatus> {
		if (this.terminal) {
			this.terminal.show();
			return this.status;
		}

		try {
			const terminal = this.createTerminal({
				name: this.terminalName,
				shellPath: options.command,
				shellArgs: buildMitmproxyArgs(options),
			});
			this.terminal = terminal;
			terminal.show();
			this.currentStatus = { state: 'running', terminalName: terminal.name };
			this.emitStatus();
		} catch (error) {
			this.terminal = undefined;
			this.currentStatus = { state: 'error', error: error instanceof Error ? error.message : String(error) };
			this.emitStatus();
		}

		return this.status;
	}

	public reveal(): MitmproxyStatus {
		this.terminal?.show();
		return this.status;
	}

	public handleTerminalClosed(terminal: ManagedMitmproxyTerminal): MitmproxyStatus {
		return this.markStoppedIfManaged(terminal);
	}

	public handleTerminalStateChanged(terminal: ManagedMitmproxyTerminal): MitmproxyStatus {
		if (!terminal.exitStatus) {
			return this.status;
		}

		return this.markStoppedIfManaged(terminal);
	}

	public stop(): MitmproxyStatus {
		if (!this.terminal) {
			this.currentStatus = { state: 'stopped' };
			return this.status;
		}

		this.terminal.dispose();
		this.terminal = undefined;
		this.currentStatus = { state: 'stopped' };
		this.emitStatus();
		return this.status;
	}

	public async restart(options: MitmproxyStartOptions): Promise<MitmproxyStatus> {
		this.stop();
		return this.start(options);
	}

	private markStoppedIfManaged(terminal: ManagedMitmproxyTerminal): MitmproxyStatus {
		if (terminal !== this.terminal) {
			return this.status;
		}

		this.terminal = undefined;
		this.currentStatus = { state: 'stopped' };
		this.emitStatus();
		return this.status;
	}

	private emitStatus(): void {
		const status = this.status;
		for (const listener of this.statusListeners) {
			listener(status);
		}
	}
}
