import { ConvexError } from "convex/values";

/** Turn anything thrown by a Convex call into a message that's safe to show the user. */
export function errorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof ConvexError) {
    const data = err.data as { message?: string } | string;
    if (typeof data === "string") return data;
    if (data?.message) return data.message;
  }
  return fallback;
}

export function errorCode(err: unknown): string | undefined {
  if (err instanceof ConvexError && typeof err.data === "object" && err.data) {
    return (err.data as { code?: string }).code;
  }
  return undefined;
}
