import { useCallback, useState, type ReactNode } from "react";
import { RouterContext, type PageKey, type RouteState } from "@/context/RouterContextCore";

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<RouteState>({
    page: "dashboard",
    params: {},
  });

  const navigate = useCallback((page: PageKey, params: Record<string, string> = {}) => {
    setRoute({ page, params });
    window.scrollTo(0, 0);
  }, []);

  return (
    <RouterContext.Provider value={{ route, navigate }}>
      {children}
    </RouterContext.Provider>
  );
}
