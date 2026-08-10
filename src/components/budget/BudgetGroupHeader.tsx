import type { ReactNode } from "react";

type Props = {
  groupId: string;
  title: ReactNode;
  summary?: ReactNode;
  expanded: boolean;
  onToggle: (id: string) => void;
  level?: "h2" | "h3";
  actions?: ReactNode;
};

export function BudgetGroupHeader({
  groupId,
  title,
  summary,
  expanded,
  onToggle,
  level = "h2",
  actions,
}: Props) {
  const Tag = level;

  return (
    <div className="budget-group-header-wrap">
      <button
        type="button"
        className="budget-group-header"
        onClick={() => onToggle(groupId)}
        aria-expanded={expanded}
      >
        <Tag className="budget-group-header__title">
          <span className="budget-group-header__chevron" aria-hidden>
            {expanded ? "▼" : "▶"}
          </span>
          {title}
        </Tag>
        {summary ? <span className="budget-group-header__summary muted">{summary}</span> : null}
      </button>
      {actions ? <div className="budget-group-header__actions">{actions}</div> : null}
    </div>
  );
}
