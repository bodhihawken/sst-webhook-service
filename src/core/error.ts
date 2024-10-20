export class VisibleError extends Error {
  constructor(
    public kind: "input" | "auth" | "not-found",
    public code: string,
    public message: string,
  ) {
    super(message);
  }
}

