import { useEffect, useRef } from 'react';

/**
 * Accessible modal: Escape and backdrop click close it, focus moves inside on
 * open and back on close. Renders inline (no portal needed at this scale).
 */
export default function Dialog({ title, children, footer, onClose, wide = false }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Focus the dialog once on mount. Using a stable ref + effect (rather than an
  // inline callback ref, which React re-invokes every render) keeps focus from
  // being yanked out of inputs while the user types.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`dialog ${wide ? 'dialog-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={dialogRef}
      >
        <h2>{title}</h2>
        {children}
        {footer ? <div className="dialog-actions">{footer}</div> : null}
      </div>
    </div>
  );
}
