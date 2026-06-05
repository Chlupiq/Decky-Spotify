import { useCallback, useEffect, useRef, useState } from "react";

export interface ToastMessage {
  id: string;
  text: string;
  sub?: string;
}

// ─── ToastContainer ────────────────────────────────────────────────────────

interface ContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

const DURATION_MS = 3500;

const styles = {
  container: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
    padding: "4px 6px 0",
    pointerEvents: "none" as const,
  },
  toast: {
    background: "#1e1e1e",
    borderLeft: "3px solid #1DB954",
    borderRadius: 4,
    padding: "5px 8px 4px",
    maxWidth: "100%",
    boxSizing: "border-box" as const,
    animation: "toast-in 0.2s ease-out both",
    overflow: "hidden" as const,
    pointerEvents: "auto" as const,
  },
  text: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: 600,
    lineHeight: "14px",
    whiteSpace: "nowrap" as const,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
  },
  sub: {
    color: "#b3b3b3",
    fontSize: 9,
    lineHeight: "13px",
    marginTop: 1,
    whiteSpace: "nowrap" as const,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
  },
  progressTrack: {
    marginTop: 4,
    height: 2,
    background: "#333333",
    borderRadius: 1,
    overflow: "hidden" as const,
  },
};

interface ToastItemProps {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [width, setWidth] = useState(100);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    function animate(ts: number) {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const remaining = Math.max(0, 1 - elapsed / DURATION_MS) * 100;
      setWidth(remaining);
      if (elapsed < DURATION_MS) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        onDismiss(toast.id);
      }
    }
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [toast.id, onDismiss]);

  return (
    <div style={styles.toast}>
      <div style={styles.text}>{toast.text}</div>
      {toast.sub && <div style={styles.sub}>{toast.sub}</div>}
      <div style={styles.progressTrack}>
        <div
          style={{
            height: "100%",
            width: `${width}%`,
            background: "#1DB954",
            borderRadius: 1,
            transition: "width 0.1s linear",
          }}
        />
      </div>
    </div>
  );
}

export function ToastContainer({ toasts, onDismiss }: ContainerProps) {
  const visible = toasts.slice(-3);
  return (
    <>
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div style={styles.container}>
        {visible.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
        ))}
      </div>
    </>
  );
}

// ─── useToast ──────────────────────────────────────────────────────────────

let _counter = 0;

export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((text: string, sub?: string) => {
    const id = `toast-${++_counter}-${Date.now()}`;
    setToasts((prev) => [...prev, { id, text, sub }]);
  }, []);

  return { toasts, showToast, dismiss };
}
