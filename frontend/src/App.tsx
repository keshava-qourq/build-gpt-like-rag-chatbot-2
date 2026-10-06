import * as React from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";

import SignIn from "@/screens/SignIn";
import AcceptInvitation from "@/screens/AcceptInvitation";
import Chat from "@/screens/Chat";
import Library from "@/screens/Library";
import Members from "@/screens/Members";
import Help from "@/screens/Help";
import { Icons } from "@/lib/icons";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    "block rounded-[var(--brand-radius)] px-3 py-2 text-sm font-medium transition-colors",
    isActive ? "bg-[var(--brand-hover)] text-[var(--brand-fg)]" : "text-[var(--brand-fg-muted)]",
  ].join(" ");

const RING =
  "focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--brand-primary)]";

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <p
        className="mb-4 px-3 text-sm font-semibold"
        style={{ fontFamily: "var(--brand-font-heading)" }}
      >
        {"# Build GPT-Like RAG Chatbot (2)"}
      </p>
      <nav className="flex flex-col gap-1">
        <NavLink to="/sign-in" className={navLinkClass} onClick={onNavigate}>
          {"Sign in"}
        </NavLink>
        <NavLink to="/accept-invitation" className={navLinkClass} onClick={onNavigate}>
          {"Accept invitation"}
        </NavLink>
        <NavLink to="/chat" className={navLinkClass} onClick={onNavigate}>
          {"Chat"}
        </NavLink>
        <NavLink to="/library" className={navLinkClass} onClick={onNavigate}>
          {"Document library"}
        </NavLink>
        <NavLink to="/members" className={navLinkClass} onClick={onNavigate}>
          {"Members"}
        </NavLink>
        <NavLink to="/help" className={navLinkClass} onClick={onNavigate}>
          {"Help and limitations"}
        </NavLink>
      </nav>
    </>
  );
}

export default function App() {
  const [navOpen, setNavOpen] = React.useState(false);
  const menuButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const drawerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (navOpen && drawerRef.current) drawerRef.current.focus();
  }, [navOpen]);

  const closeNav = () => {
    setNavOpen(false);
    if (menuButtonRef.current) menuButtonRef.current.focus();
  };

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Narrow-width top bar with a toggle; the nav itself lives in an
          overlay drawer so it never sits side by side with the thread and
          shrinks the usable width below lg. */}
      <div
        className="flex items-center justify-between border-b p-3 lg:hidden"
        style={{
          backgroundColor: "var(--brand-surface)",
          borderColor: "var(--brand-border)",
        }}
      >
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          aria-label="Open navigation"
          ref={menuButtonRef}
          className={"rounded p-1.5 " + RING}
        >
          <Icons.Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <span className="text-sm font-semibold" style={{ fontFamily: "var(--brand-font-heading)" }}>
          {"Build GPT-Like RAG Chatbot"}
        </span>
        <span className="w-8" aria-hidden="true" />
      </div>

      {navOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={closeNav}
            className="absolute inset-0 bg-black/30"
          />
          <div
            ref={drawerRef}
            tabIndex={-1}
            role="dialog"
            aria-label="Navigation"
            onKeyDown={(e) => {
              if (e.key === "Escape") closeNav();
            }}
            className="absolute inset-y-0 left-0 w-64 overflow-auto border-r p-4 shadow-xl outline-none"
            style={{
              backgroundColor: "var(--brand-surface)",
              borderColor: "var(--brand-border)",
            }}
          >
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={closeNav}
                aria-label="Close navigation"
                className={"rounded p-1.5 " + RING}
              >
                <Icons.X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <NavContent onNavigate={closeNav} />
          </div>
        </div>
      ) : null}

      <aside
        className="hidden w-56 shrink-0 border-r p-4 lg:block"
        style={{
          backgroundColor: "var(--brand-surface)",
          borderColor: "var(--brand-border)",
        }}
      >
        <NavContent />
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">
        <Routes>
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/accept-invitation" element={<AcceptInvitation />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/library" element={<Library />} />
          <Route path="/members" element={<Members />} />
          <Route path="/help" element={<Help />} />
          <Route path="*" element={<Navigate to="/sign-in" replace />} />
        </Routes>
      </main>
    </div>
  );
}
