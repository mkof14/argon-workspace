// Fallback when the app's service worker is not active yet: the share still lands on Workspace.
export async function POST(req: Request) { return Response.redirect(new URL("/?upload=1", req.url), 303); }
export async function GET(req: Request) { return Response.redirect(new URL("/", req.url), 303); }
