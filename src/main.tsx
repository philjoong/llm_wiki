import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";

function setBootStatus(message: string, data?: unknown) {
  const root = document.getElementById("root");
  if (!root) return;
  if (root.dataset.reactRendered === "true") return;
  root.setAttribute("style", "font-family: sans-serif; padding: 24px; white-space: pre-wrap;");
  root.textContent = data === undefined ? message : `${message}\n\n${formatDebugData(data)}`;
}

function debug(message: string, data?: unknown) {
  const suffix = data === undefined ? "" : ` ${formatDebugData(data)}`;
  const line = `${message}${suffix}`;
  console.log(`[app-debug] ${line}`);
  setBootStatus(`LLM Wiki booting: ${message}`, data);
  invoke("app_debug", { message: line }).catch((err) => {
    console.warn("[app-debug] failed to write to Tauri terminal:", err);
  });
}

function formatDebugData(data: unknown) {
  if (data instanceof Error) {
    return `${data.name}: ${data.message}\n${data.stack ?? ""}`;
  }
  if (typeof data === "string") {
    return data;
  }
  if (
    data &&
    typeof data === "object" &&
    "reason" in data &&
    Object.prototype.toString.call(data).includes("PromiseRejectionEvent")
  ) {
    return formatDebugData((data as PromiseRejectionEvent).reason);
  }
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

window.addEventListener("error", (event) => {
  debug("window-error", {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  debug("unhandled-rejection", event);
});

async function boot() {
  debug("main: module loaded");

  try {
    debug("main: before import index.css");
    await import("./index.css");
    debug("main: after import index.css");

    debug("main: before import i18n");
    await import("@/i18n");
    debug("main: after import i18n");

    debug("main: before import App");
    const { default: App } = await import("./App");
    debug("main: after import App");

    const rootElement = document.getElementById("root");
    if (!rootElement) {
      throw new Error("Root element #root was not found");
    }

    debug("main: before React render");
    rootElement.removeAttribute("style");
    rootElement.textContent = "";
    rootElement.dataset.reactRendered = "true";
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
    debug("main: after React render");
  } catch (err) {
    console.error("[app-debug] boot failed:", err);
    debug("main: boot failed", err);
  }
}

void boot();
