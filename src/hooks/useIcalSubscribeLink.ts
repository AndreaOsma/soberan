import { useEffect, useState } from "react";
import { api } from "../services/api";
import { icalFeedQuery, icalSubscribeLinkFromFeed, type IcalFeedUrls } from "../utils/icalUrl";

export function useIcalSubscribeLink(settings: Record<string, string>) {
  const [feed, setFeed] = useState<IcalFeedUrls | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api.getCalendarFeedUrl(icalFeedQuery(settings))
      .then((next) => {
        if (cancelled) return;
        setFeed(next);
      })
      .catch(() => {
        if (cancelled) return;
        setFeed(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // Deliberately scoped to the 3 keys the feed URL actually depends on —
    // `settings` is a large shared object touched by unrelated features, and
    // depending on the whole object would refetch on every unrelated change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.ical_feed_version,
    settings.ical_include_subs,
    settings.ical_include_income,
  ]);

  const link = feed ? icalSubscribeLinkFromFeed(feed) : null;
  return { link, feed, loading };
}
