"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => (
    !element.hidden
    && !element.closest("[hidden]")
    && !element.closest('[aria-hidden="true"]')
  ));
}

/**
 * One application-wide modal boundary.
 *
 * The portal is deliberate: a console renders inside AppShell's `<main>`, so
 * a fixed descendant can only hide siblings inside that main region. A portal
 * makes the dialog a direct child of `<body>` and lets us isolate every other
 * body child — including the skip link, sidebar, mobile header, and main app
 * root — while restoring each pre-existing attribute byte-for-byte on close.
 */
export function ModalDialog({
  label,
  onRequestClose,
  children,
  className,
  panelClassName,
  initialFocusRef,
  ariaBusy = false,
}: {
  label: string;
  onRequestClose: () => void;
  children: ReactNode;
  className: string;
  panelClassName: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  ariaBusy?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onRequestClose);

  useEffect(() => {
    closeRef.current = onRequestClose;
  }, [onRequestClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    openerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const background = Array.from(document.body.children)
      .filter((element): element is HTMLElement => (
        element instanceof HTMLElement && element !== dialog
      ))
      .map((element) => ({
        element,
        inert: element.getAttribute("inert"),
        ariaHidden: element.getAttribute("aria-hidden"),
      }));

    for (const { element } of background) {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    }

    const focusFirst = () => {
      const requested = initialFocusRef?.current;
      if (requested && dialog.contains(requested) && !requested.hasAttribute("disabled")) {
        requested.focus();
        return;
      }
      (focusableElements(dialog)[0] ?? dialog).focus();
    };

    focusFirst();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const candidates = focusableElements(dialog);
      if (candidates.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = candidates[0];
      const last = candidates[candidates.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && dialog.contains(event.target)) return;
      focusFirst();
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      for (const { element, inert, ariaHidden } of background) {
        if (inert === null) element.removeAttribute("inert");
        else element.setAttribute("inert", inert);
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      if (openerRef.current?.isConnected) openerRef.current.focus();
    };
  }, [initialFocusRef]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={dialogRef}
      className={className}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      aria-busy={ariaBusy || undefined}
      tabIndex={-1}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeRef.current();
      }}
    >
      <div className={panelClassName}>{children}</div>
    </div>,
    document.body,
  );
}
