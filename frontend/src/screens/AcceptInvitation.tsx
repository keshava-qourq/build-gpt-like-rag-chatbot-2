/* eslint-disable @typescript-eslint/no-unused-vars */
import React from "react";

import * as UI from "@/lib/ui";
import { Icons } from "@/lib/icons";
import { brand } from "@/lib/brand";
import { useNavigate } from "@/lib/navigate";

const { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Label, Separator } = UI;
const { Check, X, ChevronRight, ChevronDown, User, FileText, Clock, Upload, ArrowLeft, ArrowRight, AlertCircle, CheckCircle } = Icons;

const INVITATION = {
  workspace: "Thornbury Research",
  email: "daniel.whitfield@thornbury.io",
  role: "member",
  invitedBy: "Marian Osei",
  invitedByRole: "admin",
  sentAt: "3 October 2026",
  expiresAt: "9 October 2026",
  expiresInDays: 3,
};

const ROLE_ABILITIES = {
  member: [
    { can: true, text: "Upload PDF, DOCX, TXT, CSV and Markdown files to the shared library" },
    { can: true, text: "Ask questions and read answers with citations from every ready document" },
    { can: true, text: "Delete documents you uploaded yourself" },
    { can: false, text: "Invite or remove people, or delete a colleague's document" },
  ],
  admin: [
    { can: true, text: "Everything a member can do, across the whole shared library" },
    { can: true, text: "Invite colleagues and remove them from the workspace" },
    { can: true, text: "Delete any document, whoever uploaded it" },
    { can: false, text: "Read another member's conversations — chats stay private to each person" },
  ],
};

const NEXT_STEPS = [
  "Your chats are private to you. Nobody else in the workspace can read them.",
  "Documents are shared. Anything you upload becomes searchable for the whole team.",
  "Answers come only from uploaded documents, never from the model's general knowledge.",
];

const PASSWORD_RULES = [
  { id: "length", label: "At least 12 characters", test: (v) => v.length >= 12 },
  { id: "case", label: "An uppercase and a lowercase letter", test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
  { id: "number", label: "At least one number", test: (v) => /[0-9]/.test(v) },
];

export default function Screen() {
  const navigate = useNavigate();
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [agreed, setAgreed] = React.useState(false);
  const [errors, setErrors] = React.useState(null);
  const [accepted, setAccepted] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);

  const passwordRef = React.useRef(null);
  const confirmRef = React.useRef(null);
  const agreeRef = React.useRef(null);
  const doneRef = React.useRef(null);

  const ruleState = PASSWORD_RULES.map((r) => ({ ...r, met: r.test(password) }));
  const metCount = ruleState.filter((r) => r.met).length;

  const fieldBase =
    "w-full rounded-md border bg-white px-3 py-2 text-[15px] text-[#2A2621] placeholder-[#9B9387] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

  function validate() {
    const next = {};
    if (!password) next.password = "Enter a password to finish setting up your account.";
    else if (metCount < PASSWORD_RULES.length) next.password = "Your password does not yet meet all three requirements.";
    if (!confirm) next.confirm = "Re-enter your password to confirm it.";
    else if (confirm !== password) next.confirm = "The two passwords do not match.";
    if (!agreed) next.agree = "Confirm you understand that uploads are shared with the workspace.";
    return next;
  }

  function handleSubmit(event) {
    event.preventDefault();
    const next = validate();
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    setErrors(null);
    setAccepted(true);
  }

  React.useEffect(() => {
    if (accepted && doneRef.current) doneRef.current.focus();
  }, [accepted]);

  const errorList = errors
    ? [
        errors.password ? { field: "password", ref: passwordRef, message: errors.password } : null,
        errors.confirm ? { field: "confirm", ref: confirmRef, message: errors.confirm } : null,
        errors.agree ? { field: "agree", ref: agreeRef, message: errors.agree } : null,
      ].filter(Boolean)
    : [];

  return (
    <div
      className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14"
      style={{ fontFamily: brand.fontBody, color: "#2A2621" }}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: brand.neutralColor }}>
        Invitation to {INVITATION.workspace}
      </p>
      <h1
        className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl"
        style={{ fontFamily: brand.fontHeading, color: "#1F1C18" }}
      >
        {accepted ? "You're in" : "Set your password"}
      </h1>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed" style={{ color: brand.neutralColor }}>
        {accepted
          ? "Your account has been created and you are signed in to the shared workspace."
          : `This single-use link was sent to ${INVITATION.email}. Choose a password to create your account and join the shared document library.`}
      </p>

      <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-5">
        <div className="lg:col-span-3">
          {accepted ? (
            <UI.Card>
              <UI.CardHeader>
                <div className="flex items-start gap-3">
                  <Icons.CheckCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" style={{ color: brand.primaryColor }} />
                  <div>
                    <UI.CardTitle>
                      <h2 className="text-lg font-semibold" style={{ fontFamily: brand.fontHeading }}>
                        Account created
                      </h2>
                    </UI.CardTitle>
                    <UI.CardDescription>
                      <span className="text-[15px]" style={{ color: brand.neutralColor }}>
                        Signed in as {INVITATION.email} with the {INVITATION.role} role. This invitation link has now been
                        used and cannot be opened again.
                      </span>
                    </UI.CardDescription>
                  </div>
                </div>
              </UI.CardHeader>
              <UI.CardContent>
                <h3 className="text-sm font-semibold uppercase tracking-[0.1em]" style={{ color: brand.neutralColor }}>
                  Worth knowing before you start
                </h3>
                <ul className="mt-4 space-y-3">
                  {NEXT_STEPS.map((step) => (
                    <li key={step} className="flex items-start gap-3 text-[15px] leading-relaxed">
                      <Icons.Check className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" style={{ color: brand.primaryColor }} />
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              </UI.CardContent>
              <UI.CardFooter>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <UI.Button
                    ref={doneRef}
                    onClick={() => navigate("chat")}
                    className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={{ backgroundColor: brand.primaryColor, outlineColor: brand.primaryColor }}
                  >
                    Start your first chat
                    <Icons.ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </UI.Button>
                  <UI.Button
                    onClick={() => navigate("library")}
                    className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={{ borderColor: "#DCD5C6", color: brand.primaryColor, backgroundColor: "transparent", outlineColor: brand.primaryColor }}
                  >
                    <Icons.FileText className="h-4 w-4" aria-hidden="true" />
                    Open the document library
                  </UI.Button>
                </div>
              </UI.CardFooter>
            </UI.Card>
          ) : (
            <UI.Card>
              <UI.CardContent>
                <form onSubmit={handleSubmit} noValidate>
                  <h2 className="text-lg font-semibold" style={{ fontFamily: brand.fontHeading }}>
                    Create your password
                  </h2>
                  <p className="mt-1 text-sm" style={{ color: brand.neutralColor }}>
                    Your password is stored only as a hash. Nobody, including admins, can read it back.
                  </p>

                  {errorList.length > 0 && (
                    <div
                      role="alert"
                      className="mt-6 rounded-md border p-4"
                      style={{ borderColor: "#C0472B", backgroundColor: "#FBEDE9" }}
                    >
                      <div className="flex items-start gap-2">
                        <Icons.AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" style={{ color: "#A13A21" }} />
                        <div>
                          <h3 className="text-sm font-semibold" style={{ color: "#8E3319" }}>
                            {errorList.length === 1
                              ? "There is 1 problem with this form"
                              : `There are ${errorList.length} problems with this form`}
                          </h3>
                          <ul className="mt-2 space-y-1">
                            {errorList.map((e) => (
                              <li key={e.field}>
                                <button
                                  type="button"
                                  onClick={() => e.ref.current && e.ref.current.focus()}
                                  className="rounded text-left text-sm underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                                  style={{ color: "#8E3319", outlineColor: "#8E3319" }}
                                >
                                  {e.message}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-6">
                    <UI.Label htmlFor="invite-email">
                      <span className="text-sm font-medium">Email address</span>
                    </UI.Label>
                    <input
                      id="invite-email"
                      type="email"
                      value={INVITATION.email}
                      readOnly
                      aria-describedby="invite-email-hint"
                      className={`${fieldBase} mt-2 cursor-not-allowed`}
                      style={{ borderColor: "#DCD5C6", backgroundColor: "#F2EEE4", color: "#4A443B", outlineColor: brand.primaryColor }}
                    />
                    <p id="invite-email-hint" className="mt-2 text-xs" style={{ color: brand.neutralColor }}>
                      Fixed by the invitation. Ask {INVITATION.invitedBy} to re-send if this address is wrong.
                    </p>
                  </div>

                  <div className="mt-6">
                    <UI.Label htmlFor="invite-password">
                      <span className="text-sm font-medium">New password</span>
                    </UI.Label>
                    <div className="mt-2 flex gap-2">
                      <input
                        id="invite-password"
                        ref={passwordRef}
                        type={showPassword ? "text" : "password"}
                        value={password}
                        autoComplete="new-password"
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (errors) setErrors(null);
                        }}
                        aria-describedby="password-rules password-rules-status"
                        aria-invalid={errors && errors.password ? "true" : undefined}
                        className={`${fieldBase} flex-1`}
                        style={{
                          borderColor: errors && errors.password ? "#C0472B" : "#DCD5C6",
                          outlineColor: brand.primaryColor,
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-pressed={showPassword}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="rounded-md border px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                        style={{ borderColor: "#DCD5C6", color: brand.primaryColor, outlineColor: brand.primaryColor }}
                      >
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    </div>

                    <ul id="password-rules" className="mt-3 space-y-1.5">
                      {ruleState.map((rule) => (
                        <li key={rule.id} className="flex items-center gap-2 text-sm">
                          {rule.met ? (
                            <Icons.Check className="h-4 w-4 shrink-0" aria-hidden="true" style={{ color: brand.primaryColor }} />
                          ) : (
                            <Icons.X className="h-4 w-4 shrink-0" aria-hidden="true" style={{ color: "#8A8276" }} />
                          )}
                          <span style={{ color: rule.met ? "#1F1C18" : brand.neutralColor }}>
                            {rule.label}
                            <span className="sr-only">{rule.met ? " — met" : " — not met yet"}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p id="password-rules-status" aria-live="polite" className="mt-2 text-xs" style={{ color: brand.neutralColor }}>
                      {metCount} of {PASSWORD_RULES.length} requirements met
                    </p>
                  </div>

                  <div className="mt-6">
                    <UI.Label htmlFor="invite-confirm">
                      <span className="text-sm font-medium">Confirm password</span>
                    </UI.Label>
                    <input
                      id="invite-confirm"
                      ref={confirmRef}
                      type={showPassword ? "text" : "password"}
                      value={confirm}
                      autoComplete="new-password"
                      onChange={(e) => {
                        setConfirm(e.target.value);
                        if (errors) setErrors(null);
                      }}
                      aria-invalid={errors && errors.confirm ? "true" : undefined}
                      aria-describedby={errors && errors.confirm ? "confirm-error" : undefined}
                      className={`${fieldBase} mt-2`}
                      style={{
                        borderColor: errors && errors.confirm ? "#C0472B" : "#DCD5C6",
                        outlineColor: brand.primaryColor,
                      }}
                    />
                    {errors && errors.confirm && (
                      <p id="confirm-error" className="mt-2 text-sm font-medium" style={{ color: "#8E3319" }}>
                        {errors.confirm}
                      </p>
                    )}
                  </div>

                  <div className="mt-6 rounded-md border p-4" style={{ borderColor: "#DCD5C6", backgroundColor: "#FCFAF5" }}>
                    <div className="flex items-start gap-3">
                      <input
                        id="invite-agree"
                        ref={agreeRef}
                        type="checkbox"
                        checked={agreed}
                        onChange={(e) => {
                          setAgreed(e.target.checked);
                          if (errors) setErrors(null);
                        }}
                        aria-invalid={errors && errors.agree ? "true" : undefined}
                        aria-describedby={errors && errors.agree ? "agree-error" : undefined}
                        className="mt-1 h-4 w-4 shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                        style={{ accentColor: brand.primaryColor, outlineColor: brand.primaryColor }}
                      />
                      <UI.Label htmlFor="invite-agree">
                        <span className="text-sm leading-relaxed">
                          I understand that documents I upload are shared with everyone in {INVITATION.workspace}, and that
                          my own conversations stay private to me.
                        </span>
                      </UI.Label>
                    </div>
                    {errors && errors.agree && (
                      <p id="agree-error" className="mt-2 pl-7 text-sm font-medium" style={{ color: "#8E3319" }}>
                        {errors.agree}
                      </p>
                    )}
                  </div>

                  <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <UI.Button
                      type="submit"
                      className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                      style={{ backgroundColor: brand.primaryColor, outlineColor: brand.primaryColor }}
                    >
                      Create account and sign in
                    </UI.Button>
                    <UI.Button
                      type="button"
                      onClick={() => navigate("sign-in")}
                      className="inline-flex items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                      style={{ color: brand.primaryColor, backgroundColor: "transparent", outlineColor: brand.primaryColor }}
                    >
                      <Icons.ArrowLeft className="h-4 w-4" aria-hidden="true" />
                      I already have an account
                    </UI.Button>
                  </div>
                </form>
              </UI.CardContent>
            </UI.Card>
          )}

          <div className="mt-6">
            <button
              type="button"
              onClick={() => setHelpOpen((v) => !v)}
              aria-expanded={helpOpen}
              aria-controls="invite-help"
              className="inline-flex items-center gap-2 rounded text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{ color: brand.primaryColor, outlineColor: brand.primaryColor }}
            >
              {helpOpen ? (
                <Icons.ChevronDown className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Icons.ChevronRight className="h-4 w-4" aria-hidden="true" />
              )}
              This link isn't working
            </button>
            {helpOpen && (
              <div
                id="invite-help"
                className="mt-3 rounded-md border p-5"
                style={{ borderColor: "#DCD5C6", backgroundColor: "#FCFAF5" }}
              >
                <h2 className="text-sm font-semibold" style={{ fontFamily: brand.fontHeading }}>
                  Three things usually explain it
                </h2>
                <dl className="mt-4 space-y-4 text-sm leading-relaxed">
                  <div>
                    <dt className="font-medium">The link has expired</dt>
                    <dd style={{ color: brand.neutralColor }}>
                      Invitations last seven days. Ask {INVITATION.invitedBy} to send a fresh one.
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium">The link has already been used</dt>
                    <dd style={{ color: brand.neutralColor }}>
                      Each invitation works once. If your account already exists, sign in with your password instead.
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium">You don't have an invitation</dt>
                    <dd style={{ color: brand.neutralColor }}>
                      There is no self-signup for this workspace. An admin has to invite your email address first.
                    </dd>
                  </div>
                </dl>
                <UI.Button
                  type="button"
                  onClick={() => navigate("sign-in")}
                  className="mt-5 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  style={{ borderColor: "#DCD5C6", color: brand.primaryColor, backgroundColor: "transparent", outlineColor: brand.primaryColor }}
                >
                  Go to sign in
                </UI.Button>
              </div>
            )}
          </div>
        </div>

        <aside className="lg:col-span-2" aria-labelledby="invitation-details-heading">
          <UI.Card>
            <UI.CardContent>
              <h2 id="invitation-details-heading" className="text-sm font-semibold uppercase tracking-[0.1em]" style={{ color: brand.neutralColor }}>
                Invitation details
              </h2>
              <dl className="mt-4 space-y-4 text-sm">
                <div>
                  <dt style={{ color: brand.neutralColor }}>Workspace</dt>
                  <dd className="mt-1 font-medium">{INVITATION.workspace}</dd>
                </div>
                <div>
                  <dt style={{ color: brand.neutralColor }}>Email address</dt>
                  <dd className="mt-1 break-all font-medium">{INVITATION.email}</dd>
                </div>
                <div>
                  <dt style={{ color: brand.neutralColor }}>Role</dt>
                  <dd className="mt-1">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold"
                      style={{ backgroundColor: "#E6EDE9", color: "#14402F" }}
                    >
                      <Icons.User className="h-3.5 w-3.5" aria-hidden="true" />
                      {INVITATION.role === "admin" ? "Admin" : "Member"}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt style={{ color: brand.neutralColor }}>Invited by</dt>
                  <dd className="mt-1 font-medium">
                    {INVITATION.invitedBy} <span className="font-normal" style={{ color: brand.neutralColor }}>({INVITATION.invitedByRole})</span>
                  </dd>
                </div>
                <div>
                  <dt style={{ color: brand.neutralColor }}>Sent</dt>
                  <dd className="mt-1 font-medium">{INVITATION.sentAt}</dd>
                </div>
                <div>
                  <dt style={{ color: brand.neutralColor }}>Expires</dt>
                  <dd className="mt-1">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold"
                      style={{ backgroundColor: "#FAEFDF", color: "#7A4A12" }}
                    >
                      <Icons.Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      In {INVITATION.expiresInDays} days · {INVITATION.expiresAt}
                    </span>
                  </dd>
                </div>
              </dl>

              <UI.Separator />

              <h3 className="mt-5 text-sm font-semibold" style={{ fontFamily: brand.fontHeading }}>
                What the {INVITATION.role} role allows
              </h3>
              <ul className="mt-3 space-y-2.5">
                {ROLE_ABILITIES[INVITATION.role].map((item) => (
                  <li key={item.text} className="flex items-start gap-2.5 text-sm leading-relaxed">
                    {item.can ? (
                      <Icons.Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" style={{ color: brand.primaryColor }} />
                    ) : (
                      <Icons.X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" style={{ color: "#8A8276" }} />
                    )}
                    <span style={{ color: item.can ? "#2A2621" : brand.neutralColor }}>
                      <span className="sr-only">{item.can ? "Allowed: " : "Not allowed: "}</span>
                      {item.text}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="mt-5 text-xs leading-relaxed" style={{ color: brand.neutralColor }}>
                The assistant answers only from documents your team has uploaded. Scanned PDFs are not read, and files are
                limited to 50MB each.{" "}
                <button
                  type="button"
                  onClick={() => navigate("help")}
                  className="rounded font-semibold underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  style={{ color: brand.primaryColor, outlineColor: brand.primaryColor }}
                >
                  Read the full limitations
                </button>
              </p>
            </UI.CardContent>
          </UI.Card>
        </aside>
      </div>
    </div>
  );
}
