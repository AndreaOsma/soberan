import { MENU_SECTIONS, SECTION_BLURBS, SECTION_ICONS, sectionDefaultTab, type MenuKey, type MenuSection } from "../../config/ui";

export type InicioShortcutsProps = {
  onNavigate: (key: MenuKey) => void;
};

export function InicioShortcuts({ onNavigate }: InicioShortcutsProps) {
  return (
    <div className="inicio-shortcuts">
      {(MENU_SECTIONS.filter((s) => s !== "Inicio") as MenuSection[]).map((section) => (
        <button
          key={section}
          type="button"
          className="inicio-shortcut"
          onClick={() => onNavigate(sectionDefaultTab(section))}
        >
          <span className="inicio-shortcut__icon">{SECTION_ICONS[section]}</span>
          <strong className="inicio-shortcut__name">{section}</strong>
          <p className="inicio-shortcut__blurb muted">{SECTION_BLURBS[section]}</p>
        </button>
      ))}
    </div>
  );
}
