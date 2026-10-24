import Link from "next/link";

/** The doorway is a vector redraw of the selected Dwelld brand concept. */
export default function BrandLogo({ linked = false, compact = false }: { linked?: boolean; compact?: boolean }) {
  const logo = <span className={`dwelld-logo${compact ? " dwelld-logo--compact" : ""}`} aria-label="dwelld.">
    <svg className="dwelld-logo__symbol" viewBox="0 0 112 112" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 37.5a6 6 0 0 1 3.5-5.45L65.5 7.5a9 9 0 0 1 7.7.1l30 15.5a4 4 0 0 1-.3 7.2L41 59.5a7 7 0 0 0-4 6.3v34.7a5 5 0 0 1-2.8 4.5l-19.1 9A5 5 0 0 1 8 109.5Z" transform="translate(0 -4) scale(.95)"/><path className="dwelld-logo__door" d="M65 52.5 99 36a4 4 0 0 1 5.8 3.6v62.7a4 4 0 0 1-6.1 3.4L65 84a6 6 0 0 1-2.7-5V58a6 6 0 0 1 2.7-5.5Z"/></svg>
    <span className="dwelld-logo__type" aria-hidden="true">dwelld<span className="dwelld-logo__period">.</span></span>
  </span>;
  return linked ? <Link href="/" className="dwelld-logo-link" aria-label="Dwelld home">{logo}</Link> : logo;
}
