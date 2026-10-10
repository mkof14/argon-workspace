// Keep people signed in: the session cookie lives ~400 days and is refreshed on every visit.
export const COOKIE_OPTIONS = { maxAge: 60 * 60 * 24 * 400, path: "/", sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" };
