/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unused-expressions */
import React from "react";

import * as UI from "@/lib/ui";
import { Icons } from "@/lib/icons";
import { brand } from "@/lib/brand";
import { useNavigate } from "@/lib/navigate";

const { Input, Label, Select, Table, THead, TBody, TR, TH, TD } = UI;
const { Plus, Search, Check, X, ChevronRight, Bell, Home, Clock, Filter, ArrowLeft, ArrowRight, AlertCircle, CheckCircle } = Icons;

const INITIAL_MEMBERS = [
  {
    id: "u_01",
    name: "Priya Raman",
    email: "priya.raman@northbeam.co",
    role: "admin",
    is_active: true,
    created_at: "4 Feb 2026",
    last_active: "Today, 09:12",
    uploads: 42,
    is_you: true,
  },
  {
    id: "u_02",
    name: "Daniel Okoro",
    email: "daniel.okoro@northbeam.co",
    role: "admin",
    is_active: true,
    created_at: "4 Feb 2026",
    last_active: "Today, 08:40",
    uploads: 17,
    is_you: false,
  },
  {
    id: "u_03",
    name: "Helena Vogt",
    email: "helena.vogt@northbeam.co",
    role: "member",
    is_active: true,
    created_at: "19 Feb 2026",
    last_active: "Yesterday, 17:55",
    uploads: 26,
    is_you: false,
  },
  {
    id: "u_04",
    name: "Marcus Bell",
    email: "marcus.bell@northbeam.co",
    role: "member",
    is_active: true,
    created_at: "2 Mar 2026",
    last_active: "Yesterday, 11:02",
    uploads: 9,
    is_you: false,
  },
  {
    id: "u_05",
    name: "Sofia Almeida",
    email: "sofia.almeida@northbeam.co",
    role: "member",
    is_active: true,
    created_at: "11 Mar 2026",
    last_active: "2 Oct 2026",
    uploads: 31,
    is_you: false,
  },
  {
    id: "u_06",
    name: "Tomas Lindqvist",
    email: "tomas.lindqvist@northbeam.co",
    role: "member",
    is_active: true,
    created_at: "27 Apr 2026",
    last_active: "30 Sep 2026",
    uploads: 4,
    is_you: false,
  },
  {
    id: "u_07",
    name: "Grace Mutuku",
    email: "grace.mutuku@northbeam.co",
    role: "member",
    is_active: true,
    created_at: "8 Jun 2026",
    last_active: "Today, 07:31",
    uploads: 12,
    is_you: false,
  },
  {
    id: "u_08",
    name: "Ivan Petrov",
    email: "ivan.petrov@northbeam.co",
    role: "member",
    is_active: false,
    created_at: "15 Jan 2026",
    last_active: "22 Aug 2026",
    uploads: 6,
    is_you: false,
  },
];

const INITIAL_INVITATIONS = [
  {
    id: "inv_01",
    email: "nadia.haddad@northbeam.co",
    role: "member",
    invited_by: "Priya Raman",
    sent_at: "5 Oct 2026",
    detail: "Expires 12 Oct 2026",
    status: "pending",
  },
  {
    id: "inv_02",
    email: "oliver.schmidt@northbeam.co",
    role: "admin",
    invited_by: "Daniel Okoro",
    sent_at: "2 Oct 2026",
    detail: "Expires 9 Oct 2026",
    status: "pending",
  },
  {
    id: "inv_03",
    email: "lena.fischer@northbeam.co",
    role: "member",
    invited_by: "Priya Raman",
    sent_at: "14 Sep 2026",
    detail: "Expired 21 Sep 2026",
    status: "expired",
  },
  {
    id: "inv_04",
    email: "grace.mutuku@northbeam.co",
    role: "member",
    invited_by: "Priya Raman",
    sent_at: "6 Jun 2026",
    detail: "Accepted 8 Jun 2026",
    status: "accepted",
  },
];

const ROLE_COPY = {
  admin: "Invites and removes members, deletes any document in the library.",
  member: "Uploads and chats, deletes only their own uploads.",
};

const INVITE_STATUS_LABEL = {
  pending: "Pending",
  expired: "Expired",
  accepted: "Accepted",
};

function initials(name) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function Screen() {
  const navigate = useNavigate();
  const [members, setMembers] = React.useState(INITIAL_MEMBERS);
  const [invitations, setInvitations] = React.useState(INITIAL_INVITATIONS);
  const [tab, setTab] = React.useState("members");
  const [query, setQuery] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState("all");

  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState("member");
  const [formError, setFormError] = React.useState("");
  const [announcement, setAnnouncement] = React.useState("");

  const [confirmTarget, setConfirmTarget] = React.useState(null);

  const emailInputRef = React.useRef(null);
  const dialogCancelRef = React.useRef(null);
  const returnFocusRef = React.useRef(null);
  const tabRefs = React.useRef({});

  const tabs = [
    { id: "members", label: "Members", count: members.length },
    {
      id: "invitations",
      label: "Invitations",
      count: invitations.filter((i) => i.status !== "accepted").length,
    },
  ];

  React.useEffect(() => {
    if (confirmTarget && dialogCancelRef.current) {
      dialogCancelRef.current.focus();
    }
  }, [confirmTarget]);

  const normalisedQuery = query.trim().toLowerCase();

  const visibleMembers = members.filter((m) => {
    const matchesRole = roleFilter === "all" || m.role === roleFilter;
    const matchesQuery =
      normalisedQuery === "" ||
      m.name.toLowerCase().includes(normalisedQuery) ||
      m.email.toLowerCase().includes(normalisedQuery);
    return matchesRole && matchesQuery;
  });

  const visibleInvitations = invitations.filter((i) => {
    const matchesRole = roleFilter === "all" || i.role === roleFilter;
    const matchesQuery =
      normalisedQuery === "" || i.email.toLowerCase().includes(normalisedQuery);
    return matchesRole && matchesQuery;
  });

  const activeCount = members.filter((m) => m.is_active).length;
  const adminCount = members.filter((m) => m.role === "admin" && m.is_active).length;
  const pendingCount = invitations.filter((i) => i.status === "pending").length;

  function handleInvite(event) {
    event.preventDefault();
    const email = inviteEmail.trim().toLowerCase();

    if (email === "") {
      setFormError("Enter the email address you want to invite.");
      emailInputRef.current && emailInputRef.current.focus();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormError("That does not look like an email address. Check it and try again.");
      emailInputRef.current && emailInputRef.current.focus();
      return;
    }
    if (members.some((m) => m.email.toLowerCase() === email && m.is_active)) {
      setFormError("That person is already a member of this workspace.");
      emailInputRef.current && emailInputRef.current.focus();
      return;
    }
    if (invitations.some((i) => i.email.toLowerCase() === email && i.status === "pending")) {
      setFormError("An invitation is already pending for that address. Resend it instead.");
      emailInputRef.current && emailInputRef.current.focus();
      return;
    }

    const invitation = {
      id: "inv_" + Math.random().toString(36).slice(2, 8),
      email,
      role: inviteRole,
      invited_by: "Priya Raman",
      sent_at: "6 Oct 2026",
      detail: "Expires 13 Oct 2026",
      status: "pending",
    };

    setInvitations((prev) => [invitation, ...prev]);
    setInviteEmail("");
    setInviteRole("member");
    setFormError("");
    setTab("invitations");
    setQuery("");
    setRoleFilter("all");
    setAnnouncement(
      "Invitation sent to " +
        email +
        " as " +
        (invitation.role === "admin" ? "an admin" : "a member") +
        ". The single-use link expires in 7 days."
    );
  }

  function openRemoveDialog(member, event) {
    returnFocusRef.current = event.currentTarget;
    setConfirmTarget(member);
  }

  function closeDialog() {
    setConfirmTarget(null);
    if (returnFocusRef.current) {
      returnFocusRef.current.focus();
      returnFocusRef.current = null;
    }
  }

  function confirmRemove() {
    const member = confirmTarget;
    if (!member) return;
    setMembers((prev) =>
      prev.map((m) => (m.id === member.id ? { ...m, is_active: false, last_active: "Access removed" } : m))
    );
    setAnnouncement(
      member.name +
        " no longer has access. Their sessions are revoked and the " +
        member.uploads +
        " documents they uploaded stay in the shared library."
    );
    setConfirmTarget(null);
    if (returnFocusRef.current) {
      returnFocusRef.current = null;
    }
  }

  function restoreAccess(member) {
    setMembers((prev) =>
      prev.map((m) => (m.id === member.id ? { ...m, is_active: true, last_active: "Just now" } : m))
    );
    setAnnouncement(member.name + " can sign in again as a " + member.role + ".");
  }

  function resendInvitation(invite) {
    setInvitations((prev) =>
      prev.map((i) =>
        i.id === invite.id
          ? { ...i, status: "pending", sent_at: "6 Oct 2026", detail: "Expires 13 Oct 2026" }
          : i
      )
    );
    setAnnouncement("A fresh single-use link was sent to " + invite.email + ".");
  }

  function revokeInvitation(invite) {
    setInvitations((prev) => prev.filter((i) => i.id !== invite.id));
    setAnnouncement("Invitation for " + invite.email + " was revoked. The link no longer works.");
  }

  function onTabKeyDown(event) {
    const order = tabs.map((t) => t.id);
    const index = order.indexOf(tab);
    let next = null;
    if (event.key === "ArrowRight") next = order[(index + 1) % order.length];
    if (event.key === "ArrowLeft") next = order[(index - 1 + order.length) % order.length];
    if (event.key === "Home") next = order[0];
    if (event.key === "End") next = order[order.length - 1];
    if (next) {
      event.preventDefault();
      setTab(next);
      const el = tabRefs.current[next];
      if (el) el.focus();
    }
  }

  const primary = brand.primaryColor;
  const accent = brand.accentColor;
  const neutral = brand.neutralColor;
  const radius = brand.radius;

  const focusRing =
    "focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F7F4ED]";

  function StatusTag({ tone, icon, children }) {
    const tones = {
      green: { color: "#1B5240", border: "#1B5240", bg: "rgba(27,82,64,0.08)" },
      amber: { color: "#8A5312", border: "#C1761A", bg: "rgba(193,118,26,0.10)" },
      grey: { color: "#555047", border: "#B8B1A5", bg: "rgba(110,103,91,0.10)" },
    };
    const t = tones[tone] || tones.grey;
    return (
      <span
        className="inline-flex items-center gap-1.5 border px-2 py-0.5 text-xs font-medium"
        style={{ color: t.color, borderColor: t.border, backgroundColor: t.bg, borderRadius: "4px" }}
      >
        {icon}
        {children}
      </span>
    );
  }

  return (
    <div
      className="min-h-full w-full"
      style={{ backgroundColor: brand.backgroundColor, fontFamily: brand.fontBody, color: "#2A2721" }}
    >
      <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
        {/* Heading */}
        <header className="mb-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: neutral }}>
            Northbeam Research workspace
          </p>
          <h1
            className="text-3xl font-semibold tracking-tight sm:text-[2rem]"
            style={{ fontFamily: brand.fontHeading, color: "#201D18" }}
          >
            Members
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed" style={{ color: neutral }}>
            Access to the shared document library is by invitation only. You are signed in as an admin,
            so you can invite colleagues, change who can delete documents, and remove access.
          </p>
        </header>

        {/* Summary */}
        <section aria-label="Workspace summary" className="mb-8">
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              { label: "Active members", value: activeCount, note: "Can sign in today" },
              { label: "Admins", value: adminCount, note: "Can remove any document" },
              { label: "Pending invitations", value: pendingCount, note: "Link not yet used" },
            ].map((item) => (
              <li
                key={item.label}
                className="border bg-white px-5 py-4"
                style={{ borderColor: "#E2DCD0", borderRadius: radius }}
              >
                <p className="text-sm font-medium" style={{ color: neutral }}>
                  {item.label}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: primary }}>
                  {item.value}
                </p>
                <p className="mt-1 text-xs" style={{ color: neutral }}>
                  {item.note}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <div aria-live="polite" className="sr-only">
          {announcement}
        </div>

        {announcement ? (
          <div
            className="mb-6 flex items-start gap-3 border px-4 py-3"
            style={{ borderColor: primary, backgroundColor: "rgba(27,82,64,0.06)", borderRadius: radius }}
          >
            <Icons.CheckCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" style={{ color: primary }} />
            <p className="text-sm leading-relaxed" style={{ color: "#20392F" }}>
              {announcement}
            </p>
            <button
              type="button"
              onClick={() => setAnnouncement("")}
              aria-label="Dismiss this confirmation"
              className={"ml-auto shrink-0 rounded p-1 hover:bg-black/5 " + focusRing}
              style={{ color: neutral }}
            >
              <Icons.X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {/* List column */}
          <section aria-labelledby="directory-heading" className="min-w-0">
            <h2 id="directory-heading" className="sr-only">
              Workspace directory
            </h2>

            <div
              role="tablist"
              aria-label="Directory view"
              onKeyDown={onTabKeyDown}
              className="flex gap-1 border-b"
              style={{ borderColor: "#E2DCD0" }}
            >
              {tabs.map((t) => {
                const selected = tab === t.id;
                return (
                  <button
                    key={t.id}
                    id={"tab-" + t.id}
                    ref={(el) => {
                      tabRefs.current[t.id] = el;
                    }}
                    role="tab"
                    type="button"
                    aria-selected={selected}
                    aria-controls={"panel-" + t.id}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setTab(t.id)}
                    className={
                      "-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors " + focusRing
                    }
                    style={{
                      borderColor: selected ? primary : "transparent",
                      color: selected ? primary : neutral,
                    }}
                  >
                    {t.label}{" "}
                    <span className="tabular-nums" style={{ color: selected ? primary : neutral }}>
                      ({t.count})
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Filters */}
            <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <UI.Label htmlFor="member-search" className="mb-1.5 block text-sm font-medium">
                  Search by name or email
                </UI.Label>
                <div className="relative">
                  <Icons.Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                    aria-hidden="true"
                    style={{ color: neutral }}
                  />
                  <UI.Input
                    id="member-search"
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="e.g. helena or @northbeam.co"
                    className="w-full pl-9"
                  />
                </div>
              </div>
              <div className="sm:w-48">
                <UI.Label htmlFor="role-filter" className="mb-1.5 block text-sm font-medium">
                  Filter by role
                </UI.Label>
                <UI.Select
                  id="role-filter"
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="w-full"
                >
                  <option value="all">All roles</option>
                  <option value="admin">Admins</option>
                  <option value="member">Members</option>
                </UI.Select>
              </div>
            </div>

            {/* Members panel */}
            <div
              role="tabpanel"
              id="panel-members"
              aria-labelledby="tab-members"
              hidden={tab !== "members"}
              tabIndex={-1}
              className="mt-5"
            >
              {visibleMembers.length === 0 ? (
                <div
                  className="border bg-white px-6 py-12 text-center"
                  style={{ borderColor: "#E2DCD0", borderRadius: radius }}
                >
                  <h3 className="text-base font-semibold" style={{ color: "#201D18" }}>
                    No members match that search
                  </h3>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed" style={{ color: neutral }}>
                    Nobody in this workspace matches “{query || "the current filter"}”. Clear the filters to
                    see everyone again.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setRoleFilter("all");
                    }}
                    className={"mt-5 border px-4 py-2 text-sm font-medium " + focusRing}
                    style={{ borderColor: primary, color: primary, borderRadius: radius }}
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <div
                  className="overflow-x-auto border bg-white"
                  style={{ borderColor: "#E2DCD0", borderRadius: radius }}
                >
                  <UI.Table className="w-full min-w-[42rem] text-sm">
                    <caption className="sr-only">
                      Members of the Northbeam Research workspace, with role, access status and uploads.
                    </caption>
                    <UI.THead>
                      <UI.TR>
                        <UI.TH scope="col">Member</UI.TH>
                        <UI.TH scope="col">Role</UI.TH>
                        <UI.TH scope="col">Access</UI.TH>
                        <UI.TH scope="col">Uploads</UI.TH>
                        <UI.TH scope="col">Last active</UI.TH>
                        <UI.TH scope="col">
                          <span className="sr-only">Actions</span>
                        </UI.TH>
                      </UI.TR>
                    </UI.THead>
                    <UI.TBody>
                      {visibleMembers.map((m) => (
                        <UI.TR key={m.id}>
                          <UI.TD>
                            <div className="flex items-center gap-3">
                              <span
                                aria-hidden="true"
                                className="flex h-9 w-9 shrink-0 items-center justify-center text-xs font-semibold"
                                style={{
                                  backgroundColor: "rgba(27,82,64,0.10)",
                                  color: primary,
                                  borderRadius: "999px",
                                }}
                              >
                                {initials(m.name)}
                              </span>
                              <span className="min-w-0">
                                <span className="block font-medium" style={{ color: "#201D18" }}>
                                  {m.name}
                                  {m.is_you ? (
                                    <span className="ml-2 text-xs font-normal" style={{ color: neutral }}>
                                      (you)
                                    </span>
                                  ) : null}
                                </span>
                                <span className="block truncate text-xs" style={{ color: neutral }}>
                                  {m.email}
                                </span>
                              </span>
                            </div>
                          </UI.TD>
                          <UI.TD>
                            <span className="font-medium" style={{ color: "#201D18" }}>
                              {m.role === "admin" ? "Admin" : "Member"}
                            </span>
                            <span className="mt-0.5 block text-xs" style={{ color: neutral }}>
                              {m.role === "admin" ? "Manages users" : "Own uploads only"}
                            </span>
                          </UI.TD>
                          <UI.TD>
                            {m.is_active ? (
                              <StatusTag
                                tone="green"
                                icon={<Icons.Check className="h-3.5 w-3.5" aria-hidden="true" />}
                              >
                                Active
                              </StatusTag>
                            ) : (
                              <StatusTag
                                tone="grey"
                                icon={<Icons.X className="h-3.5 w-3.5" aria-hidden="true" />}
                              >
                                Removed
                              </StatusTag>
                            )}
                          </UI.TD>
                          <UI.TD>
                            <span className="tabular-nums">{m.uploads}</span>
                          </UI.TD>
                          <UI.TD>
                            <span style={{ color: neutral }}>{m.last_active}</span>
                            <span className="mt-0.5 block text-xs" style={{ color: neutral }}>
                              Joined {m.created_at}
                            </span>
                          </UI.TD>
                          <UI.TD>
                            <div className="flex justify-end">
                              {m.is_you ? (
                                <span className="text-xs" style={{ color: neutral }}>
                                  Cannot remove yourself
                                </span>
                              ) : m.is_active ? (
                                <button
                                  type="button"
                                  onClick={(e) => openRemoveDialog(m, e)}
                                  className={"border px-3 py-1.5 text-sm font-medium " + focusRing}
                                  style={{ borderColor: "#C9C2B5", color: "#8A3022", borderRadius: radius }}
                                >
                                  Remove
                                  <span className="sr-only"> {m.name} from the workspace</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => restoreAccess(m)}
                                  className={"border px-3 py-1.5 text-sm font-medium " + focusRing}
                                  style={{ borderColor: primary, color: primary, borderRadius: radius }}
                                >
                                  Restore
                                  <span className="sr-only"> access for {m.name}</span>
                                </button>
                              )}
                            </div>
                          </UI.TD>
                        </UI.TR>
                      ))}
                    </UI.TBody>
                  </UI.Table>
                </div>
              )}
              <p className="mt-3 text-xs" style={{ color: neutral }}>
                Showing {visibleMembers.length} of {members.length} people. Removing someone revokes their
                sessions; documents they uploaded stay in the shared library.
              </p>
            </div>

            {/* Invitations panel */}
            <div
              role="tabpanel"
              id="panel-invitations"
              aria-labelledby="tab-invitations"
              hidden={tab !== "invitations"}
              tabIndex={-1}
              className="mt-5"
            >
              {visibleInvitations.length === 0 ? (
                <div
                  className="border bg-white px-6 py-12 text-center"
                  style={{ borderColor: "#E2DCD0", borderRadius: radius }}
                >
                  <h3 className="text-base font-semibold" style={{ color: "#201D18" }}>
                    No invitations to show
                  </h3>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed" style={{ color: neutral }}>
                    Nothing matches the current search or role filter. Invite a colleague using the form,
                    and their single-use link will be listed here until it is used.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setRoleFilter("all");
                      emailInputRef.current && emailInputRef.current.focus();
                    }}
                    className={"mt-5 px-4 py-2 text-sm font-medium text-white " + focusRing}
                    style={{ backgroundColor: primary, borderRadius: radius }}
                  >
                    Invite someone
                  </button>
                </div>
              ) : (
                <div
                  className="overflow-x-auto border bg-white"
                  style={{ borderColor: "#E2DCD0", borderRadius: radius }}
                >
                  <UI.Table className="w-full min-w-[42rem] text-sm">
                    <caption className="sr-only">
                      Invitations to this workspace, with role, status and the admin who sent them.
                    </caption>
                    <UI.THead>
                      <UI.TR>
                        <UI.TH scope="col">Email address</UI.TH>
                        <UI.TH scope="col">Role</UI.TH>
                        <UI.TH scope="col">Status</UI.TH>
                        <UI.TH scope="col">Invited by</UI.TH>
                        <UI.TH scope="col">
                          <span className="sr-only">Actions</span>
                        </UI.TH>
                      </UI.TR>
                    </UI.THead>
                    <UI.TBody>
                      {visibleInvitations.map((inv) => (
                        <UI.TR key={inv.id}>
                          <UI.TD>
                            <span className="font-medium" style={{ color: "#201D18" }}>
                              {inv.email}
                            </span>
                            <span className="mt-0.5 block text-xs" style={{ color: neutral }}>
                              Sent {inv.sent_at}
                            </span>
                          </UI.TD>
                          <UI.TD>{inv.role === "admin" ? "Admin" : "Member"}</UI.TD>
                          <UI.TD>
                            {inv.status === "pending" ? (
                              <StatusTag
                                tone="amber"
                                icon={<Icons.Clock className="h-3.5 w-3.5" aria-hidden="true" />}
                              >
                                {INVITE_STATUS_LABEL.pending}
                              </StatusTag>
                            ) : inv.status === "expired" ? (
                              <StatusTag
                                tone="grey"
                                icon={<Icons.AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                              >
                                {INVITE_STATUS_LABEL.expired}
                              </StatusTag>
                            ) : (
                              <StatusTag
                                tone="green"
                                icon={<Icons.Check className="h-3.5 w-3.5" aria-hidden="true" />}
                              >
                                {INVITE_STATUS_LABEL.accepted}
                              </StatusTag>
                            )}
                            <span className="mt-1 block text-xs" style={{ color: neutral }}>
                              {inv.detail}
                            </span>
                          </UI.TD>
                          <UI.TD>
                            <span style={{ color: neutral }}>{inv.invited_by}</span>
                          </UI.TD>
                          <UI.TD>
                            <div className="flex justify-end gap-2">
                              {inv.status === "accepted" ? (
                                <span className="text-xs" style={{ color: neutral }}>
                                  Link already used
                                </span>
                              ) : (
                                <React.Fragment>
                                  <button
                                    type="button"
                                    onClick={() => resendInvitation(inv)}
                                    className={"border px-3 py-1.5 text-sm font-medium " + focusRing}
                                    style={{ borderColor: primary, color: primary, borderRadius: radius }}
                                  >
                                    Resend
                                    <span className="sr-only"> invitation to {inv.email}</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => revokeInvitation(inv)}
                                    className={"border px-3 py-1.5 text-sm font-medium " + focusRing}
                                    style={{ borderColor: "#C9C2B5", color: "#8A3022", borderRadius: radius }}
                                  >
                                    Revoke
                                    <span className="sr-only"> invitation to {inv.email}</span>
                                  </button>
                                </React.Fragment>
                              )}
                            </div>
                          </UI.TD>
                        </UI.TR>
                      ))}
                    </UI.TBody>
                  </UI.Table>
                </div>
              )}
              <p className="mt-3 text-xs" style={{ color: neutral }}>
                Each invitation link works once and expires after 7 days. There is no open sign-up.
              </p>
            </div>
          </section>

          {/* Invite column */}
          <aside className="lg:sticky lg:top-8 lg:self-start">
            <div
              className="border bg-white p-5"
              style={{ borderColor: "#E2DCD0", borderRadius: radius }}
            >
              <h2 className="text-lg font-semibold" style={{ fontFamily: brand.fontHeading, color: "#201D18" }}>
                Invite a colleague
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed" style={{ color: neutral }}>
                They receive a single-use link to set their own password.
              </p>

              <form onSubmit={handleInvite} noValidate className="mt-5 space-y-4">
                <div>
                  <UI.Label htmlFor="invite-email" className="mb-1.5 block text-sm font-medium">
                    Work email address
                  </UI.Label>
                  <UI.Input
                    id="invite-email"
                    ref={emailInputRef}
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => {
                      setInviteEmail(e.target.value);
                      if (formError) setFormError("");
                    }}
                    placeholder="name@northbeam.co"
                    aria-invalid={formError ? "true" : "false"}
                    aria-describedby={formError ? "invite-email-error" : undefined}
                    className="w-full"
                  />
                  {formError ? (
                    <p
                      id="invite-email-error"
                      role="alert"
                      className="mt-2 flex items-start gap-1.5 text-sm"
                      style={{ color: "#8A3022" }}
                    >
                      <Icons.AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      {formError}
                    </p>
                  ) : null}
                </div>

                <div>
                  <UI.Label htmlFor="invite-role" className="mb-1.5 block text-sm font-medium">
                    Role
                  </UI.Label>
                  <UI.Select
                    id="invite-role"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    aria-describedby="invite-role-help"
                    className="w-full"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </UI.Select>
                  <p id="invite-role-help" className="mt-2 text-xs leading-relaxed" style={{ color: neutral }}>
                    {ROLE_COPY[inviteRole]}
                  </p>
                </div>

                <button
                  type="submit"
                  className={"flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white " + focusRing}
                  style={{ backgroundColor: primary, borderRadius: radius }}
                >
                  <Icons.Plus className="h-4 w-4" aria-hidden="true" />
                  Send invitation
                </button>
              </form>
            </div>

            <div
              className="mt-5 border p-5"
              style={{ borderColor: "#E2DCD0", borderRadius: radius, backgroundColor: "rgba(193,118,26,0.06)" }}
            >
              <h3 className="text-sm font-semibold" style={{ color: "#201D18" }}>
                What each role can do
              </h3>
              <dl className="mt-3 space-y-3 text-sm">
                <div>
                  <dt className="font-medium" style={{ color: accent }}>
                    Member
                  </dt>
                  <dd className="mt-0.5 leading-relaxed" style={{ color: neutral }}>
                    Uploads to the shared library, chats privately, deletes only their own uploads.
                  </dd>
                </div>
                <div>
                  <dt className="font-medium" style={{ color: accent }}>
                    Admin
                  </dt>
                  <dd className="mt-0.5 leading-relaxed" style={{ color: neutral }}>
                    Everything a member can do, plus inviting and removing people and deleting any document.
                  </dd>
                </div>
              </dl>
              <p className="mt-4 text-xs leading-relaxed" style={{ color: neutral }}>
                Nobody, including admins, can read another person's conversations.
              </p>
              <button
                type="button"
                onClick={() => navigate("help")}
                className={"mt-3 inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4 " + focusRing}
                style={{ color: primary }}
              >
                Read the admin guide
                <Icons.ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </aside>
        </div>
      </div>

      {/* Remove confirmation dialog */}
      {confirmTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(32,29,24,0.45)" }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              closeDialog();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-dialog-title"
            aria-describedby="remove-dialog-desc"
            className="w-full max-w-md border bg-white p-6 shadow-xl"
            style={{ borderColor: "#E2DCD0", borderRadius: radius }}
          >
            <h2
              id="remove-dialog-title"
              className="text-lg font-semibold"
              style={{ fontFamily: brand.fontHeading, color: "#201D18" }}
            >
              Remove {confirmTarget.name}?
            </h2>
            <p id="remove-dialog-desc" className="mt-3 text-sm leading-relaxed" style={{ color: neutral }}>
              {confirmTarget.email} will be signed out everywhere and will not be able to sign in again
              unless you invite them back. The {confirmTarget.uploads} documents they uploaded stay in the
              shared library, and their conversations are not visible to anyone.
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                ref={dialogCancelRef}
                onClick={closeDialog}
                className={"border px-4 py-2 text-sm font-medium " + focusRing}
                style={{ borderColor: "#C9C2B5", color: "#201D18", borderRadius: radius }}
              >
                Keep access
              </button>
              <button
                type="button"
                onClick={confirmRemove}
                className={"px-4 py-2 text-sm font-semibold text-white " + focusRing}
                style={{ backgroundColor: "#8A3022", borderRadius: radius }}
              >
                Remove member
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
