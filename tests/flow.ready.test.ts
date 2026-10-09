import { describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { FlowPage } from "../src/flow/page.js";
import { LoginRequiredError } from "../src/errors.js";

describe("Flow dashboard readiness", () => {
  it.each(["addNew project", "addNovo projeto"])("recognizes a signed-in dashboard with %s", async (label) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const url = "https://flow.example.test/";
      await page.route(url, route => route.fulfill({
        contentType: "text/html",
        body: `<button>${label}</button>`
      }));
      const flow = new FlowPage(page, url);
      await flow.open();
      await expect(flow.assertReady()).resolves.toBeUndefined();
    } finally {
      await browser.close();
    }
  });

  it("rejects a signed-out page even when a hidden dashboard button exists", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent('<button hidden>addNovo projeto</button><a>Sign in</a>');
      await expect(new FlowPage(page).assertReady()).rejects.toBeInstanceOf(LoginRequiredError);
    } finally {
      await browser.close();
    }
  });
});
