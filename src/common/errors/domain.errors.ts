/** Business-rule violation: request is well-formed but cannot be processed (HTTP 422). */
export class DomainValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainValidationError';
  }
}

/** Requested resource does not exist for the calling partner (HTTP 404). */
export class OrderNotFoundError extends Error {
  readonly code = 'ORDER_NOT_FOUND';

  constructor(orderId: string) {
    super(`Order ${orderId} was not found`);
    this.name = 'OrderNotFoundError';
  }
}
