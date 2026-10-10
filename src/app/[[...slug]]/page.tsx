import ClientApp from "@/components/ClientApp";
export default function Page({ params }: { params: { slug?: string[] } }) {
  return <ClientApp slug={params.slug || []} />;
}
