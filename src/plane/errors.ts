export class PlaneError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PlaneError";
	}
}

export class ConfigurationError extends PlaneError {
	constructor(message: string) {
		super(message);
		this.name = "ConfigurationError";
	}
}

export class HttpError extends PlaneError {
	readonly status: number;
	readonly payload: unknown;

	constructor(status: number, statusText: string, payload: unknown) {
		super(`HTTP ${status}: ${statusText}`);
		this.name = "HttpError";
		this.status = status;
		this.payload = payload;
	}
}
