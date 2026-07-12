export const KNOWLEDGE_ERROR_CODES = [
  "SCHEMA_VERSION_MISMATCH", "VALIDATION_FAILED", "NOT_FOUND", "CARDINALITY_CONFLICT", "ATOMIC_WRITE_RECOVERY_REQUIRED",
] as const
export type KnowledgeErrorCode = (typeof KNOWLEDGE_ERROR_CODES)[number]

const USER_MESSAGES: Record<KnowledgeErrorCode, string> = {
  SCHEMA_VERSION_MISMATCH: "이 프로젝트의 지식 데이터베이스 형식은 현재 앱에서 지원하지 않습니다.",
  VALIDATION_FAILED: "지식 데이터를 저장할 수 없습니다. 필수 값과 형식을 확인하세요.",
  NOT_FOUND: "요청한 지식 데이터를 찾을 수 없습니다.",
  CARDINALITY_CONFLICT: "기존 관계와 충돌합니다. 새 관계는 검토 상태로 저장해야 합니다.",
  ATOMIC_WRITE_RECOVERY_REQUIRED: "저장 작업이 완전히 끝나지 않았습니다. 복구가 필요합니다.",
}

export class KnowledgeError extends Error {
  readonly name = "KnowledgeError"
  constructor(readonly code: KnowledgeErrorCode, message = USER_MESSAGES[code], readonly details?: Record<string, unknown>) {
    super(message)
  }
}

export function knowledgeErrorUserMessage(code: KnowledgeErrorCode): string {
  return USER_MESSAGES[code]
}
