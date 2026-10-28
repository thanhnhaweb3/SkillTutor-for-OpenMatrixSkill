export class AcError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
    message = code
  ) {
    super(message);
    this.name = "AcError";
  }
}

export function toErrorResponse(error: unknown) {
  if (error instanceof AcError) {
    return Response.json(
      {
        error: error.code,
        message: error.message === error.code ? undefined : error.message
      },
      { status: error.status }
    );
  }

  if (error instanceof Error && error.name === "AccessDeniedException") {
    console.error(error);
    return Response.json({ error: "user_store_access_denied" }, { status: 500 });
  }

  console.error(error);
  return Response.json({ error: "internal_error" }, { status: 500 });
}
