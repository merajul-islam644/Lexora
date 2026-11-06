// @vitest-environment jsdom
/* Automated axe scan (spec §20): the public landing page (shell + sections)
   and two app pages in their error states — the states every visitor can
   reach when the data layer is unreachable. The api module is stubbed so the
   pages fail fast and render their ErrorNote path without any network. */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { axe, toHaveNoViolations } from "jest-axe";
import { Landing } from "../../src/web/pages/Public.js";
import { PublicLayout } from "../../src/web/Layout.js";
import { Practice } from "../../src/web/pages/Practice.js";
import { GrammarWorkspace } from "../../src/web/pages/Grammar.js";

expect.extend(toHaveNoViolations);

vi.mock("../../src/web/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/web/api.js")>();
  const offline = async () => {
    throw new Error("offline (a11y test)");
  };
  return { ...actual, api: { get: offline, post: offline, patch: offline, del: offline } };
});

const workspace = { id: "ws-a11y", name: "A11y Workspace", role: "owner" };

function at(path: string, ui: React.ReactElement) {
  return (
    <MemoryRouter initialEntries={[path]}>
      {ui}
    </MemoryRouter>
  );
}

/* App pages always render inside AppShell's <main>; mirror that landmark here
   so the axe "region" rule sees the same structure as the deployed app. */
function shellMain(ui: React.ReactElement) {
  return (
    <MemoryRouter>
      <main id="main-content">{ui}</main>
    </MemoryRouter>
  );
}

afterEach(cleanup);

describe("a11y: axe scans (spec §20)", () => {
  it("public landing (header, sections, footer) has no axe violations", async () => {
    const { container } = render(at("/", <PublicLayout><Landing /></PublicLayout>));
    expect(await axe(container.innerHTML)).toHaveNoViolations();
  });

  it("practice page error state has no axe violations", async () => {
    const { container } = render(shellMain(<Practice workspace={workspace} />));
    // Wait for the load promise to settle into the ErrorNote render.
    await new Promise((r) => setTimeout(r, 50));
    expect(container.textContent).toContain("offline");
    expect(await axe(container.innerHTML)).toHaveNoViolations();
  });

  it("grammar workspace error state has no axe violations", async () => {
    const { container } = render(shellMain(<GrammarWorkspace workspace={workspace} />));
    await new Promise((r) => setTimeout(r, 50));
    expect(container.textContent).toContain("offline");
    expect(await axe(container.innerHTML)).toHaveNoViolations();
  });
});
