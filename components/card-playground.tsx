"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

const styles = [
  { id: "landscape", label: "Landscape" },
  { id: "hero", label: "Hero" },
  { id: "report", label: "Report" },
] as const;

type CardStyle = (typeof styles)[number]["id"];

type PreparedCardPreviews = Record<CardStyle, string>;

export async function prepareCardPreviews({
  handle,
  signal,
  fetcher = fetch,
  cacheBuster = Date.now,
  createObjectUrl = (blob) => URL.createObjectURL(blob),
  revokeObjectUrl = (url) => URL.revokeObjectURL(url),
  decodeImage = decodeImageUrl,
}: {
  handle: string;
  signal: AbortSignal;
  fetcher?: typeof fetch;
  cacheBuster?: () => number;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  decodeImage?: (url: string, signal: AbortSignal) => Promise<void>;
}): Promise<PreparedCardPreviews> {
  const entries = await Promise.all(
    styles.map(async ({ id: style }) => {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const response = await fetcher("/api/card/prepare", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ handle, style }),
          cache: "no-store",
          signal,
        });
        const payload = (await response.json()) as {
          status?: string;
          imageUrl?: string;
          retryAfter?: number;
          error?: string;
        };

        if (response.status === 202 && payload.status === "preparing") {
          await wait(Math.max(1, payload.retryAfter ?? 2) * 1000, signal);
          continue;
        }
        if (!response.ok || payload.status !== "ready" || !payload.imageUrl) {
          throw new Error(payload.error || `The ${style} card could not be prepared.`);
        }

        const imageResponse = await fetcher(`${payload.imageUrl}?preview=${cacheBuster()}`, {
          cache: "no-store",
          signal,
        });
        const bytes = new Uint8Array(await imageResponse.arrayBuffer());
        if (
          !imageResponse.ok ||
          imageResponse.headers.get("content-type")?.split(";", 1)[0] !== "image/png" ||
          !hasPngSignature(bytes)
        ) {
          throw new Error(`The durable ${style} card URL did not return a valid PNG.`);
        }

        return [style, bytes] as const;
      }

      throw new Error(`The ${style} card is still being prepared.`);
    }),
  );

  const objectUrls = Object.fromEntries(
    entries.map(([style, bytes]) => [
      style,
      createObjectUrl(new Blob([bytes], { type: "image/png" })),
    ]),
  ) as PreparedCardPreviews;

  try {
    await Promise.all(styles.map(({ id }) => decodeImage(objectUrls[id], signal)));
    return objectUrls;
  } catch (error) {
    Object.values(objectUrls).forEach(revokeObjectUrl);
    throw error;
  }
}

function normalizeHandle(value: string) {
  return value.trim().replace(/^@/, "").replace(/[^a-zA-Z0-9_-]/g, "");
}

export function CardPlayground({ baseUrl, initialHandle }: { baseUrl: string; initialHandle: string }) {
  const [handleInput, setHandleInput] = useState(initialHandle);
  const [submittedHandle, setSubmittedHandle] = useState(initialHandle);
  const [style, setStyle] = useState<CardStyle>("landscape");
  const [prepareKey, setPrepareKey] = useState(0);
  const [previewImageUrls, setPreviewImageUrls] = useState<Partial<Record<CardStyle, string>>>({});
  const [imageState, setImageState] = useState<"preparing" | "ready" | "error">("preparing");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "unavailable">("idle");

  const handle = normalizeHandle(submittedHandle) || initialHandle;
  const imageUrl = useMemo(() => `${baseUrl}/api/card/${handle}/${style}.png`, [baseUrl, handle, style]);
  const previewImageUrl = previewImageUrls[style] ?? null;
  const canCopy = imageState === "ready" && previewImageUrl !== null;

  useEffect(() => {
    const controller = new AbortController();
    const objectUrls: string[] = [];

    async function prepare() {
      setPreviewImageUrls({});
      setImageState("preparing");
      setCopyState("idle");

      try {
        const previews = await prepareCardPreviews({ handle, signal: controller.signal });
        objectUrls.push(...Object.values(previews));
        setPreviewImageUrls(previews);
        setImageState("ready");
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Card preparation failed", error);
          setImageState("error");
        }
      }
    }

    void prepare();
    return () => {
      controller.abort();
      objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
    };
  }, [handle, prepareKey]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittedHandle(normalizeHandle(handleInput) || initialHandle);
    setPrepareKey((value) => value + 1);
    setImageState("preparing");
    setCopyState("idle");
  }

  function selectStyle(nextStyle: CardStyle) {
    setStyle(nextStyle);
    setCopyState("idle");
  }

  async function copyUrl() {
    if (!canCopy) return;

    try {
      await navigator.clipboard.writeText(imageUrl);
      setCopyState("copied");
    } catch {
      setCopyState("unavailable");
    }
  }

  return (
    <div className="playground-bezel">
      <div className="playground-core">
        <form className="handle-form" onSubmit={submit}>
          <label htmlFor="handle">WhoBurnedMore handle</label>
          <div className="handle-control">
            <span aria-hidden="true">@</span>
            <input
              autoCapitalize="none"
              autoComplete="off"
              id="handle"
              name="handle"
              onChange={(event) => setHandleInput(event.target.value)}
              placeholder="your-handle"
              spellCheck={false}
              value={handleInput}
            />
            <button type="submit">Preview</button>
          </div>
          <p>Public profiles only. Use letters, numbers, hyphens, and underscores.</p>
        </form>

        <div aria-label="Card format" className="style-picker" role="group">
          {styles.map((item) => (
            <button
              aria-pressed={style === item.id}
              className={style === item.id ? "is-selected" : undefined}
              key={item.id}
              onClick={() => selectStyle(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className={`card-stage card-stage-${style}`}>
          {imageState === "preparing" ? (
            <>
              <span className="image-skeleton" />
              <p className="preview-loading" role="status">
                Preparing all three durable cards…
              </p>
            </>
          ) : null}
          {previewImageUrl ? (
            <img
              alt={`Official WhoBurnedMore ${style} card for ${handle}`}
              className="is-ready"
              height={630}
              key={previewImageUrl}
              loading="eager"
              onError={() => setImageState("error")}
              src={previewImageUrl}
              width={1200}
            />
          ) : null}
          {imageState === "error" ? (
            <p className="preview-error" role="status">
              This profile could not return a card. Check that the handle is public and try again.
            </p>
          ) : null}
        </div>

        <div className="url-output">
          <code>{imageUrl}</code>
          <button disabled={!canCopy} onClick={copyUrl} type="button">
            {copyState === "copied" ? "Copied" : canCopy ? "Copy URL" : "Preparing…"}
          </button>
        </div>
        <p aria-live="polite" className="copy-status">
          {copyState === "unavailable"
            ? "Clipboard access is unavailable. Select the URL to copy it."
            : imageState === "preparing"
              ? "All three URLs unlock after the durable images are prepared and verified."
              : ""}
        </p>
      </div>
    </div>
  );
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function decodeImageUrl(url: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      image.onload = null;
      image.onerror = null;
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    image.onload = () => {
      cleanup();
      resolve();
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("The browser could not decode a prepared card image."));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    image.src = url;
  });
}

function hasPngSignature(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 8 &&
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71 &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10
  );
}
