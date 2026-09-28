/** Error carrying the HTTP status of a failed API call (0 = network failure). */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export function toApiError(
  error: { message: string; code?: string } | null,
  status: number,
  fallback = "Request failed",
): ApiError {
  const message = error?.message || fallback;
  // supabase-js reports network failures as status 0 / "Failed to fetch".
  const isNetwork = status === 0 || /network request failed|failed to fetch|fetch failed/i.test(message);
  return new ApiError(isNetwork ? "Network unavailable" : message, isNetwork ? 0 : status, error?.code);
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return "You're offline or the server can't be reached.";
    if (error.status === 429) return "Too many requests — please wait a moment and try again.";
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
