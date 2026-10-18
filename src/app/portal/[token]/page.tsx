import Portal from "./Portal";
export const metadata = { title: "AGRON — client portal", robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Portal token={token} />;
}
