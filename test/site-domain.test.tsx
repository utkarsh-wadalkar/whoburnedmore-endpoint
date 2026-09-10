import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import DocsPage from "../app/docs/page";
import Home from "../app/page";

describe("public production URLs", () => {
  test("homepage and docs publish card endpoints on wbm-card.vercel.app", () => {
    const homepage = renderToStaticMarkup(createElement(Home));
    const docs = renderToStaticMarkup(createElement(DocsPage));

    expect(homepage).toContain(
      "https://wbm-card.vercel.app/api/card/utkarsh-wadalkar/landscape.png",
    );
    expect(docs).toContain(
      "https://wbm-card.vercel.app/api/card/PROFILE-USERNAME/landscape.png",
    );
    expect(`${homepage}${docs}`).not.toContain("whoburnedmore-card.vercel.app");
  });
});
