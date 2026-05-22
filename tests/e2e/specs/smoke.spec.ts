import { browser, $, expect } from "@wdio/globals";

describe("CCShell smoke", () => {
  it("renders the layout", async () => {
    await browser.pause(1000);
    const layout = await $(".layout");
    await expect(layout).toBeDisplayed();
  });

  it("opens a new session via ⌘N", async () => {
    await browser.keys(["Meta", "n"]);
    await browser.pause(500);
    const sessionList = await $$(".pane .section-label=Sessions");
    await expect(sessionList.length).toBeGreaterThan(0);
  });
});
