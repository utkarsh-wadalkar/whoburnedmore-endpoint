import { Analytics } from "@vercel/analytics/next";
import { Children, createElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, test } from "vitest";

import RootLayout from "../app/layout";

describe("Vercel Web Analytics", () => {
  test("mounts analytics once for every page through the root layout", () => {
    const layout = RootLayout({ children: createElement("main", null, "Page") });
    const body = layout.props.children as ReactElement<{ children: ReactNode }>;
    const bodyChildren = Children.toArray(body.props.children);

    expect(bodyChildren.filter((child) => (child as ReactElement).type === Analytics)).toHaveLength(1);
  });
});
