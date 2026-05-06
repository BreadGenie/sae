export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === "object" && error !== null) {
		const err = error as Record<string, unknown>;
		if (Array.isArray(err.messages)) {
			return (err.messages as string[]).join(", ");
		}
		if (typeof err.message === "string") {
			return err.message;
		}
	}
	return String(error);
}
