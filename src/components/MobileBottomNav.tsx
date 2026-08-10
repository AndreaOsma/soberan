import { SECTION_ICONS, menuKeyToSection, sectionDefaultTab, type MenuKey, type MenuSection } from "../config/ui";

const PRIMARY_TABS: { section: MenuSection; label: string }[] = [
  { section: "Inicio", label: "Inicio" },
  { section: "Presupuesto", label: "Presupuesto" },
  { section: "Movimientos", label: "Movimientos" },
  { section: "Cuentas", label: "Cuentas" },
];

type Props = {
  currentMenu: MenuKey;
  onNavigate: (key: MenuKey) => void;
  onMore: () => void;
};

export function MobileBottomNav({ currentMenu, onNavigate, onMore }: Props) {
  const activeSection = menuKeyToSection(currentMenu);
  const isPrimary = PRIMARY_TABS.some((t) => t.section === activeSection);

  return (
    <nav className="mobile-tab-bar" aria-label="Navegación principal">
      {PRIMARY_TABS.map(({ section, label }) => {
        const active = activeSection === section;
        return (
          <button
            key={section}
            type="button"
            className={`mobile-tab${active ? " mobile-tab--active" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={() => onNavigate(sectionDefaultTab(section))}
          >
            <span className="mobile-tab__icon" aria-hidden="true">{SECTION_ICONS[section]}</span>
            <span className="mobile-tab__label">{label}</span>
          </button>
        );
      })}
      <button
        type="button"
        className={`mobile-tab${!isPrimary ? " mobile-tab--active" : ""}`}
        aria-label="Más secciones"
        onClick={onMore}
      >
        <span className="mobile-tab__icon" aria-hidden="true">☰</span>
        <span className="mobile-tab__label">Más</span>
      </button>
    </nav>
  );
}
