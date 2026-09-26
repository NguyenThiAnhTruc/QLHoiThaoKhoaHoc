import { useState } from "react";
import { Eye, EyeOff, KeyRound, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { supabase } from "@/lib/supabase";
import { showToast } from "@/components/ui/toastStore";

export function ResetPasswordPage({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("Mật khẩu mới phải có ít nhất 6 ký tự.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError("Liên kết khôi phục không còn hiệu lực. Vui lòng yêu cầu lại.");
      return;
    }

    window.history.replaceState({}, "", window.location.pathname);
    showToast("success", "Đã cập nhật mật khẩu mới.");
    onComplete();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#effaf7] px-4 py-10">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-teal-600 text-white">
          <KeyRound className="h-5 w-5" />
        </span>
        <h1 className="mt-5 text-2xl font-bold text-slate-900">
          Đặt mật khẩu mới
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Tạo mật khẩu mới để tiếp tục sử dụng ConfManager.
        </p>
        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <PasswordInput
            label="Mật khẩu mới"
            value={password}
            onChange={setPassword}
            show={showPassword}
            onToggle={() => setShowPassword((value) => !value)}
            autoComplete="new-password"
          />
          <PasswordInput
            label="Xác nhận mật khẩu mới"
            value={confirmPassword}
            onChange={setConfirmPassword}
            show={showPassword}
            onToggle={() => setShowPassword((value) => !value)}
            autoComplete="new-password"
          />
          {error && (
            <p className="text-sm text-rose-600" role="alert">
              {error}
            </p>
          )}
          <Button className="w-full" size="lg" type="submit" disabled={loading}>
            {loading ? "Đang cập nhật..." : "Cập nhật mật khẩu"}
          </Button>
        </form>
      </section>
    </main>
  );
}

function PasswordInput({
  label,
  value,
  onChange,
  show,
  onToggle,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggle: () => void;
  autoComplete: string;
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <span className="mt-1.5 flex items-center gap-3 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20">
        <Lock className="h-4 w-4 text-slate-400" />
        <input
          className="w-full bg-transparent text-sm text-slate-900 focus:outline-none"
          type={show ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          required
        />
        <button
          type="button"
          aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          onClick={onToggle}
          className="rounded p-1 text-slate-400 hover:bg-slate-100"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </span>
    </label>
  );
}
