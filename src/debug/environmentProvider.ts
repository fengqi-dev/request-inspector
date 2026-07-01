import path from "path";
import os from "os";

export interface DebugConfigurationWithEnvironment {
	env?: Record<string, string | undefined>;
	[key: string]: unknown;
}

export interface DebugPromptWindow {
	showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>;
}

export function buildAutomaticDebugInjectionEnabledMessage(proxyPort: number): string {
	return `mitmproxy started. Future VS Code debug sessions will automatically receive proxy environment variables for http://127.0.0.1:${proxyPort}.`;
}

export class DynamicProxyDebugEnvironmentProvider {
	private proxyPort: number | undefined;

	public enable(proxyPort: number): void {
		this.proxyPort = proxyPort;
	}

	public disable(): void {
		this.proxyPort = undefined;
	}

	public resolveDebugConfiguration(
		_folder: unknown,
		configuration: DebugConfigurationWithEnvironment,
	): Promise<DebugConfigurationWithEnvironment> {
		return this.resolveConfiguration(configuration);
	}

	public async resolveConfiguration<T extends DebugConfigurationWithEnvironment>(configuration: T): Promise<T> {
		if (this.proxyPort === undefined) {
			return Promise.resolve(configuration);
		}

		const proxyUrl = `http://127.0.0.1:${this.proxyPort}`;
		return {
			...configuration,
			env: {
				...configuration.env,
				HTTP_PROXY: proxyUrl,
				HTTPS_PROXY: proxyUrl,
				ALL_PROXY: proxyUrl,
				REQUESTS_CA_BUNDLE: path.join(os.homedir(), '.mitmproxy', 'mitmproxy-ca-cert.pem'),
			},
		};
	}
}
