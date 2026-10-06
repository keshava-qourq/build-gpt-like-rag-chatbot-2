/**
 * Thin wrapper around react-router-dom's `useNavigate`.
 *
 * Generated screens call `navigate("chat")`, `navigate("library")` and so on --
 * route names without a leading slash -- while `App.tsx` registers routes as
 * `/chat`, `/library`, etc. This hook normalises the bare name to an absolute
 * path so every screen's `navigate(...)` calls land on the route the router
 * actually has, without each screen re-implementing the same string check.
 */
import { useNavigate as useRouterNavigate, type NavigateOptions } from "react-router-dom";

export function useNavigate() {
  const routerNavigate = useRouterNavigate();

  return (to: string, options?: NavigateOptions) => {
    const path = to.startsWith("/") ? to : `/${to}`;
    routerNavigate(path, options);
  };
}
