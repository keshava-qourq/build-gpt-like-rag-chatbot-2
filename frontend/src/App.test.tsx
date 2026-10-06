import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import App from "./App";

describe("App", () => {
  it("renders without crashing and shows the first screen's nav link", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    // The sidebar nav link and the sign-in screen's own heading both read
    // "Sign in", so this asserts at least one rather than picking a single
    // (fragile) match.
    expect(screen.getAllByText("Sign in").length).toBeGreaterThan(0);
  });
});
