import { useState, type ReactNode } from "react";
import {
  Award,
  CalendarClock as ScheduleIcon,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  User,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/context/useAuth";
import { useConferenceAccess } from "@/context/useConferenceAccess";
import { useRouter } from "@/context/useRouter";
import { NotificationBell } from "@/components/NotificationBell";
import type { PageKey } from "@/context/RouterContextCore";
import { ROLE_LABELS } from "@/lib/constants";
import type { UserRole } from "@/types";
import logo from "@/public/logo.jpg";

interface NavItem {
  key: PageKey;
  label: string;
  icon: ReactNode;
  roles?: UserRole[];
}

const overviewItem: NavItem = {
  key: "dashboard",
  label: "Tổng quan",
  icon: <LayoutDashboard className="h-5 w-5" />,
};
const managementItems: NavItem[] = [
  {
    key: "conferences",
    label: "Hội thảo",
    icon: <CalendarDays className="h-5 w-5" />,
  },
  {
    key: "papers",
    label: "Bài báo khoa học",
    icon: <FileText className="h-5 w-5" />,
  },
  {
    key: "reviews",
    label: "Phản biện",
    icon: <ClipboardCheck className="h-5 w-5" />,
    roles: ["admin", "organizer", "author", "reviewer"],
  },
  {
    key: "sessions",
    label: "Lịch trình",
    icon: <ScheduleIcon className="h-5 w-5" />,
  },
  {
    key: "participants",
    label: "Người tham dự",
    icon: <Users className="h-5 w-5" />,
    roles: ["admin", "organizer"],
  },
  {
    key: "certificates",
    label: "Chứng nhận",
    icon: <Award className="h-5 w-5" />,
  },
];
const systemItems: NavItem[] = [
  {
    key: "users",
    label: "Tài khoản",
    icon: <Users className="h-5 w-5" />,
    roles: ["admin"],
  },
  {
    key: "audit-logs",
    label: "Audit log",
    icon: <ClipboardList className="h-5 w-5" />,
    roles: ["admin"],
  },
];
const messageItem: NavItem = {
  key: "messages",
  label: "Tin nhắn",
  icon: <MessageCircle className="h-5 w-5" />,
};
const profileItem: NavItem = {
  key: "profile",
  label: "Hồ sơ & cài đặt",
  icon: <User className="h-5 w-5" />,
};

export function Layout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const { conferences } = useConferenceAccess();
  const { route, navigate } = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const canSee = (item: NavItem) =>
    !item.roles ||
    (profile && item.roles.includes(profile.role)) ||
    (item.key === "participants" && conferences.length > 0);
  const personal =
    conferences.length === 0 &&
    (profile?.role === "author" || profile?.role === "participant");
  const visibleManagementItems = managementItems.filter(canSee).map((item) => ({
    ...item,
    label:
      personal && item.key === "certificates"
        ? "Chứng nhận của tôi"
        : (profile?.role === "author" || profile?.role === "reviewer") && item.key === "reviews"
          ? "Phản biện được giao"
          : item.label,
  }));
  const visibleSystemItems = systemItems.filter(canSee);

  function isActive(key: PageKey) {
    if (
      key === "conferences" &&
      ["conference-detail", "conference-form"].includes(route.page)
    )
      return true;
    if (key === "papers" && ["paper-detail", "paper-form"].includes(route.page))
      return true;
    if (key === "reviews" && route.page === "review-detail") return true;
    if (key === "sessions" && route.page === "session-form") return true;
    return route.page === key;
  }

  function handleNavigate(key: PageKey) {
    navigate(key);
    setSidebarOpen(false);
  }

  return (
    <div className="min-h-screen bg-[#effaf7]">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col transform bg-slate-900 transition-transform duration-200 lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-16 items-center gap-2.5 border-b border-slate-800 px-6">
          <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-white">
            <img
              src={logo}
              alt="Logo Quản lý Hội thảo Khoa học"
              className="h-full w-full object-contain"
            />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white">ConfManager</h1>
            <p className="text-xs text-slate-400">Quản lý hội thảo</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => handleNavigate("profile")}
          className="mx-3 mt-4 flex items-center gap-3 rounded-lg bg-slate-800/70 px-3 py-3 text-left transition-colors hover:bg-slate-800"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-700 text-sm font-semibold text-white">
            {profile?.full_name?.charAt(0).toUpperCase() ?? "?"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">
              {profile?.full_name || "Người dùng"}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              {profile ? ROLE_LABELS[profile.role] : ""}
            </p>
          </div>
        </button>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {profile?.role !== "participant" && (
            <SidebarItem
              item={overviewItem}
              active={isActive(overviewItem.key)}
              onNavigate={handleNavigate}
            />
          )}
          <p className="mb-2 mt-5 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {profile?.role === "participant"
              ? "Khám phá"
              : profile?.role === "author"
                ? "Nghiên cứu & tham gia"
                : "Quản lý"}
          </p>
          <div className="space-y-1">
            {visibleManagementItems.map((item) => (
              <SidebarItem
                key={item.key}
                item={item}
                active={isActive(item.key)}
                onNavigate={handleNavigate}
              />
            ))}
          </div>
          <div className="mt-5">
            <SidebarItem
              item={messageItem}
              active={isActive(messageItem.key)}
              onNavigate={handleNavigate}
            />
          </div>
          {visibleSystemItems.length > 0 && (
            <>
              <p className="mb-2 mt-5 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Quản trị hệ thống
              </p>
              <div className="space-y-1">
                {visibleSystemItems.map((item) => (
                  <SidebarItem
                    key={item.key}
                    item={item}
                    active={isActive(item.key)}
                    onNavigate={handleNavigate}
                  />
                ))}
              </div>
            </>
          )}
        </nav>

        <div className="border-t border-slate-800 p-3">
          <SidebarItem
            item={profileItem}
            active={isActive(profileItem.key)}
            onNavigate={handleNavigate}
          />
          <button
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <LogOut className="h-5 w-5" />
            Đăng xuất
          </button>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 hidden h-16 items-center justify-end border-b border-slate-200 bg-white/95 px-8 backdrop-blur lg:flex">
          <NotificationBell />
        </header>
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden">
          <button onClick={() => setSidebarOpen(true)} aria-label="Mở menu">
            <Menu className="h-6 w-6 text-slate-600" />
          </button>
          <div className="flex items-center gap-2">
            <img
              src={logo}
              alt="Logo Quản lý Hội thảo Khoa học"
              className="h-8 w-8 rounded-md object-contain"
            />
            <span className="font-bold text-slate-900">ConfManager</span>
          </div>
          <NotificationBell />
        </header>
        <main className="min-h-[calc(100vh-4rem)] p-4 lg:p-8">{children}</main>
      </div>

      {sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(false)}
          aria-label="Đóng menu"
          className="fixed right-4 top-4 z-50 rounded-lg bg-white p-2 shadow-lg lg:hidden"
        >
          <X className="h-5 w-5 text-slate-600" />
        </button>
      )}
    </div>
  );
}

function SidebarItem({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate: (key: PageKey) => void;
}) {
  return (
    <button
      onClick={() => onNavigate(item.key)}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${active ? "bg-teal-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"}`}
    >
      {item.icon}
      {item.label}
    </button>
  );
}
