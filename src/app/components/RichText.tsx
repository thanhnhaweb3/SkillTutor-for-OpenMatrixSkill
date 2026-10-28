/** Renders WhatsApp-style *bold* and _italic_ safely (no HTML injection). */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_)/g);
  return <>{parts.map((p, i) => p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <strong key={i}>{p.slice(1, -1)}</strong>
    : p.startsWith("_") && p.endsWith("_") && p.length > 2 ? <em key={i}>{p.slice(1, -1)}</em> : <span key={i}>{p}</span>)}</>;
}
