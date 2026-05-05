# Schema Example — 게임 개발 프로젝트 (MMORPG / 액션 RPG)

이 문서는 IDEA.md Part 1의 `schema.md`를 게임 개발 도메인에 적용한 **실무 예시**다.
실제 프로젝트에서 그대로 사용할 수 있도록 작성했고, 프로젝트 특성에 따라 필요한 부분만 가져다 변형해 쓴다.

- 대상 게임: MMORPG / MO 액션 RPG (인스턴스 던전 + 오픈필드 + PvP)
- 대상 산출물: GDD, TDD, 밸런스 시트, 회의록, 정책 문서, QA 리포트, 라이브 패치 노트, 아트/사운드 작업 메모

이 파일은 두 가지 역할을 동시에 한다.
1. **샘플 스키마:** "Create New Wiki Project" 다이얼로그의 스키마 picker에서 이 파일을 그대로 선택하면 새 프로젝트의 `schema.md`로 복사된다. 게임 개발 도메인이 아니라면 자기 도메인용 스키마 `.md` 파일을 따로 작성해 picker에서 고르면 된다.
2. **사람이 읽는 기준 문서:** 새 프로젝트가 자기 schema.md를 작성할 때 참고하는 reference.

---

## 1. 디렉토리 트리

```text
db/
  game/
    overview.md
    pillars.md                    # 게임의 핵심 디자인 기둥 3-5개
    target_audience.md
    platform_matrix.md            # 지원 플랫폼/스펙
    glossary.md                   # 도메인 용어집

  systems/
    progression/
      level_curve.md
      experience_sources.md
      stat_growth.md
      power_curve.md              # 시간/투자 대비 캐릭터 성장 곡선
    combat/
      damage_formula.md           # 최종 데미지 계산식
      mitigation.md               # 방어/저항/감쇠
      crit_system.md
      hit_eval.md                 # 명중/회피
      threat_aggro.md
      action_priority.md          # GCD, CC vs CC 우선순위
      status_effects/
        <effect_id>.md            # 출혈, 화상, 빙결, 기절 등
    skill/
      skill_grammar.md            # 스킬 정의 데이터 스키마
      cast_system.md              # 시전/캔슬/페이크캐스트/리캐스트
      cooldown_system.md
      resource_system.md          # MP/에너지/콤보 등
      targeting.md
    movement/
      locomotion.md
      mount.md
      jump_fall.md
      collision.md
      teleport.md
    party_raid/
      party_rules.md
      raid_rules.md
      role_system.md              # 탱/딜/힐
      loot_distribution.md        # 분배/마스터루팅/주사위 등
      ready_check.md
    guild/
      guild_lifecycle.md
      guild_rank.md
      guild_perks.md
      guild_storage.md
    social/
      friend_system.md
      block_mute.md
      chat_channels.md
      whisper_mail.md
    matchmaking/
      pvp_mmr.md
      group_finder.md
      cross_realm.md
    instance_server/
      server_structure.md
      instance_lifecycle.md       # 입장/퇴장/타임아웃/와이프
      sharding.md
      reconnect.md
    world_server/
      zone_handover.md
      world_event_scheduler.md
      world_boss_scheduler.md
    persistence/
      save_points.md
      auto_save.md
      conflict_resolution.md      # 동시 접속/세션 전이
    economy/
      currency_matrix.md          # 골드/명예/메달/유료재화 종류
      shop_design.md
      auction_house.md
      trade_rules.md
      sink_source_balance.md      # 통화 흡수원/공급원 균형
      anti_inflation.md
    monetization/
      bm_overview.md
      battle_pass.md
      gacha.md
      cosmetics.md
      vip_subscription.md
    crafting/
      recipe_system.md
      material_tiers.md
      enchant_upgrade.md
      reforge.md

  content/
    classes/
      <class_id>/
        overview.md               # 콘셉트, 판타지, 역할
        stats.md
        signature_skills.md
        skill_tree.md
        talents.md
    races/
      <race_id>.md
    items/
      equipment/
        weapons/<item_id>.md
        armor/<item_id>.md
        accessories/<item_id>.md
      consumables/<item_id>.md
      materials/<item_id>.md
      key_items/<item_id>.md
    skills/
      <skill_id>.md               # 스킬 1개의 데이터/효과/연출 분해
    npcs/
      <npc_id>.md                 # 시나리오/상점/퀘스트 NPC
    monsters/
      common/<monster_id>.md
      elite/<monster_id>.md
      named/<monster_id>.md
    bosses/
      raid/<boss_id>.md           # 패턴, 페이즈, 체크포인트, 보상
      world/<boss_id>.md
      dungeon/<boss_id>.md
    quests/
      main/<quest_id>.md
      side/<quest_id>.md
      daily/<quest_id>.md
      event/<quest_id>.md
    dialogue/
      <npc_id>/<scene_id>.md

  world/
    zones/
      <zone_id>/
        overview.md
        layout.md
        spawn_table.md
        ambient.md                # 환경/시간대/날씨/BGM 큐
    dungeons/
      <dungeon_id>/
        overview.md
        entry_rules.md
        rewards.md
        spawn_rules.md
        boss_encounters.md
        difficulty_modes.md       # 일반/하드/신화 등
        weekly_lockout.md
    raids/
      <raid_id>/
        overview.md
        progression_gating.md     # 보스 1 클리어 후 보스 2 해금 등
        rewards.md
        boss_encounters.md
        weekly_lockout.md
    open_world_events/
      <event_id>.md

  pvp/
    arena/
      arena_rules.md
      arena_seasons.md
      arena_rewards.md
    battleground/
      <bg_id>.md
    open_pvp/
      flagging.md
      karma_system.md
      pk_penalty.md
    rated_ladder/
      tier_promotion.md
      placement.md

  policies/
    safezone.md
    pvp_policy.md
    pk_griefing.md
    chat_policy.md
    name_policy.md                # 욕설/사칭/예약어
    monetization_policy.md        # 가챠 표시/확률 공개/연령
    age_rating.md
    refund_policy.md
    operations/
      gm_authority.md             # GM 권한/감시/벤
      anti_cheat.md
      bot_detection.md
      rmt_policy.md               # 현금거래 단속
      account_security.md

  balance/
    class_balance/
      <class_id>.md
    pvp_balance.md
    drop_rates.md                 # 드랍 테이블 정책 + 수치
    boss_dps_check.md             # 클리어 타임 검증
    inflation_metrics.md
    monetization_kpi.md

  ui_ux/
    flows/
      login_flow.md
      char_select_flow.md
      first_time_user.md
      death_respawn_flow.md
    hud/
      action_bar.md
      minimap.md
      buff_debuff_bar.md
      target_frame.md
    menus/
      inventory.md
      character_sheet.md
      skill_book.md
      social_panel.md
    notifications/
      toast.md
      system_message.md
      mail_alert.md
    accessibility/
      colorblind.md
      ui_scaling.md
      font_size.md

  audio/
    bgm.md
    sfx_categories.md
    voice/
      <character_id>.md
    audio_mix.md                  # 우선순위/덕킹 정책

  network/
    protocol_overview.md
    packet_priority.md
    interest_management.md        # AOI
    latency_compensation.md
    rollback_prediction.md
    rate_limit.md

  data/
    save_schema.md
    telemetry_events.md           # 어떤 이벤트를 어떤 스키마로 보내는가
    analytics_funnels.md
    a_b_testing.md
    privacy_compliance.md         # GDPR/COPPA 등

  liveops/
    seasons/
      <season_id>.md
    patches/
      <patch_id>.md               # 패치노트, 변경요약, 영향 분석
    events/
      <event_id>.md
    hotfix_log.md
    server_status_policy.md       # 점검/롤백 기준

  qa/
    test_plans/
      <feature_id>.md
    bug_classification.md
    regression_suites/
      combat.md
      progression.md
      economy.md
      pvp.md
      ...
    known_issues.md

  build/
    branching_strategy.md
    versioning.md
    deployment_pipeline.md
    platform_certification.md     # 콘솔 인증/스토어 정책

  localization/
    glossary_per_locale/<locale>.md
    text_id_policy.md
    voice_locale_matrix.md
```

---

## 2. 분해 규칙 (1차 산출물 → 2차 산출물 위치)

1차 산출물 한 파일은 보통 여러 의미 단위가 섞여 있다. 다음 표는 자주 등장하는 의미 단위와 분해 위치다.

| 의미 단위 | 위치 | 비고 |
|---|---|---|
| 게임 콘셉트/방향성 | db/game/pillars.md, overview.md | GDD 1장 |
| 클래스 콘셉트 | db/content/classes/{class_id}/overview.md | |
| 클래스 스킬 트리 | db/content/classes/{class_id}/skill_tree.md | |
| 스킬 1개 정의 (데이터+효과+연출) | db/content/skills/{skill_id}.md | |
| 스킬 시전/쿨다운/리소스 시스템 | db/systems/skill/cast_system.md 등 | 시스템 룰 |
| 데미지 계산식 | db/systems/combat/damage_formula.md | |
| CC/GCD 우선순위 | db/systems/combat/action_priority.md | |
| 상태이상 정의 (출혈 등) | db/systems/combat/status_effects/{effect_id}.md | |
| 인스턴스 서버 구조 | db/systems/instance_server/server_structure.md | |
| 던전 입장 조건 | db/world/dungeons/{dungeon_id}/entry_rules.md | |
| 던전 보상 테이블 | db/world/dungeons/{dungeon_id}/rewards.md | |
| 던전 스폰 규칙 | db/world/dungeons/{dungeon_id}/spawn_rules.md | |
| 던전 보스 패턴 | db/content/bosses/dungeon/{boss_id}.md | 보스 단위로 primary, 던전 페이지에서 wikilink |
| 레이드 보스 페이즈 | db/content/bosses/raid/{boss_id}.md | |
| 아이템 정의 | db/content/items/.../{item_id}.md | 카테고리 분기 |
| NPC 대사/시나리오 | db/content/dialogue/{npc_id}/{scene_id}.md | |
| 퀘스트 시나리오 | db/content/quests/{type}/{quest_id}.md | main/side/daily/event |
| 존 레이아웃/스폰 | db/world/zones/{zone_id}/...md | |
| PvP 룰셋 | db/pvp/{mode}/...md | arena/battleground/open |
| SafeZone 정책 | db/policies/safezone.md | |
| PK 페널티 | db/policies/pk_griefing.md + db/pvp/open_pvp/pk_penalty.md | 정책 vs 시스템 분리 (§3) |
| 가챠 확률 | db/systems/monetization/gacha.md + db/policies/monetization_policy.md | 시스템 + 법적 정책 (§3) |
| 골드 inflation 분석 | db/balance/inflation_metrics.md | |
| 시즌 패치 노트 | db/liveops/patches/{patch_id}.md | |
| 클래스 밸런스 패치 | db/liveops/patches/{patch_id}.md + db/balance/class_balance/{class_id}.md | (§3 cross-cutting) |
| QA 회귀 케이스 | db/qa/regression_suites/{area}.md | |
| 텔레메트리 이벤트 정의 | db/data/telemetry_events.md | |
| UI 플로우 (사망 후 부활 등) | db/ui_ux/flows/{flow_id}.md | |
| 서버 점검/롤백 기준 | db/liveops/server_status_policy.md | |
| 어뷰징/RMT 정책 | db/policies/operations/rmt_policy.md | |
| 사운드 큐 정책 | db/audio/audio_mix.md | |
| 네트워크 보정/예측 | db/network/latency_compensation.md, rollback_prediction.md | |

---

## 3. Cross-cutting (한 의미 단위가 여러 곳에 걸칠 때)

같은 1차 산출물 구간이 여러 위치에 의미를 가지는 경우는 흔하다. 다음 규칙을 따른다.

1. **Primary 위치 1개에만 본문을 쓴다.** 다른 위치에는 wikilink만 둔다.
2. Primary 결정 우선순위:
   - **법적/규제 영향이 있으면** `policies/`가 primary (예: 가챠 확률 공개, 연령 등급).
   - 그 외에는 **시스템 룰(`systems/`) > 콘텐츠 인스턴스(`content/`) > 정책(`policies/`)** 순.
3. 라이브 패치는 `liveops/patches/{patch_id}.md`에 변경 요약을 두고, 영향받는 각 시스템/콘텐츠 파일은 `updated:` 갱신 + `sources`에 패치 노트를 추가한다.

예시 — "가챠 확률 변경"

| 위치 | 역할 |
|---|---|
| db/policies/monetization_policy.md | **Primary** (법적 공개 책임) |
| db/systems/monetization/gacha.md | 보조 (수치 반영, primary로 wikilink) |
| db/liveops/patches/{patch_id}.md | 라이브 변경 이력 |

예시 — "전사 클래스 데미지 계수 변경"

| 위치 | 역할 |
|---|---|
| db/balance/class_balance/warrior.md | **Primary** (밸런스 디자이너 영역) |
| db/content/classes/warrior/skill_tree.md | 보조 (수치 반영) |
| db/liveops/patches/{patch_id}.md | 라이브 변경 이력 |

---

## 4. Frontmatter

모든 2차 산출물 파일은 다음 frontmatter를 가진다.

```yaml
---
id: <slug>                      # 파일명 stem과 동일
type: <§4.1 type 값 중 하나>
title: 사람이 읽는 제목
status: draft | review | approved | deprecated
owner: <팀/직군>                # combat, content, narrative, liveops, qa, ui, server, audio, balance, ...
tags: []
related: []                     # [[wikilink]] 가능한 다른 페이지 id
sources:
  - file: <원본 파일명>
    range: <heading path | sheet!range | page+paragraph | url+anchor>
    confidence: high | medium | low
created: YYYY-MM-DD
updated: YYYY-MM-DD
last_validated_at: YYYY-MM-DD   # IDEA §2.8 신선도 — Part 2에서 사용
---
```

### 4.1 type 값

한 페이지 = 한 type. 디렉토리와 type은 보통 1:1로 대응된다.

```
system | skill | status_effect | class | race | item | npc | monster | boss
| quest | dialogue | zone | dungeon | raid | pvp_mode | policy | balance
| ui_flow | hud | menu | audio | network | telemetry | season | patch | event
| qa_plan | regression | build | localization | overview | glossary
```

---

## 5. Source Range — raw 포맷별 지정 방법

`sources[].range`는 가능한 한 **사람이 다시 찾아갈 수 있는** 단위로 적는다. "어딘가 있음"은 출처 추적의 신뢰를 무너뜨린다.

| 원본 포맷 | range 표기 | 예시 |
|---|---|---|
| DOCX/PDF | `section X.Y.Z` 또는 `p.N ¶M` | `section 3.2.1`, `p.42 ¶3` |
| MD | heading path | `## 던전 입장 조건` |
| XLSX | `Sheet!Range` | `DungeonA!B12:E18` |
| Confluence/Notion | `<page_url>#<anchor>` | `https://.../page#entry-rules` |
| 회의록 | `YYYY-MM-DD 회의 > 안건 N` | `2026-04-12 전투팀 정기 > 안건 3` |
| Slack 스레드 | `#channel > YYYY-MM-DD HH:MM` | `#combat-balance > 2026-04-12 14:32` |
| Jira 티켓 | `<TICKET-ID> > comment#N` | `GAME-1234 > comment#3` |
| Figma/PSD | `<file_url>#frame=<name>` | `figma.com/...#frame=Boss_Phase1` |
| 음성 회의 녹취 | `YYYY-MM-DD 회의 > MM:SS-MM:SS` | `2026-04-12 KOM > 12:30-15:10` |

---

## 6. Update Conflict Policy (수정 요청이 발생하는 경우)

다음은 **자동 덮어쓰기 금지**. modification review로 사용자에게 제시한다 (IDEA §1.5).

- 같은 속성값에 다른 값이 들어옴 (예: damage_formula의 계수 변경)
- 같은 보스 패턴에 새 페이즈가 추가되거나 기존 페이즈 수치 변경
- SafeZone 범위/규칙 변경
- 보상 테이블의 드랍률 조정
- 정책 문서(특히 monetization_policy, pk_griefing, age_rating)의 모든 변경
- 클래스 밸런스 수치 변경
- 아이템의 stat 변경 (외형/플레이버 텍스트는 자동 허용)
- 텔레메트리 이벤트 **스키마** 변경

다음은 **자동 append 허용** (덮어쓰기 아님, 신규 추가만).

- `liveops/patches/<new_id>.md` 신규 패치 노트
- `qa/known_issues.md` 신규 이슈
- `liveops/hotfix_log.md` 신규 핫픽스
- `data/telemetry_events.md` **신규** 이벤트 정의 (기존 이벤트 스키마 변경은 modification)
- `content/dialogue/.../<scene_id>.md` 신규 대사 (기존 대사 수정은 modification)

---

## 7. 출처 신뢰도 (confidence)

`sources[].confidence` 는 다음 기준으로 정한다.

| 값 | 기준 |
|---|---|
| high | 공식 GDD/TDD/밸런스 시트, 승인된 정책 문서, 릴리스된 패치 노트, 합의된 회의 결과 |
| medium | 회의록 안건, 디자이너 작성 메모, QA 리포트 초안, 미승인 제안서 |
| low | Slack 발언, 1:1 대화 요약, 추정/추론 |

**low가 단독 출처인 페이지는 `status: review`로 두고**, high/medium 출처가 추가될 때까지 `approved`로 승격하지 않는다.

---

## 8. 명명 규칙

- 파일: kebab-case (`death_respawn_flow.md` 처럼 underscore도 허용 — 영역 컨벤션 일관성 우선)
- `<class_id>` 등 식별자: 영문 lowercase + 숫자 (`paladin`, `dark_knight_2`)
- 패치 id: `YYYY-MM-DD` 또는 `vMAJOR.MINOR.PATCH` (프로젝트 결정, 일관성만 유지)
- 시즌 id: `s01`, `s02` 등 zero-padded
- 보스 id: `<dungeon_or_raid>_<boss_slug>` (예: `tomb_of_rin_first_guardian`)
- 스킬 id: `<class>_<skill_slug>` 또는 글로벌 스킬은 `<skill_slug>` (예: `paladin_judgment`, `global_dodge`)
- 아이템 id: `<category>_<slug>_<tier>` (예: `weapon_flameblade_t3`)

---

## 9. 의존성 / related

`related:` 필드에 다른 페이지 id를 wikilink로 넣어 양방향 관계를 만든다.

- 스킬 → 그 스킬을 쓰는 클래스, 영향받는 status_effect
- 보스 → 그 보스가 등장하는 던전/레이드, 드랍하는 아이템
- 아이템 → 드랍 보스/몬스터, 사용되는 레시피, 장착 가능 클래스
- 정책 → 정책이 영향을 주는 시스템/콘텐츠 페이지
- 시즌 → 그 시즌에 도입된 패치/이벤트/콘텐츠

ingest 시 LLM은 `related:` 후보를 **제안만** 한다. 실제 추가는 사용자 review를 거친다 — 자동 추가는 잘못된 연결을 만들기 쉽다.

---

## 10. 이 schema가 다루지 **않는** 것

- 1차 가공(raw → 1차 산출물) 알고리즘 — IDEA §1.1 범위 밖
- 검색 — IDEA Part 2 (`question_types/`, `exclusions/` 는 별도 트리)
- 운영 도구(GM 콘솔, 라이브 모니터링) 자체 매뉴얼 — 별도 운영 위키
- 엔진 내부 구조 (Unreal/Unity 모듈) — 엔진 문서가 별도로 관리됨
- 코드 리뷰/스펙(소스 코드 단위) — 소스 코드 저장소 내 README/주석이 1차 출처

---

## 11. 변경 시 체크리스트

이 schema를 수정할 때 다음을 함께 갱신한다.

- [ ] [src/lib/templates.ts](../src/lib/templates.ts) `gameDevTemplate.schema` — 본문 임베드 동기화
- [ ] [src/lib/templates.ts](../src/lib/templates.ts) `gameDevTemplate.extraDirs` — 디렉토리 트리 동기화
- [ ] [PLAN.md](../PLAN.md) §3 — 요약/링크가 여전히 일치하는지
- [ ] 기존 프로젝트의 `schema.md` — 운영 중 프로젝트는 schema 변경 시 modification review 발생 (자동 마이그레이션 X)
