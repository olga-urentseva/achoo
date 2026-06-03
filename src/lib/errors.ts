/**
 * Domain errors thrown by the service layer. They carry no HTTP knowledge —
 * the central error handler in `index.ts` maps them to status codes, keeping
 * services transport-agnostic.
 */
export class NotFoundError extends Error {
  constructor(message = "not found") {
    super(message);
    this.name = "NotFoundError";
  }
}
