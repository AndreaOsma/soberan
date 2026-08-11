type Props = {
  rows?: number;
};

export function ViewSkeleton({ rows = 3 }: Props) {
  return (
    <div className="view-skeleton" aria-hidden="true">
      <div className="skeleton skeleton-card" />
      <div className="skeleton skeleton-card" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton skeleton-row" />
      ))}
    </div>
  );
}
