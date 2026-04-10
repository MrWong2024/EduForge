"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type FloatingMoreMenuProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  label?: string;
  menuClassName?: string;
  children: ReactNode;
};

type MenuPosition = {
  top: number;
  left: number;
};

const VIEWPORT_MARGIN = 8;
const MENU_GAP = 8;
const FALLBACK_MENU_WIDTH = 112;
const FALLBACK_MENU_HEIGHT = 92;

export function FloatingMoreMenu({
  isOpen,
  onOpenChange,
  disabled = false,
  label = "更多",
  menuClassName,
  children,
}: FloatingMoreMenuProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const closeMenu = useCallback(() => {
    setPosition(null);
    onOpenChange(false);
  }, [onOpenChange]);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) {
      return;
    }

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const menuWidth = menuRef.current?.offsetWidth ?? FALLBACK_MENU_WIDTH;
    const menuHeight = menuRef.current?.offsetHeight ?? FALLBACK_MENU_HEIGHT;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = triggerRect.bottom + MENU_GAP;
    if (top + menuHeight > viewportHeight - VIEWPORT_MARGIN) {
      top = triggerRect.top - MENU_GAP - menuHeight;
      if (top < VIEWPORT_MARGIN) {
        top = Math.max(VIEWPORT_MARGIN, viewportHeight - VIEWPORT_MARGIN - menuHeight);
      }
    }

    let left = triggerRect.right - menuWidth;
    if (left < VIEWPORT_MARGIN) {
      left = VIEWPORT_MARGIN;
    }
    if (left + menuWidth > viewportWidth - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, viewportWidth - VIEWPORT_MARGIN - menuWidth);
    }

    setPosition({ top, left });
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) {
        return;
      }
      if (menuRef.current?.contains(target)) {
        return;
      }
      closeMenu();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    const handleViewportChange = () => {
      closeMenu();
    };

    let nextFrameId: number | null = null;
    const rafId = window.requestAnimationFrame(() => {
      updatePosition();
      nextFrameId = window.requestAnimationFrame(updatePosition);
    });

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.cancelAnimationFrame(rafId);
      if (nextFrameId !== null) {
        window.cancelAnimationFrame(nextFrameId);
      }
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [closeMenu, isOpen, updatePosition]);

  return (
    <>
      <div className="inline-flex">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            if (isOpen) {
              closeMenu();
              return;
            }
            setPosition(null);
            onOpenChange(true);
          }}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
        >
          {label}
        </button>
      </div>

      {isOpen && position && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{
                position: "fixed",
                top: position.top,
                left: position.left,
                zIndex: 70,
              }}
              className={
                menuClassName ??
                "w-28 rounded-md border border-zinc-200 bg-white py-1 shadow-lg"
              }
            >
              {children}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
