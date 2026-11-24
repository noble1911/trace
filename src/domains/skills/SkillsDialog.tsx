import type { ReactNode } from "react";
import { Modal } from "@/components/Modal";
import type { Skill } from "@/ipc/skills";

interface SkillsDialogProps {
  /** The plugin's or skill's name. */
  title: string;
  /** What it's for, in its author's words. */
  about: string | null;
  /** A version, where the source gives one. */
  version?: string | null;
  skills: Skill[];
  /** Said instead of the list when there are none to show. */
  empty?: string;
  /** Below the skills: where it's installed (a marketplace's plugin). */
  children?: ReactNode;
  onClose: () => void;
}

// What a plugin (or one skill) holds, in plain words: each skill's name and what its
// author says it's for. Claude reads the same description to decide when to use it.
export function SkillsDialog({
  title,
  about,
  version,
  skills,
  empty,
  children,
  onClose,
}: SkillsDialogProps) {
  return (
    <Modal title={title} onClose={onClose} className="sk-modal">
      <div className="sk-dialog">
        {(about || version) && (
          <div className="ig-desc">
            {about}
            {version && <span className="sk-version">v{version}</span>}
          </div>
        )}
        {skills.length === 0 ? (
          empty && <div className="sk-empty">{empty}</div>
        ) : (
          <ul className="sk-skill-list">
            {skills.map((s) => (
              <li key={s.folder}>
                <div className="sk-skill-name">{s.name}</div>
                <div className="sk-skill-about">
                  {s.description ?? "Its SKILL.md doesn't say what it's for."}
                </div>
              </li>
            ))}
          </ul>
        )}
        {children}
      </div>
    </Modal>
  );
}
