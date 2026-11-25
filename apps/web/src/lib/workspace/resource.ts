import { ApiError } from "../api/client.ts";

export type Resource<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "error"; error: unknown };

export function requestMessage(error: unknown) {
  if (!(error instanceof ApiError)) return "The request could not be completed.";
  switch (error.status) {
    case 401: return "Sign in to continue using the live workspace.";
    case 403: return "You don’t have permission to complete this request.";
    case 404: return "This conversation or workspace is unavailable.";
    case 409: return "This request conflicts with an existing record.";
    case 503: return "The messaging service is currently unavailable.";
  }
  if (error.kind === "network") return "Could not reach the messaging service. Check your connection and try again.";
  if (error.kind === "invalid_response") return "The messaging service returned an unexpected response.";
  return "The request could not be completed.";
}

export function mayRetrySend(error: unknown) {
  return error instanceof ApiError && (error.kind === "network" || error.kind === "invalid_response" ||
    (error.status !== undefined && error.status >= 500));
}
