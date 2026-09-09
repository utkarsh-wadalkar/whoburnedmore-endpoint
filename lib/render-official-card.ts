import chromium from "@sparticuz/chromium-min";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

import { profileUrl, type CardStyle } from "./card";

const CARD_DOWNLOAD_KEY = "__whoburnedmoreCardDownload";
const MAX_CARD_BYTES = 12 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 30_000;
const CARD_TIMEOUT_MS = 20_000;

const ALLOWED_HOSTS = new Set([
  "whoburnedmore.com",
  "api.whoburnedmore.com",
  "avatars.githubusercontent.com",
  "lh3.googleusercontent.com",
  "randomuser.me",
  "storage.googleapis.com",
  "api.producthunt.com",
]);

let browserPromise: Promise<Browser> | undefined;

export class CardRenderError extends Error {
  constructor(
    public readonly kind: "not-found" | "unavailable",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CardRenderError";
  }
}

export type RenderedCard = {
  bytes: Uint8Array;
  contentType: "image/png";
};

export async function renderOfficialCard(handle: string, style: CardStyle): Promise<RenderedCard> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await configurePage(page);
    const response = await page.goto(profileUrl(handle), {
      waitUntil: "domcontentloaded",
      timeout: PAGE_TIMEOUT_MS,
    });

    if (response?.status() === 404) {
      throw new CardRenderError("not-found", "The public profile was not found.");
    }

    if (!response || response.status() >= 500) {
      throw new CardRenderError("unavailable", "The upstream profile could not be loaded.");
    }

    await waitForShareCard(page);
    await waitForCardAssets(page);
    await openShareDialog(page);
    await selectStyle(page, style);
    await installDownloadCapture(page);
    await clickDialogButton(page, "download");

    const dataUrl = await page.waitForFunction(
      (key) => {
        const value = (window as unknown as Window & Record<string, unknown>)[key];
        return typeof value === "string" && value.startsWith("data:image/") ? value : false;
      },
      { timeout: CARD_TIMEOUT_MS },
      CARD_DOWNLOAD_KEY,
    );

    const value = await dataUrl.jsonValue();
    if (typeof value !== "string") {
      throw new CardRenderError("unavailable", "The official image download did not complete.");
    }

    return decodePngDataUrl(value);
  } catch (error) {
    if (error instanceof CardRenderError) throw error;

    throw new CardRenderError("unavailable", "The official card renderer did not complete.", {
      cause: error,
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser();
    browserPromise.catch(() => {
      browserPromise = undefined;
    });
  }

  return browserPromise;
}

async function launchBrowser(): Promise<Browser> {
  const localExecutable = process.env.CHROME_EXECUTABLE_PATH;
  const isVercel = Boolean(process.env.VERCEL);

  if (!isVercel && !localExecutable) {
    throw new CardRenderError(
      "unavailable",
      "Set CHROME_EXECUTABLE_PATH to render cards outside Vercel.",
    );
  }

  const executablePath = localExecutable ?? (await chromium.executablePath(getChromiumPackUrl()));
  const args = localExecutable ? ["--no-sandbox", "--disable-setuid-sandbox"] : chromium.args;

  return puppeteer.launch({
    args,
    defaultViewport: {
      width: 1280,
      height: 1600,
      deviceScaleFactor: 2,
      isLandscape: false,
      isMobile: false,
      hasTouch: false,
    },
    executablePath,
    headless: true,
  });
}

function getChromiumPackUrl(): string {
  const configured = process.env.CHROMIUM_PACK_URL;
  if (configured) {
    const parsed = new URL(configured);
    if (parsed.protocol !== "https:") {
      throw new CardRenderError("unavailable", "CHROMIUM_PACK_URL must use HTTPS.");
    }
    return parsed.toString();
  }

  const deploymentUrl = process.env.VERCEL_URL;
  if (!deploymentUrl) {
    throw new CardRenderError(
      "unavailable",
      "CHROMIUM_PACK_URL is required outside a Vercel deployment.",
    );
  }

  return `https://${deploymentUrl}/chromium-pack.tar`;
}

async function configurePage(page: Page): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    try {
      const url = new URL(request.url());
      const permitted =
        url.protocol === "data:" ||
        url.protocol === "blob:" ||
        (url.protocol === "https:" &&
          (ALLOWED_HOSTS.has(url.hostname) || url.hostname.endsWith(".public.blob.vercel-storage.com")));

      void (permitted ? request.continue() : request.abort());
    } catch {
      void request.abort();
    }
  });
}

async function waitForShareCard(page: Page): Promise<void> {
  try {
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("button")).some((button) => {
          const text = (button.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
          const rect = button.getBoundingClientRect();
          const styles = getComputedStyle(button);
          return (
            text === "more cards" &&
            rect.width > 0 &&
            rect.height > 0 &&
            styles.display !== "none" &&
            styles.visibility !== "hidden" &&
            styles.pointerEvents !== "none"
          );
        }),
      { timeout: CARD_TIMEOUT_MS },
    );
  } catch {
    const text = await page.evaluate(() => document.body.innerText);
    if (/not found|does not exist|private profile/i.test(text)) {
      throw new CardRenderError("not-found", "The public profile was not found.");
    }
    throw new CardRenderError("unavailable", "The share-card controls were not available.");
  }
}

async function waitForCardAssets(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images).map((image) => {
        if (image.complete) return Promise.resolve();
        return new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        });
      }),
    );
  });
}

async function openShareDialog(page: Page): Promise<void> {
  await clickButtonByText(page, "body", "more cards");
  await page.waitForFunction(() => Boolean(document.querySelector('[role="dialog"]')), {
    timeout: CARD_TIMEOUT_MS,
  });
}

async function selectStyle(page: Page, style: CardStyle): Promise<void> {
  await clickDialogButton(page, style);
  await page.waitForFunction(
    (selectedStyle) => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return false;
      const button = Array.from(dialog.querySelectorAll("button")).find(
        (candidate) =>
          (candidate.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase() === selectedStyle,
      );
      return button?.getAttribute("aria-pressed") === "true";
    },
    { timeout: CARD_TIMEOUT_MS },
    style,
  );
  await waitForCardAssets(page);
}

async function installDownloadCapture(page: Page): Promise<void> {
  await page.evaluate((key) => {
    const windowWithCapture = window as unknown as Window & Record<string, unknown>;
    windowWithCapture[key] = null;

    const anchorPrototype = HTMLAnchorElement.prototype as HTMLAnchorElement & {
      __whoburnedmoreOriginalClick?: typeof HTMLAnchorElement.prototype.click;
    };
    if (!anchorPrototype.__whoburnedmoreOriginalClick) {
      anchorPrototype.__whoburnedmoreOriginalClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function clickWithCardCapture(this: HTMLAnchorElement) {
        if (this.download && this.href.startsWith("data:image/")) {
          windowWithCapture[key] = this.href;
        }
        return anchorPrototype.__whoburnedmoreOriginalClick!.call(this);
      };
    }

    const urlWithCapture = URL as typeof URL & { __whoburnedmoreOriginalCreateObjectUrl?: typeof URL.createObjectURL };
    if (!urlWithCapture.__whoburnedmoreOriginalCreateObjectUrl) {
      urlWithCapture.__whoburnedmoreOriginalCreateObjectUrl = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (object: Blob) => {
        if (object.type.startsWith("image/")) {
          const reader = new FileReader();
          reader.addEventListener("loadend", () => {
            if (typeof reader.result === "string") windowWithCapture[key] = reader.result;
          });
          reader.readAsDataURL(object);
        }
        return urlWithCapture.__whoburnedmoreOriginalCreateObjectUrl!(object);
      };
    }
  }, CARD_DOWNLOAD_KEY);
}

async function clickDialogButton(page: Page, label: string): Promise<void> {
  await clickButtonByText(page, '[role="dialog"]', label);
}

async function clickButtonByText(page: Page, rootSelector: string, label: string): Promise<void> {
  const buttons = await page.$$(`${rootSelector} button`);
  for (const button of buttons) {
    const buttonState = await button.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      return {
        text: (element.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase(),
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          styles.display !== "none" &&
          styles.visibility !== "hidden" &&
          styles.pointerEvents !== "none",
      };
    });
    if (buttonState.text === label && buttonState.visible) {
      await button.click();
      return;
    }
  }

  throw new CardRenderError("unavailable", `The ${label} button was not available.`);
}

function decodePngDataUrl(dataUrl: string): RenderedCard {
  const match = /^data:image\/png;base64,([a-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) {
    throw new CardRenderError("unavailable", "The upstream card was not a PNG image.");
  }

  const bytes = Buffer.from(match[1], "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CARD_BYTES) {
    throw new CardRenderError("unavailable", "The upstream card image was invalid.");
  }

  return { bytes, contentType: "image/png" };
}
