import Decide from "./Decide";
export const metadata = { title: "Approval · AGRON Workspace", robots: { index: false } };
export default async function Page({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ d?: string }> }) {
  const { token } = await params; const { d } = await searchParams;
  return <Decide token={token} preset={d === "approved" || d === "rejected" ? d : undefined} />;
}
