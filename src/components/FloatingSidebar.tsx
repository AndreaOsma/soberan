import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MENU_SECTIONS, SECTION_ICONS, SECTION_TABS, menuKeyToSection, sectionDefaultTab, type MenuKey, type MenuSection } from '../config/ui';
import { useModalA11y } from '../hooks/useModalA11y';

interface FloatingSidebarProps {
  currentMenu: MenuKey;
  setCurrentMenu: (menu: MenuKey) => void;
  isOpen: boolean;
  onClose: () => void;
  focusSearch?: boolean;
}

export const FloatingSidebar: React.FC<FloatingSidebarProps> = ({
  currentMenu,
  setCurrentMenu,
  isOpen,
  onClose,
  focusSearch = false,
}) => {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useModalA11y(isOpen, onClose, "menu-panel-title");
  const normalized = query.trim().toLowerCase();

  const filteredSections = useMemo(() => {
    if (!normalized) return MENU_SECTIONS as MenuSection[];
    return (MENU_SECTIONS as MenuSection[]).filter((section) => {
      if (section.toLowerCase().includes(normalized)) return true;
      return SECTION_TABS[section].some((tab) => tab.toLowerCase().includes(normalized));
    });
  }, [normalized]);

  useEffect(() => {
    if (!isOpen) setQuery("");
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && focusSearch) {
      searchRef.current?.focus();
    }
  }, [isOpen, focusSearch]);

  if (!isOpen) return null;

  const activeSection = menuKeyToSection(currentMenu);

  return (
    <div className="menu-overlay" role="dialog" aria-modal="true" aria-label="Menú de navegación">
      <div className="menu-panel" ref={panelRef}>
        <div className="menu-panel__head">
          <span className="menu-panel__title" id="menu-panel-title">Soberan</span>
          <button className="button-secondary menu-panel__close" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <div className="menu-panel__search">
          <input
            ref={searchRef}
            type="search"
            className="menu-search-input"
            placeholder="Buscar módulo…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar módulo"
          />
        </div>

        <div className="menu-panel__body">
          {filteredSections.map((section) => {
            const isActive = activeSection === section;
            const tabs = SECTION_TABS[section];
            const matchingTab = normalized
              ? tabs.find((tab) => tab.toLowerCase().includes(normalized))
              : undefined;
            return (
              <button
                key={section}
                type="button"
                className={`menu-link${isActive ? ' menu-link--active' : ''}`}
                onClick={() => {
                  setCurrentMenu(matchingTab ?? sectionDefaultTab(section));
                  onClose();
                }}
              >
                <span className="menu-link__icon">{SECTION_ICONS[section]}</span>
                {section}
              </button>
            );
          })}
          {filteredSections.length === 0 && (
            <p className="muted" style={{ padding: "0.5rem 0.75rem", fontSize: "0.85rem" }}>Sin resultados</p>
          )}
        </div>

      </div>
      <div className="menu-overlay__backdrop" onClick={onClose} role="button" tabIndex={-1} aria-label="Cerrar menú" />
    </div>
  );
};
