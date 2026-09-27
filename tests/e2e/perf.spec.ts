import { expect, test } from "@playwright/test";
import { randomIp } from "./helpers";

test.skip(({ browserName }) => browserName !== "chromium", "CDP throttling is Chromium-only");

test("throttled mid-range phone on 3G-like network: fast paint, small JS, quick to interactive", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  await page.addInitScript(() => {
    (window as unknown as { __lcp: number }).__lcp = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) (window as unknown as { __lcp: number }).__lcp = e.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  });

  await page.goto("/", { waitUntil: "load" });
  // Interactive = React has attached handlers to the CTA.
  await page.waitForFunction(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Spin Now"));
    return !!btn && Object.keys(btn).some((k) => k.startsWith("__reactProps"));
  });
  const interactiveAt = await page.evaluate(() => performance.now());

  const m = await page.evaluate(() => {
    const paint = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const js = resources.filter((r) => r.initiatorType === "script" || r.name.endsWith(".js"));
    return {
      fcp: Math.round(paint),
      lcp: Math.round((window as unknown as { __lcp: number }).__lcp),
      jsKB: Math.round(js.reduce((s, r) => s + r.transferSize, 0) / 1024),
      jsFiles: js.length,
      confettiPreloaded: js.some((r) => r.name.includes("confetti")),
    };
  });
  console.log(`[4× CPU, 1.6 Mbps/150ms] FCP ${m.fcp}ms · LCP ${m.lcp}ms · interactive ${Math.round(interactiveAt)}ms · JS ${m.jsKB} KB in ${m.jsFiles} files`);

  expect(m.fcp).toBeLessThan(2500);
  expect(m.lcp).toBeLessThan(4000);
  expect(interactiveAt).toBeLessThan(5000);
  expect(m.jsKB).toBeLessThan(250);
  expect(m.confettiPreloaded, "confetti should be lazy-loaded").toBe(false);
});

test("spin animation stays smooth at 6× CPU slowdown (low-end Android)", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  await page.route("**/api/spin", (route) =>
    route.fulfill({
      json: {
        outcome: { id: "pct_20", label: "20% OFF", discountPct: 20 },
        code: "WEBAURA-PERF22",
        angle: 7 * 360 + (360 - (6 * 45 + 22.5)),
        name: "Perf Test",
        phoneMasked: "+91 ••••••0000",
        expiresAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
        expired: false,
        serverNow: new Date().toISOString(),
        alreadySpun: false,
      },
    }),
  );
  await page.goto("/");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });

  await page.getByRole("button", { name: "Spin Now" }).click();
  await page.getByLabel("Your name").fill("Perf Test");
  await page.getByLabel("WhatsApp number").fill("9876543210");

  // Record frame intervals for exactly the lifetime of the wheel's spin animation, so the
  // modal closing before it and the confetti/result card after it aren't counted as spin jank.
  const measured = page.evaluate(
    () =>
      new Promise<{ property: string; frames: number[] }>((resolve) => {
        const findSpin = () => {
          const a = document.getAnimations().find((x) => {
            const target = (x.effect as KeyframeEffect | null)?.target;
            return target instanceof HTMLElement && target.dataset.testid === "wheel-rotor";
          });
          if (!a) return requestAnimationFrame(findSpin);
          const frames: number[] = [];
          let last = -1;
          let done = false;
          const property = Object.keys((a.effect as KeyframeEffect).getKeyframes()[0]).includes("transform") ? "transform" : "?";
          a.finished.then(() => {
            done = true;
            resolve({ property, frames: frames.slice(2) });
          });
          const tick = (t: number) => {
            if (done) return;
            if (last >= 0) frames.push(t - last);
            last = t;
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        };
        findSpin();
      }),
  );
  await page.getByRole("button", { name: "Unlock & Spin" }).click();
  const { property, frames } = await measured;
  expect(property).toBe("transform");
  await expect(page.locator("code")).toBeVisible({ timeout: 20_000 });
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const long = frames.filter((f) => f > 50).length;
  const avgFps = 1000 / (frames.reduce((a, b) => a + b, 0) / frames.length);
  console.log(`[6× CPU] ${frames.length} frames · avg ${avgFps.toFixed(1)} fps · p95 ${p95.toFixed(1)}ms · ${long} frames >50ms`);

  expect(long / frames.length).toBeLessThan(0.05);
  expect(p95).toBeLessThan(40);
});
