import * as net from 'net';

export function findAvailablePort(host = '127.0.0.1', preferredPort = 8888): Promise<number> {
	return probePort(preferredPort, host).catch((error: NodeJS.ErrnoException) => {
		if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
			return probePort(0, host);
		}
		throw error;
	});
}

function probePort(port: number, host: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.on('error', reject);
		server.listen(port, host, () => {
			const address = server.address();
			if (!address || typeof address === 'string') {
				server.close(() => reject(new Error('Could not allocate a local proxy port.')));
				return;
			}

			const { port } = address;
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(port);
			});
		});
	});
}
