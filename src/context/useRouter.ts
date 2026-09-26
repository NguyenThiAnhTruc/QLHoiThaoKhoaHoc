import { useContext } from "react";
import { RouterContext } from "@/context/RouterContextCore";

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter must be used within RouterProvider");
  return ctx;
}
