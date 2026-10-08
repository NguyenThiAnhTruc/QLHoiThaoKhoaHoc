import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Award,
  Bell,
  CalendarDays,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Lock,
  LogIn,
  Mail,
  MapPin,
  Search,
  ShieldCheck,
  UserPlus,
  User as UserIcon,
} from "lucide-react";
import { useAuth } from "@/context/useAuth";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { getRememberLoginPreference, supabase } from "@/lib/supabase";
import { showToast } from "@/components/ui/toastStore";
import { PublicPortal } from "@/pages/PublicPortal";
import {
  CONFERENCE_STATUS_COLORS,
  CONFERENCE_STATUS_LABELS,
  getConferenceDisplayStatus,
  ROLE_LABELS,
} from "@/lib/constants";
import type { Conference, ConferenceStatus, UserRole } from "@/types";
import logo from "@/public/logo.jpg";

type AuthMode = "landing" | "signin" | "signup" | "forgot";

export function AuthPage() {
  const { signIn, signInWithGoogle, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<AuthMode>("landing");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<UserRole | "">("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [roleError, setRoleError] = useState("");
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [rememberLogin, setRememberLogin] = useState(
    getRememberLoginPreference,
  );

  const signupRoles: UserRole[] = ["participant", "author", "reviewer"];
  const isSignup = mode === "signup";
  const isForgot = mode === "forgot";
  const passwordChecks = [
    { label: "Ít nhất 6 ký tự", valid: password.length >= 6 },
    { label: "Có chữ cái", valid: /[A-Za-zÀ-ỹ]/.test(password) },
    { label: "Có chữ số", valid: /\d/.test(password) },
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setEmailError("");
    setPasswordError("");
    setRoleError("");

    const cleanEmail = email.trim().toLowerCase();
    const validationError = validateForm(cleanEmail);
    if (validationError) {
      setError(validationError);
      if (validationError.toLowerCase().includes("email"))
        setEmailError(validationError);
      else if (validationError.toLowerCase().includes("vai trò"))
        setRoleError(validationError);
      else if (!isForgot) setPasswordError(validationError);
      return;
    }

    setLoading(true);

    if (mode === "signin") {
      const { error } = await signIn(cleanEmail, password, rememberLogin);
      if (error) {
        setPasswordError("Email hoặc mật khẩu không đúng.");
        showToast("error", "Đăng nhập thất bại");
      } else {
        showToast("success", "Đăng nhập thành công");
      }
    } else if (mode === "signup") {
      const { error } = await signUp(
        cleanEmail,
        password,
        fullName.trim(),
        role as UserRole,
      );
      if (error) {
        setError(error);
        showToast("error", "Đăng ký thất bại");
      } else {
        showToast("success", "Đăng ký thành công! Vui lòng đăng nhập.");
        switchMode("signin");
        setPassword("");
        setConfirmPassword("");
      }
    } else {
      const { error } = await resetPassword(cleanEmail);
      if (error) {
        setError(error);
        showToast("error", "Gửi email khôi phục thất bại");
      } else {
        showToast("success", "Đã gửi email khôi phục mật khẩu");
        switchMode("signin");
      }
    }

    setLoading(false);
  }

  async function handleGoogleSignIn() {
    setError("");
    setPasswordError("");
    setLoading(true);
    const { error } = await signInWithGoogle(rememberLogin);
    if (error) {
      setError(
        "Chưa thể đăng nhập bằng Google. Vui lòng thử lại hoặc dùng email và mật khẩu.",
      );
      showToast("error", "Đăng nhập Google thất bại");
      setLoading(false);
    }
  }

  function validateForm(cleanEmail: string) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return "Email không hợp lệ";
    }

    if (isForgot) return "";
    if (!password) return "Vui lòng nhập mật khẩu";

    if (isSignup) {
      if (!fullName.trim()) return "Vui lòng nhập họ và tên";
      if (!role) return "Vui lòng chọn vai trò đăng ký";
      if (password.length < 6) return "Mật khẩu phải có ít nhất 6 ký tự";
      if (password !== confirmPassword) return "Mật khẩu xác nhận không khớp";
    }

    return "";
  }

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError("");
    setShowPassword(false);
    setShowConfirmPassword(false);
  }

  if (mode === "landing") {
    return (
      <PublicPortal
        onSignIn={() => switchMode("signin")}
        onSignUp={() => switchMode("signup")}
      />
    );
  }

  return (
    <div className="min-h-screen bg-white lg:grid lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-slate-900 lg:flex lg:flex-col lg:justify-between lg:p-14 xl:p-16">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,#0f172a_0%,#164e63_54%,#0f766e_100%)]" />
        <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:40px_40px]" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm">
            <img
              src={logo}
              alt="Logo Quản lý Hội thảo Khoa học"
              className="h-full w-full object-contain"
            />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">ConfManager</h1>
            <p className="text-sm text-slate-300">Hệ thống Quản lý Hội thảo</p>
          </div>
        </div>

        <div className="relative z-10 space-y-6">
          <h2 className="max-w-lg text-3xl font-bold leading-tight text-white">
            Quản lý hội thảo khoa học toàn diện
          </h2>
          <p className="max-w-xl leading-relaxed text-slate-200">
            Nền tảng giúp ban tổ chức, tác giả và người tham dự làm việc trong
            cùng một hệ thống; phản biện được phân công theo từng bài báo.
          </p>
          <div className="grid gap-3">
            {[
              "Quản lý hội thảo và lịch trình",
              "Nộp và phản biện bài báo khoa học",
              "Điểm danh bằng mã QR",
              "Cấp chứng nhận tham dự",
            ].map((item) => (
              <div
                key={item}
                className="flex items-center gap-3 text-slate-100"
              >
                <ShieldCheck className="h-5 w-5 text-teal-300" />
                <span className="text-sm">{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 text-sm text-slate-300">
          © 2026 ConfManager. Đồ án tốt nghiệp.
        </div>
      </div>

      <div className="flex min-h-screen items-center justify-center bg-[#effaf7] px-6 py-10 sm:px-10 lg:min-h-0 lg:px-12 xl:px-16">
        <div className="w-full max-w-lg">
          <div className="mb-6 flex items-center justify-center gap-2.5 lg:hidden">
            <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm">
              <img
                src={logo}
                alt="Logo Quản lý Hội thảo Khoa học"
                className="h-full w-full object-contain"
              />
            </div>
            <span className="text-lg font-bold text-slate-900">
              ConfManager
            </span>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <button
              type="button"
              onClick={() => switchMode("landing")}
              className="mb-4 text-sm font-medium text-slate-500 hover:text-slate-700"
            >
              Quay lại trang chủ
            </button>
            <div className="mb-5">
              <h2 className="text-2xl font-bold text-slate-900">
                {mode === "signin" && "Đăng nhập"}
                {mode === "signup" && "Tạo tài khoản"}
                {mode === "forgot" && "Khôi phục mật khẩu"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {mode === "signin" && "Chào mừng bạn quay lại ConfManager"}
                {mode === "signup" &&
                  "Tạo tài khoản để tham gia quy trình hội thảo"}
                {mode === "forgot" &&
                  "Nhập email để nhận liên kết đặt lại mật khẩu"}
              </p>
            </div>

            {error && (
              <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              {isSignup && (
                <>
                  <FormField
                    icon={<UserIcon className="h-4 w-4 text-slate-400" />}
                  >
                    <input
                      type="text"
                      placeholder="Họ và tên"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      autoComplete="name"
                      required
                      className="w-full bg-transparent text-sm text-slate-900 placeholder-slate-400 focus:outline-none"
                    />
                  </FormField>
                  <Select
                    label="Vai trò đăng ký *"
                    value={role}
                    onChange={(e) => {
                      setRole(e.target.value as UserRole);
                      setRoleError("");
                    }}
                    error={roleError}
                    required
                  >
                    <option value="" disabled>
                      Chọn vai trò
                    </option>
                    {signupRoles.map((item) => (
                      <option key={item} value={item}>
                        {ROLE_LABELS[item]}
                      </option>
                    ))}
                  </Select>
                </>
              )}

              <FormField icon={<Mail className="h-4 w-4 text-slate-400" />}>
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailError("");
                  }}
                  autoComplete="email"
                  required
                  className="w-full bg-transparent text-sm text-slate-900 placeholder-slate-400 focus:outline-none"
                />
              </FormField>
              {emailError && (
                <p className="-mt-2 text-sm text-rose-600" role="alert">
                  {emailError}
                </p>
              )}

              {!isForgot && (
                <>
                  <PasswordField
                    value={password}
                    onChange={(value) => {
                      setPassword(value);
                      setPasswordError("");
                    }}
                    show={showPassword}
                    onToggleShow={() => setShowPassword((current) => !current)}
                    onCapsLockChange={setCapsLockOn}
                    placeholder="Mật khẩu"
                    autoComplete={
                      isSignup ? "new-password" : "current-password"
                    }
                  />
                  {capsLockOn && (
                    <p className="-mt-2 text-sm text-amber-700" role="status">
                      Caps Lock đang bật
                    </p>
                  )}
                  {passwordError && (
                    <p className="-mt-2 text-sm text-rose-600" role="alert">
                      {passwordError}
                    </p>
                  )}
                </>
              )}

              {mode === "signin" && (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={rememberLogin}
                    onChange={(event) => setRememberLogin(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  Ghi nhớ đăng nhập
                </label>
              )}

              {isSignup && (
                <>
                  <PasswordField
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    show={showConfirmPassword}
                    onToggleShow={() =>
                      setShowConfirmPassword((current) => !current)
                    }
                    placeholder="Nhập lại mật khẩu"
                    autoComplete="new-password"
                  />
                  <div className="grid gap-2 rounded-lg bg-slate-50 px-3.5 py-3">
                    {passwordChecks.map((check) => (
                      <div
                        key={check.label}
                        className={`flex items-center gap-2 text-xs ${
                          check.valid ? "text-emerald-700" : "text-slate-500"
                        }`}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {check.label}
                      </div>
                    ))}
                  </div>
                </>
              )}

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={loading}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading
                  ? "Đang xử lý..."
                  : mode === "signin"
                    ? "Đăng nhập"
                    : mode === "signup"
                      ? "Tạo tài khoản"
                      : "Gửi liên kết"}
              </Button>

              {mode === "signin" && (
                <>
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span className="h-px flex-1 bg-slate-200" />
                    <span>hoặc</span>
                    <span className="h-px flex-1 bg-slate-200" />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="w-full"
                    disabled={loading}
                    onClick={handleGoogleSignIn}
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-sm font-bold text-red-500">
                      G
                    </span>
                    Tiếp tục với Google
                  </Button>
                </>
              )}
            </form>

            <div className="mt-5 text-center text-sm">
              {mode === "signin" && (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => switchMode("forgot")}
                    className="block w-full text-slate-400 hover:text-slate-600"
                  >
                    Quên mật khẩu?
                  </button>
                  <p className="text-slate-500">
                    Chưa có tài khoản?{" "}
                    <button
                      type="button"
                      onClick={() => switchMode("signup")}
                      className="font-medium text-teal-600 hover:text-teal-700"
                    >
                      Đăng ký
                    </button>
                  </p>
                </div>
              )}
              {mode === "signup" && (
                <p className="text-slate-500">
                  Đã có tài khoản?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("signin")}
                    className="font-medium text-teal-600 hover:text-teal-700"
                  >
                    Đăng nhập
                  </button>
                </p>
              )}
              {mode === "forgot" && (
                <button
                  type="button"
                  onClick={() => switchMode("signin")}
                  className="font-medium text-teal-600 hover:text-teal-700"
                >
                  Quay lại đăng nhập
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LegacyLandingPage({
  onSignIn,
  onSignUp,
}: {
  onSignIn: () => void;
  onSignUp: () => void;
}) {
  const [conferences, setConferences] = useState<Conference[]>([]);
  const [conferenceLoading, setConferenceLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<ConferenceStatus | "all">(
    "all",
  );
  const [certificateNumber, setCertificateNumber] = useState("");
  const [certificateResult, setCertificateResult] =
    useState<CertificateLookup | null>(null);
  const [certificateMessage, setCertificateMessage] = useState("");
  const [verifyingCertificate, setVerifyingCertificate] = useState(false);

  const defaultConferenceImages = [
    "https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1515169067865-5387ec356754?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&w=900&q=80",
  ];

  const features = [
    {
      title: "Quản lý hội thảo",
      description:
        "Tạo hội thảo, cập nhật trạng thái, địa điểm, thời gian và số lượng tham dự.",
      icon: <CalendarDays className="h-5 w-5" />,
    },
    {
      title: "Nộp bài khoa học",
      description:
        "Tác giả nộp bài, thêm đồng tác giả và theo dõi trạng thái xét duyệt.",
      icon: <FileText className="h-5 w-5" />,
    },
    {
      title: "Phản biện",
      description:
        "Phân công phản biện, chấm điểm, nhận xét và đưa khuyến nghị xử lý.",
      icon: <ShieldCheck className="h-5 w-5" />,
    },
    {
      title: "Điểm danh & chứng nhận",
      description:
        "Quét mã điểm danh, xuất danh sách tham dự và cấp chứng nhận sau hội thảo.",
      icon: <Award className="h-5 w-5" />,
    },
  ];

  const sampleConferences = [
    {
      code: "AIED 2026",
      title: "Hội thảo Quốc gia về Giáo dục trong kỷ nguyên AI",
      organizer: "Khoa Công nghệ thông tin · Trường Đại học Demo",
      location: "TP. Hồ Chí Minh",
      field: "Trí tuệ nhân tạo",
      status: "Nhận bài",
      date: "25/09",
      year: "2026",
      deadline: "Hạn nộp bài: 15/08/2026",
      imageUrl: defaultConferenceImages[0],
    },
    {
      code: "SECONF 2026",
      title: "Hội nghị Sinh viên Nghiên cứu Khoa học Công nghệ",
      organizer: "Viện Khoa học Ứng dụng · CLB Nghiên cứu trẻ",
      location: "Hà Nội",
      field: "Kỹ thuật phần mềm",
      status: "Mở đăng ký",
      date: "09/10",
      year: "2026",
      deadline: "Hạn đăng ký: 30/09/2026",
      imageUrl: defaultConferenceImages[1],
    },
    {
      code: "DATA 2026",
      title: "Hội thảo Dữ liệu và Chuyển đổi số trong giáo dục",
      organizer: "Trung tâm Chuyển đổi số",
      location: "Đà Nẵng",
      field: "Khoa học dữ liệu",
      status: "Sắp diễn ra",
      date: "12/11",
      year: "2026",
      deadline: "Thông báo chấp nhận: 20/10/2026",
      imageUrl: defaultConferenceImages[2],
    },
  ];

  useEffect(() => {
    async function loadPublicConferences() {
      const { data } = await supabase
        .from("conferences")
        .select("*")
        .order("start_date", { ascending: true })
        .limit(12);

      setConferences((data ?? []) as unknown as Conference[]);
      setConferenceLoading(false);
    }

    loadPublicConferences();
  }, []);

  const publicConferences =
    conferences.length > 0
      ? conferences.map((conference, index) => ({
          code: makeConferenceCode(conference.title),
          title: conference.title,
          organizer: "Ban tổ chức",
          location: conference.location || "Chưa cập nhật",
          field: "Hội thảo khoa học",
          status:
            CONFERENCE_STATUS_LABELS[getConferenceDisplayStatus(conference)],
          statusClass:
            CONFERENCE_STATUS_COLORS[getConferenceDisplayStatus(conference)],
          date: formatDayMonth(conference.start_date),
          year: new Date(conference.start_date).getFullYear().toString(),
          imageUrl:
            conference.cover_image_url ||
            defaultConferenceImages[index % defaultConferenceImages.length],
          deadline:
            getConferenceDisplayStatus(conference) === "open"
              ? "Đang mở đăng ký tham dự"
              : `Trạng thái: ${CONFERENCE_STATUS_LABELS[getConferenceDisplayStatus(conference)]}`,
        }))
      : sampleConferences.map((conference) => ({
          ...conference,
          statusClass: "bg-teal-50 text-teal-700",
        }));

  const filteredConferences = publicConferences.filter((conference) => {
    const query = searchTerm.trim().toLowerCase();
    const matchesSearch =
      !query ||
      conference.title.toLowerCase().includes(query) ||
      conference.location.toLowerCase().includes(query) ||
      conference.field.toLowerCase().includes(query);
    const matchesStatus =
      statusFilter === "all" ||
      (conferences.length > 0 &&
        conference.status === CONFERENCE_STATUS_LABELS[statusFilter]);
    return matchesSearch && matchesStatus;
  });

  const stats = [
    [publicConferences.length.toString(), "Hội thảo"],
    [
      conferences.length > 0
        ? conferences
            .filter(
              (conference) => getConferenceDisplayStatus(conference) === "open",
            )
            .length.toString()
        : "5",
      "Đang mở đăng ký",
    ],
    ["28", "Bài chờ phản biện"],
    ["84", "Chứng nhận"],
  ];

  const steps = [
    {
      index: "01",
      title: "Tạo và công bố hội thảo",
      description:
        "Ban tổ chức nhập thông tin hội thảo, thời gian, địa điểm, trạng thái đăng ký và lịch trình.",
    },
    {
      index: "02",
      title: "Nhận bài và phản biện",
      description:
        "Tác giả nộp bài, ban tổ chức phân công phản biện, phản biện chấm điểm và gửi nhận xét.",
    },
    {
      index: "03",
      title: "Điểm danh và cấp chứng nhận",
      description:
        "Người tham dự dùng mã QR để điểm danh, ban tổ chức xuất danh sách và cấp chứng nhận.",
    },
  ];

  const faqs = [
    [
      "ConfManager dùng để làm gì?",
      "Hệ thống dùng để quản lý hội thảo khoa học từ lúc tạo sự kiện, nhận bài, phản biện đến điểm danh và cấp chứng nhận.",
    ],
    [
      "Có cần đăng nhập để sử dụng không?",
      "Trang chủ có thể xem trước, còn các chức năng quản lý, nộp bài, phản biện và điểm danh cần đăng nhập.",
    ],
    [
      "Ai có quyền tạo hội thảo?",
      "Admin và tài khoản ban tổ chức có quyền tạo, sửa, xóa hội thảo và quản lý lịch trình.",
    ],
  ];

  const roles = ["Admin", "Ban tổ chức", "Tác giả", "Người tham dự"];

  async function verifyCertificate() {
    const lookup = certificateNumber.trim();
    if (!lookup) {
      setCertificateMessage("Vui lòng nhập mã chứng nhận");
      setCertificateResult(null);
      return;
    }

    setVerifyingCertificate(true);
    setCertificateMessage("");
    const { data, error } = await supabase.rpc("verify_certificate", {
      lookup_number: lookup,
    });

    if (error) {
      setCertificateMessage("Không thể kiểm tra chứng nhận lúc này");
      setCertificateResult(null);
    } else if (!data || data.length === 0) {
      setCertificateMessage("Không tìm thấy chứng nhận phù hợp");
      setCertificateResult(null);
    } else {
      setCertificateResult(data[0] as CertificateLookup);
    }
    setVerifyingCertificate(false);
  }

  return (
    <div className="min-h-screen bg-[#effaf7]">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-white">
              <img
                src={logo}
                alt="Logo Quản lý Hội thảo Khoa học"
                className="h-full w-full object-contain"
              />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">ConfManager</p>
              <p className="text-xs text-slate-500">
                Quản lý hội thảo khoa học
              </p>
            </div>
          </div>
          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
            <a href="#conferences" className="hover:text-teal-700">
              Hội thảo
            </a>
            <a href="#features" className="hover:text-teal-700">
              Chức năng
            </a>
            <a href="#process" className="hover:text-teal-700">
              Quy trình
            </a>
            <a href="#faq" className="hover:text-teal-700">
              FAQ
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onSignIn}>
              <LogIn className="h-4 w-4" />
              Đăng nhập
            </Button>
            <Button onClick={onSignUp}>
              <UserPlus className="h-4 w-4" />
              Đăng ký
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_0.95fr] lg:px-8 lg:py-16">
            <div className="flex flex-col justify-center">
              <div className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-sm font-medium text-teal-700">
                <ShieldCheck className="h-4 w-4" />
                Hệ thống quản lý hội thảo khoa học
              </div>
              <h1 className="max-w-3xl text-4xl font-bold leading-tight text-slate-950 sm:text-5xl">
                ConfManager
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
                Nền tảng hỗ trợ toàn bộ quy trình hội thảo khoa học: tạo hội
                thảo, đăng ký tham dự, nộp bài, phản biện, điểm danh và cấp
                chứng nhận.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {stats.map(([value, label]) => (
                  <div
                    key={label}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                  >
                    <p className="text-2xl font-bold text-slate-950">{value}</p>
                    <p className="mt-1 text-xs text-slate-500">{label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Button size="lg" onClick={onSignUp}>
                  Bắt đầu đăng ký
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button size="lg" variant="outline" onClick={onSignIn}>
                  Tôi đã có tài khoản
                </Button>
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                {roles.map((role) => (
                  <span
                    key={role}
                    className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600"
                  >
                    {role}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
              <div className="rounded-lg bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Tìm hội thảo phù hợp
                    </p>
                    <p className="text-xs text-slate-500">
                      Mẫu giao diện danh sách trước khi đăng nhập
                    </p>
                  </div>
                  <Search className="h-5 w-5 text-teal-600" />
                </div>
                <div className="mt-4 grid gap-3">
                  {publicConferences.slice(0, 2).map((conference) => (
                    <div
                      key={conference.code}
                      className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                    >
                      <img
                        src={conference.imageUrl}
                        alt=""
                        className="h-24 w-full object-cover"
                      />
                      <div className="p-4">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <span className="text-xs font-semibold text-teal-700">
                            {conference.code}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${conference.statusClass}`}
                          >
                            {conference.status}
                          </span>
                        </div>
                        <p className="line-clamp-2 text-sm font-semibold text-slate-900">
                          {conference.title}
                        </p>
                        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {conference.location}
                          </span>
                          <span className="font-semibold text-slate-700">
                            {conference.date}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          id="conferences"
          className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8"
        >
          <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                Hội thảo nổi bật
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Tra cứu hội thảo công khai trước khi đăng nhập vào hệ thống.
              </p>
            </div>
            <Button variant="outline" onClick={onSignIn}>
              Đăng nhập để xem đầy đủ
            </Button>
          </div>
          <div className="mb-5 grid gap-3 md:grid-cols-[1fr_220px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Tìm theo tên, địa điểm hoặc lĩnh vực..."
                className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as ConferenceStatus | "all")
              }
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="open">Đang mở đăng ký</option>
              <option value="ongoing">Đang diễn ra</option>
              <option value="completed">Đã hoàn thành</option>
              <option value="draft">Bản nháp</option>
            </select>
          </div>
          {conferenceLoading && (
            <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
              Đang tải danh sách hội thảo...
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-3">
            {filteredConferences.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 lg:col-span-3">
                Không tìm thấy hội thảo phù hợp
              </div>
            ) : (
              filteredConferences.map((conference) => (
                <article
                  key={conference.code}
                  className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
                >
                  <img
                    src={conference.imageUrl}
                    alt=""
                    className="h-36 w-full object-cover"
                  />
                  <div className="p-5">
                    <div className="mb-4 flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold uppercase text-teal-700">
                          {conference.code}
                        </p>
                        <h3 className="mt-2 line-clamp-2 font-semibold text-slate-950">
                          {conference.title}
                        </h3>
                      </div>
                      <div className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center">
                        <p className="text-sm font-bold text-slate-900">
                          {conference.date}
                        </p>
                        <p className="text-xs text-slate-500">
                          {conference.year}
                        </p>
                      </div>
                    </div>
                    <p className="line-clamp-2 text-sm text-slate-500">
                      {conference.organizer}
                    </p>
                    <div className="mt-4 grid gap-2 text-xs text-slate-500">
                      <span className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5" />
                        {conference.location}
                      </span>
                      <span className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5" />
                        {conference.field}
                      </span>
                      <span className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5" />
                        {conference.deadline}
                      </span>
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-medium ${conference.statusClass}`}
                      >
                        {conference.status}
                      </span>
                      <button
                        type="button"
                        onClick={onSignIn}
                        className="text-sm font-medium text-teal-700 hover:text-teal-800"
                      >
                        Xem chi tiết
                      </button>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section id="features" className="border-y border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
            <div className="mb-5">
              <h2 className="text-xl font-bold text-slate-900">
                Chức năng nổi bật
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Người dùng có thể xem trước hệ thống trước khi đăng nhập.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                    {feature.icon}
                  </div>
                  <h3 className="font-semibold text-slate-900">
                    {feature.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          id="process"
          className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8"
        >
          <div className="mb-5">
            <h2 className="text-xl font-bold text-slate-900">
              Quy trình sử dụng
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Từ tạo hội thảo đến cấp chứng nhận trong 3 bước.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {steps.map((step) => (
              <div
                key={step.index}
                className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
              >
                <p className="text-sm font-bold text-teal-700">{step.index}</p>
                <h3 className="mt-3 font-semibold text-slate-900">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section id="faq" className="border-t border-slate-200 bg-white">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                Câu hỏi thường gặp
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Các thông tin nhanh trước khi người dùng đăng nhập hoặc đăng ký.
              </p>
              <div className="mt-5 flex items-center gap-2 text-sm text-slate-500">
                <Bell className="h-4 w-4 text-teal-700" />
                Có thể mở rộng thêm thông báo hạn nộp bài sau này.
              </div>
            </div>
            <div className="grid gap-3">
              {faqs.map(([question, answer]) => (
                <div
                  key={question}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                >
                  <h3 className="font-semibold text-slate-900">{question}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {answer}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-slate-200 bg-slate-50">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                Kiểm tra chứng nhận
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Nhập mã chứng nhận để xác minh nhanh thông tin người nhận và hội
                thảo mà không cần đăng nhập.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <input
                  type="text"
                  value={certificateNumber}
                  onChange={(e) => setCertificateNumber(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") verifyCertificate();
                  }}
                  placeholder="Nhập mã chứng nhận"
                  className="rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                />
                <Button
                  onClick={verifyCertificate}
                  disabled={verifyingCertificate}
                >
                  {verifyingCertificate ? "Đang kiểm tra..." : "Kiểm tra"}
                </Button>
              </div>
              {certificateMessage && (
                <p className="mt-3 text-sm text-rose-600">
                  {certificateMessage}
                </p>
              )}
              {certificateResult && (
                <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <p className="font-semibold text-emerald-900">
                    Chứng nhận hợp lệ
                  </p>
                  <div className="mt-2 grid gap-1 text-sm text-emerald-800">
                    <p>Người nhận: {certificateResult.recipient_name}</p>
                    <p>
                      Đơn vị:{" "}
                      {certificateResult.recipient_organization ||
                        "Chưa cập nhật"}
                    </p>
                    <p>Hội thảo: {certificateResult.conference_title}</p>
                    <p>
                      Ngày cấp:{" "}
                      {new Date(certificateResult.issued_at).toLocaleDateString(
                        "vi-VN",
                      )}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

interface CertificateLookup {
  certificate_number: string;
  certificate_type: string;
  issued_at: string;
  recipient_name: string;
  recipient_organization: string;
  conference_title: string;
  conference_start_date: string;
  conference_end_date: string;
}

function makeConferenceCode(title: string) {
  const words = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[A-Za-z0-9]+/g);
  return (words ?? ["CONF"])
    .slice(0, 3)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function formatDayMonth(date: string) {
  return new Date(date).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
  });
}

function PasswordField({
  value,
  onChange,
  show,
  onToggleShow,
  onCapsLockChange,
  placeholder,
  autoComplete,
}: {
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggleShow: () => void;
  onCapsLockChange?: (enabled: boolean) => void;
  placeholder: string;
  autoComplete: string;
}) {
  return (
    <FormField icon={<Lock className="h-4 w-4 text-slate-400" />}>
      <input
        type={show ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(event) =>
          onCapsLockChange?.(event.getModifierState("CapsLock"))
        }
        onKeyUp={(event) =>
          onCapsLockChange?.(event.getModifierState("CapsLock"))
        }
        onBlur={() => onCapsLockChange?.(false)}
        autoComplete={autoComplete}
        required
        className="w-full bg-transparent text-sm text-slate-900 placeholder-slate-400 focus:outline-none"
      />
      <button
        type="button"
        onClick={onToggleShow}
        className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </FormField>
  );
}

function FormField({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 transition-colors focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20">
      {icon}
      {children}
    </div>
  );
}
