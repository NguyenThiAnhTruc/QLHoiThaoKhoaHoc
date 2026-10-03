import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Award,
  BookOpenCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Compass,
  FileText,
  Home,
  LogIn,
  Mail,
  MapPin,
  Menu,
  Mic2,
  Phone,
  Share2,
  Sparkles,
  UserPlus,
  Users,
  Video,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { supabase } from "@/lib/supabase";
import { showToast } from "@/components/ui/toastStore";
import {
  getConferenceDisplayStatus,
  isConferenceRegistrationOpen,
} from "@/lib/constants";
import type {
  Conference,
  ConferenceAnnouncement,
  ConferenceSpeaker,
  EventFormat,
  Session,
} from "@/types";
import logo from "@/public/logo.jpg";

interface PublicPortalProps {
  onSignIn: () => void;
  onSignUp: () => void;
}

const fallbackImages = [
  "https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1515169067865-5387ec356754?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&w=1200&q=80",
];

const formatLabels: Record<EventFormat, string> = {
  online: "Trực tuyến",
  offline: "Trực tiếp",
  hybrid: "Kết hợp",
};

export function PublicPortal({ onSignIn, onSignUp }: PublicPortalProps) {
  const [conferences, setConferences] = useState<Conference[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConference, setSelectedConference] =
    useState<Conference | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [speakers, setSpeakers] = useState<ConferenceSpeaker[]>([]);
  const [detailAnnouncements, setDetailAnnouncements] = useState<
    ConferenceAnnouncement[]
  >([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [certificateNumber, setCertificateNumber] = useState("");
  const [certificateMessage, setCertificateMessage] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authPrompt, setAuthPrompt] = useState<{
    action: "register" | "submit";
    conference: Conference;
  } | null>(null);

  useEffect(() => {
    async function load() {
      const { data: conferenceRows } = await supabase
        .from("conferences")
        .select("*")
        .order("start_date", { ascending: true });
      setConferences(
        ((conferenceRows ?? []) as unknown as Conference[]).filter(
          (conference) => getConferenceDisplayStatus(conference) !== "draft",
        ),
      );
      setLoading(false);

      const requestedId = new URLSearchParams(window.location.search).get(
        "conference",
      );
      const requested = conferenceRows?.find(
        (conference) => conference.id === requestedId,
      );
      if (requested) openConference(requested as Conference);
    }
    load();
  }, []);

  const topicCount = new Set(
    conferences.flatMap((conference) => conference.topics ?? []),
  ).size;
  const upcomingConferences = conferences.filter(
    (conference) => new Date(conference.start_date) >= startOfToday(),
  );
  const registrationOpenConferences = conferences.filter((conference) =>
    isRegistrationOpen(conference),
  );
  const ongoingConferences = conferences.filter(
    (conference) => getConferenceDisplayStatus(conference) === "ongoing",
  );
  const featured = conferences
    .filter((conference) => conference.is_featured)
    .slice(0, 3);
  const published = conferences
    .filter((conference) =>
      ["open", "closed", "ongoing"].includes(
        getConferenceDisplayStatus(conference),
      ),
    )
    .slice()
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  const heroConference =
    registrationOpenConferences[0] ??
    upcomingConferences[0] ??
    featured[0] ??
    conferences[0];

  async function openConference(conference: Conference) {
    setSelectedConference(conference);
    setDetailLoading(true);
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}?conference=${conference.id}`,
    );
    const [
      { data: sessionRows },
      { data: speakerRows },
      { data: announcementRows },
    ] = await Promise.all([
      conference.is_schedule_public
        ? supabase
            .from("sessions")
            .select("*")
            .eq("conference_id", conference.id)
            .order("start_time")
        : Promise.resolve({ data: [] }),
      supabase
        .from("conference_speakers")
        .select("*")
        .eq("conference_id", conference.id)
        .order("display_order"),
      supabase
        .from("conference_announcements")
        .select("*")
        .eq("conference_id", conference.id)
        .eq("is_public", true)
        .order("published_at", { ascending: false }),
    ]);
    setSessions((sessionRows ?? []) as unknown as Session[]);
    setSpeakers((speakerRows ?? []) as unknown as ConferenceSpeaker[]);
    setDetailAnnouncements(
      (announcementRows ?? []) as unknown as ConferenceAnnouncement[],
    );
    setDetailLoading(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeDetail() {
    setSelectedConference(null);
    window.history.replaceState({}, "", window.location.pathname);
  }

  function beginIntent(action: "register" | "submit", conference: Conference) {
    setAuthPrompt({ action, conference });
  }

  function continueToAuth(mode: "signin" | "signup") {
    if (!authPrompt) return;
    sessionStorage.setItem(
      "confmanager:return-after-auth",
      JSON.stringify({
        conferenceId: authPrompt.conference.id,
        action: authPrompt.action,
      }),
    );
    setAuthPrompt(null);
    if (mode === "signin") onSignIn();
    else onSignUp();
  }

  async function copyText(value: string) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const input = document.createElement("textarea");
    input.value = value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    if (!copied) throw new Error("Copy command was rejected");
  }

  async function share(conference: Conference) {
    const url = `${window.location.origin}${window.location.pathname}?conference=${conference.id}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: conference.title,
          text: conference.description,
          url,
        });
        return;
      }
      await copyText(url);
      showToast("success", "Đã sao chép liên kết hội thảo");
    } catch {
      showToast("error", "Không thể chia sẻ liên kết lúc này");
    }
  }

  async function copyLink(conference: Conference) {
    try {
      await copyText(
        `${window.location.origin}${window.location.pathname}?conference=${conference.id}`,
      );
      showToast("success", "Đã sao chép liên kết hội thảo");
    } catch {
      showToast("error", "Trình duyệt không thể sao chép liên kết");
    }
  }

  async function verifyCertificate() {
    const lookup = certificateNumber.trim();
    if (!lookup) {
      setCertificateMessage("Vui lòng nhập mã chứng nhận.");
      return;
    }
    const { data, error } = await supabase.rpc("verify_certificate", {
      lookup_number: lookup,
    });
    setCertificateMessage(
      error
        ? "Không thể kiểm tra chứng nhận lúc này."
        : data?.length
          ? `Chứng nhận hợp lệ: ${data[0].recipient_name} - ${data[0].conference_title}`
          : "Không tìm thấy chứng nhận phù hợp.",
    );
  }

  if (selectedConference) {
    return (
      <>
        <PublicConferenceDetail
          conference={selectedConference}
          sessions={sessions}
          speakers={speakers}
          announcements={detailAnnouncements}
          loading={detailLoading}
          onBack={closeDetail}
          onRegister={() => beginIntent("register", selectedConference)}
          onSubmit={() => beginIntent("submit", selectedConference)}
          onShare={() => share(selectedConference)}
          onCopy={() => copyLink(selectedConference)}
        />
        <Modal
          open={!!authPrompt}
          onClose={() => setAuthPrompt(null)}
          title="Cần đăng nhập để tiếp tục"
          size="sm"
        >
          <p className="text-sm leading-6 text-slate-600">
            Bạn cần đăng nhập hoặc đăng ký tài khoản để sử dụng chức năng này.
          </p>
          {authPrompt && (
            <p className="mt-3 rounded-lg bg-[#f4f8fc] px-3 py-2 text-sm font-medium text-slate-700">
              {authPrompt.action === "register"
                ? "Đăng ký tham dự"
                : "Nộp bài báo"}
              : {authPrompt.conference.title}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="outline" onClick={() => continueToAuth("signup")}>
              Đăng ký
            </Button>
            <Button onClick={() => continueToAuth("signin")}>Đăng nhập</Button>
          </div>
        </Modal>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#effaf7] text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <a href="#top" className="group flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-white transition-transform duration-300 group-hover:rotate-6 group-hover:scale-105">
              <img
                src={logo}
                alt="Logo Quản lý Hội thảo Khoa học"
                className="h-full w-full object-contain"
              />
            </span>
            <span>
              <strong className="block text-sm">ConfManager</strong>
              <small className="hidden text-xs text-slate-500 sm:block">
                Cổng thông tin hội thảo
              </small>
            </span>
          </a>
          <nav className="hidden gap-5 text-sm font-medium text-slate-600 md:flex">
            <a
              className="group flex items-center gap-1.5 transition-colors hover:text-teal-700"
              href="#top"
            >
              <Home className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5" />
              Trang chủ
            </a>
            <a
              className="group flex items-center gap-1.5 transition-colors hover:text-teal-700"
              href="#explore"
            >
              <Compass className="h-3.5 w-3.5 transition-transform group-hover:rotate-12" />
              Khám phá hội thảo
            </a>
            <a
              className="group flex items-center gap-1.5 transition-colors hover:text-teal-700"
              href="#faq"
            >
              <CircleHelp className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
              FAQ
            </a>
          </nav>
          <div className="flex items-center gap-1 sm:gap-2">
            <Button
              variant="ghost"
              className="px-2 sm:px-4"
              aria-label="Đăng nhập"
              title="Đăng nhập"
              onClick={onSignIn}
            >
              <LogIn className="h-4 w-4" />
              <span className="hidden sm:inline">Đăng nhập</span>
            </Button>
            <Button
              className="px-2 sm:px-4"
              aria-label="Đăng ký"
              title="Đăng ký"
              onClick={onSignUp}
            >
              <UserPlus className="h-4 w-4" />
              <span className="hidden sm:inline">Đăng ký</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="px-2 md:hidden"
              aria-label={mobileMenuOpen ? "Đóng menu" : "Mở menu"}
              title={mobileMenuOpen ? "Đóng menu" : "Mở menu"}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((open) => !open)}
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
        {mobileMenuOpen && (
          <nav className="border-t border-slate-100 bg-white px-4 py-3 shadow-lg md:hidden">
            <div className="mx-auto grid max-w-7xl gap-1">
              <a
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-emerald-50 hover:text-teal-700"
                href="#top"
                onClick={() => setMobileMenuOpen(false)}
              >
                <Home className="h-4 w-4" />
                Trang chủ
              </a>
              <a
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-emerald-50 hover:text-teal-700"
                href="#explore"
                onClick={() => setMobileMenuOpen(false)}
              >
                <Compass className="h-4 w-4" />
                Khám phá hội thảo
              </a>
              <a
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-emerald-50 hover:text-teal-700"
                href="#faq"
                onClick={() => setMobileMenuOpen(false)}
              >
                <CircleHelp className="h-4 w-4" />
                FAQ
              </a>
            </div>
          </nav>
        )}
      </header>

      <main id="top">
        {loading && (
          <div className="mx-auto max-w-7xl px-4 pt-4 text-sm text-slate-500 sm:px-6 lg:px-8">
            Đang tải hội thảo công khai...
          </div>
        )}
        <section className="border-b border-white bg-[#effaf7]">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_0.78fr] lg:items-center lg:px-8 lg:py-16">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-teal-700">
                <Sparkles className="h-4 w-4 motion-safe:animate-pulse" />
                CỔNG THÔNG TIN HỘI THẢO
              </p>
              <h1 className="mt-3 max-w-2xl text-4xl font-bold leading-tight sm:text-5xl">
                Quản lý và tham gia hội thảo dễ dàng hơn.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600">
                Khám phá hội thảo phù hợp, theo dõi thời hạn, đăng ký tham dự và
                quản lý quá trình nộp bài trên một nền tảng duy nhất.
              </p>
              <div className="mt-5 flex items-center gap-2">
                <HeroAccent
                  label="Hội thảo"
                  tone="border-teal-200 bg-white text-teal-700"
                  delay="0ms"
                >
                  <CalendarDays className="h-4 w-4" />
                </HeroAccent>
                <HeroAccent
                  label="Bài báo khoa học"
                  tone="border-sky-200 bg-white text-sky-700"
                  delay="180ms"
                >
                  <FileText className="h-4 w-4" />
                </HeroAccent>
                <HeroAccent
                  label="Phản biện"
                  tone="border-violet-200 bg-white text-violet-700"
                  delay="360ms"
                >
                  <BookOpenCheck className="h-4 w-4" />
                </HeroAccent>
                <HeroAccent
                  label="Chứng nhận"
                  tone="border-amber-200 bg-white text-amber-700"
                  delay="540ms"
                >
                  <Award className="h-4 w-4" />
                </HeroAccent>
              </div>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button
                  onClick={() =>
                    document
                      .getElementById("explore")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                >
                  <Compass className="h-4 w-4" /> Khám phá hội thảo
                </Button>
                <Button variant="outline" onClick={onSignUp}>
                  Đăng ký ngay <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-8 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
                <QuickStat
                  icon={<CalendarDays className="h-4 w-4" />}
                  value={conferences.length}
                  label="Hội thảo công khai"
                />
                <QuickStat
                  icon={<Clock3 className="h-4 w-4" />}
                  value={upcomingConferences.length}
                  label="Sắp diễn ra"
                />
                <QuickStat
                  icon={<Users className="h-4 w-4" />}
                  value={registrationOpenConferences.length}
                  label="Mở đăng ký"
                />
                <QuickStat
                  icon={<Compass className="h-4 w-4" />}
                  value={topicCount}
                  label="Chủ đề"
                />
              </div>
            </div>
            <HeroConference
              conference={heroConference}
              onOpen={openConference}
            />
          </div>
        </section>

        <section className="border-b border-white bg-white">
          <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold">Tại sao chọn ConfManager?</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Mọi thông tin và công việc quan trọng của một hội thảo được tập
                trung rõ ràng.
              </p>
            </div>
            <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <ValueItem
                icon={<Compass />}
                title="Khám phá hội thảo"
                description="Xem các hội thảo theo chủ đề, địa điểm và thời gian phù hợp."
              />
              <ValueItem
                icon={<FileText />}
                title="Nộp và quản lý bài viết"
                description="Theo dõi bài đã nộp, phiên bản và trạng thái xử lý."
              />
              <ValueItem
                icon={<BookOpenCheck />}
                title="Phản biện và deadline"
                description="Nhận thông tin về thời hạn, phản hồi và kết quả."
              />
              <ValueItem
                icon={<Award />}
                title="Chứng nhận hội thảo"
                description="Tra cứu và quản lý chứng nhận sau khi tham dự."
              />
            </div>
          </div>
        </section>

        <section id="explore" className="border-y border-white bg-[#effaf7]">
          <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-2xl font-bold">Khám phá hội thảo</h2>
              <p className="mt-2 text-sm text-slate-600">
                Chọn một hội thảo phù hợp để xem thời gian, địa điểm và các
                deadline quan trọng.
              </p>
            </div>
            {loading ? (
              <div className="mt-8">
                <LoadingGrid />
              </div>
            ) : conferences.length === 0 ? (
              <div className="mx-auto mt-8 max-w-xl">
                <Empty text="Chưa có hội thảo công khai nào được công bố." />
              </div>
            ) : (
              <ExploreBoard
                registration={registrationOpenConferences}
                upcoming={upcomingConferences}
                ongoing={ongoingConferences}
                latest={published}
                onOpen={openConference}
              />
            )}
            <div className="mt-8 flex justify-center">
              <Button variant="outline" onClick={onSignIn}>
                Đăng nhập để đăng ký hoặc nộp bài{" "}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>

        <section className="border-y border-white bg-white">
          <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold">Quy trình tham gia</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Bắt đầu từ một tài khoản và theo dõi trọn vẹn hành trình hội
                thảo của bạn.
              </p>
            </div>
            <ProcessSteps />
          </div>
        </section>

        <section
          id="faq"
          className="mx-auto grid max-w-7xl gap-6 px-4 py-12 sm:px-6 md:grid-cols-3 lg:px-8"
        >
          <div>
            <h2 className="text-2xl font-bold">Sẵn sàng tham gia?</h2>
            <p className="mt-3 max-w-md leading-7 text-slate-600">
              Đăng ký tài khoản để theo dõi bài báo, đăng ký tham dự và nhận các
              thông báo trong hệ thống.
            </p>
            <Button className="mt-5" onClick={onSignUp}>
              Tạo tài khoản <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid gap-3">
            {[
              [
                "Nộp bài như thế nào?",
                "Mở hội thảo phù hợp, chọn Nộp bài và đăng nhập bằng tài khoản tác giả.",
              ],
              [
                "Làm sao đăng ký tham dự?",
                "Chọn Đăng ký tham dự tại trang chi tiết, đăng nhập rồi xác nhận đăng ký.",
              ],
              [
                "Có thể kiểm tra lịch trình không?",
                "Lịch trình được công khai tại trang hội thảo khi ban tổ chức bật quyền hiển thị.",
              ],
            ].map(([question, answer]) => (
              <article
                key={question}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <h3 className="font-semibold">{question}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {answer}
                </p>
              </article>
            ))}
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-semibold">Kiểm tra chứng nhận</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Xác minh chứng nhận bằng mã được cấp.
            </p>
            <input
              value={certificateNumber}
              onChange={(event) => setCertificateNumber(event.target.value)}
              onKeyDown={(event) =>
                event.key === "Enter" && verifyCertificate()
              }
              placeholder="Nhập mã chứng nhận"
              className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-teal-500 focus:outline-none"
            />
            <Button className="mt-3 w-full" onClick={verifyCertificate}>
              Kiểm tra
            </Button>
            {certificateMessage && (
              <p className="mt-3 text-sm text-slate-600">
                {certificateMessage}
              </p>
            )}
          </div>
        </section>
      </main>
      <footer className="border-t border-slate-200 bg-slate-900 text-slate-300">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-4 lg:px-8">
          <div>
            <p className="font-bold text-white">ConfManager</p>
            <p className="mt-2 text-sm leading-6">
              Nền tảng quản lý và khám phá hội thảo khoa học.
            </p>
          </div>
          <FooterGroup
            title="Giới thiệu"
            links={["Về ConfManager", "Liên hệ", "FAQ"]}
          />
          <FooterGroup
            title="Liên kết"
            links={[
              "Khám phá hội thảo",
              "Hướng dẫn nộp bài",
              "Kiểm tra chứng nhận",
            ]}
          />
          <FooterGroup
            title="Pháp lý"
            links={["Điều khoản sử dụng", "Chính sách bảo mật"]}
          />
        </div>
        <div className="mx-auto max-w-7xl border-t border-slate-700 px-4 py-4 text-xs text-slate-400 sm:px-6 lg:px-8">
          © 2026 ConfManager. Hệ thống quản lý hội thảo khoa học.
        </div>
      </footer>
      <Modal
        open={!!authPrompt}
        onClose={() => setAuthPrompt(null)}
        title="Cần đăng nhập để tiếp tục"
        size="sm"
      >
        <p className="text-sm leading-6 text-slate-600">
          Bạn cần đăng nhập hoặc đăng ký tài khoản để sử dụng chức năng này.
        </p>
        {authPrompt && (
          <p className="mt-3 rounded-lg bg-[#f4f8fc] px-3 py-2 text-sm font-medium text-slate-700">
            {authPrompt.action === "register"
              ? "Đăng ký tham dự"
              : "Nộp bài báo"}
            : {authPrompt.conference.title}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" onClick={() => continueToAuth("signup")}>
            Đăng ký
          </Button>
          <Button onClick={() => continueToAuth("signin")}>Đăng nhập</Button>
        </div>
      </Modal>
    </div>
  );
}

function ProcessSteps() {
  const steps = [
    {
      number: "01",
      label: "Tạo tài khoản",
      icon: <UserPlus className="h-5 w-5" />,
      tone: "border-sky-100 bg-sky-50 text-sky-700",
      iconTone: "border-sky-200 bg-white text-sky-700",
      lineTone: "bg-sky-500",
    },
    {
      number: "02",
      label: "Chọn hội thảo",
      icon: <Compass className="h-5 w-5" />,
      tone: "border-teal-100 bg-teal-50 text-teal-700",
      iconTone: "border-teal-200 bg-white text-teal-700",
      lineTone: "bg-teal-500",
    },
    {
      number: "03",
      label: "Đăng ký hoặc nộp bài",
      icon: <FileText className="h-5 w-5" />,
      tone: "border-violet-100 bg-violet-50 text-violet-700",
      iconTone: "border-violet-200 bg-white text-violet-700",
      lineTone: "bg-violet-500",
    },
    {
      number: "04",
      label: "Theo dõi phản biện",
      icon: <BookOpenCheck className="h-5 w-5" />,
      tone: "border-amber-100 bg-amber-50 text-amber-700",
      iconTone: "border-amber-200 bg-white text-amber-700",
      lineTone: "bg-amber-500",
    },
    {
      number: "05",
      label: "Tham dự",
      icon: <Users className="h-5 w-5" />,
      tone: "border-rose-100 bg-rose-50 text-rose-700",
      iconTone: "border-rose-200 bg-white text-rose-700",
      lineTone: "bg-rose-500",
    },
    {
      number: "06",
      label: "Nhận chứng nhận",
      icon: <Award className="h-5 w-5" />,
      tone: "border-emerald-100 bg-emerald-50 text-emerald-700",
      iconTone: "border-emerald-200 bg-white text-emerald-700",
      lineTone: "bg-emerald-500",
    },
  ];

  return (
    <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {steps.map((step, index) => (
        <li
          key={step.number}
          className={`group relative overflow-hidden border p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-md ${step.tone}`}
        >
          <span className="absolute right-3 top-3 text-xs font-bold opacity-40">
            {step.number}
          </span>
          <span
            className={`relative inline-flex h-11 w-11 items-center justify-center rounded-full border transition-transform duration-300 ease-out motion-reduce:transform-none group-hover:-translate-y-1 group-hover:rotate-6 group-hover:scale-110 ${step.iconTone}`}
          >
            <span
              className="absolute inset-0 rounded-full border border-current opacity-30 motion-safe:animate-pulse"
              style={{ animationDelay: `${index * 220}ms` }}
            />
            {step.icon}
          </span>
          <p className="mt-4 text-sm font-semibold text-slate-800">
            {step.label}
          </p>
          <span
            className={`mt-3 block h-0.5 w-8 transition-all duration-300 group-hover:w-full ${step.lineTone}`}
          />
        </li>
      ))}
    </ol>
  );
}

function ExploreBoard({
  registration,
  upcoming,
  ongoing,
  latest,
  onOpen,
}: {
  registration: Conference[];
  upcoming: Conference[];
  ongoing: Conference[];
  latest: Conference[];
  onOpen: (conference: Conference) => void;
}) {
  const columns = [
    {
      title: "Đang mở đăng ký",
      conferences: registration,
      tone: "bg-rose-50 text-rose-700",
    },
    {
      title: "Sắp diễn ra",
      conferences: upcoming,
      tone: "bg-sky-50 text-sky-700",
    },
    {
      title: "Đang diễn ra",
      conferences: ongoing,
      tone: "bg-amber-50 text-amber-700",
    },
    {
      title: "Mới công bố",
      conferences: latest,
      tone: "bg-violet-50 text-violet-700",
    },
  ];

  return (
    <div className="mx-auto mt-8 grid max-w-7xl gap-5 sm:grid-cols-2 xl:grid-cols-4">
      {columns.map((column, index) => (
        <ExploreColumn
          key={column.title}
          title={column.title}
          conferences={column.conferences}
          tone={column.tone}
          image={fallbackImages[index % fallbackImages.length]}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function ExploreColumn({
  title,
  conferences,
  tone,
  image,
  onOpen,
}: {
  title: string;
  conferences: Conference[];
  tone: string;
  image: string;
  onOpen: (conference: Conference) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (conferences.length < 2 || paused) return;
    const timer = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % conferences.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [conferences.length, paused]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const activeSlide = track.children.item(activeIndex) as HTMLElement | null;
    activeSlide?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "start",
    });
  }, [activeIndex]);

  function syncActiveCard() {
    const track = trackRef.current;
    if (!track || conferences.length < 2) return;
    const slides = Array.from(track.children) as HTMLElement[];
    const closestIndex = slides.reduce(
      (bestIndex, slide, index) =>
        Math.abs(slide.offsetLeft - track.scrollLeft) <
        Math.abs(slides[bestIndex].offsetLeft - track.scrollLeft)
          ? index
          : bestIndex,
      0,
    );
    setActiveIndex(closestIndex);
  }

  function moveSlide(direction: -1 | 1) {
    if (conferences.length < 2) return;
    setPaused(true);
    setActiveIndex(
      (index) => (index + direction + conferences.length) % conferences.length,
    );
  }

  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-1 text-xs font-medium ${tone}`}
          >
            {conferences.length} hội thảo
            {conferences.length > 1
              ? ` · ${activeIndex + 1}/${conferences.length}`
              : ""}
          </span>
          {conferences.length > 1 && (
            <div className="flex gap-1">
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
                title="Hội thảo trước"
                aria-label="Hội thảo trước"
                onClick={() => moveSlide(-1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
                title="Hội thảo tiếp theo"
                aria-label="Hội thảo tiếp theo"
                onClick={() => moveSlide(1)}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
      {conferences.length > 0 ? (
        <div
          ref={trackRef}
          onScroll={syncActiveCard}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onTouchStart={() => setPaused(true)}
          onTouchEnd={() => setPaused(false)}
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {conferences.map((conference) => (
            <div key={conference.id} className="w-[90%] shrink-0 snap-start">
              <ExploreConferenceCard
                conference={conference}
                image={image}
                onOpen={onOpen}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-64 items-center justify-center border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-500">
          Chưa có hội thảo trong nhóm này.
        </div>
      )}
    </div>
  );
}

function ExploreConferenceCard({
  conference,
  image,
  onOpen,
}: {
  conference: Conference;
  image: string;
  onOpen: (conference: Conference) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(conference)}
      className="group block w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-teal-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
    >
      <img
        src={conference.cover_image_url || image}
        alt=""
        onError={(event) => {
          event.currentTarget.onerror = null;
          event.currentTarget.src = image;
        }}
        className="h-36 w-full object-cover transition-transform duration-500 group-hover:scale-105"
      />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h4 className="line-clamp-2 font-semibold text-slate-900 group-hover:text-teal-700">
            {conference.title}
          </h4>
          <StatusBadge conference={conference} />
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          <CalendarDays className="h-3.5 w-3.5 text-teal-600" />{" "}
          {formatDateTime(conference.start_date)}
        </p>
        <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <MapPin className="h-3.5 w-3.5 text-teal-600" />{" "}
          {conference.location || "Trực tuyến"}
        </p>
        <p className="mt-4 text-sm font-medium text-teal-700">
          Xem chi tiết{" "}
          <ArrowRight className="inline h-4 w-4 transition-transform group-hover:translate-x-1" />
        </p>
      </div>
    </button>
  );
}

function HeroConference({
  conference,
  onOpen,
}: {
  conference?: Conference;
  onOpen: (conference: Conference) => void;
}) {
  if (!conference) {
    return (
      <div className="min-h-72 border-l-4 border-teal-600 bg-slate-100 p-6">
        <p className="text-sm text-slate-500">
          Hội thảo nổi bật sẽ được cập nhật sớm.
        </p>
      </div>
    );
  }

  const fallbackImage = fallbackImages[0];
  return (
    <button
      type="button"
      onClick={() => onOpen(conference)}
      className="group relative min-h-72 overflow-hidden rounded-[28px_8px_28px_8px] border border-white/30 text-left shadow-lg transition-[transform,border-radius,box-shadow] duration-500 hover:-translate-y-1 hover:rounded-[8px_28px_8px_28px] hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
    >
      <img
        src={conference.cover_image_url || fallbackImage}
        alt=""
        onError={(event) => {
          event.currentTarget.onerror = null;
          event.currentTarget.src = fallbackImage;
        }}
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
      />
      <div className="absolute inset-0 bg-slate-900/55 transition-colors duration-500 group-hover:bg-slate-900/45" />
      <div className="absolute inset-3 rounded-[20px_4px_20px_4px] border border-white/20 transition-[inset,border-radius] duration-500 group-hover:inset-4 group-hover:rounded-[4px_20px_4px_20px]" />
      <div className="relative flex min-h-72 flex-col justify-end p-6 text-white">
        <span className="flex w-fit items-center gap-1.5 rounded-full bg-teal-500 px-2.5 py-1 text-xs font-semibold">
          <span className="h-1.5 w-1.5 rounded-full bg-white motion-safe:animate-pulse" />
          {isRegistrationOpen(conference)
            ? "Đang mở đăng ký"
            : formatLabels[conference.event_format]}
        </span>
        <h2 className="mt-3 text-xl font-bold leading-snug">
          {conference.title}
        </h2>
        <p className="mt-2 flex items-center gap-2 text-sm text-slate-100">
          <CalendarDays className="h-4 w-4" />{" "}
          {formatDateTime(conference.start_date)}
        </p>
        <p className="mt-1 flex items-center gap-2 text-sm text-slate-100">
          <MapPin className="h-4 w-4" /> {conference.location || "Trực tuyến"}
        </p>
        <span className="mt-4 text-sm font-semibold text-teal-100">
          Xem chi tiết{" "}
          <ArrowRight className="inline h-4 w-4 transition-transform group-hover:translate-x-1" />
        </span>
      </div>
    </button>
  );
}

function ValueItem({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <article className="group border-l-2 border-teal-500 bg-white p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-md">
      <span className="inline-flex rounded-lg bg-teal-50 p-2.5 text-teal-700 transition-transform duration-300 ease-out motion-reduce:transform-none group-hover:-translate-y-1 group-hover:rotate-6 group-hover:scale-110">
        {icon}
      </span>
      <h3 className="mt-4 font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
    </article>
  );
}

function HeroAccent({
  label,
  tone,
  delay,
  children,
}: {
  label: string;
  tone: string;
  delay: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={label}
      aria-label={label}
      className={`group inline-flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition-transform duration-300 hover:-translate-y-1 hover:rotate-6 hover:shadow-md ${tone}`}
    >
      <span
        className="motion-safe:animate-pulse"
        style={{ animationDelay: delay }}
      >
        {children}
      </span>
    </span>
  );
}

function PublicConferenceDetail({
  conference,
  sessions,
  speakers,
  announcements,
  loading,
  onBack,
  onRegister,
  onSubmit,
  onShare,
  onCopy,
}: {
  conference: Conference;
  sessions: Session[];
  speakers: ConferenceSpeaker[];
  announcements: ConferenceAnnouncement[];
  loading: boolean;
  onBack: () => void;
  onRegister: () => void;
  onSubmit: () => void;
  onShare: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="min-h-screen bg-[#effaf7]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-sm font-medium text-slate-600"
          >
            <ArrowLeft className="h-4 w-4" /> Quay lại khám phá
          </button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCopy}>
              <Copy className="h-4 w-4" /> Copy link
            </Button>
            <Button variant="outline" onClick={onShare}>
              <Share2 className="h-4 w-4" /> Chia sẻ
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-lg bg-slate-900 px-6 py-10 text-white lg:px-10">
          {conference.cover_image_url && (
            <img
              src={conference.cover_image_url}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-25"
            />
          )}
          <div className="relative max-w-3xl">
            <p className="text-sm font-semibold text-teal-200">
              {formatLabels[conference.event_format] ?? "Hội thảo"}
            </p>
            <h1 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">
              {conference.title}
            </h1>
            <p className="mt-4 leading-7 text-slate-200">
              {conference.description}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                onClick={onRegister}
                disabled={!isRegistrationOpen(conference)}
              >
                <Users className="h-4 w-4" />{" "}
                {isRegistrationOpen(conference)
                  ? "Đăng ký tham dự"
                  : "Đã đóng đăng ký"}
              </Button>
              <Button
                variant="outline"
                className="border-white/40 bg-white/10 text-white hover:bg-white/20"
                onClick={onSubmit}
                disabled={!isSubmissionOpen(conference)}
              >
                <FileText className="h-4 w-4" />{" "}
                {isSubmissionOpen(conference) ? "Nộp bài" : "Đã đóng nhận bài"}
              </Button>
            </div>
          </div>
        </section>
        <div className="mt-8 grid gap-8 lg:grid-cols-[1.45fr_0.75fr]">
          <div className="space-y-8">
            <DetailSection title="Thông tin hội thảo">
              <div className="grid gap-4 sm:grid-cols-2">
                <Info
                  icon={<CalendarDays />}
                  label="Thời gian"
                  value={`${formatDate(conference.start_date)} - ${formatDate(conference.end_date)}`}
                />
                <Info
                  icon={<MapPin />}
                  label="Địa điểm"
                  value={conference.location || "Sẽ cập nhật"}
                />
                <Info
                  icon={<Video />}
                  label="Hình thức"
                  value={formatLabels[conference.event_format]}
                />
                <Info
                  icon={<Clock3 />}
                  label="Deadline"
                  value={deadlineLabel(conference)}
                />
              </div>
              {(conference.topics ?? []).length > 0 && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {conference.topics.map((item) => (
                    <span
                      key={item}
                      className="rounded-full bg-teal-50 px-3 py-1 text-sm font-medium text-teal-700"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              )}
            </DetailSection>
            <DetailSection title="Thông báo">
              <div className="space-y-3">
                {announcements.length ? (
                  announcements.map((item) => (
                    <article
                      key={item.id}
                      className="rounded-lg border border-slate-200 p-4"
                    >
                      <h3 className="font-semibold">{item.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {item.message}
                      </p>
                    </article>
                  ))
                ) : (
                  <Empty text="Chưa có thông báo công khai." />
                )}
              </div>
            </DetailSection>
            <DetailSection title="Lịch trình công khai">
              {loading ? (
                <p className="text-sm text-slate-500">Đang tải lịch trình...</p>
              ) : !conference.is_schedule_public ? (
                <Empty text="Ban tổ chức chưa công bố lịch trình." />
              ) : sessions.length ? (
                <div className="space-y-3">
                  {sessions.map((session) => (
                    <article
                      key={session.id}
                      className="flex gap-4 rounded-lg border border-slate-200 p-4"
                    >
                      <span className="text-sm font-semibold text-teal-700">
                        {new Date(session.start_time).toLocaleTimeString(
                          "vi-VN",
                          { hour: "2-digit", minute: "2-digit" },
                        )}
                      </span>
                      <div>
                        <h3 className="font-semibold">{session.title}</h3>
                        <p className="mt-1 text-sm text-slate-600">
                          {session.description}
                        </p>
                        <p className="mt-2 text-xs text-slate-400">
                          {session.room || "Phòng sẽ cập nhật"}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty text="Chưa có phiên nào được công bố." />
              )}
            </DetailSection>
            <DetailSection title="Diễn giả và keynote">
              {speakers.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {speakers.map((speaker) => (
                    <article
                      key={speaker.id}
                      className="flex gap-3 rounded-lg border border-slate-200 p-4"
                    >
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                        <Mic2 className="h-5 w-5" />
                      </span>
                      <div>
                        <p className="font-semibold">{speaker.full_name}</p>
                        <p className="text-sm text-teal-700">
                          {speaker.is_keynote
                            ? "Keynote speaker"
                            : speaker.title}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {speaker.organization}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty text="Danh sách diễn giả sẽ được cập nhật." />
              )}
            </DetailSection>
          </div>
          <aside className="space-y-5">
            <DetailSection title="Liên hệ ban tổ chức">
              <div className="space-y-3 text-sm text-slate-600">
                <p className="font-medium text-slate-900">
                  {conference.contact_name || "Ban tổ chức hội thảo"}
                </p>
                {conference.contact_email && (
                  <a
                    className="flex items-center gap-2 text-teal-700"
                    href={`mailto:${conference.contact_email}`}
                  >
                    <Mail className="h-4 w-4" /> {conference.contact_email}
                  </a>
                )}
                {conference.contact_phone && (
                  <a
                    className="flex items-center gap-2 text-teal-700"
                    href={`tel:${conference.contact_phone}`}
                  >
                    <Phone className="h-4 w-4" /> {conference.contact_phone}
                  </a>
                )}
              </div>
            </DetailSection>
            <DetailSection title="Mốc thời gian">
              <dl className="space-y-3 text-sm">
                {[
                  ["Hạn nộp bài", conference.submission_deadline],
                  ["Hạn phản biện", conference.review_deadline],
                  ["Hạn đăng ký", conference.registration_deadline],
                  ["Camera-ready", conference.camera_ready_deadline],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="text-right font-medium">
                      {value ? formatDateTime(value) : "Chưa cập nhật"}
                    </dd>
                  </div>
                ))}
              </dl>
            </DetailSection>
          </aside>
        </div>
      </main>
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-lg border border-slate-200 bg-white"
        >
          <div className="h-36 animate-pulse bg-slate-200" />
          <div className="space-y-3 p-5">
            <div className="h-5 w-4/5 animate-pulse rounded bg-slate-200" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-slate-100" />
            <div className="h-16 animate-pulse rounded bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  );
}
function StatusBadge({ conference }: { conference: Conference }) {
  const displayStatus = getConferenceDisplayStatus(conference);
  const label = isSubmissionOpen(conference)
    ? "Mở nộp bài"
    : isRegistrationOpen(conference)
      ? "Mở đăng ký"
      : displayStatus === "ongoing"
        ? "Đang diễn ra"
        : displayStatus === "completed"
          ? "Đã kết thúc"
          : "Đã đóng";
  const tone =
    isSubmissionOpen(conference) || isRegistrationOpen(conference)
      ? "bg-emerald-50 text-emerald-700"
      : displayStatus === "ongoing"
        ? "bg-amber-50 text-amber-700"
        : "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}
function QuickStat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <div className="group rounded-lg border border-slate-200 bg-white px-3 py-3 transition-all duration-300 hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-sm">
      <div className="flex items-center gap-2 text-teal-700">
        <span className="transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6">
          {icon}
        </span>
        <p className="text-xl font-bold">{value}</p>
      </div>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </div>
  );
}
function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
function Info({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3">
      <span className="text-teal-600">{icon}</span>
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className="mt-1 text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}
function FooterGroup({ title, links }: { title: string; links: string[] }) {
  return (
    <div>
      <p className="font-medium text-white">{title}</p>
      <div className="mt-3 grid gap-2 text-sm">
        {links.map((link) => (
          <a key={link} href="#top" className="hover:text-white">
            {link}
          </a>
        ))}
      </div>
    </div>
  );
}
function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}
function isRegistrationOpen(conference: Conference) {
  return isConferenceRegistrationOpen(conference);
}
function isSubmissionOpen(conference: Conference) {
  return (
    getConferenceDisplayStatus(conference) === "open" &&
    (!conference.submission_deadline ||
      new Date(conference.submission_deadline) >= new Date())
  );
}
function deadlineLabel(conference: Conference) {
  const deadline = isSubmissionOpen(conference)
    ? conference.submission_deadline
    : isRegistrationOpen(conference)
      ? conference.registration_deadline
      : null;
  if (!deadline) return `Diễn ra ${formatDate(conference.start_date)}`;
  const days = Math.ceil(
    (new Date(deadline).getTime() - Date.now()) / 86400000,
  );
  return days > 0
    ? `Còn ${days} ngày: ${isSubmissionOpen(conference) ? "nộp bài" : "đăng ký"}`
    : "Đã hết hạn";
}
function formatDate(value: string) {
  return new Date(value).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
function formatDateTime(value: string) {
  return new Date(value).toLocaleString("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
