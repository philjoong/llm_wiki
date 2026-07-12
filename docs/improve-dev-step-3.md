# Improve 개발 Step 3 — Markdown v2 parser와 안정 section identity

## 목표

Markdown v2를 LLM과 무관하게 파싱·검증·직렬화한다. 제목 변경은 같은 section 수정으로, ID가 같은 서로 다른 본문만 충돌로 판정해야 한다.

## 권장 구조

```text
src/lib/markdown-v2/
  types.ts
  frontmatter.ts
  parser.ts
  serializer.ts
  validator.ts
  reconcile.ts
  anchors.ts
```

기존 `src/lib/ingest.ts`의 `splitIntoSections()`와 `reconcileSections()`에서 로직을 복사해 수정하지 말고 독립 모듈을 만든 뒤 호출부를 교체한다.

## parser 계약

입력 한 번으로 다음을 반환한다.

```ts
interface ParsedPageV2 {
  page: PageMetadata
  h1: string
  sections: ParsedSectionV2[]
  source: string
}

interface ParsedSectionV2 {
  sectionId: string
  headingText: string
  headingLevel: 2
  ordinal: number
  metadata: SectionMetadata
  body: string
  startOffset: number
  endOffset: number
}
```

offset은 citation anchor와 preview가 같은 parser 결과를 재사용할 수 있게 UTF-16 string offset인지 UTF-8 byte offset인지 고정해야 한다. TypeScript 중심이면 UTF-16 offset을 권장하고 Rust 경계에서는 문자열 slice에 직접 쓰지 않는다.

## 강제 validation

- `schema: llm-wiki/page/v2`
- `page_id`, `title`, `page_type`, `summary` 존재
- H1 정확히 1개
- 모든 H2가 `## 제목 {#sec-ULID}` 형식
- section ID가 프로젝트 전체에서 유일함(DB 확인 포함)
- frontmatter `sections`와 본문 H2가 ID 기준 1:1
- `section_type`이 통제 어휘에 포함
- `type: ui`이면 `ui_scope` 필수, UI 필드 값도 통제 어휘 검사
- `primary_entity`, `content_entity`, `host_entity`는 저장 직전 DB에서 존재 확인
- H3 이하는 section 내부 본문으로 보존
- 중복 YAML key, 알 수 없는 필드, 잘못된 tag 형식을 명시적으로 거부할지 정한다. 권장은 typo를 숨기지 않도록 거부하는 것이다.

## reconcile 규칙

`section_id`를 map key로 사용한다.

| 상황 | 결과 |
|---|---|
| 기존에만 ID 존재 | 기존 section 유지 |
| incoming에만 ID 존재 | 신규 section 추가 |
| 같은 ID, 같은 body, heading 변경 | 동일 section metadata 갱신 |
| 같은 ID, body 변경 | modification conflict |
| 같은 heading, 다른 ID | 별개 section; 경고 가능, 자동 merge 금지 |
| incoming이 기존 page와 다른 `page_id` | 같은 path여도 page identity 충돌 |

본문 비교 전 line ending과 trailing whitespace만 정규화하고 의미 변환은 하지 않는다.

## 생성·수정 흐름 반영

- `buildFileBlocksFromSections()` 출력 계약에 page/section metadata를 포함한다.
- ID는 LLM에게 생성시키지 않는 것을 권장한다. LLM은 구조와 메타데이터 후보를 내고 애플리케이션이 ID를 부여한다.
- 기존 page를 선택한 decomposition은 기존 section ID 목록을 prompt에 제공한다.
- modification proposal에 `pageId`, `sectionId`를 필수 저장한다.
- Approve 시 heading text가 아니라 section ID로 splice한다.

## tag schema

`.llm-wiki/tag-schema.yaml` loader/validator를 추가한다. open 시 schema 자체의 중복 namespace/value를 검사하고, page 저장 시 `namespace:value`를 검증한다. UI 필드나 entity 이름을 tag로 자동 복제하지 않는다.

## 테스트 fixture

- 정상 page/section round trip에서 의미 데이터와 본문 보존
- heading rename 후 동일 section ID 유지
- H2 metadata 누락/초과/중복
- H1 0개/2개
- UI scope 누락 및 잘못된 enum
- 같은 heading + 다른 ID, 다른 heading + 같은 ID
- CRLF/LF와 한글/이모지 offset
- YAML alias/duplicate key 등 parser edge case
- unsafe 또는 malformed heading attribute

## 완료 기준

- 저장 가능한 모든 Markdown은 v2 validator를 통과한다.
- section 충돌 판정에서 heading text 비교가 사라진다.
- parser/serializer round trip 후 안정 ID와 본문이 유지된다.
- modification proposal이 page/section ID를 가진다.

## 다음 단계로 넘어가기 전 체크

- serializer가 사용자의 Markdown 포맷을 과도하게 재작성하지 않는가?
- 기존 문서는 지원하지 않고 명확히 validation error를 내는가?
- 프로젝트 전역 section ID 중복 검사가 DB transaction 안에도 있는가?

