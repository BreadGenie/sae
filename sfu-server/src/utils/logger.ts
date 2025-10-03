import { format } from 'node:util';

export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3,
}

export class Logger {
	private component: string;
	private minLevel: LogLevel;

	constructor(component: string, minLevel: LogLevel = LogLevel.INFO) {
		this.component = component;
		this.minLevel = minLevel;
	}

	private formatMessage(
		level: string,
		message: string,
		...args: unknown[]
	): string {
		const timestamp = new Date().toISOString();
		const formattedMessage =
			args.length > 0 ? format(message, ...args) : message;
		return `[${timestamp}] [${level}] [${this.component}] ${formattedMessage}`;
	}

	private shouldLog(level: LogLevel): boolean {
		return level >= this.minLevel;
	}

	debug(message: string, ...args: unknown[]): void {
		if (this.shouldLog(LogLevel.DEBUG)) {
			console.log(this.formatMessage('DEBUG', message, ...args));
		}
	}

	info(message: string, ...args: unknown[]): void {
		if (this.shouldLog(LogLevel.INFO)) {
			console.log(this.formatMessage('INFO', message, ...args));
		}
	}

	warn(message: string, ...args: unknown[]): void {
		if (this.shouldLog(LogLevel.WARN)) {
			console.warn(this.formatMessage('WARN', message, ...args));
		}
	}

	error(message: string, ...args: unknown[]): void {
		if (this.shouldLog(LogLevel.ERROR)) {
			console.error(this.formatMessage('ERROR', message, ...args));
		}
	}
}

// Create loggers for each component
export const loggers = {
	workerManager: new Logger('WorkerManager'),
	roomManager: new Logger('RoomManager'),
	peerManager: new Logger('PeerManager'),
	transportManager: new Logger('TransportManager'),
	producerManager: new Logger('ProducerManager'),
	consumerManager: new Logger('ConsumerManager'),
	mediasoupManager: new Logger('MediasoupManager'),
	socketHandler: new Logger('SocketHandler'),
	authManager: new Logger('AuthManager'),
	server: new Logger('Server'),
	config: new Logger('Config'),
} as const;
