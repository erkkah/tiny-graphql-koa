/**
 * Throwing a ClientFacingError will expose the error message to the
 * calling client via the `errors` response field.
 */
export class ClientFacingError extends Error {
    readonly expose = true;

    constructor(message?: string) {
        super(message);
    }
}

/**
 * ExtendedError adds service specific error data to the `extensions`
 * response field.
 */
export class ExtendedError extends ClientFacingError {
    constructor(message: string, public extensions: Record<string, unknown>) {
        super(message);
    }
}
