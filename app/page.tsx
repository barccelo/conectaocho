export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item));
    else if (value !== undefined) query.set(key, value);
  });
  const gameUrl = `/game/index.html${query.size ? `?${query.toString()}` : ""}`;
  return (
    <main className="site-frame">
      <iframe src={gameUrl} title="Conecta 8" />
    </main>
  );
}
