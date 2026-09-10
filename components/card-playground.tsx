"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

const styles = [
  { id: "landscape", label: "Landscape" },
  { id: "hero", label: "Hero" },
  { id: "report", label: "Report" },
] as const;

type CardStyle = (typeof styles)[number]["id"];

function normalizeHandle(value: string) {
  return value.trim().replace(/^@/, "").replace(/[^a-zA-Z0-9_-]/g, "");
}

export function CardPlayground({ baseUrl, initialHandle }: { baseUrl: string; initialHandle: string }) {
  const [handleInput, setHandleInput] = useState(initialHandle);
  const [submittedHandle, setSubmittedHandle] = useState(initialHandle);
  const [style, setStyle] = useState<CardStyle>("landscape");
  const [prepareKey, setPrepareKey] = useState(0);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [imageState, setImageState] = useState<"preparing" | "loading" | "ready" | "error">("preparing");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "unavailable">("idle");

  const handle = normalizeHandle(submittedHandle) || initialHandle;
  const imageUrl = useMemo(() => `${baseUrl}/api/card/${handle}/${style}.png`, [baseUrl, handle, style]);
  const canCopy = imageState === "ready";

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;

    async function prepare() {
      setPreviewImageUrl(null);
      setImageState("preparing");
      setCopyState("idle");

      try {
        for (let attempt = 0; attempt < 30; attempt += 1) {
          const response = await fetch("/api/card/prepare", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ handle, style }),
            cache: "no-store",
            signal: controller.signal,
          });
          const payload = (await response.json()) as {
            status?: string;
            imageUrl?: string;
            retryAfter?: number;
            error?: string;
          };

          if (response.status === 202 && payload.status === "preparing") {
            await wait(Math.max(1, payload.retryAfter ?? 2) * 1000, controller.signal);
            continue;
          }
          if (!response.ok || payload.status !== "ready" || !payload.imageUrl) {
            throw new Error(payload.error || "The card could not be prepared.");
          }

          const imageResponse = await fetch(`${payload.imageUrl}?preview=${Date.now()}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          const bytes = new Uint8Array(await imageResponse.arrayBuffer());
          if (
            !imageResponse.ok ||
            imageResponse.headers.get("content-type")?.split(";", 1)[0] !== "image/png" ||
            !hasPngSignature(bytes)
          ) {
            throw new Error("The durable card URL did not return a valid PNG.");
          }

          objectUrl = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
          setPreviewImageUrl(objectUrl);
          setImageState("loading");
          return;
        }
        throw new Error("The card is still being prepared.");
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
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [handle, style, prepareKey]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittedHandle(normalizeHandle(handleInput) || initialHandle);
    setPrepareKey((value) => value + 1);
    setImageState("preparing");
    setCopyState("idle");
  }

  function selectStyle(nextStyle: CardStyle) {
    setStyle(nextStyle);
    setPrepareKey((value) => value + 1);
    setImageState("preparing");
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
          {imageState === "preparing" || imageState === "loading" ? (
            <>
              <span className="image-skeleton" />
              <p className="preview-loading" role="status">
                {imageState === "preparing" ? "Preparing a durable card…" : "Verifying the live PNG…"}
              </p>
            </>
          ) : null}
          {previewImageUrl ? (
            <img
              alt={`Official WhoBurnedMore ${style} card for ${handle}`}
              className={imageState === "ready" ? "is-ready" : undefined}
              height={630}
              key={previewImageUrl}
              loading="eager"
              onError={() => setImageState("error")}
              onLoad={() => setImageState("ready")}
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
            : imageState === "preparing" || imageState === "loading"
              ? "The URL unlocks after the durable image is prepared and verified."
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
