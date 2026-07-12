# Improve 개발 Step 7 — Chat 구조화 citation과 section preview

## 목표

Chat이 상위 section만 읽고, 모델이 발급된 citation key만 사용하게 한다. 스트리밍 완료 후 key를 안정 ID와 실제 인용 구간으로 변환해 저장하며 문서 이동·heading rename 뒤에도 reference가 열려야 한다.

## Step 6 검색 결과 인계

이 단계는 Step 6의 section candidate를 prompt의 유일한 문서 입력으로 사용한다. 파일 검색 결과나 graph hit만으로 문서 전체를 다시 읽어 citation을 만들지 않는다.

- candidate의 `pageId`, `sectionId`, `ordinal`, `matchedRanges`, `assertionIds`, `evidenceState`, `graphPath`를 요청 단위 citation map에 보관한다.
- prompt 직전에 `pages`/`sections` 존재를 다시 확인한다. 삭제된 section 또는 오래된 embedding/token cache hit는 제외하며, 그 key를 발급하지 않는다.
- `pagePath`와 heading은 map에 표시용으로만 넣을 수 있고, 저장 reference의 identity나 preview lookup에는 사용하지 않는다.
- `graphPrefixFilter`가 있는 Chat은 prefix를 허용 graph ID 목록으로 먼저 해석해 Step 6 `allowedGraphIds`에 전달한다. 모델이 받은 key나 graph path를 이용해 scope 밖 graph를 다시 조회해서는 안 된다.
- RAG off는 embedding recall만 끄는 정책을 유지한다. entity/traversal/metadata 후보와 그로부터 만든 section citation은 계속 사용할 수 있다.

`graphPath`와 `evidenceState`는 모델의 citation 사실을 결정하지 않는다. 이들은 사용자가 왜 section이 후보가 되었는지 확인하기 위한 provenance이며, citation anchor는 언제나 해당 section 안의 실제 텍스트여야 한다.

## message reference 계약

`src/stores/chat-store.ts`의 `MessageReference`를 새 shape로 교체한다.

```ts
interface StructuredCitation {
  citationId: string
  pageId: string
  sectionId: string
  quotedText: string
  prefix?: string
  suffix?: string
  startOffset?: number
  endOffset?: number
}
```

`pagePath`와 heading은 저장하지 않거나 snapshot 표시용으로만 둔다. 클릭 시 DB의 page/section ID로 현재 경로와 heading을 해석한다.

## prompt 구성

검색 후보마다 임의 추측이 어려운 요청 단위 key를 발급한다.

```text
[CIT:7f3a] page_id=... section_id=...
<허용된 근거 본문>
```

- 모델에는 key와 실제로 제공한 section text만 전달한다.
- 답변은 정해진 문법(예: `[[CIT:7f3a]]`)만 사용하도록 한다.
- key는 요청마다 새로 만들고 section ordinal과 동일하게 만들지 않는다.
- 모델이 작성한 path, quote, page ID를 citation 데이터로 신뢰하지 않는다.

출력 언어 reminder, question type의 Answer Format 위치, history 예산 정책은 기존 동작을 보존한다.

## finalize 단계

1. 응답에서 허용 문법의 key를 파싱한다.
2. 이번 요청의 key map에 없는 값은 무시하고 경고 telemetry를 남긴다.
3. key가 가리킨 실제 section 안에서 답변 문장과 관련된 인용 구간을 결정한다.
4. 모델에게 quote를 다시 요청하지 않는다. 최소 첫 버전은 candidate의 `matchedRanges` 또는 **같은 section을 가리키는** evidence quote를 사용한다. assertion의 evidence가 다른 page/section에 있으면 quote anchor로 재사용하지 않는다.
5. `quotedText`와 구분에 필요한 prefix/suffix를 함께 저장한다.
6. 본문에는 citation marker를 렌더용 token으로 유지하고 reference 배열과 연결한다.

모델이 citation key를 냈지만 구간을 좁힐 수 없으면 section 전체를 quote로 저장하지 말고 reference는 만들되 `quotedText`를 빈 값으로 둘지 정책을 정한다. 권장은 section reference는 유지하고 highlight 없음 상태로 표시하는 것이다. 이 경우 `matchedRanges`가 없다는 사실을 임의 문장 선택으로 보완하지 않는다.

## preview와 highlight

`chat-reference-panel.tsx`는 다음 순서로 anchor를 찾는다.

1. page/section ID로 현재 Markdown section을 parse
2. 저장 offset의 substring과 quoted text가 일치하면 사용
3. section 내부 exact quote 검색
4. 여러 exact match면 prefix/suffix로 disambiguate
5. 찾지 못하면 section은 열고 “근거 구간을 찾을 수 없음” 표시

유사도 기반 임의 highlight는 하지 않는다. 여러 citation 구간은 모두 표시하되 선택한 citation을 우선 강조한다.

## 레거시 제거

새 message는 structured citation만 저장·렌더링한다. 다음 fallback을 제거한다.

- `<!-- cited: ... -->`
- `[N]` 순차 인용 parsing
- `[[wikilink]]`를 reference로 추론
- 구형 reference shape adapter

이 변경으로 기존 저장 대화가 열리지 않을 수 있다는 점은 Step 1의 비호환 정책과 일치해야 한다. chat DB/state도 새 schema version을 검사한다.

## 테스트

- 발급 key만 citation으로 저장
- hallucinated key/quote/path 무시
- 여러 key와 중복 key 처리
- page move와 heading rename 후 preview 열기
- exact quote 다중 등장 시 context disambiguation
- quote 삭제/수정 시 no-highlight 상태
- section만 context budget에 포함되는지 확인
- stale cache hit 또는 DB에서 삭제된 section에는 key가 발급되지 않음
- RAG off에서도 entity/graph/metadata section citation은 유지되고 embedding recall만 비활성화됨
- `graphPrefixFilter`가 traversal의 `allowedGraphIds`에 강제되어 scope 밖 section key가 발급되지 않음
- no relevant section, RAG off, graph context empty, question type, 언어 reminder 회귀
- streaming 중 marker가 잘려 들어오는 경우 finalize parsing

## 완료 기준

- 저장된 reference가 page ID와 section ID를 필수로 가진다.
- 모델 출력만으로 quote/path가 저장되지 않는다.
- 이동·rename 뒤 reference가 열리고 실제 구간을 highlight한다.
- 구형 reference fallback이 production code에서 제거된다.

## 다음 단계로 넘어가기 전 체크

- citation marker가 일반 Markdown과 충돌하지 않는가?
- section 원문이 바뀐 경우 잘못된 문장을 highlight하지 않는가?
- context budget 계산이 파일이 아니라 실제 삽입 section 기준인가?
