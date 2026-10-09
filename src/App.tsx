import { AuthProvider } from "@/context/AuthContext";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/useAuth";
import { RouterProvider } from "@/context/RouterContext";
import { useRouter } from "@/context/useRouter";
import { Layout } from "@/components/Layout";
import { Modal } from "@/components/ui/Modal";
import { RoleDashboard } from "@/components/RoleDashboard";
import { ReviewerDashboard } from "@/components/ReviewerDashboard";
import { AuthPage } from "@/pages/AuthPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ConferencesPage } from "@/pages/ConferencesPage";
import { ConferenceDetailPage } from "@/pages/ConferenceDetailPage";
import { ConferenceFormPage } from "@/pages/ConferenceFormPage";
import { PapersPage } from "@/pages/PapersPage";
import { PaperDetailPage } from "@/pages/PaperDetailPage";
import { PaperFormPage } from "@/pages/PaperFormPage";
import { ReviewsPage } from "@/pages/ReviewsPage";
import { SessionsPage } from "@/pages/SessionsPage";
import { ParticipantsPage } from "@/pages/ParticipantsPage";
import { CertificatesPage } from "@/pages/CertificatesPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { UsersPage } from "@/pages/UsersPage";
import { MessagesPage } from "@/pages/MessagesPage";

function AppContent() {
  const { session, profile, loading, authEvent } = useAuth();
  const { route, navigate, formRoute, closeForm } = useRouter();
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [pageVersion, setPageVersion] = useState(0);
  const dismissForm = () => { if (!formSubmitting) closeForm(); };
  const handleFormSaved = () => {
    closeForm();
    setFormSubmitting(false);
    setPageVersion((value) => value + 1);
  };
  const [passwordRecovery, setPasswordRecovery] = useState(() =>
    window.location.hash.includes("type=recovery"),
  );

  useEffect(() => {
    if (authEvent === "PASSWORD_RECOVERY") setPasswordRecovery(true);
  }, [authEvent]);

  useEffect(() => {
    if (!session) return;
    const returnTarget = sessionStorage.getItem(
      "confmanager:return-after-auth",
    );
    if (!returnTarget) return;
    sessionStorage.removeItem("confmanager:return-after-auth");
    try {
      const target = JSON.parse(returnTarget) as {
        conferenceId?: string;
        action?: "register" | "submit";
      };
      if (target.conferenceId) {
        sessionStorage.setItem(
          "confmanager:pending-intent",
          JSON.stringify(target),
        );
        navigate("conference-detail", { id: target.conferenceId });
      }
    } catch {
      // Ignore malformed browser storage left by an older session.
    }
  }, [navigate, session]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#effaf7]">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
      </div>
    );
  }

  if (!session) {
    return <AuthPage />;
  }

  if (passwordRecovery) {
    return (
      <ResetPasswordPage
        onComplete={() => {
          setPasswordRecovery(false);
          navigate("dashboard");
        }}
      />
    );
  }

  const pageMap: Record<string, React.ReactNode> = {
    dashboard:
      profile?.role === "admin" ? (
        <DashboardPage />
      ) : profile?.role === "reviewer" ? (
        <ReviewerDashboard />
      ) : (
        <RoleDashboard />
      ),
    conferences: <ConferencesPage />,
    "conference-detail": <ConferenceDetailPage />,
    "conference-form": <ConferenceFormPage />,
    papers: <PapersPage />,
    "paper-detail": <PaperDetailPage />,
    "paper-form": <PaperFormPage />,
    reviews: <ReviewsPage />,
    sessions: <SessionsPage />,
    participants: <ParticipantsPage />,
    certificates: <CertificatesPage />,
    messages: <MessagesPage />,
    users: <UsersPage />,
    profile: <ProfilePage />,
  };

  return <Layout>
    <div key={pageVersion}>{pageMap[route.page] ?? pageMap.dashboard}</div>
    <Modal
      open={formRoute !== null}
      onClose={dismissForm}
      title={formRoute?.page === "conference-form"
        ? (formRoute.params.id ? "Chỉnh sửa hội thảo" : "Tạo hội thảo mới")
        : (formRoute?.params.id ? "Chỉnh sửa bài báo" : "Nộp bài báo mới")}
      size="lg"
    >
      {formRoute?.page === "conference-form" && <ConferenceFormPage
        embedded
        editId={formRoute.params.id}
        onCancel={dismissForm}
        onSaved={handleFormSaved}
        onSubmittingChange={setFormSubmitting}
      />}
      {formRoute?.page === "paper-form" && <PaperFormPage
        embedded
        editId={formRoute.params.id}
        initialConferenceId={formRoute.params.conferenceId}
        onCancel={dismissForm}
        onSaved={handleFormSaved}
        onSubmittingChange={setFormSubmitting}
      />}
    </Modal>
  </Layout>;
}

function App() {
  return (
    <AuthProvider>
      <RouterProvider>
        <AppContent />
      </RouterProvider>
    </AuthProvider>
  );
}

export default App;
