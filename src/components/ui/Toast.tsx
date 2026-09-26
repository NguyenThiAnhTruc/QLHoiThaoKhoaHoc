import { useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { removeToast, subscribeToasts, type Toast, type ToastType } from '@/components/ui/toastStore';

const icons: Record<ToastType, ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
  error: <XCircle className="h-5 w-5 text-rose-500" />,
  info: <Info className="h-5 w-5 text-blue-500" />,
};

const borderColors: Record<ToastType, string> = {
  success: 'border-l-emerald-500',
  error: 'border-l-rose-500',
  info: 'border-l-blue-500',
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    return subscribeToasts(setToasts);
  }, []);

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-center gap-3 rounded-lg border border-slate-200 border-l-4 ${borderColors[toast.type]} bg-white px-4 py-3 shadow-lg animate-slide-in`}
        >
          {icons[toast.type]}
          <span className="text-sm text-slate-700">{toast.message}</span>
          <button
            onClick={() => {
              removeToast(toast.id);
            }}
            className="ml-2 text-slate-400 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
