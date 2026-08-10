export type IcalFeedUrls = {
  url: string;
  webcal_url: string;
};

export function icalFeedQuery(settings: Record<string, string>): URLSearchParams {
  const v = settings.ical_feed_version || "1";
  const subs = settings.ical_include_subs !== "0" ? "1" : "0";
  const inc = settings.ical_include_income !== "0" ? "1" : "0";
  return new URLSearchParams({
    v,
    subs,
    rec_inc: inc,
    debts: "1",
  });
}

/** Enlace de suscripción a partir de la URL pública devuelta por el backend. */
export function icalSubscribeLinkFromFeed(feed: IcalFeedUrls): { href: string; external: boolean } {
  const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isApple && feed.webcal_url.startsWith("webcal://")) {
    return { href: feed.webcal_url, external: false };
  }
  return { href: feed.url, external: true };
}
