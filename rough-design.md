# 🎮 Game Knowledge Graph System Design (Rust + Tauri + FalkorDB)

## 1. 개요

다양한 포맷의 문서를 MD 파일로 변환
MD 파일이 Knowledge Graph 생성(AI 기반 그래프 자동 생성)
하나의 거대한 Knowledge Graph가 아닌 관계 유형(edge type)을 4개 이하로 제한한 여러 개의 작은 KG들로 분할
사용자는 시각화된 Knowledge Graph를 확인할 수 있음
사용자는 12개 질문 타입 중 한 개를 선택해 질문할 수 있음
사용자는 MD 파일을 RAG 검색할 수 있음
사용자는 지식 그래프와 RAG 검색이 연결된 심층 검색을 할 수 있음
Knowledge Graph를 추가/삭제/수정할 수 있다. 

***

## 2. 기술 스택

### Core

* **Rust**
  * 백엔드 로직 및 데이터 처리
* **Tauri**
  * 데스크탑 앱 프레임워크 (Rust + Web UI)
* **FalkorDB**
  * Redis 기반 Graph DB

### 시각화된 Knowledge Graph

* [falkordb-browser](./falkordb-browser)
  * 그래프 시각화 UI
  * 커스텀 확장하여 app 내부에 임베딩

falkordb는 http://10.246.42.51:3000/에 떠있음
***

## 3. 핵심 설계 개념

### 3.1 Multi-Graph Strategy

> 하나의 KG 대신 "기능 단위로 분할된 Graph 집합"

각 Graph는 다음 제약을 가진다:

* Edge type ≤ 4
* 명확한 도메인 책임
* graph 간 loose coupling

***

### 3.2 Graph Naming Convention

```
<domain>_graph

예:
ui_graph
skill_graph
enemy_graph
```

***

## 4. 그래프 분류 설계

### 4.1 필수 그래프 (기본 정의)

#### ✅ UI Graph

* UI 흐름 및 화면 구조
* Example edges:
  * `NAVIGATES_TO`
  * `CONTAINS`
  * `TRIGGERS`

***

#### ✅ Skill Graph

* 스킬 트리 및 능력 관계
* Example edges:
  * `UPGRADES_TO`
  * `REQUIRES`
  * `MODIFIES`

***

#### ✅ Enemy Graph

* 적/AI 관계
* Example edges:
  * `TARGETS`
  * `SPAWNS`
  * `WEAK_AGAINST`

***

#### ✅ Server Movement Graph

* 서버 이동 / 맵 전이
* Example edges:
  * `CONNECTS_TO`
  * `REQUIRES_ITEM`
  * `HAS_LEVEL_LIMIT`

***

### 4.2 추가 필요한 그래프 (추천)

#### ✅ Item Graph

* 아이템 / 장비 / 소비템
* edges:
  * `CRAFTS_INTO`
  * `REQUIRES`
  * `ENHANCES`

***

#### ✅ Quest Graph

* 퀘스트 흐름
* edges:
  * `NEXT`
  * `REQUIRES`
  * `UNLOCKS`

***

#### ✅ Dialogue Graph

* NPC 대화 흐름
* edges:
  * `LEADS_TO`
  * `CONDITIONAL`
  * `ENDS`

***

#### ✅ Economy Graph

* 재화 흐름
* edges:
  * `GENERATES`
  * `CONSUMES`
  * `EXCHANGES`

***

#### ✅ Faction Graph

* 세력 관계
* edges:
  * `ALLY`
  * `ENEMY`
  * `NEUTRAL`

***

#### ✅ Event Graph

* 이벤트 트리거 시스템
* edges:
  * `TRIGGERS`
  * `CONDITIONAL`
  * `CHAINED_TO`

***

#### ✅ AI Behavior Graph

* AI 상태 머신
* edges:
  * `TRANSITIONS_TO`
  * `CONDITION`
  * `ACTION`

***

#### ✅ Progression Graph

* 캐릭터 성장 흐름
* edges:
  * `LEVELS_TO`
  * `UNLOCKS`
  * `REQUIRES_XP`

***

### 💡 그래프 설계 원칙 요약

* 그래프별 책임 명확화
* edge type 최소화 (≤4)
* node 타입은 자유롭게 확장
* cross-graph reference는 ID 기반으로 처리

***

## 5. App 기능 정의

### 5.1 문서 기반 KG 생성 시스템

App은 다음 워크플로우를 제공해야 한다:

```
Markdown / Structured Doc → KG 생성
```

***

### 5.2 그래프 CRUD 기능

#### Create

* 그래프 생성

#### Read

* 그래프 시각화
* 쿼리 실행 (Cypher-like)

#### Update

* 노드/엣지 속성 변경
* 관계 타입 변경

#### Delete

* Node delete (cascade 옵션)
* Edge delete
* Graph delete

***

### 5.3 시각화 기능

* FalkorDB Browser 임베딩
* 기능:
  * 줌 / 이동
  * 노드 필터링
  * edge type highlight
  * subgraph focus

***

### 5.4 고급 기능 (필수 포함 추천)

#### ✅ Graph Validation

* edge type 제한 체크
* orphan node 탐지

#### ✅ Schema Enforcement

* graph별 schema 정의
* node/edge 타입 제한

#### ✅ Version Control

* git-like snapshot
* diff visualization

#### ✅ Graph Templates

* predefined graph structure
* 빠른 생성

***

### 5.5 생산성 기능

#### ✅ Visual + Text Edit Dual Mode

* 그래프 → 문서 변환
* 문서 → 그래프 생성

#### ✅ Search

* 노드 검색
* 관계 기반 탐색

#### ✅ Bulk Edit

* 여러 node/edge 한 번에 수정

#### ✅ Cross Graph Navigation

* 문서를 선택하면 관련 있는 그래프 리스트들이 출력 > 선택한 그래프 시각화되어 출력됨

***