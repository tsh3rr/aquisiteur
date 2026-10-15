import { RichText } from "./rich-text";

export function LegalPage({ title, markdown }: { title: string; markdown: string }) {
  return (
    <main id="main" className="min-h-dvh bg-background px-5 py-16 sm:px-8">
      <article className="mx-auto grid max-w-2xl gap-6">
        <h1 className="text-3xl font-semibold">{title}</h1>
        <RichText source={markdown} className="leading-relaxed" />
      </article>
    </main>
  );
}
