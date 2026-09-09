"use client";

import { FormEvent, useMemo, useState } from "react";

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
  const [imageState, setImageState] = useState<"loading" | "ready" | "error">("loading");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "unavailable">("idle");

  const handle = normalizeHandle(submittedHandle) || initialHandle;
  const imageUrl = useMemo(() => `${baseUrl}/api/card/${handle}/${style}.png`, [baseUrl, handle, style]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittedHandle(normalizeHandle(handleInput) || initialHandle);
    setImageState("loading");
    setCopyState("idle");
  }

  function selectStyle(nextStyle: CardStyle) {
    setStyle(nextStyle);
    setImageState("loading");
    setCopyState("idle");
  }

  async function copyUrl() {
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
          {imageState === "loading" ? <span className="image-skeleton" /> : null}
          <img
            alt={`Official WhoBurnedMore ${style} card for ${handle}`}
            className={imageState === "ready" ? "is-ready" : undefined}
            height={630}
            key={imageUrl}
            loading="lazy"
            onError={() => setImageState("error")}
            onLoad={() => setImageState("ready")}
            src={imageUrl}
            width={1200}
          />
          {imageState === "error" ? (
            <p className="preview-error" role="status">
              This profile could not return a card. Check that the handle is public and try again.
            </p>
          ) : null}
        </div>

        <div className="url-output">
          <code>{imageUrl}</code>
          <button onClick={copyUrl} type="button">
            {copyState === "copied" ? "Copied" : "Copy URL"}
          </button>
        </div>
        <p aria-live="polite" className="copy-status">
          {copyState === "unavailable" ? "Clipboard access is unavailable. Select the URL to copy it." : ""}
        </p>
      </div>
    </div>
  );
}
