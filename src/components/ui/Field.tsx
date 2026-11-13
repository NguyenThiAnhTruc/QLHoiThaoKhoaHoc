import { useState, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from 'react';

const baseFieldClass =
  'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition-all focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:bg-slate-50 disabled:text-slate-500';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className = '', ...props }: InputProps) {
  const [nativeError, setNativeError] = useState('');
  const message = error || nativeError;
  const required = props.required ?? label?.includes('*');
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-semibold text-slate-700">{label}</label>}
      <input
        className={`${baseFieldClass} ${message ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20' : ''} ${className}`}
        {...props}
        required={required}
        aria-invalid={message ? true : undefined}
        onChange={(event) => {
          setNativeError('');
          props.onChange?.(event);
        }}
        onInvalid={(event) => {
          const target = event.currentTarget;
          setNativeError(target.validity.valueMissing ? 'Vui lòng nhập thông tin này.' : target.validationMessage);
          props.onInvalid?.(event);
        }}
      />
      {message && <p className="text-sm text-rose-600">{message}</p>}
    </div>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function Textarea({ label, error, className = '', ...props }: TextareaProps) {
  const [nativeError, setNativeError] = useState('');
  const message = error || nativeError;
  const required = props.required ?? label?.includes('*');
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-semibold text-slate-700">{label}</label>}
      <textarea
        className={`${baseFieldClass} resize-y min-h-[100px] ${message ? 'border-rose-400' : ''} ${className}`}
        {...props}
        required={required}
        aria-invalid={message ? true : undefined}
        onChange={(event) => {
          setNativeError('');
          props.onChange?.(event);
        }}
        onInvalid={(event) => {
          const target = event.currentTarget;
          setNativeError(target.validity.valueMissing ? 'Vui lòng nhập thông tin này.' : target.validationMessage);
          props.onInvalid?.(event);
        }}
      />
      {message && <p className="text-sm text-rose-600">{message}</p>}
    </div>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  children: React.ReactNode;
}

export function Select({ label, error, className = '', children, ...props }: SelectProps) {
  const [nativeError, setNativeError] = useState('');
  const message = error || nativeError;
  const required = props.required ?? label?.includes('*');
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-semibold text-slate-700">{label}</label>}
      <select
        className={`${baseFieldClass} ${message ? 'border-rose-400' : ''} ${className}`}
        {...props}
        required={required}
        aria-invalid={message ? true : undefined}
        onChange={(event) => {
          setNativeError('');
          props.onChange?.(event);
        }}
        onInvalid={(event) => {
          const target = event.currentTarget;
          setNativeError(target.validity.valueMissing ? 'Vui lòng chọn một giá trị.' : target.validationMessage);
          props.onInvalid?.(event);
        }}
      >
        {children}
      </select>
      {message && <p className="text-sm text-rose-600">{message}</p>}
    </div>
  );
}
