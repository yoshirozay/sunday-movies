import Link from "next/link";

export function ViewAllCard({
  href,
  count,
  width = 300,
}: {
  href: string;
  count: number;
  width?: number;
}) {
  return (
    <Link
      href={href}
      className="group relative flex shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-[10px] text-center transition-all duration-200 hover:scale-[1.04]"
      style={{
        width,
        aspectRatio: "2 / 3",
        background: "rgba(255, 255, 255, 0.05)",
        boxShadow: "rgba(0, 0, 0, 0.6) 0px 0px 0px 1px inset",
      }}
    >
      <span
        className="text-[11px] font-medium uppercase text-[color:var(--silver)]"
        style={{ letterSpacing: "0.15em" }}
      >
        View all
      </span>
      <span
        className="font-mono text-[28px] tabular-nums text-white"
        style={{ letterSpacing: "-0.02em" }}
      >
        {count.toLocaleString()}
      </span>
      <span
        className="text-[12px] text-white/60 transition-colors group-hover:text-white"
        aria-hidden
      >
        →
      </span>
    </Link>
  );
}
