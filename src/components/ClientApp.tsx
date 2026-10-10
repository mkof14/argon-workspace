"use client";
import dynamic from "next/dynamic";
// The workspace reads browser-only state (theme, language, session), so it renders on the client.
const App = dynamic(() => import("./App"), { ssr: false, loading: () => <div className="login" /> });
export default function ClientApp({ slug }: { slug: string[] }) { return <App slug={slug} />; }
