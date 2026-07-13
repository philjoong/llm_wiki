### data_types 사용처

1. icon-sidebar.tsx (파일 주입 시 구조화 추출) — 사용자가 파일/URL을 프로젝트에 주입(inject)할 때, loadDataTypes(projectPath)로 목록을 불러와 다이얼로그에 체크박스로 보여줍니다. 하나 이상 선택하면 선택된 data type마다 enqueueIngest(project.id, rel, "", dataTypeId)를 호출해 파일 1개당 선택한 data type 개수만큼 ingest 작업을 큐에 넣습니다.
2. ingest.ts (autoIngest) — 큐에서 실행될 때 dataTypeId가 있으면 loadDataTypes(pp)로 해당 data type을 찾아 그 fields를 기준으로 LLM에게 구조화 추출(decomposition)을 시킵니다. 추출 결과가 전부 빈 값이면 "이 data type에 맞는 내용 없음"으로 처리해 실패가 아닌 review item으로 남깁니다.
3. data-types-section.tsx (설정 화면) — loadDataTypes로 읽어와 CRUD 편집기를 제공합니다. 저장 시 {projectPath}/data_types/{id}.yaml에 직접 writeFile, 삭제 시 deleteFile(_filePath) — 즉 이 화면이 문서에서 말한 "프로젝트 폴더 내부 실제 설정 파일"을 직접 편집하는 UI입니다.

### question_types 사용처

1. chat-input.tsx — 채팅 입력창에서 loadQuestionTypes(projectPath)로 목록을 불러와 사용자가 답변 형식(질문 유형)을 선택하게 합니다.
2. chat-panel.tsx — 선택된 questionTypeId가 있으면 loadQuestionTypes(pp)로 해당 타입을 찾아 그 fields를 프롬프트의 "## Answer Format" 섹션으로 주입해 LLM 응답 형식을 강제합니다.
3. question-types-section.tsx — data-types-section과 동일한 패턴의 설정 CRUD 화면.