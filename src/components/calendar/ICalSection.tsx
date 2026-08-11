import { useIcalSubscribeLink } from "../../hooks/useIcalSubscribeLink";

type Props = {
  settings: Record<string, string>;
};

export function ICalSection({ settings }: Props) {
  const { link, feed, loading } = useIcalSubscribeLink(settings);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div style={{ fontSize: "0.75rem", fontFamily: "monospace", wordBreak: "break-all", padding: "0.5rem", background: "var(--glass-bg)", borderRadius: "0.4rem" }}>
        {loading ? "Generando enlace de suscripción…" : (feed?.url ?? "No se pudo generar el enlace")}
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {link ? (
          <a
            href={link.href}
            {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="button-secondary"
            style={{ fontSize: "0.8rem", textDecoration: "none", padding: "0.3rem 0.75rem", display: "inline-flex", alignItems: "center" }}
          >
            📅 Suscribir iCal
          </a>
        ) : (
          <button type="button" className="button-secondary" style={{ fontSize: "0.8rem" }} disabled>
            {loading ? "Preparando…" : "iCal no disponible"}
          </button>
        )}
        <button
          type="button"
          className="button-secondary"
          style={{ fontSize: "0.8rem" }}
          disabled={loading || !feed}
          onClick={() => {
            if (feed) void navigator.clipboard.writeText(feed.url);
          }}
        >
          Copiar URL
        </button>
      </div>
    </div>
  );
}
