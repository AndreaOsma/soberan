import { GlassModal } from "../GlassModal";
import { METHOD_SECTIONS, METHOD_SUMMARY_LEAD, METHOD_TIPS, type MethodGuideSection } from "../../content/methodGuide";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  sections?: MethodGuideSection[];
  showIntro?: boolean;
};

export function MethodGuideModal({ isOpen, onClose, sections = METHOD_SECTIONS, showIntro = true }: Props) {
  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onClose}
      title="Cómo funciona"
      contentClassName="method-guide-modal"
      maxWidth="36rem"
    >
      <div className="method-guide-modal__body">
        {showIntro && <p className="muted method-guide-modal__intro">{METHOD_SUMMARY_LEAD}</p>}
        {sections.map((section) => (
          <section key={section.id} className="method-guide-section">
            <h3 className="method-guide-section__title">{section.title}</h3>
            <p className="muted method-guide-section__body">{section.body}</p>
            {section.bullets && section.bullets.length > 0 && (
              <ul className="method-guide-section__list">
                {section.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <section className="method-guide-tips" aria-label="Notas">
          <h3 className="method-guide-section__title">Notas</h3>
          <ul className="method-guide-tips__list">
            {METHOD_TIPS.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </section>
      </div>
    </GlassModal>
  );
}
