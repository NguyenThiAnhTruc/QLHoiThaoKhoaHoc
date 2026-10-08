import { useId, useState, type InputHTMLAttributes } from "react";
import { CalendarDays } from "lucide-react";
import { formatDateInput, parseDateInput } from "@/lib/dateInput";

interface DateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> {
  type?: "date" | "datetime-local";
  value: string;
  onValueChange: (value: string) => void;
  label?: string;
}

export function DateInput({ type = "date", value, onValueChange, label, id, min, max, className = "", ...props }: DateInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [draft, setDraft] = useState({ source: value, text: formatDateInput(value) });
  const text = draft.source === value ? draft.text : formatDateInput(value);
  const withTime = type === "datetime-local";
  const format = withTime ? "dd/mm/yyyy HH:mm" : "dd/mm/yyyy";
  const parsed = parseDateInput(text, withTime);
  const error = text && !parsed ? `Vui lòng nhập ngày hợp lệ theo ${format}.`
    : parsed && min && parsed < String(min) ? `Ngày phải từ ${formatDateInput(String(min))}.`
    : parsed && max && parsed > String(max) ? `Ngày phải đến ${formatDateInput(String(max))}.` : "";
  const input = <span className="relative block">
    <input
    {...props}
    id={inputId}
    type="text"
    value={text}
    placeholder={format}
    aria-label={props["aria-label"] ?? label}
    aria-invalid={error ? true : undefined}
    title={format}
    style={{ paddingRight: "3rem", ...props.style }}
    className={`w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 disabled:bg-slate-50 ${className}`}
    ref={(element) => { element?.setCustomValidity(error); }}
    onChange={(event) => {
      const nextText = event.target.value;
      const nextValue = parseDateInput(nextText, withTime);
      setDraft({ source: nextValue, text: nextText });
      onValueChange(nextValue);
    }}
    />
    <span className="absolute bottom-0 right-0 flex h-[42px] w-11 items-center justify-center rounded-r-lg text-slate-500 hover:text-teal-700 focus-within:ring-2 focus-within:ring-teal-500">
      <CalendarDays className="h-5 w-5" aria-hidden="true" />
      <input
        type={type}
        value={value}
        min={min}
        max={max}
        step={props.step}
        disabled={props.disabled || props.readOnly}
        aria-label={`${withTime ? "Chọn ngày và giờ" : "Chọn ngày"}${label ? `: ${label}` : ""}`}
        title={withTime ? "Chọn ngày và giờ" : "Chọn ngày"}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        onClick={(event) => event.currentTarget.showPicker?.()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.currentTarget.showPicker?.();
          }
        }}
        onChange={(event) => {
          const nextValue = event.target.value;
          setDraft({ source: nextValue, text: formatDateInput(nextValue) });
          onValueChange(nextValue);
        }}
      />
    </span>
  </span>;
  return label ? <div className="space-y-1.5"><label htmlFor={inputId} className="block text-sm font-medium text-slate-700">{label}</label>{input}</div> : input;
}
