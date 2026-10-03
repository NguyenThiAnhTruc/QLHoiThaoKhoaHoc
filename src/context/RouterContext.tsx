import { useCallback, useState, type ReactNode } from "react";
import { RouterContext, type PageKey, type RouteState } from "@/context/RouterContextCore";

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<RouteState>({
    page: "dashboard",
    params: {},
  });

  const navigate = useCallback((page: PageKey, params: Record<string, string> = {}) => {
    if (page === "conference-form" || page === "paper-form") {
      setFormRoute({ page, params });
      return;
    }
    setFormRoute(null);
    setRoute({ page, params });
    window.scrollTo(0, 0);
  }, []);

  const [formRoute, setFormRoute] = useState<RouteState | null>(null);
  const closeForm = useCallback(() => setFormRoute(null), []);

  return (
    <RouterContext.Provider value={{ route, navigate, formRoute, closeForm }}>
      {children}
    </RouterContext.Provider>
  );
}
