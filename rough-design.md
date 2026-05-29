# Game Knowledge Graph System Design

1. 프로젝트 선택 시 https://set-git.cloud.ncsoft.com/gameqa/claude-skills의 branch list 출력.
2. 프로젝트 생성 시 https://set-git.cloud.ncsoft.com/gameqa/claude-skills에 프로젝트명으로 branch 생성 및 http://10.246.42.51:6379로 FalkorDB 통신해서 프로젝트명으로 계정 생성
3. raw data injection 시 다양한 포맷의 문서를 MD 파일로 변환.
4. MD 파일로 Knowledge Graph 생성(AI 기반 그래프 자동 생성) 프로젝트명 계정에 Knowledge Graph 생성, 하나의 거대한 Knowledge Graph가 아닌 관계 유형(edge type)을 4개 이하로 제한한 여러 개의 작은 KG들로 분할(예: ui_graph, skill_graph, server_and_skill_relation_graph, faction_graph, Server_Movement_Graph 등), 관계 유형(edge type)은 사용자가 llm에게 추가 및 제거 요청할 수 있음. raw data injection 시 이미 제거한 관계 유형으로 llm이 Knowledge Graph를 생성할 수 있으니 forbidden 관계 유형 리스트 관리를 할 수 있어야 하고 llm이 참고하여 Knowledge Graph를 생성해야됨.
5. llm이 생성하려는 Knowledge Graph의 노드, 관계 타입 혹은 속성이 기존과 달라서 수정이 필요할 경우 사용자에게 판단 요청.
6. Knowledge Graph의 Version Control은 로컬에서 이뤄지고 remote에 반영할지 exit할 때 문의, app 실행하여 프로젝트 선택 시 remote와 sync 맞춤.
7. 프로젝트에서 생성된 Knowledge Graph는 사용자가 시각화된 상태로 확인할 수 있고 Knowledge Graph를 노드, 관계, 속성을 CRUD할 수 있어야돼. 시각화는 ./falkordb-browser의 기술을 사용.
8. injection된 문서를 선택했을 때 해당 문서와 연관 있는 Knowledge Graph list가 출력되어야 하고 list item을 선택하면 해당 Knowledge Graph가 시각화되어 보여줘야 함.
9. 사용자는 llm에 질문할 수 있고 llm은 injection된 데이터를 rag 검색하거나 지식 그래프를 참고하여 답변에 참고할 수 있음.
10. 사용자는 질문 타입 중 한 개를 선택해 llm에 질문할 수 있음, 질문 타입은 yaml 파일로 작성되어 있고, llm은 yaml에 작성된 항목(key)에 대한 답변을 해야함. 사용자는 질문 타입을 CRUD할 수 있음. 