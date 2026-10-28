export type DeliveryErrorCode = "VALIDATION_ERROR" | "MISSING_PERMISSION" | "OUTSIDE_EXPERT" | "VERSION_CONFLICT" | "INVALID_STATE_TRANSITION" | "QUOTA_EXCEEDED";
export class DeliveryDomainError extends Error { constructor(readonly code: DeliveryErrorCode, message: string = code) { super(message); this.name = "DeliveryDomainError"; } }
