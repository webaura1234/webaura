import { expect, test, type Page } from "@playwright/test";
import type { SpinResponse } from "../../src/lib/segments";
import { SEGMENTS, segmentIndexOf } from "../../src/lib/segments";
import { randomIp, randomPhone, rowsForPhone } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

async function openForm(page: Page) {
  await page.goto("/?utm_source=e2e");
  await page.getByRole("button", { name: "Spin Now" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function fillLead(page: Page, name: string, phone: string) {
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("WhatsApp number").fill(phone);
}

/** The form's own error banner (Next.js also renders a hidden role=alert route announcer). */
const formAlert = (page: Page) => page.getByRole("dialog").getByRole("alert");

/** Which wedge is physically under the pointer tip, by hit-testing the rendered SVG. */
function wedgeUnderPointer(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const rotor = document.querySelector<HTMLElement>('[data-testid="wheel-rotor"]')!;
    rotor.scrollIntoView({ block: "center", behavior: "instant" });
    // The bounding rect of a rotated element grows with the angle, but its centre doesn't move;
    // offsetWidth is the unrotated size.
    const r = rotor.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // 150/200 of the radius out from the centre, straight up: inside the wedge, clear of labels and rim.
    const hit = document.elementFromPoint(cx, cy - rotor.offsetWidth * (150 / 400));
    return hit?.getAttribute("data-segment") ?? null;
  });
}

async function expectWedge(page: Page, id: string) {
  // The app smooth-scrolls to the coupon after the spin; poll until layout settles.
  await expect.poll(() => wedgeUnderPointer(page), { message: `wedge under pointer should be ${id}`, timeout: 5_000 }).toBe(id);
}

function mockSpin(page: Page, body: Partial<SpinResponse>) {
  const now = Date.now();
  const outcome = body.outcome ?? { id: "pct_20", label: "20% OFF", discountPct: 20 };
  const index = segmentIndexOf(outcome.id);
  const full: SpinResponse = {
    outcome,
    code: "WEBAURA-MOCK22",
    angle: 7 * 360 + (360 - (index * 45 + 22.5)),
    name: "Mock User",
    phoneMasked: "+91 ••••••4321",
    expiresAt: new Date(now + 48 * 3600_000).toISOString(),
    expired: false,
    serverNow: new Date(now).toISOString(),
    alreadySpun: false,
    ...body,
  };
  return page.route("**/api/spin", (route) => route.fulfill({ json: full }));
}

function hmsToSeconds(text: string) {
  const [h, m, s] = text.trim().split(":").map(Number);
  return h * 3600 + m * 60 + s;
}

test("layout: wheel centred, no horizontal scroll, CTA above the fold on phones", async ({ page, isMobile }) => {
  await page.goto("/");
  const { width: vw, height: vh } = page.viewportSize()!;
  const box = (await page.getByTestId("wheel").boundingBox())!;
  if (vw < 1024) {
    expect(Math.abs(box.x + box.width / 2 - vw / 2)).toBeLessThan(2);
  } else {
    // Two-column desktop layout: wheel sits in the right column, fully visible without scrolling.
    expect(box.x + box.width / 2).toBeGreaterThan(vw / 2);
    expect(box.y + box.height).toBeLessThanOrEqual(vh);
  }
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vw);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (isMobile) {
    const cta = (await page.getByRole("button", { name: "Spin Now" }).boundingBox())!;
    expect(cta.y + cta.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  }
});

test("layout holds on a 320px-wide phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  const box = (await page.getByTestId("wheel").boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - 160)).toBeLessThan(2);
  expect(box.width).toBeGreaterThan(250);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("empty or invalid input blocks the spin with a clear error and sends no request", async ({ page }) => {
  let calls = 0;
  page.on("request", (r) => r.url().includes("/api/spin") && calls++);
  await openForm(page);
  const submit = page.getByRole("button", { name: "Unlock & Spin" });

  await submit.click();
  await expect(page.getByText("Please enter your name")).toBeVisible();
  await expect(page.getByText("Enter a valid 10-digit Indian mobile")).toBeVisible();

  for (const phone of ["98765", "5876543210", "98765abcde", "987654321012"]) {
    await fillLead(page, "Valid Name", phone);
    await submit.click();
    await expect(page.getByText("Enter a valid 10-digit Indian mobile")).toBeVisible();
  }
  await fillLead(page, "     ", "9876543210");
  await submit.click();
  await expect(page.getByText("Please enter your name")).toBeVisible();

  expect(calls).toBe(0);
  await expect(page.getByTestId("wheel-rotor")).toHaveAttribute("style", /rotate\(0deg\)/);
});

test("full spin: lands on the server's segment, coupon + countdown + WhatsApp link all match", async ({ page, browserName }) => {
  const phone = randomPhone();
  const name = "Zoë D'Souza";
  await openForm(page);
  await fillLead(page, name, `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`);

  const responsePromise = page.waitForResponse("**/api/spin");
  await page.getByRole("button", { name: "Unlock & Spin" }).click();
  const api = (await (await responsePromise).json()) as SpinResponse;

  // Mid-spin: the CTA is disabled so a second request can't be triggered.
  const cta = page.getByRole("button", { name: /Spinning/ });
  await expect(cta).toBeDisabled();

  await expect(page.locator("code")).toHaveText(api.code, { timeout: 15_000 });
  await expectWedge(page, api.outcome.id);
  test.info().annotations.push({ type: "outcome", description: `${browserName}: ${api.outcome.id}` });

  const card = page.locator("section[aria-live]");
  if (api.outcome.discountPct === null) await expect(card).toContainText("Free Consultation");
  else await expect(card).toContainText(`${api.outcome.discountPct}%`);
  await expect(card).not.toContainText(/\b0% OFF|null|undefined/);

  const remaining = hmsToSeconds(await page.getByRole("timer").innerText());
  const expected = (Date.parse(api.expiresAt) - Date.parse(api.serverNow)) / 1000;
  expect(Math.abs(remaining - expected)).toBeLessThan(10);

  const href = (await page.getByRole("link", { name: /Claim on WhatsApp/ }).getAttribute("href"))!;
  const url = new URL(href);
  expect(url.host).toBe("wa.me");
  expect(url.pathname).toBe("/917288052098");
  const text = url.searchParams.get("text")!;
  expect(text).toContain(name);
  expect(text).toContain(api.code);
  expect(text).toContain(api.outcome.discountPct === null ? "Free Consultation" : `${api.outcome.discountPct}% OFF`);
  expect(text).toContain(phone.slice(-4));

  await expect(page.getByRole("button", { name: "Spin Now" })).toHaveCount(0);

  const [row] = rowsForPhone(`91${phone}`);
  expect(row.code).toBe(api.code);
  expect(row.outcome).toBe(api.outcome.id);
  expect(row.source).toBe("e2e");
});

test("double-click on submit sends exactly one request", async ({ page }) => {
  let calls = 0;
  page.on("request", (r) => r.url().includes("/api/spin") && calls++);
  await openForm(page);
  await fillLead(page, "Double Clicker", randomPhone());
  const box = (await page.getByRole("button", { name: "Unlock & Spin" }).boundingBox())!;
  // Raw mouse events: no actionability wait, so the second click lands even as the button disables.
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator("code")).toBeVisible({ timeout: 15_000 });
  expect(calls).toBe(1);
});

test("three submits in the same tick (before React re-renders) send exactly one request", async ({ page }) => {
  let calls = 0;
  page.on("request", (r) => r.url().includes("/api/spin") && calls++);
  await openForm(page);
  await fillLead(page, "Script Kiddie", randomPhone());
  await page.evaluate(() => {
    const form = document.querySelector("form")!;
    form.requestSubmit();
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(page.locator("code")).toBeVisible({ timeout: 15_000 });
  expect(calls).toBe(1);
});

test("result survives reload; clearing storage and resubmitting returns the same coupon", async ({ page }) => {
  const phone = randomPhone();
  await openForm(page);
  await fillLead(page, "Returning User", phone);
  await page.getByRole("button", { name: "Unlock & Spin" }).click();
  const code = await page.locator("code").innerText({ timeout: 15_000 });

  await page.reload();
  await expect(page.locator("code")).toHaveText(code);
  await expect(page.getByRole("button", { name: "Spin Now" })).toHaveCount(0);

  await page.evaluate(() => localStorage.clear());
  await page.context().clearCookies();
  await page.reload();
  await page.getByRole("button", { name: "Spin Now" }).click();
  await fillLead(page, "Returning User", `0${phone}`);
  await page.getByRole("button", { name: "Unlock & Spin" }).click();
  await expect(page.locator("code")).toHaveText(code, { timeout: 15_000 });
  await expect(page.getByText(/this number has already spun/)).toBeVisible();
  expect(rowsForPhone(`91${phone}`)).toHaveLength(1);
});

test("Spin again: back to the start with a clean form; new numbers spin, repeat numbers keep their coupon", async ({ page }) => {
  test.setTimeout(90_000);
  const first = randomPhone();
  await openForm(page);
  await fillLead(page, "First Visitor", first);
  await page.getByRole("button", { name: "Unlock & Spin" }).click();
  const firstCode = await page.locator("code").innerText({ timeout: 15_000 });

  await page.getByRole("button", { name: "Spin again" }).click();
  await expect(page.getByRole("button", { name: "Spin Now" })).toBeEnabled();
  await expect(page.locator("code")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("webaura-spin-v2"))).toBeNull();

  await page.getByRole("button", { name: "Spin Now" }).click();
  await expect(page.getByLabel("Your name")).toHaveValue("");
  await expect(page.getByLabel("WhatsApp number")).toHaveValue("");
  await fillLead(page, "Second Visitor", randomPhone());
  await page.getByRole("button", { name: "Unlock & Spin" }).click();
  const secondCode = await page.locator("code").innerText({ timeout: 15_000 });
  expect(secondCode).not.toBe(firstCode);
  await expect(page.getByText(/this number has already spun/)).toHaveCount(0);

  await page.getByRole("button", { name: "Spin again" }).click();
  await page.getByRole("button", { name: "Spin Now" }).click();
  await fillLead(page, "First Visitor", first);
  await page.getByRole("button", { name: "Unlock & Spin" }).click();
  await expect(page.locator("code")).toHaveText(firstCode, { timeout: 15_000 });
  await expect(page.getByText(/this number has already spun/)).toBeVisible();
  expect(rowsForPhone(`91${first}`)).toHaveLength(1);
});

test("server error: message shown, wheel never spins, user can retry", async ({ page }) => {
  await page.route("**/api/spin", (route) =>
    route.fulfill({ status: 503, json: { error: "We couldn't record your spin right now, so no coupon was issued." } }),
  );
  await openForm(page);
  await fillLead(page, "Error Case", randomPhone());
  await page.getByRole("button", { name: "Unlock & Spin" }).click();
  await expect(formAlert(page)).toContainText("no coupon was issued");
  await expect(page.getByRole("button", { name: "Unlock & Spin" })).toBeEnabled();
  await expect(page.getByTestId("wheel-rotor")).toHaveAttribute("style", /rotate\(0deg\)/);
  await expect(page.locator("code")).toHaveCount(0);

  await page.unroute("**/api/spin");
  await page.getByRole("button", { name: "Unlock & Spin" }).click();
  await expect(page.locator("code")).toBeVisible({ timeout: 15_000 });
});

test("network failure shows an error instead of a stuck wheel", async ({ page }) => {
  await page.route("**/api/spin", (route) => route.abort("internetdisconnected"));
  await openForm(page);
  await fillLead(page, "Offline Case", randomPhone());
  await page.getByRole("button", { name: "Unlock & Spin" }).click();
  await expect(formAlert(page)).toContainText(/Network error|taking too long/);
  await expect(page.getByTestId("wheel-rotor")).toHaveAttribute("style", /rotate\(0deg\)/);
});

test("a hung request times out with a message after 15s", async ({ page }) => {
  await page.clock.install();
  await page.route("**/api/spin", () => {
    /* never respond */
  });
  await openForm(page);
  await fillLead(page, "Slow Network", randomPhone());
  await page.getByRole("button", { name: "Unlock & Spin" }).click();
  await expect(page.getByRole("button", { name: /Getting your spin/ })).toBeVisible();
  await page.clock.fastForward(16_000);
  await expect(formAlert(page)).toContainText("taking too long");
  await expect(page.getByRole("button", { name: "Unlock & Spin" })).toBeEnabled();
});

test("Free Consultation shows its own wording and never '0% off'", async ({ page }) => {
  await mockSpin(page, { outcome: { id: "free_consult", label: "Free Consultation", discountPct: null } });
  await openForm(page);
  await fillLead(page, "Consult Winner", randomPhone());
  await page.getByRole("button", { name: "Unlock & Spin" }).click();
  const card = page.locator("section[aria-live]");
  await expect(card).toContainText("Free Consultation", { timeout: 15_000 });
  await expect(card).toContainText("free strategy call");
  await expect(card).not.toContainText(/%|null|undefined/);
  await expectWedge(page, "free_consult");
  const text = new URL((await page.getByRole("link", { name: /WhatsApp/ }).getAttribute("href"))!).searchParams.get("text")!;
  expect(text).toContain("Free Consultation");
  expect(text).not.toMatch(/0%|null/);
});

test("expired coupon: expired state and an expired-coupon WhatsApp message", async ({ page }) => {
  const past = Date.now() - 3600_000;
  await mockSpin(page, { alreadySpun: true, expired: true, expiresAt: new Date(past).toISOString() });
  await openForm(page);
  await fillLead(page, "Late Claimer", randomPhone());
  await page.getByRole("button", { name: "Unlock & Spin" }).click();
  await expect(page.getByText("This coupon has expired")).toBeVisible({ timeout: 15_000 });
  const link = page.getByRole("link", { name: "Message us on WhatsApp" });
  await expect(link).toBeVisible();
  const text = new URL((await link.getAttribute("href"))!).searchParams.get("text")!;
  expect(text).toContain("expired on");
  expect(text).not.toContain("I'd like to claim it");
});

test("countdown follows the server clock even if the phone's clock is wrong", async ({ page }) => {
  const deviceNow = Date.now();
  const serverNow = deviceNow + 2 * 3600_000; // phone is 2h behind
  await mockSpin(page, {
    serverNow: new Date(serverNow).toISOString(),
    expiresAt: new Date(serverNow + 48 * 3600_000).toISOString(),
  });
  await openForm(page);
  await fillLead(page, "Skewed Clock", randomPhone());
  await page.getByRole("button", { name: "Unlock & Spin" }).click();
  const remaining = hmsToSeconds(await page.getByRole("timer").innerText({ timeout: 15_000 }));
  expect(Math.abs(remaining - 48 * 3600)).toBeLessThan(15);
});

test("every segment renders at its expected wheel position", async ({ page }) => {
  test.setTimeout(180_000);
  // Drive the real wheel to each segment via mocked responses and hit-test it.
  for (const segment of SEGMENTS) {
    await page.unroute("**/api/spin").catch(() => {});
    await mockSpin(page, { outcome: { id: segment.id, label: segment.label, discountPct: segment.discountPct } });
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByRole("button", { name: "Spin Now" }).click();
    await fillLead(page, "Segment Check", randomPhone());
    await page.getByRole("button", { name: "Unlock & Spin" }).click();
    await expect(page.locator("code")).toBeVisible({ timeout: 15_000 });
    await expectWedge(page, segment.id);
  }
});
