import { useState } from "react"
import { useTranslation } from "react-i18next"
import { open } from "@tauri-apps/plugin-dialog"
import { HelpCircle, Upload, Link2, CheckCircle2, Loader2 } from "lucide-react"
import type { InformationRequest } from "@/lib/json-answer"

/**
 * How a single back-question was resolved in this conversation. `answered`
 * and `unavailable` collapse the form to a status line; `ingesting` shows a
 * spinner until the enqueued file/link ingest drains, then flips to the
 * "반영 완료 — 다시 질문" badge (Step 11 §5).
 */
export interface InfoRequestResolution {
  state: "answered" | "unavailable" | "ingesting" | "ingestDone"
  /** Ingest task ids to watch (file/link answers). */
  taskIds?: string[]
}

export interface InfoFormsProps {
  /** Validated requests parsed from the answer's information_requests key. */
  requests: InformationRequest[]
  /** Resolution state per info_key (owned by the parent, conversation-scoped). */
  resolutions: Record<string, InfoRequestResolution>
  /** Submit a text/choice answer as a user message tagged with the info_key. */
  onAnswer: (infoKey: string, answer: string) => void
  /** Mark this info_key unavailable (closes the ask-loop). */
  onUnavailable: (infoKey: string) => void
  /** Answer a link request (fetch+ingest); parent watches the returned task. */
  onLink: (infoKey: string, url: string) => void
  /** Answer a file request with already-picked absolute paths. */
  onFile: (infoKey: string, paths: string[]) => void
  /** Re-send the original question once ingest completed (§5). */
  onResend: () => void
  /** Project root, needed only to seed the file picker's default dir. */
  projectPath?: string
  disabled?: boolean
}

/**
 * Inline back-question forms rendered under an answer card (Step 11). Each
 * request gets an input matching its `input_type` plus a mandatory
 * "없음/모름" button. Non-blocking: the user may ignore these and just chat.
 */
export function ChatInfoForms({
  requests,
  resolutions,
  onAnswer,
  onUnavailable,
  onLink,
  onFile,
  onResend,
  projectPath,
  disabled,
}: InfoFormsProps) {
  const { t } = useTranslation()
  if (requests.length === 0) return null
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/20 p-2 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        <HelpCircle className="h-3.5 w-3.5" />
        {t("chat.info.title")}
      </div>
      {requests.map((req) => (
        <InfoRequestRow
          key={req.infoKey}
          req={req}
          resolution={resolutions[req.infoKey]}
          onAnswer={onAnswer}
          onUnavailable={onUnavailable}
          onLink={onLink}
          onFile={onFile}
          onResend={onResend}
          projectPath={projectPath}
          disabled={disabled}
        />
      ))}
    </div>
  )
}

function InfoRequestRow({
  req,
  resolution,
  onAnswer,
  onUnavailable,
  onLink,
  onFile,
  onResend,
  projectPath,
  disabled,
}: {
  req: InformationRequest
  resolution?: InfoRequestResolution
} & Omit<InfoFormsProps, "requests" | "resolutions">) {
  const { t } = useTranslation()

  // Once resolved, collapse to a status line (with an ingest badge for
  // file/link answers — Step 11 §5).
  if (resolution) {
    return <ResolvedRow req={req} resolution={resolution} onResend={onResend} />
  }

  return (
    <div className="rounded border border-border/60 bg-background/60 p-2 space-y-1.5">
      <div className="text-xs text-foreground">{req.question || req.infoKey}</div>
      {req.reason && <div className="text-[10px] text-muted-foreground">{req.reason}</div>}
      <InfoInput
        req={req}
        onAnswer={onAnswer}
        onLink={onLink}
        onFile={onFile}
        projectPath={projectPath}
        disabled={disabled}
      />
      <button
        type="button"
        onClick={() => onUnavailable(req.infoKey)}
        disabled={disabled}
        className="text-[11px] text-muted-foreground hover:text-foreground underline disabled:opacity-50"
      >
        {t("chat.info.unavailable")}
      </button>
    </div>
  )
}

function ResolvedRow({
  req,
  resolution,
  onResend,
}: {
  req: InformationRequest
  resolution: InfoRequestResolution
  onResend: () => void
}) {
  const { t } = useTranslation()
  const label =
    resolution.state === "unavailable"
      ? t("chat.info.markedUnavailable")
      : resolution.state === "ingesting"
        ? t("chat.info.ingesting")
        : resolution.state === "ingestDone"
          ? t("chat.info.ingestDone")
          : t("chat.info.answered")

  return (
    <div className="flex items-center gap-1.5 rounded border border-border/50 bg-background/40 px-2 py-1 text-[11px] text-muted-foreground">
      {resolution.state === "ingesting" ? (
        <Loader2 className="h-3 w-3 animate-spin shrink-0" />
      ) : (
        <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
      )}
      <span className="truncate">{req.infoKey}: {label}</span>
      {resolution.state === "ingestDone" && (
        <button
          type="button"
          onClick={onResend}
          className="ml-auto rounded bg-primary/10 px-1.5 py-0.5 text-primary hover:bg-primary/20"
        >
          {t("chat.info.resend")}
        </button>
      )}
    </div>
  )
}

/** The input widget for a single request, chosen by input_type. */
function InfoInput({
  req,
  onAnswer,
  onLink,
  onFile,
  projectPath,
  disabled,
}: {
  req: InformationRequest
} & Pick<InfoFormsProps, "onAnswer" | "onLink" | "onFile" | "projectPath" | "disabled">) {
  const { t } = useTranslation()
  const [text, setText] = useState("")
  const [choice, setChoice] = useState<string>("")
  const [otherText, setOtherText] = useState("")

  if (req.inputType === "choice") {
    const isOther = choice === "__other__"
    const value = isOther ? otherText.trim() : choice
    return (
      <div className="space-y-1">
        {req.options.map((opt) => (
          <label key={opt} className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="radio"
              name={`info-${req.infoKey}`}
              checked={choice === opt}
              onChange={() => setChoice(opt)}
              disabled={disabled}
              className="h-3 w-3"
            />
            <span>{opt}</span>
          </label>
        ))}
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            type="radio"
            name={`info-${req.infoKey}`}
            checked={isOther}
            onChange={() => setChoice("__other__")}
            disabled={disabled}
            className="h-3 w-3"
          />
          <span>{t("chat.info.otherOption")}</span>
        </label>
        {isOther && (
          <input
            type="text"
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            placeholder={t("chat.info.textPlaceholder")}
            disabled={disabled}
            className="w-full rounded border bg-background px-2 py-1 text-xs"
          />
        )}
        <SubmitButton
          disabled={disabled || !value}
          onClick={() => value && onAnswer(req.infoKey, value)}
        />
      </div>
    )
  }

  if (req.inputType === "link") {
    return (
      <div className="flex items-center gap-1">
        <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("chat.info.linkPlaceholder")}
          disabled={disabled}
          className="flex-1 rounded border bg-background px-2 py-1 text-xs"
        />
        <SubmitButton
          disabled={disabled || !text.trim()}
          onClick={() => text.trim() && onLink(req.infoKey, text.trim())}
        />
      </div>
    )
  }

  if (req.inputType === "file") {
    return (
      <button
        type="button"
        onClick={async () => {
          const selected = await open({
            multiple: true,
            defaultPath: projectPath ? `${projectPath}/raw/sources` : undefined,
            title: t("chat.info.chooseFile"),
            filters: [{ name: "All Files", extensions: ["*"] }],
          })
          if (!selected) return
          const paths = Array.isArray(selected) ? selected : [selected]
          if (paths.length > 0) onFile(req.infoKey, paths)
        }}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded border bg-background px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
      >
        <Upload className="h-3 w-3" />
        {t("chat.info.chooseFile")}
      </button>
    )
  }

  // text (default)
  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("chat.info.textPlaceholder")}
        disabled={disabled}
        className="flex-1 rounded border bg-background px-2 py-1 text-xs"
      />
      <SubmitButton
        disabled={disabled || !text.trim()}
        onClick={() => text.trim() && onAnswer(req.infoKey, text.trim())}
      />
    </div>
  )
}

function SubmitButton({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="shrink-0 rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
    >
      {t("chat.info.submit")}
    </button>
  )
}
