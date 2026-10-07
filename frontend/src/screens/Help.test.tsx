import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import Help from "./Help";

function renderHelp() {
  return render(
    <MemoryRouter>
      <Help />
    </MemoryRouter>,
  );
}

describe("Help screen", () => {
  it("shows the uploading, statuses and citations sections in the contents nav", () => {
    renderHelp();
    const nav = screen.getByRole("tablist", { name: "Help sections" });
    expect(within(nav).getByText("Uploading documents")).toBeInTheDocument();
    expect(within(nav).getByText("The four statuses")).toBeInTheDocument();
    expect(within(nav).getByText("Checking citations")).toBeInTheDocument();
  });

  it("lists all four document statuses with their meaning", async () => {
    const user = userEvent.setup();
    renderHelp();
    await user.click(screen.getByRole("tab", { name: /The four statuses/i }));
    for (const label of ["Queued", "Processing", "Ready", "Failed"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("states the limitations required by the product: documents-only answers, no OCR, 50MB limit, English assumption, shared docs/private chats", async () => {
    const user = userEvent.setup();
    renderHelp();

    expect(
      screen.getByText(/answers questions using only the documents your team has uploaded/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /What it will not do/i }));
    expect(screen.getByText(/Read scanned or image-only PDFs/i)).toBeInTheDocument();
    expect(screen.getByText(/There is no OCR in this release/i)).toBeInTheDocument();
    expect(screen.getByText(/Documents are assumed to be English/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Documents are shared with the whole workspace\. Conversations are private/i,
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Uploading documents/i }));
    expect(
      screen.getByText(/50MB per file, for every one of the five supported formats/i),
    ).toBeInTheDocument();
  });

  it("does not mention pricing, plans, invoices, payment or subscriptions", () => {
    const { container } = renderHelp();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\bpricing\b/i);
    expect(text).not.toMatch(/\bplan\b/i);
    expect(text).not.toMatch(/\binvoice\b/i);
    expect(text).not.toMatch(/\bpayment\b/i);
    expect(text).not.toMatch(/\bsubscription\b/i);
  });

  it("states admin rules: admins invite/remove members and delete any document, members delete only their own", async () => {
    const user = userEvent.setup();
    renderHelp();
    await user.click(screen.getByRole("switch", { name: /Show admin topics/i }));
    await user.click(screen.getByRole("tab", { name: /For admins/i }));

    expect(screen.getByText(/Admins invite and remove members/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /An admin may delete any document in the workspace; a member may delete only the documents they uploaded themselves/i,
      ),
    ).toBeInTheDocument();
  });
});
