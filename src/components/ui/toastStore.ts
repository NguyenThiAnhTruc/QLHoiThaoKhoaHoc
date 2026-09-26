export type ToastType = "success" | "error" | "info";

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

let toastIdCounter = 0;
let currentToasts: Toast[] = [];
const listeners = new Set<(toasts: Toast[]) => void>();

export function showToast(type: ToastType, message: string) {
  const id = ++toastIdCounter;
  currentToasts = [...currentToasts, { id, type, message }];
  notify();
  // Toasts are transient UI feedback. Keep them out of the notification
  // panel after a short delay so repeated page loads do not pile up stale
  // errors for the user.
  window.setTimeout(() => removeToast(id), 5000);
}

export function subscribeToasts(listener: (toasts: Toast[]) => void) {
  listeners.add(listener);
  listener(currentToasts);
  return () => {
    listeners.delete(listener);
  };
}

export function removeToast(id: number) {
  currentToasts = currentToasts.filter((toast) => toast.id !== id);
  notify();
}

function notify() {
  listeners.forEach((listener) => listener(currentToasts));
}
