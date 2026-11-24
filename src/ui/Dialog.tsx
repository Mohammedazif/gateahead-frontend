import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { Icon } from "./Icon";

export function Dialog({ title, onClose, children, initialFocus, centered }: {
  title: string; onClose: () => void; children: ReactNode; initialFocus?: RefObject<HTMLElement | null>; centered?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      initialFocus?.current?.focus({ preventScroll: true });
    }
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [initialFocus]);
  return <dialog ref={ref} className={centered ? "utility-dialog" : "utility-dialog utility-dialog-sheet"}
    aria-labelledby={titleId} onCancel={onClose}
    onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-frame">
      <header className="dialog-header"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" aria-label={`Close ${title}`} onClick={onClose}><Icon name="close" /></button></header>
      <div className="dialog-body">{children}</div>
    </div>
  </dialog>;
}
