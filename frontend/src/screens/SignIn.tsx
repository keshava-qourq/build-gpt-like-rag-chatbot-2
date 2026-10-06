/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/rules-of-hooks */
import React from "react";

import * as UI from "@/lib/ui";
import { Icons } from "@/lib/icons";
import { brand } from "@/lib/brand";
import { useNavigate } from "@/lib/navigate";

const { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Input, Label, Checkbox, Badge, Avatar, Separator } = UI;
const { Check, X, User, ArrowRight, AlertCircle, CheckCircle } = Icons;

const WORKSPACE = {
  name: "Northfield Research",
  members: 14,
  domain: "northfield.co",
};

const ACCOUNTS = [
  {
    email: "maya.ellison@northfield.co",
    password: "reading-room",
    name: "Maya Ellison",
    role: "Admin",
    lastSeen: "Signed in yesterday, 17:42",
  },
  {
    email: "tobias.renn@northfield.co",
    password: "reading-room",
    name: "Tobias Renn",
    role: "Member",
    lastSeen: "Signed in Friday, 09:15",
  },
];

const LIMITATIONS = [
  "Answers are drawn only from documents your team has uploaded, never from general knowledge.",
  "PDF, DOCX, TXT, CSV and Markdown are supported, up to 50MB per file.",
  "Scanned or image-only PDFs are not read in this release and are marked failed.",
  "The library is shared with the whole workspace. Your conversations stay private to you.",
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Screen() {
  const navigate = useNavigate();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [keepSignedIn, setKeepSignedIn] = React.useState(true);
  const [fieldErrors, setFieldErrors] = React.useState({ email: "", password: "" });
  const [formError, setFormError] = React.useState("");
  const [attempts, setAttempts] = React.useState(0);
  const [session, setSession] = React.useState(null);
  const [showSignedOutNotice, setShowSignedOutNotice] = React.useState(true);

  const emailRef = React.useRef(null);

  const focusRing =
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 rounded";

  function handleSubmit(event) {
    event.preventDefault();

    const nextFieldErrors = { email: "", password: "" };
    if (!email.trim()) {
      nextFieldErrors.email = "Enter your email address.";
    } else if (!EMAIL_PATTERN.test(email.trim())) {
      nextFieldErrors.email = "Enter a valid email address, for example name@" + WORKSPACE.domain + ".";
    }
    if (!password) {
      nextFieldErrors.password = "Enter your password.";
    }

    setFieldErrors(nextFieldErrors);

    if (nextFieldErrors.email || nextFieldErrors.password) {
      setFormError("");
      return;
    }

    const match = ACCOUNTS.find(
      (account) =>
        account.email.toLowerCase() === email.trim().toLowerCase() &&
        account.password === password
    );

    if (!match) {
      setAttempts((count) => count + 1);
      setFormError(
        "We could not sign you in. Check your email address and password, then try again."
      );
      setPassword("");
      if (emailRef.current) {
        emailRef.current.focus();
      }
      return;
    }

    setFormError("");
    setAttempts(0);
    setSession(match);
    setShowSignedOutNotice(false);
    navigate("chat");
  }

  function useAccount(account) {
    setEmail(account.email);
    setPassword(account.password);
    setFieldErrors({ email: "", password: "" });
    setFormError("");
  }

  if (session) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-16">
        <h1
          className="text-3xl font-semibold tracking-tight"
          style={{ fontFamily: brand.fontHeading, color: brand.primaryColor }}
        >
          Signed in
        </h1>
        <p
          className="mt-3 text-base leading-7"
          style={{ fontFamily: brand.fontBody, color: brand.neutralColor }}
        >
          Your session is active for the {WORKSPACE.name} workspace.
        </p>

        <UI.Card className="mt-8">
          <UI.CardContent>
            <div className="flex flex-wrap items-center gap-4 py-2">
              <UI.Avatar name={session.name} />
              <div className="min-w-0">
                <p className="font-medium" style={{ color: brand.primaryColor }}>
                  {session.name}
                </p>
                <p className="text-sm" style={{ color: brand.neutralColor }}>
                  {session.email}
                </p>
              </div>
              <UI.Badge className="ml-auto">{session.role}</UI.Badge>
            </div>

            <UI.Separator />

            <div className="flex flex-wrap gap-3 pt-5">
              <UI.Button
                onClick={() => navigate("chat")}
                style={{ backgroundColor: brand.primaryColor, color: "#FFFFFF" }}
              >
                Continue to chat
              </UI.Button>
              <UI.Button variant="outline" onClick={() => navigate("library")}>
                Document library
              </UI.Button>
              <UI.Button
                variant="ghost"
                onClick={() => {
                  setSession(null);
                  setPassword("");
                  setShowSignedOutNotice(true);
                }}
              >
                Sign out
              </UI.Button>
            </div>
          </UI.CardContent>
        </UI.Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12 lg:py-16">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-16">
        {/* Sign-in column */}
        <div className="max-w-md">
          <p
            className="text-xs font-semibold uppercase tracking-[0.14em]"
            style={{ color: brand.accentColor, fontFamily: brand.fontBody }}
          >
            Reading Room
          </p>
          <h1
            className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
            style={{ fontFamily: brand.fontHeading, color: brand.primaryColor }}
          >
            Sign in
          </h1>
          <p
            className="mt-3 text-base leading-7"
            style={{ fontFamily: brand.fontBody, color: brand.neutralColor }}
          >
            Reach the {WORKSPACE.name} library and your own conversations. Access is by
            invitation from a workspace admin.
          </p>

          {showSignedOutNotice && (
            <div
              className="mt-8 flex items-start gap-3 border px-4 py-3"
              style={{
                borderColor: "#DED6C6",
                backgroundColor: "#FFFFFF",
                borderRadius: brand.radius,
              }}
            >
              <Icons.CheckCircle
                className="mt-0.5 h-4 w-4 shrink-0"
                aria-hidden="true"
                style={{ color: brand.primaryColor }}
              />
              <p className="text-sm leading-6" style={{ color: brand.neutralColor }}>
                You have been signed out. Your session token was cleared on this device.
              </p>
              <button
                type="button"
                onClick={() => setShowSignedOutNotice(false)}
                aria-label="Dismiss signed out message"
                className={"ml-auto -mr-1 p-1 " + focusRing}
                style={{ color: brand.neutralColor, outlineColor: brand.primaryColor }}
              >
                <Icons.X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="mt-8">
            <div
              aria-live="assertive"
              role={formError ? "alert" : undefined}
              className={formError ? "mb-6" : ""}
            >
              {formError && (
                <div
                  className="flex items-start gap-3 border px-4 py-3"
                  style={{
                    borderColor: "#B4472F",
                    backgroundColor: "#FBEDE8",
                    borderRadius: brand.radius,
                  }}
                >
                  <Icons.AlertCircle
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden="true"
                    style={{ color: "#8E3420" }}
                  />
                  <div>
                    <p className="text-sm font-medium" style={{ color: "#8E3420" }}>
                      Sign-in refused
                    </p>
                    <p className="mt-1 text-sm leading-6" style={{ color: "#6E4034" }}>
                      {formError}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-6">
              <div>
                <UI.Label htmlFor="signin-email">Email address</UI.Label>
                <UI.Input
                  id="signin-email"
                  ref={emailRef}
                  name="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={fieldErrors.email ? "true" : undefined}
                  aria-describedby={fieldErrors.email ? "signin-email-error" : undefined}
                  className="mt-2"
                />
                {fieldErrors.email && (
                  <p
                    id="signin-email-error"
                    className="mt-2 flex items-center gap-1.5 text-sm"
                    style={{ color: "#8E3420" }}
                  >
                    <Icons.AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-4">
                  <UI.Label htmlFor="signin-password">Password</UI.Label>
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-pressed={showPassword}
                    className={"text-sm font-medium px-1 " + focusRing}
                    style={{ color: brand.accentColor, outlineColor: brand.primaryColor }}
                  >
                    {showPassword ? "Hide password" : "Show password"}
                  </button>
                </div>
                <UI.Input
                  id="signin-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={fieldErrors.password ? "true" : undefined}
                  aria-describedby={
                    fieldErrors.password ? "signin-password-error" : undefined
                  }
                  className="mt-2"
                />
                {fieldErrors.password && (
                  <p
                    id="signin-password-error"
                    className="mt-2 flex items-center gap-1.5 text-sm"
                    style={{ color: "#8E3420" }}
                  >
                    <Icons.AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    {fieldErrors.password}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3">
                <UI.Checkbox
                  id="signin-keep"
                  checked={keepSignedIn}
                  onChange={(e) =>
                    setKeepSignedIn(
                      e && e.target ? e.target.checked : !keepSignedIn
                    )
                  }
                  onCheckedChange={(value) => setKeepSignedIn(Boolean(value))}
                />
                <UI.Label htmlFor="signin-keep" className="font-normal">
                  Keep me signed in on this device
                </UI.Label>
              </div>

              <UI.Button
                type="submit"
                className="w-full"
                style={{ backgroundColor: brand.primaryColor, color: "#FFFFFF" }}
              >
                Sign in
              </UI.Button>
            </div>
          </form>

          {attempts >= 2 && (
            <p
              className="mt-6 text-sm leading-6"
              style={{ color: brand.neutralColor }}
            >
              Passwords are set from an invitation link. If yours has expired, ask a
              workspace admin to send a new one.{" "}
              <button
                type="button"
                onClick={() => navigate("accept-invitation")}
                className={"font-medium underline underline-offset-2 " + focusRing}
                style={{ color: brand.accentColor, outlineColor: brand.primaryColor }}
              >
                Open an invitation link
              </button>
            </p>
          )}

          <div
            className="mt-10 border-t pt-6"
            style={{ borderColor: "#E3DCCD" }}
          >
            <h2
              className="text-sm font-semibold"
              style={{ fontFamily: brand.fontHeading, color: brand.primaryColor }}
            >
              Prototype accounts
            </h2>
            <p className="mt-1 text-sm" style={{ color: brand.neutralColor }}>
              Both use the password <span className="font-medium">reading-room</span>.
            </p>
            <ul className="mt-4 space-y-2">
              {ACCOUNTS.map((account) => (
                <li key={account.email}>
                  <button
                    type="button"
                    onClick={() => useAccount(account)}
                    className={
                      "flex w-full items-center gap-3 border px-4 py-3 text-left transition-colors hover:bg-white " +
                      focusRing
                    }
                    style={{
                      borderColor: "#E3DCCD",
                      borderRadius: brand.radius,
                      outlineColor: brand.primaryColor,
                    }}
                  >
                    <Icons.User
                      className="h-4 w-4 shrink-0"
                      aria-hidden="true"
                      style={{ color: brand.neutralColor }}
                    />
                    <span className="min-w-0">
                      <span
                        className="block truncate text-sm font-medium"
                        style={{ color: brand.primaryColor }}
                      >
                        {account.name}
                        <span className="sr-only">
                          {", " + account.role + ", fill sign-in form"}
                        </span>
                      </span>
                      <span
                        className="block truncate text-sm"
                        style={{ color: brand.neutralColor }}
                      >
                        {account.email}
                      </span>
                    </span>
                    <span
                      className="ml-auto shrink-0 text-xs font-medium uppercase tracking-wide"
                      style={{ color: brand.accentColor }}
                      aria-hidden="true"
                    >
                      {account.role}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Context column */}
        <aside className="lg:pt-16">
          <UI.Card>
            <UI.CardHeader>
              <UI.CardTitle>
                <span style={{ fontFamily: brand.fontHeading }}>{WORKSPACE.name}</span>
              </UI.CardTitle>
              <UI.CardDescription>
                A single shared workspace. {WORKSPACE.members} members, invitation only.
              </UI.CardDescription>
            </UI.CardHeader>
            <UI.CardContent>
              <h3
                className="text-sm font-semibold"
                style={{ fontFamily: brand.fontHeading, color: brand.primaryColor }}
              >
                What to expect
              </h3>
              <ul className="mt-3 space-y-3">
                {LIMITATIONS.map((item) => (
                  <li key={item} className="flex gap-2.5">
                    <Icons.Check
                      className="mt-1 h-3.5 w-3.5 shrink-0"
                      aria-hidden="true"
                      style={{ color: brand.accentColor }}
                    />
                    <span
                      className="text-sm leading-6"
                      style={{ color: brand.neutralColor }}
                    >
                      {item}
                    </span>
                  </li>
                ))}
              </ul>
            </UI.CardContent>
            <UI.CardFooter>
              <UI.Button variant="outline" onClick={() => navigate("help")}>
                Read the full limitations
              </UI.Button>
            </UI.CardFooter>
          </UI.Card>

          <div className="mt-6">
            <h2
              className="text-sm font-semibold"
              style={{ fontFamily: brand.fontHeading, color: brand.primaryColor }}
            >
              Been invited?
            </h2>
            <p className="mt-2 text-sm leading-6" style={{ color: brand.neutralColor }}>
              There is no self-signup. Open the single-use link from your invitation email
              to set a password, then sign in here.
            </p>
            <button
              type="button"
              onClick={() => navigate("accept-invitation")}
              className={"mt-3 inline-flex items-center gap-1.5 text-sm font-medium " + focusRing}
              style={{ color: brand.accentColor, outlineColor: brand.primaryColor }}
            >
              Set a password from an invitation
              <Icons.ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
