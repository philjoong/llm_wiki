Concept과 Concept Scheme의 개념 이해하기
1. The skos:Concept Class
Preamble
Vocabulary
Class & Property Definitions
Examples
Notes
편집자주
2. Concept Scheme
Preamble
Vocabulary
Class & Property Definitions
Examples
Integrity Conditions
Notes
편집자주
Concept과 Concept Scheme의 개념 이해하기
SKOS의 주요 클래스로는 conceptScheme와 concept이 있다. SKOS에서 'ConceptScheme'은 큰 카테고리나 분류 체계를 나타낸다. 예를 들어, '과일'이라는 ConceptScheme을 상상해보자. 마치 대형 슈퍼마켓에서 과일 섹션이 있는 것처럼, '과일' ConceptScheme은 사과, 바나나, 포도와 같은 다양한 과일들을 포괄한다. 그 안에서, 각각의 과일, 즉 사과, 바나나, 포도는 'Concept'으로 표현된다. 이들은 '과일'이라는 큰 틀 안에서 각각 독립된 항목으로 존재하며, 각각의 과일이 가지는 고유한 특성과 정보를 포함한다. 마치 사과에는 '빨강', '달콤함', '가을철'과 같은 태그가 붙을 수 있듯이, 각 Concept은 그 자체로 풍부한 정보를 가지고 있다. '과일'이라는 ConceptScheme 안에 있는 '사과', '바나나', '포도'라는 Concept들은 모두 서로 연관되어 있으면서도, 각각 독립된 정보와 속성을 가지고 있다.


예를 들어, 여러 교통법률들이 각각 하나의 개념이라고 했을 때, conceptScheme는 이러한 개념들을 하나로 묶는 교통법률 개념 체계인 것이다. 따라서 conceptScheme는 개념들, 즉 concept의 집합이라고 이해할 수 있겠다. 그리고 conceptScheme 아래에 있는 concept는 반드시 컨셉트 스키마의 일부일 필요는 없으며, 독립적인 자원으로 정의되고 선언될 수 있다.


만약 컨셉이 특정 컨셉스키마에 일부라면, skos:inScheme 속성을 사용하면 된다.


또 컨셉트들이 더 넓거나 좁은 일반화 계층 구조로 배열된 컨셉트 스키마에서는, 일반화 계층 구조에서 최상위 레벨의 컨셉트와 컨셉트 스키마 간의 연결을 명시하기 위해 skos:hasTopConcept 속성을 사용할 수 있다. 즉, 교통법률체계라는 conceptScheme에 최상위 레벨의 concept인 육상교통법률, 해상교통법률, 항공교통법률이 연결되어 있음을 기술해주는 관계어가 바로 skos:hasTopConcept 인 것이다.


conceptScheme와 동일한 클래스인 Concept은 특정한 아이디어나 주제를 나타내는 단위로 사용되며, 각각의 concept은 고유한 의미와 속성을 가진다. SKOS 개념은 지식 조직 시스템의 개념적 또는 지적 구조를 설명할 때, 그리고 KOS 내에서 확립된 특정 아이디어나 의미를 언급할 때 유용하다. 예를 들어, <육상교통법률>, <해상교통법률>, <항공교통법률>과 그 하위에 위치한 <도로교통법>이나 <항해안전법>, <항공안전법> 같은 교통법규를 concept으로 표현할 수 있다.


1. The skos:Concept Class
Preamble
skos:Concept 클래스는 SKOS 개념의 클래스이다. SKOS 개념은 하나의 생각 또는 개념, 생각의 단위로 볼 수 있다. 그러나 생각의 단위가 무엇인지는 주관적이며, 이 정의는 제안적인 것이지 제한적인 것이 아니어야 한다. skos:Concept이라는 개념은 지식 조직 시스템(KOS)의 개념적 또는 지적 구조를 설명할 때, 그리고 KOS 내에서 확립된 특정 아이디어나 의미를 참조할 때 유용하다. SKOS는 주로 사전 정의되지 않은 KOS를 나타내기 위해 설계되었기 때문에, 이 클래스의 형식적 정의에는 일정한 유연성이 내장되어 있다는 점을 주목할 필요가 있다.

Vocabulary
skos:Concept

Class & Property Definitions
skos:Concept은 owl:Class의 인스턴스이다.
(skos:Concept is an instance of owl:Class.)

Examples
아래 예시는 〈MyConcept〉이 SKOS 개념임을 나타낸다(즉, skos:Concept의 인스턴스이다).
〈MyConcept〉rdf:type skos:Concept .
편집자 예시:〈육상교통수단〉rdf:type skos:Concept .


그림 1. 교통수단체계 개념도
Notes
SKOS Concepts, OWL Classes and OWL Properties:
SKOS에서는 skos:Concept이 owl:Class의 인스턴스라는 주장 외에는 SKOS 개념의 클래스와 OWL 클래스의 클래스 간의 공식적인 관계에 대해 어떠한 추가적인 진술도 하지 않는다. 이러한 진술을 하지 않기로 결정한 것은 응용 프로그램이 OWL과 함께 작동하는 다양한 설계 패턴을 탐색할 수 있는 자유를 제공하기 위함이다.

아래 예시에서〈MyConcept〉은 skos:Concept의 인스턴스이자 owl:Class의 인스턴스이다.
ex: 〈MyConcept〉 rdf:type skos:Concept , owl:Class .
이 예시는 SKOS 데이터 모델과 일치한다.

마찬가지로, SKOS 개념의 클래스와 OWL 속성의 클래스 간의 공식적인 관계에 대해 어떠한 진술도 하지 않는다. 아래 예시에서, 〈MyConcept〉은 skos:Concept의 인스턴스이자 owl:ObjectProperty의 인스턴스이다.
ex: 〈MyConcept〉 rdf:type skos:Concept , owl:ObjectProperty .
이 예시는 SKOS 데이터 모델과 일치한다.

편집자주
1) skos:Concept 클래스는 owl:Class의 인스턴스이며, 아이디어 또는 개념, 즉 사고의 단위로 볼 수 있다. skos:Concept의 개념은 지식 조직 시스템의 개념적 또는 지적 구조를 설명할 때, 특정 아이디어나 의미를 언급할 때 유용하다. skos:Concept이 owl:Class의 인스턴스라는 주장 외에, skos:Concept과 owl:Class 간의 형식적 관계에 대해 추가 진술을 하지 않는 것은 SKOS와 OWL을 함께 사용할 수 있는 다양한 설계 패턴을 자유롭게 탐색할 수 있도록 하기 위해서이다.
2) concept 간에 각각 상하위 관계이거나 관련이 있음을 명시할 수 있는 관계어는 무엇이 있을까? 상위 개념임을 기술하는 broader, 하위 개념임을 기술하는 narrawer, 두 개념이 각각 관련이 있음을 명시하는 related가 있다. 아래 이미지에서와 같이 도로교통법은 하나의 컨셉 즉, 개념이면서 육상교통법률이라는 상위 개념을 가진다. 이 때 우리는 skos:broader라는 관계어를 기술하여 이 둘이 상하위 개념임을 나타낼 수 있다. 반대로 해상교통법률이라는 컨셉의 하위에는 항해안전법이라는 법률 개념이 있다. 이 때에는 skos:narrower라는 관계어를 기술하여 항해안전법이 해상교통법률보다 하위 개념임을 명시하여 준다. 그리고 skos:related라는 관계어는 하나의 컨셉과 다른 하나의 컨셉이 동일한 개념적 지위를 가지지만 적용되는 범주나 의미가 달라 두 개념이 관련이 있음을 명시해 줄 때 사용된다.


Concept과 Concept 간의 관계는 Semantic Relation 파트에 자세히 정리되어 있으며 다음 링크를 참조할 것. SKOS Semantic Relation
2. Concept Scheme

Preamble
SKOS concept scheme는 하나 이상의 SKOS 개념들의 집합으로 간주될 수 있다. 이러한 개념들 사이의 의미 관계(링크)도 개념 체계의 일부로 간주될 수 있다. 그러나 이 정의는 제안적인 성격을 가지며 제한적이지 않고, 아래에 명시된 공식 데이터 모델에서는 어느 정도 유연성이 있다. SKOS concept scheme라는 개념은 알려지지 않은 출처로부터의 데이터를 다룰 때, 그리고 두 개 이상의 다른 지식 조직 시스템을 설명하는 데이터를 다룰 때 유용하다.

Vocabulary
skos:ConceptScheme
skos:inScheme
skos:hasTopConcept
skos:topConceptOf

Class & Property Definitions
1)skos:ConceptScheme는 owl:Class의 인스턴스이다.
(skos:ConceptScheme is an instance of owl:Class.)

2) skos:inScheme, skos:hasTopConcept, 그리고 skos:topConceptOf은 각각 owl:ObjectProperty의 인스턴스이다.
(skos:inScheme, skos:hasTopConcept and skos:topConceptOf are each instances of owl:ObjectProperty.)

3) skos:inScheme 속성은 SKOS 개념을 SKOS 개념 체계에 연결하는 데 사용되며, 그 rdfs:range는 skos:ConceptScheme으로 지정되어 있다.
(The rdfs:range of skos:inScheme is the class skos:ConceptScheme.)

4) skos:hasTopConcept의 rdfs:domain은 skos:ConceptScheme 클래스이다.
(The rdfs:domain of skos:hasTopConcept is the class skos:ConceptScheme. )

5) skos:hasTopConcept의 rdfs:range는 skos:Concept 클래스이다.
(The rdfs:range of skos:hasTopConcept is the class skos:Concept.)

6) skos:topConceptOf는 skos:inScheme의 하위 속성이다.
(skos:topConceptOf is a sub-property of skos:inScheme.)

7) skos:topConceptOf는 속성 skos:hasTopConcept의 역속성이다(owl:inverseOf).
(skos:topConceptOf is owl:inverseOf the property skos:hasTopConcept.)



그림 2. Concept Scheme 개념도
Examples
아래 예제는 두 개의 SKOS 개념을 포함하는 concept scheme를 설명하고 있으며, 그 중 하나는 해당 체계에서 최상위 개념이다.
〈MyScheme〉 rdf:type skos:ConceptScheme ; skos:hasTopConcept 〈MyConcept〉 .
〈MyConcept〉 skos:topConceptOf〈MyScheme〉 .
〈AnotherConcept〉 skos:inScheme 〈MyScheme〉 .
편집자 예시:
〈교통수단체계〉 rdf:type skos:ConceptScheme ; skos:hasTopConcept 〈육상교통수단〉 .
〈육상교통수단〉 skos:topConceptOf〈교통수단체계〉 .
〈버스〉 skos:inScheme 〈교통수단체계〉 .

Integrity Conditions
skos:ConceptScheme은 skos:Concept와 분리되어 있다.
(skos:ConceptScheme is disjoint with skos:Concept.)

Notes
1) Closed vs Open Systems:
개별 SKOS concept scheme의 개념은 대략 개별 시소러스, 분류 체계, 주제 머리말 시스템 또는 기타 지식 조직 시스템의 개념과 대략 일치한다. 그러나 대부분의 현재 정보 시스템에서는 시소러스나 분류 체계가 폐쇄된 시스템으로 취급되어, 해당 시스템 내에서 정의된 개념 단위는 다른 시스템에 참여할 수 없다(비록 그것들이 다른 시스템의 단위와 매핑될 수는 있지만). SKOS도 비슷한 접근 방식을 취하지만, SKOS 개념이 0, 1 또는 하나 이상의 concept scheme에 참여하는 것을 막는 조건은 없다.
예를 들어, 아래 예제에서 SKOS 개념 〈MyConcept〉은 두 개의 다른 concept scheme에 참여하고 있는데, 이것은 SKOS 데이터 모델과 일치한다.
〈MyScheme〉 rdf:type skos:ConceptScheme .
〈AnotherScheme〉 rdf:type skos:ConceptScheme ; owl:differentFrom 〈MyScheme〉 .
〈MyConcept〉 skos:inScheme 〈MyScheme〉 , 〈AnotherScheme〉 .
편집자 예시:
〈교통수단체계〉 rdf:type skos:ConceptScheme .
〈교통법률체계〉 rdf:type skos:ConceptScheme ; owl:differentFrom 〈교통수단체계〉 .
〈버스〉 skos:inScheme 〈교통수단체계〉 , 〈교통법규체계〉 .
이러한 유연성은 새로운 concept scheme를 기존의 두 개 이상의 concept scheme를 연결함으로써 설명할 수 있게 해주는 등 바람직한 것이다. 또한, concept scheme의 경계를 닫는 방법이 없다는 점을 주목해야 한다. 따라서 SKOS:inScheme을 사용하여 SKOS 개념 X, Y, Z가 개념 체계 A에 참여한다고 말할 수는 있지만, 오직 X, Y, Z만이 A에 참여한다고 말할 방법은 없다. SKOS를 사용하여 concept scheme를 설명할 수는 있지만, SKOS는 concept scheme를 완전히 정의하는 메커니즘을 제공하지 않는다.


그림 3. 기존의 두 개 이상의 concept scheme를 연결한 경우


2) SKOS Concept Schemes and OWL Ontologies:
SKOS는 SKOS concept schemes의 클래스와 OWL 온톨로지의 클래스 간의 공식적인 관계에 대해 아무런 진술도 하지 않는다. 이러한 진술을 하지 않기로 한 결정은 SKOS를 OWL [OWL-GUIDE]과 결합하여 사용하기 위한 다양한 설계 패턴을 탐색할 수 있도록 하기 위한 것이다.
아래의 예제 그래프에서, 〈MyScheme〉은 SKOS concept schemes이자 OWL 온톨로지이다. 이것은 SKOS 데이터 모델과 일치한다.
〈MyScheme〉 rdf:type skos:ConceptScheme , owl:Ontology .
〈MyConcept〉 skos:inScheme 〈MyScheme〉 .
편집자 예시:
〈교통수단체계〉 rdf:type skos:ConceptScheme , owl:Ontology .
〈버스〉 skos:inScheme 〈교통수단체계〉 .
위 예에서 〈MyScheme〉이 SKOS concept scheme와 OWL 온톨로지의 인스턴스로 동시에 선언되어 있으며, 이는 SKOS와 OWL을 함께 사용할 때 다양한 방법으로 활용될 수 있음을 나타낸다. 이러한 유연성은 SKOS와 OWL을 함께 사용하는 다양한 사용 사례에 적용될 수 있다.

3) Top Concepts and Semantic Relations:
skos:hasTopConcept 속성은 관례적으로 개념 체계를 해당 체계에 대한 계층적 관계에서 최상위에 있는 SKOS 개념(들)에 연결하는 데 사용된다. 그러나 이 관례를 강제하는 무결성 조건은 없다. 따라서 아래의 예제는 skos:hasTopConcept의 사용 관례를 엄격하게 준수하지 않지만, SKOS 데이터 모델과 일치한다.
〈MyScheme〉 skos:hasTopConcept 〈MyConcept〉 .
편집자 예시:
〈교통수단체계〉 skos:hasTopConcept 〈육상교통수단〉 .

〈MyConcept〉 skos:broader 〈AnotherConcept〉 .
편집자 예시:
〈버스〉 skos:broader 〈육상교통수단〉 .

〈AnotherConcept〉 skos:inScheme 〈MyScheme〉 .
편집자 예시:
〈자전거〉 skos:inScheme 〈육상교통수단〉 .

4) Scheme Containment and Semantic Relations:
두 SKOS 개념 사이의 링크는 동일한 개념 체계 내에서의 포함을 의미하지 않는다.(비연역성) 아래 예시에서 이를 설명하고 있다.
〈A〉 skos:narrower 〈B〉 .
〈A〉 skos:inScheme 〈MyScheme〉 .
does not entail(비연역성)
〈B〉 skos:inScheme 〈MyScheme〉 .

편집자 예시:
〈버스〉 skos:narrower 〈마을버스〉 .
〈버스〉 skos:inScheme 〈교통수단체계〉 .
does not entail(비연역성)
〈마을버스〉 skos:inScheme 〈교통수단체계〉 .

위 예에서, 〈A〉 개념은 〈MyScheme〉 개념 체계에 속해 있고, 〈B〉 개념은 〈A〉 개념보다 더 구체적이다. 그러나 이것이 〈B〉가 자동으로 〈MyScheme〉 개념 체계에 속해 있다는 것을 의미하지는 않는다. 따라서, 개별적인 개념의 체계 소속은 명시적으로 선언되어야 한다.

5) Domain of skos:inScheme:
속성 skos:inScheme에 대한 도메인이 명시되어 있지 않다는 점에 주목해야 한다. 즉, 도메인은 효과적으로 모든 리소스의 클래스(rdfs:Resource)이다. 도메인을 명시하지 않은 결정은 SKOS를 확장하여 새로운 리소스 클래스를 정의할 수 있게 하면서도 skos:inScheme을 사용하여 이들을 skos:ConceptScheme에 연결할 수 있는 유연성을 제공하기 위한 것이다.


Concept과 Concept Scheme의 개념 이해하기
1. The skos:Concept Class
Preamble
Vocabulary
Class & Property Definitions
Examples
Notes
편집자주
2. Concept Scheme
Preamble
Vocabulary
Class & Property Definitions
Examples
Integrity Conditions
Notes
편집자주
Concept과 Concept Scheme의 개념 이해하기
SKOS의 주요 클래스로는 conceptScheme와 concept이 있다. SKOS에서 'ConceptScheme'은 큰 카테고리나 분류 체계를 나타낸다. 예를 들어, '과일'이라는 ConceptScheme을 상상해보자. 마치 대형 슈퍼마켓에서 과일 섹션이 있는 것처럼, '과일' ConceptScheme은 사과, 바나나, 포도와 같은 다양한 과일들을 포괄한다. 그 안에서, 각각의 과일, 즉 사과, 바나나, 포도는 'Concept'으로 표현된다. 이들은 '과일'이라는 큰 틀 안에서 각각 독립된 항목으로 존재하며, 각각의 과일이 가지는 고유한 특성과 정보를 포함한다. 마치 사과에는 '빨강', '달콤함', '가을철'과 같은 태그가 붙을 수 있듯이, 각 Concept은 그 자체로 풍부한 정보를 가지고 있다. '과일'이라는 ConceptScheme 안에 있는 '사과', '바나나', '포도'라는 Concept들은 모두 서로 연관되어 있으면서도, 각각 독립된 정보와 속성을 가지고 있다.


예를 들어, 여러 교통법률들이 각각 하나의 개념이라고 했을 때, conceptScheme는 이러한 개념들을 하나로 묶는 교통법률 개념 체계인 것이다. 따라서 conceptScheme는 개념들, 즉 concept의 집합이라고 이해할 수 있겠다. 그리고 conceptScheme 아래에 있는 concept는 반드시 컨셉트 스키마의 일부일 필요는 없으며, 독립적인 자원으로 정의되고 선언될 수 있다.


만약 컨셉이 특정 컨셉스키마에 일부라면, skos:inScheme 속성을 사용하면 된다.


또 컨셉트들이 더 넓거나 좁은 일반화 계층 구조로 배열된 컨셉트 스키마에서는, 일반화 계층 구조에서 최상위 레벨의 컨셉트와 컨셉트 스키마 간의 연결을 명시하기 위해 skos:hasTopConcept 속성을 사용할 수 있다. 즉, 교통법률체계라는 conceptScheme에 최상위 레벨의 concept인 육상교통법률, 해상교통법률, 항공교통법률이 연결되어 있음을 기술해주는 관계어가 바로 skos:hasTopConcept 인 것이다.


conceptScheme와 동일한 클래스인 Concept은 특정한 아이디어나 주제를 나타내는 단위로 사용되며, 각각의 concept은 고유한 의미와 속성을 가진다. SKOS 개념은 지식 조직 시스템의 개념적 또는 지적 구조를 설명할 때, 그리고 KOS 내에서 확립된 특정 아이디어나 의미를 언급할 때 유용하다. 예를 들어, <육상교통법률>, <해상교통법률>, <항공교통법률>과 그 하위에 위치한 <도로교통법>이나 <항해안전법>, <항공안전법> 같은 교통법규를 concept으로 표현할 수 있다.


1. The skos:Concept Class
Preamble
skos:Concept 클래스는 SKOS 개념의 클래스이다. SKOS 개념은 하나의 생각 또는 개념, 생각의 단위로 볼 수 있다. 그러나 생각의 단위가 무엇인지는 주관적이며, 이 정의는 제안적인 것이지 제한적인 것이 아니어야 한다. skos:Concept이라는 개념은 지식 조직 시스템(KOS)의 개념적 또는 지적 구조를 설명할 때, 그리고 KOS 내에서 확립된 특정 아이디어나 의미를 참조할 때 유용하다. SKOS는 주로 사전 정의되지 않은 KOS를 나타내기 위해 설계되었기 때문에, 이 클래스의 형식적 정의에는 일정한 유연성이 내장되어 있다는 점을 주목할 필요가 있다.

Vocabulary
skos:Concept

Class & Property Definitions
skos:Concept은 owl:Class의 인스턴스이다.
(skos:Concept is an instance of owl:Class.)

Examples
아래 예시는 〈MyConcept〉이 SKOS 개념임을 나타낸다(즉, skos:Concept의 인스턴스이다).
〈MyConcept〉rdf:type skos:Concept .
편집자 예시:〈육상교통수단〉rdf:type skos:Concept .


그림 1. 교통수단체계 개념도
Notes
SKOS Concepts, OWL Classes and OWL Properties:
SKOS에서는 skos:Concept이 owl:Class의 인스턴스라는 주장 외에는 SKOS 개념의 클래스와 OWL 클래스의 클래스 간의 공식적인 관계에 대해 어떠한 추가적인 진술도 하지 않는다. 이러한 진술을 하지 않기로 결정한 것은 응용 프로그램이 OWL과 함께 작동하는 다양한 설계 패턴을 탐색할 수 있는 자유를 제공하기 위함이다.

아래 예시에서〈MyConcept〉은 skos:Concept의 인스턴스이자 owl:Class의 인스턴스이다.
ex: 〈MyConcept〉 rdf:type skos:Concept , owl:Class .
이 예시는 SKOS 데이터 모델과 일치한다.

마찬가지로, SKOS 개념의 클래스와 OWL 속성의 클래스 간의 공식적인 관계에 대해 어떠한 진술도 하지 않는다. 아래 예시에서, 〈MyConcept〉은 skos:Concept의 인스턴스이자 owl:ObjectProperty의 인스턴스이다.
ex: 〈MyConcept〉 rdf:type skos:Concept , owl:ObjectProperty .
이 예시는 SKOS 데이터 모델과 일치한다.

편집자주
1) skos:Concept 클래스는 owl:Class의 인스턴스이며, 아이디어 또는 개념, 즉 사고의 단위로 볼 수 있다. skos:Concept의 개념은 지식 조직 시스템의 개념적 또는 지적 구조를 설명할 때, 특정 아이디어나 의미를 언급할 때 유용하다. skos:Concept이 owl:Class의 인스턴스라는 주장 외에, skos:Concept과 owl:Class 간의 형식적 관계에 대해 추가 진술을 하지 않는 것은 SKOS와 OWL을 함께 사용할 수 있는 다양한 설계 패턴을 자유롭게 탐색할 수 있도록 하기 위해서이다.
2) concept 간에 각각 상하위 관계이거나 관련이 있음을 명시할 수 있는 관계어는 무엇이 있을까? 상위 개념임을 기술하는 broader, 하위 개념임을 기술하는 narrawer, 두 개념이 각각 관련이 있음을 명시하는 related가 있다. 아래 이미지에서와 같이 도로교통법은 하나의 컨셉 즉, 개념이면서 육상교통법률이라는 상위 개념을 가진다. 이 때 우리는 skos:broader라는 관계어를 기술하여 이 둘이 상하위 개념임을 나타낼 수 있다. 반대로 해상교통법률이라는 컨셉의 하위에는 항해안전법이라는 법률 개념이 있다. 이 때에는 skos:narrower라는 관계어를 기술하여 항해안전법이 해상교통법률보다 하위 개념임을 명시하여 준다. 그리고 skos:related라는 관계어는 하나의 컨셉과 다른 하나의 컨셉이 동일한 개념적 지위를 가지지만 적용되는 범주나 의미가 달라 두 개념이 관련이 있음을 명시해 줄 때 사용된다.


Concept과 Concept 간의 관계는 Semantic Relation 파트에 자세히 정리되어 있으며 다음 링크를 참조할 것. SKOS Semantic Relation
2. Concept Scheme

Preamble
SKOS concept scheme는 하나 이상의 SKOS 개념들의 집합으로 간주될 수 있다. 이러한 개념들 사이의 의미 관계(링크)도 개념 체계의 일부로 간주될 수 있다. 그러나 이 정의는 제안적인 성격을 가지며 제한적이지 않고, 아래에 명시된 공식 데이터 모델에서는 어느 정도 유연성이 있다. SKOS concept scheme라는 개념은 알려지지 않은 출처로부터의 데이터를 다룰 때, 그리고 두 개 이상의 다른 지식 조직 시스템을 설명하는 데이터를 다룰 때 유용하다.

Vocabulary
skos:ConceptScheme
skos:inScheme
skos:hasTopConcept
skos:topConceptOf

Class & Property Definitions
1)skos:ConceptScheme는 owl:Class의 인스턴스이다.
(skos:ConceptScheme is an instance of owl:Class.)

2) skos:inScheme, skos:hasTopConcept, 그리고 skos:topConceptOf은 각각 owl:ObjectProperty의 인스턴스이다.
(skos:inScheme, skos:hasTopConcept and skos:topConceptOf are each instances of owl:ObjectProperty.)

3) skos:inScheme 속성은 SKOS 개념을 SKOS 개념 체계에 연결하는 데 사용되며, 그 rdfs:range는 skos:ConceptScheme으로 지정되어 있다.
(The rdfs:range of skos:inScheme is the class skos:ConceptScheme.)

4) skos:hasTopConcept의 rdfs:domain은 skos:ConceptScheme 클래스이다.
(The rdfs:domain of skos:hasTopConcept is the class skos:ConceptScheme. )

5) skos:hasTopConcept의 rdfs:range는 skos:Concept 클래스이다.
(The rdfs:range of skos:hasTopConcept is the class skos:Concept.)

6) skos:topConceptOf는 skos:inScheme의 하위 속성이다.
(skos:topConceptOf is a sub-property of skos:inScheme.)

7) skos:topConceptOf는 속성 skos:hasTopConcept의 역속성이다(owl:inverseOf).
(skos:topConceptOf is owl:inverseOf the property skos:hasTopConcept.)



그림 2. Concept Scheme 개념도
Examples
아래 예제는 두 개의 SKOS 개념을 포함하는 concept scheme를 설명하고 있으며, 그 중 하나는 해당 체계에서 최상위 개념이다.
〈MyScheme〉 rdf:type skos:ConceptScheme ; skos:hasTopConcept 〈MyConcept〉 .
〈MyConcept〉 skos:topConceptOf〈MyScheme〉 .
〈AnotherConcept〉 skos:inScheme 〈MyScheme〉 .
편집자 예시:
〈교통수단체계〉 rdf:type skos:ConceptScheme ; skos:hasTopConcept 〈육상교통수단〉 .
〈육상교통수단〉 skos:topConceptOf〈교통수단체계〉 .
〈버스〉 skos:inScheme 〈교통수단체계〉 .

Integrity Conditions
skos:ConceptScheme은 skos:Concept와 분리되어 있다.
(skos:ConceptScheme is disjoint with skos:Concept.)

Notes
1) Closed vs Open Systems:
개별 SKOS concept scheme의 개념은 대략 개별 시소러스, 분류 체계, 주제 머리말 시스템 또는 기타 지식 조직 시스템의 개념과 대략 일치한다. 그러나 대부분의 현재 정보 시스템에서는 시소러스나 분류 체계가 폐쇄된 시스템으로 취급되어, 해당 시스템 내에서 정의된 개념 단위는 다른 시스템에 참여할 수 없다(비록 그것들이 다른 시스템의 단위와 매핑될 수는 있지만). SKOS도 비슷한 접근 방식을 취하지만, SKOS 개념이 0, 1 또는 하나 이상의 concept scheme에 참여하는 것을 막는 조건은 없다.
예를 들어, 아래 예제에서 SKOS 개념 〈MyConcept〉은 두 개의 다른 concept scheme에 참여하고 있는데, 이것은 SKOS 데이터 모델과 일치한다.
〈MyScheme〉 rdf:type skos:ConceptScheme .
〈AnotherScheme〉 rdf:type skos:ConceptScheme ; owl:differentFrom 〈MyScheme〉 .
〈MyConcept〉 skos:inScheme 〈MyScheme〉 , 〈AnotherScheme〉 .
편집자 예시:
〈교통수단체계〉 rdf:type skos:ConceptScheme .
〈교통법률체계〉 rdf:type skos:ConceptScheme ; owl:differentFrom 〈교통수단체계〉 .
〈버스〉 skos:inScheme 〈교통수단체계〉 , 〈교통법규체계〉 .
이러한 유연성은 새로운 concept scheme를 기존의 두 개 이상의 concept scheme를 연결함으로써 설명할 수 있게 해주는 등 바람직한 것이다. 또한, concept scheme의 경계를 닫는 방법이 없다는 점을 주목해야 한다. 따라서 SKOS:inScheme을 사용하여 SKOS 개념 X, Y, Z가 개념 체계 A에 참여한다고 말할 수는 있지만, 오직 X, Y, Z만이 A에 참여한다고 말할 방법은 없다. SKOS를 사용하여 concept scheme를 설명할 수는 있지만, SKOS는 concept scheme를 완전히 정의하는 메커니즘을 제공하지 않는다.


그림 3. 기존의 두 개 이상의 concept scheme를 연결한 경우


2) SKOS Concept Schemes and OWL Ontologies:
SKOS는 SKOS concept schemes의 클래스와 OWL 온톨로지의 클래스 간의 공식적인 관계에 대해 아무런 진술도 하지 않는다. 이러한 진술을 하지 않기로 한 결정은 SKOS를 OWL [OWL-GUIDE]과 결합하여 사용하기 위한 다양한 설계 패턴을 탐색할 수 있도록 하기 위한 것이다.
아래의 예제 그래프에서, 〈MyScheme〉은 SKOS concept schemes이자 OWL 온톨로지이다. 이것은 SKOS 데이터 모델과 일치한다.
〈MyScheme〉 rdf:type skos:ConceptScheme , owl:Ontology .
〈MyConcept〉 skos:inScheme 〈MyScheme〉 .
편집자 예시:
〈교통수단체계〉 rdf:type skos:ConceptScheme , owl:Ontology .
〈버스〉 skos:inScheme 〈교통수단체계〉 .
위 예에서 〈MyScheme〉이 SKOS concept scheme와 OWL 온톨로지의 인스턴스로 동시에 선언되어 있으며, 이는 SKOS와 OWL을 함께 사용할 때 다양한 방법으로 활용될 수 있음을 나타낸다. 이러한 유연성은 SKOS와 OWL을 함께 사용하는 다양한 사용 사례에 적용될 수 있다.

3) Top Concepts and Semantic Relations:
skos:hasTopConcept 속성은 관례적으로 개념 체계를 해당 체계에 대한 계층적 관계에서 최상위에 있는 SKOS 개념(들)에 연결하는 데 사용된다. 그러나 이 관례를 강제하는 무결성 조건은 없다. 따라서 아래의 예제는 skos:hasTopConcept의 사용 관례를 엄격하게 준수하지 않지만, SKOS 데이터 모델과 일치한다.
〈MyScheme〉 skos:hasTopConcept 〈MyConcept〉 .
편집자 예시:
〈교통수단체계〉 skos:hasTopConcept 〈육상교통수단〉 .

〈MyConcept〉 skos:broader 〈AnotherConcept〉 .
편집자 예시:
〈버스〉 skos:broader 〈육상교통수단〉 .

〈AnotherConcept〉 skos:inScheme 〈MyScheme〉 .
편집자 예시:
〈자전거〉 skos:inScheme 〈육상교통수단〉 .

4) Scheme Containment and Semantic Relations:
두 SKOS 개념 사이의 링크는 동일한 개념 체계 내에서의 포함을 의미하지 않는다.(비연역성) 아래 예시에서 이를 설명하고 있다.
〈A〉 skos:narrower 〈B〉 .
〈A〉 skos:inScheme 〈MyScheme〉 .
does not entail(비연역성)
〈B〉 skos:inScheme 〈MyScheme〉 .

편집자 예시:
〈버스〉 skos:narrower 〈마을버스〉 .
〈버스〉 skos:inScheme 〈교통수단체계〉 .
does not entail(비연역성)
〈마을버스〉 skos:inScheme 〈교통수단체계〉 .

위 예에서, 〈A〉 개념은 〈MyScheme〉 개념 체계에 속해 있고, 〈B〉 개념은 〈A〉 개념보다 더 구체적이다. 그러나 이것이 〈B〉가 자동으로 〈MyScheme〉 개념 체계에 속해 있다는 것을 의미하지는 않는다. 따라서, 개별적인 개념의 체계 소속은 명시적으로 선언되어야 한다.

5) Domain of skos:inScheme:
속성 skos:inScheme에 대한 도메인이 명시되어 있지 않다는 점에 주목해야 한다. 즉, 도메인은 효과적으로 모든 리소스의 클래스(rdfs:Resource)이다. 도메인을 명시하지 않은 결정은 SKOS를 확장하여 새로운 리소스 클래스를 정의할 수 있게 하면서도 skos:inScheme을 사용하여 이들을 skos:ConceptScheme에 연결할 수 있는 유연성을 제공하기 위한 것이다.

개념 설명
역관계 (inverse relation)
기능적 속성 (Functional Property)
이행성 (Transitivity)
대칭성 (Symmetry)
재귀성 (Reflexivity)
skos:semanticRelation
Preamble
Vocabulary
Class & Property Definitions
Integrity Conditions
Examples
Example 25 (consistent, 일관성 있음)
Example 26 (not consistent, 일관성 없음)
Example 27 (not consistent, 일관성 없음)
Example 28 (not consistent, 일관성 없음)
Example 29 (not consistent, 일관성 없음)
NOTES
시맨틱 릴레이션의 하위속성 관계 (Sub-Property Relationships)
SKOS 시맨틱 릴레이션의 도메인과 레인지
skos:related의 대칭성
Example 30 (entailment, 상속됨)
Example 31 (entailment, 상속됨)
skos:related와 이행성
Example 32 (non-entailment, 상속되지 않음)
skos:related와 재귀성
Example 33 (consistent, 일관성 있음)
skos:broader과 이행성
Example 34 (non-entailment, 상속되지 않음)
Example 35 (entailment, 상속됨)
skos:broader과 재귀성
Example 36 (consistent, 일관성 있음)
계층적 관계속의 사이클 (skos:broaderTransitive와 재귀성)
Example 37 (consistent, 일관성 있음)
계층 관계의 대체 경로
Example 38 (consistent, 일관성 있음)
Example 39 (consistent, 일관성 있음)
skos:related와 skos:broaderTransitive의 상호배타성
개념 설명
시멘틱 릴레이션에서 관계속성(Object Properties)은 역관계(inverse relation), 기능적 속성(Functional Property), 이행성 또는 추이적 속성(Transitivity/Transitive Property), 대칭성(Symmetry), 재귀성(Reflexivity)등 특징을 가질 수 있으므로 시멘틱 릴레이션을 소개하기 전 개념 설명을 먼저 하도록 한다.

역관계 (inverse relation)
Matthew는 Jean라는 엄마가 있다. 역으로 Jean는 Matthew라는 아들이 있다. 이는 역관계다.



기능적 속성 (Functional Property)
Jean의 생모는 한 명밖에 없어서 Peggy와 Margarat는 같은 사람임을 알 수 있다. 이러한 특징을 가진 관계속성은 값이 하나밖에 없다.



이행성 (Transitivity)
Matthew의 조상은 Peter이며 Peter의 조상은 William이다. 그러면 Matthew의 조상은 William이라고 추론할 수 있다. 이는 이행성은 가진 관계 속성이다.



대칭성 (Symmetry)
Matthew의 형제자매가 Gemma이면 Gemma의 형제자매도 Matthew이라고 할 수 있다. 그 외 친구 관계도 대칭성을 가진 관계 속성이다.



재귀성 (Reflexivity)
Greoge는 자신을 알고 있고 Simon도 자신을 알고 있다. 이는 재귀성이다.



skos:semanticRelation
Preamble
SKOS 시맨틱 릴레이션이란 SKOS 컨셉간의 링크다. 그 링크는 연결된 컨셉의 관계 의미에 내재되어 있다. SKOS는 기본적으로 두가지 시맨틱 릴레이션이 있다. 바로 계층과 연관관계이다(아래 사진 참조). 계층 관계일 경우 한 컨셉의 범위는 다른 컨셉보다 넓거나 좁다. 반면, 연관관계일 경우 두 컨셉은 본래 연관되어 있으며 그 중 하나가 다른 것의 상위 개념이 될 수 없다.


SKOS Semantic Relation

자세히 알아보기
베스트셀러 전자책
위키 기반 정보
소프트웨어
속성 skos:broader 와 skos:narrower는 두 SKOS 컨셉간의 직접적 계층관계를 단언하는 것이다. 트리플 모델 〈A〉 skos:broader 〈B〉일 경우, 목적어〈B〉는 주어〈A〉보다 더 넓은 개념이다. 마찬가지로 트리플 모델 〈C〉 skos:narrower 〈D〉일 경우, 목적어〈D〉가 주어〈C〉보다 더 좁은 개념이다.


관례상 skos:broader 와 skos:narrower는 두 SKOS 컨셉의 직접적인 계층 관계에만 사용한다. 이는 어플리케이션에 직접적인 상위와 하위 관계를 접근할 수 있는 편리하고 신뢰성 있는 방법을 제공한다. 이 사용 규칙을 지원하기 위해 skos:broader와 skos:narrower는 추이적 속성으로 선언되지 않았음에 주의해야 한다.


일부 어플리케이션에서 컨셉간의 직접적과 간적접 계층 관계를 이용할 필요가 있다. 예를 들어 쿼리를 통해 더 좋은 검색 결과가 나오게끔 개선하려고 한다. 이런 목적 하에 속성skos:broaderTransitive와 skos:narrowerTransitive가 생겨났다. 트리플 모델 〈A〉 skos:broaderTransitive 〈B〉는 직접적과 간접적 계층 관계에서 〈B〉가 〈A〉보다 더 넓은 “조상” 개념임을 대표한다. 트리플 모델 〈C〉 skos:narrowerTransitive 〈D〉는 직접적 및 간접적 계층 관계에서 〈C〉가 〈D〉보다 더 좁은 “자손”개념임을 대표한다.


관례상 skos:broaderTransitive와 skos:narrowerTransitive의 용도는 두 컨셉간의 관계를 단언하는 것이 아니다. 오히려 계층관계의 끝을 추론하는 목적으로 쓰이며 모든 간접적 및 직접적 관계에 접근할 수 있다.


속성 skos:related는 두 SKOS 컨셉의 연관관계를 단언하는 목적으로 쓰인다.
더 많은 계층적과 연관적 관계를 서술한 예시들을 보려면 [SKOS-PRIMER]를 참고 바람.

Vocabulary
skos:broader
skos:narrower
skos:related
skos:broaderTransitive
skos:narrowerTransitive

Class & Property Definitions
S18 || skos:semanticRelation, skos:broader, skos:narrower, skos:related, skos:broaderTransitive and skos:narrowerTransitive 모두 owl:ObjectProperty의 인스턴스다.
S19 || skos:semanticRelation의 rdfs:domain(도메인)은 skos:Concept라는 클래스에 속한다.
S20 || skos:semanticRelation의 rdfs:range(레인지)는 skos:Concept라는 클래스에 속한다.
S21 || skos:broaderTransitive, skos:narrowerTransitive와 skos:related 모두 skos:semanticRelation의 하위 속성이다.
S22 || skos:broader는 skos:broaderTransitive의 하위 속성이며 skos:narrower는 skos:narrowerTransitive의 하위 속성이다.
S23 || skos:related는 owl:SymmetricProperty(대칭속성)의 인스턴스다.
S24 || skos:broaderTransitive와 skos:narrowerTransitive는 owl:TransitiveProperty(추이적 속성)의 인스턴스다.
S25 || skos:narrower와 skos:broader의 관계는 owl:inverseOf로 표현할 수 있다.
S26 || skos:narrowerTransitive와 skos:broaderTransitive의 관계는 owl:inverseOf로 표현할 수 있다.

Integrity Conditions
S27 || skos:related는 속성 skos:broaderTransitive와 상관없다.
skos:related는 대칭 속성이며 skos:broaderTransitive와 skos:narrowerTransitive는 서로 역관계이기 때문에 skos:related는 skos:narrowerTransitive와도 상관없다는 것에 유념해야 한다.

Examples
아래 예시에서 〈A〉와 〈B〉 (〈A〉의 상위어가 〈B〉다)의 직접적 계층관계를, 〈A〉와 〈C〉의 연관관계를 단언한다. 이러한 설계는 SKOS 데이터 모델과 일치한다. 교통수단 체계 개념도를 예시로 들겠습니다.

교통수단 체계 개념도

Example 25 (consistent, 일관성 있음)
〈A〉 skos:broader 〈B〉 ; skos:related 〈C〉.

[편집자]
〈시외버스〉 skos:broader 〈버스〉 ; skos:related 〈고속버스〉.
〈시외버스〉의 상위개념이 〈버스〉이면서, 〈시외버스〉와 〈고속버스〉가 연관 관계에 있다고 기술하는 것은 일관성이 있다.


아래 예시에서 SKOS 데이터 모델과 불일치하는 이유는 연관관계와 계층 관계가 서로 충돌하기 때문이다.

Example 26 (not consistent, 일관성 없음)
〈A〉 skos:broader 〈B〉 ; skos:related 〈B〉.

[편집자]
〈승용차〉 skos:broader 〈육상교통수단〉
X〈승용차〉skos:related 〈육상교통수단〉.

〈승용차〉의 상위 개념이 〈육상교통수단〉이라고 할 때 〈승용차〉와 〈육상교통수단〉이 연관 관계라고 하는 것은 일관성이 없다. 따라서 성립하지 않는다.


아래 예시에서 SKOS 데이터 모델과 불일치하는 이유는 연관관계와 계층 관계가 서로 충돌하기 때문이다.

Example 27 (not consistent, 일관성 없음)
자세히 알아보기
신간 전자책 알림
스크립트 언어
딥러닝 전자책
〈A〉 skos:broader 〈B〉 ; skos:related 〈C〉. 〈B〉 skos:broader 〈C〉 .

[편집자]
〈시외버스〉 skos:broader 〈버스〉.
〈시외버스〉skos:related 〈고속버스〉.
X〈버스〉 skos:broader 〈고속버스〉.

〈시외버스〉의 상위 개념이 〈버스〉이면서 〈고속버스〉와 연관 관계라고 할 때 〈버스〉의 상위 개념이 〈고속버스〉라고 하는 것은 일관성이 없다. 따라서 성립하지 않는다.

예시 27에서 연관관계와 계층관계의 충돌이 곧바로 보이지 않지만 위 클래스와 속성 정의에 의해 예시 28의 서술을 추론할 수 있다.

Example 28 (not consistent, 일관성 없음)
〈A〉 skos:broaderTransitive 〈C〉 ; skos:related 〈C〉.

[편집자]
〈버스〉 skos:broaderTransitive 〈육상교통수단〉.
X〈버스〉skos:related 〈육상교통수단〉.

〈버스〉의 상위 개념이 〈육상교통수단〉이라고 할 때, 〈버스〉와 〈육상교통수단〉이 연관 관계라고 하는 것은 일관성이 없다.

아래 예시에서 SKOS 데이터 모델과 불일치하는 이유는 똑같이 연관 관계와 계층 관계가 서로 충돌하기 때문이다. 위 클래스와 속성 정의에 의해 추론할 수 있다.

Example 29 (not consistent, 일관성 없음)
〈A〉 skos:narrower 〈B〉 ; skos:related 〈C〉. 〈B〉 skos:narrower 〈C〉 .

[편집자]
〈육상교통수단〉 skos:narrower 〈버스〉 .
〈육상교통수단〉skos:related 〈항공교통수단〉.
X〈버스〉 skos:narrower 〈항공교통수단〉.

〈육상교통수단〉의 하위 개념이 〈버스〉이면서 〈항공교통수단〉과 연관 관계라고 했는데, 〈버스〉의 하위 개념이 〈항공교통수단〉라고 하는 것은 일관성이 없다.

NOTES
시맨틱 릴레이션의 하위속성 관계 (Sub-Property Relationships)
아래 도식은 SKOS 시맨틱 릴레이션간의 비공식적인 하위속성 관계를 표현한다.



SKOS 시맨틱 릴레이션의 도메인과 레인지
skos:semanticRelation의 도메인과 레인지는 skos:Concept라는 클래스에 속한다. 그리고 skos:broader, skos:narrower와 skos:related는 모두 skos:semanticRelation의 하위 속성이므로 예시 25에서 〈A〉, 〈B〉와 〈C〉는 모두 skos:Concept의 인스턴스라는 것을 추론할 수 있다.

skos:related의 대칭성
skos:related는 대칭속성이다. 아래 예시는 해당 조건에 부합하는 것이다.

Example 30 (entailment, 상속됨)
〈A〉 skos:related 〈B〉.
entails
〈B〉 skos:related 〈A〉.

[편집자]
〈바티칸〉 skos:related 〈한국〉.
entails (수반한다)
〈한국〉 skos:related 〈바티칸〉.

〈바티칸〉이 〈한국〉과 연관 관계에 있다면 〈한국〉도 〈바티칸〉과 연관 관계에 있다.

skos:related가 대칭속성이라고 해서 skos:related의 하위 속성일 경우 대칭성이 반드시 있어야 하는 것이 아니다(skos:related의 하위속성은 대칭적, 비대칭적, 반대칭적 관계가 될 수도 있고 SKOS 데이터 모델과 일치한다.) 아래 예시에서 이런 상황을 반영한다. 두 속성은 skos:related의 하위 속성이며 대칭성이 없지만 SKOS 데이터 모델과 일치한다.

Example 31 (entailment, 상속됨)
〈cause〉 rdf:type owl:ObjectProperty ; rdfs:subPropertyOf skos:related.
〈effect〉 rdf:type owl:ObjectProperty ; rdfs:subPropertyOf skos:related ; owl:inverseOf 〈cause〉.
〈A〉 〈cause〉 〈B〉 .
entails
〈A〉 skos:related 〈B〉.
〈B〉 〈effect〉 〈A〉 ; skos:related 〈A〉.

[편집자]
〈선배〉, 〈후배〉 rdf:type owl:ObjectProperty ; rdfs:subPropertyOf skos:related.
〈선배〉 owl:inverseOf 〈후배〉
〈손흥민〉 〈선배〉 〈박지성〉
entails (수반한다)
〈손흥민〉 skos:related 〈박지성〉.
〈박지성〉 〈후배〉 〈손흥민〉 ; skos:related 〈손흥민〉.

자세히 알아보기
컴퓨터 교육
소프트웨어공학
파이썬 전자책
〈선배〉는 관계 속성(owl:ObjectProperty)이면서, skos:related의 하위 속성이며,
〈후배〉는 관계 속성(owl:ObjectProperty)이면서, skos:related의 하위 속성이며,
〈선배〉와 역 관계(owl:inverseOf)라고 할 때,

〈손흥민〉의 〈선배〉가 〈박지성〉이라고 한다면, 〈손흥민〉과 〈박지성〉은 연관 관계(skos:related)가 있으며, 〈박지성〉은 〈손흥민〉의 〈선배〉이고, 〈박지성〉은 〈손흥민〉과 연관 관계가 있다.

skos:related와 이행성
skos:related는 이행성의 특징이 없다는 것에 유념해야 한다. 따라서 SKOS 데이터 모델은 아래 예시에서 추론한 내용을 지원하지 않는다.

Example 32 (non-entailment, 상속되지 않음)
〈A〉 skos:related 〈B〉.
〈B〉 skos:related 〈C〉.
does not entail
〈A〉 skos:related 〈C〉.

[편집자]
〈한국〉 skos:related 〈바티칸〉.
〈바티칸〉 skos:related 〈대만〉.
does not entail (다음을 수반하지 않음)
〈한국〉 skos:related 〈대만〉

〈바티칸〉은 각각 〈한국〉 및 〈대만〉과 수교국 관계라고 했을 때〈한국〉과 〈대만〉은 수교국 관계일 수도 있으나, 확정할 수는 없다.



skos:related와 재귀성
skos:related는 재귀성이나 비재귀성에 속한다고 하지 않았다.
skos:related는 비재귀성 속성이라고 정의하지 않았기 때문에 아래 예시는 SKOS 데이터 모델과 일치한다.

Example 33 (consistent, 일관성 있음)
〈A〉 skos:related 〈A〉.

[편집자]
〈나〉skos:related 〈나〉.

나는 나와 연관 관계가 있다고 하는 것은 일관성 있다.

하지만, KOS를 사용한 많은 어플리케이션에서 X skos:related X란 서술이 잠재적인 문제가 된다. 예를 들어 한 어플리케이션이 SKOS데이터를 처리하기 전 이러한 서술을 검색을 통해 찾아내고 싶은 경우가 그것이다. 그러나 이러한 서술은 어떻게 처리해야 할지 SKOS 문서에서 정의하지 않았고 어플리케이션에 따라 처리 방식도 다를 수 있다.

skos:broader과 이행성
skos:broader는 이행성의 특징이 없다는 것을 유념해야 한다. skos:narrower도 마찬가지다. 따라서 SKOS 데이터 모델은 아래 예시에서 추론한 내용을 지원하지 않는다.

Example 34 (non-entailment, 상속되지 않음)
〈A〉 skos:broader 〈B〉.
〈B〉 skos:broader 〈C〉.
does not entail
〈A〉 skos:broader 〈C〉

[편집자]
〈수륙양용버스〉 skos:broader 〈버스〉.
〈버스〉 skos:broader 〈육상교통수단〉.
does not entail (다음을 수반하지 않음)
〈수륙양용버스〉 skos:broader 〈육상교통수단〉

〈수륙양용버스〉의 상위 개념이 〈버스〉이며 〈버스〉의 상위 개념이 〈육상교통수단〉이라고 했을 때, 〈수륙양용버스〉의 상위 개념이 반드시 〈육상교통수단〉이라고 할 수는 없다. 왜냐하면 skos:broader는 이행성을 가지지 않기 때문이다. 다만 〈버스〉와 그의 상위컨셉인 〈육상교통수단〉의 관계를 skos:broaderTransitive로 표현할 수도 있습니다. 이유는 교통수단체계에서 〈버스〉의 상위컨셉이 간접적으로도〈육상교통수단〉인 것을 추론할 수 있는 것입니다.



자세히 알아보기
e-book
파이썬 교과서
지식 공유 플랫폼
그러나 skos:broader는 skos:broaderTransitive의 하위 속성이고 skos:narrower는 skos:narrowerTransitive의 하위 속성이며 skos:broaderTransitive와 skos:narrowerTransitive일 경우 이행성을 갖고 있다. 따라서 SKOS 데이터 모델은 아래 예시에서 추론한 내용을 지원한다.

Example 35 (entailment, 상속됨)
〈A〉 skos:broaderTransitive 〈B〉.
〈B〉 skos:broaderTransitive 〈C〉.
entails
〈A〉 skos:broaderTransitive 〈C〉.

[편집자]
〈마을버스〉 skos:broaderTransitive 〈버스〉.
〈버스〉 skos:broaderTransitive 〈육상교통수단〉.
entails (수반한다)
〈마을버스〉 skos:broaderTransitive 〈육상교통수단〉.

〈마을버스〉의 상위 개념이 〈버스〉이며 〈버스〉의 상위 개념이 〈육상교통수단〉이라고 했을 때 〈마을버스〉의 상위 개념은 〈육상교통수단〉이다. 왜냐하면 skos:broaderTransitive는 이행성을 가지고 있기 때문이다.

관례상, skos:broader와 skos:narrower는 두 SKOS 컨셉간의 직접적 계층 관계에서만 단언할 수 있고 skos:broaderTransitive와 skos:narrowerTransitive는 관계를 단언하는 대신 추론에 쓰이는 것이다. 이러한 패턴을 통해 직접적 계층관계 정보(KOS시스템에서 시각적 표현들을 구축할 때 필수 내용이다)를 보존할 수 있으며 직접 및 간접 계층관계의 끝을 편리하게 쿼리할 수 있는 것이 쿼리 확장 알고리즘에서 유용하다.

추이적 속성의 하위 속성은 무조건 추이적 속성이 아닌 것을 유념해야 한다.

skos:broader과 재귀성
본 문서에서는 skos:broader의 재귀성 속성에 대해 서술하지 않았다. skos:broader가 곧 재귀성 속성이라든지 비재귀성 속성이라고 하지 않았다. 어떤 리소스 〈A〉이든, 아래 트리플은 존재할 수도 있고 존재하지 않을 수도 있다.

Example 36 (consistent, 일관성 있음)
〈A〉 skos:broader 〈A〉

[편집자]
〈연극〉 skos:broader 〈연극〉

〈연극〉의 상위 개념이 〈연극〉이라고 하는 것은 일관성이 있다. 〈연극〉의 하위 개념이 〈연극〉,〈배우〉, 〈제작〉, 〈극장〉, 〈관객〉등 요소를 포함할 수 있다.

이러한 보수적인 서술에 SKOS가 두가지 KOS모델에서 쓸 수 있게 된다. 하나는 재귀성이 가진 skos:broader(예: 추론된 OWL 하위클래스)이고, 하나는 비재귀성이 가진 skos:broader(예: 대부분 유사어사전이나 분류 스키마에 합당함)이다.

마찬가지로 skos:narrower 가 재귀적이나 비재귀적인지 선언하지 않았다.

하지만, KOS를 사용한 많은 어플리케이션에서 X skos:broader X 또는 Y skos:narrower Y란 서술이 잠재적인 문제가 된다. 한 어플리케이션이 SKOS데이터를 처리하기 전 이러한 서술을 검색을 통해 찾아내고 싶은 것이다. 그런데, 이러한 서술은 어떻게 처리해야 할지 SKOS 문서에서 정의하지 않았고 어플리케이션에 따라 처리 방식도 다를 수 있다.

계층적 관계속의 사이클 (skos:broaderTransitive와 재귀성)
아래 예시에서 계층적 관계속의 사이클을 서술하였다. 조건에서 skos:broaderTransitive가 비재귀성 속성이라고 요구하지 않는다.

Example 37 (consistent, 일관성 있음)
〈A〉 skos:broader 〈B〉.
〈B〉 skos:broader 〈A〉.

[편집자]
〈미성년자〉 skos:broader 〈청소년〉.
〈청소년〉 skos:broader 〈미성년자〉.

〈미성년자〉의 상위가 〈청소년〉이면서, 〈청소년〉의 상위가 〈미성년자〉일 수 있다.
*참조: 법적으로 〈미성년자〉가 19세에 달하지 않은 자를 말하며 〈청소년〉은 만 9세 이상, 24세 이하인 사람을 가리킨다.

일반적으로 해당 경우는 거의 발생하지 않으나, 부분집합인 경우를 고려할 수 있으며, 이를 통해서 SKOS의 유연성을 줄 수 있다. 다만, 실 상황에서는 거의 발생하지 않으며, 무의미한 혼란을 줄 수 있기에 사용에 주의를 요구한다.

그러나 KOS 사용하는 많은 어플리케이션에서 계층관계 속의 사이클이 잠재적 문제가 된다. 이러한 어플리케이션에서 계층관계 속의 사이클을 찾으려면 skos:broaderTransitive가 어디서 끝났는지, X skos:broaderTransitive X 서술을 찾아내는 것이 가장 편한 방법이다. 이러한 서술은 어떻게 처리해야 할지 SKOS 문서에서 정의하지 않았고 어플리케이션에 따라 처리 방식도 다를 수 있다.

계층 관계의 대체 경로
아래 예시에서 계층관계 속에 〈A〉에서 〈C〉까지 두가지 대체 경로가 있다.

Example 38 (consistent, 일관성 있음)
〈A〉 skos:broader 〈B〉 , 〈C〉.
〈B〉 skos:broader 〈C〉.

[편집자]
〈마을버스〉 skos:broader 〈버스〉 , 〈육상교통수단〉.
〈버스〉 skos:broader 〈육상교통수단〉.

〈마을버스〉의 상위 개념이 〈버스〉이고, 〈마을버스〉의 상위개념이 〈육상교통수단〉이면서, 〈버스〉의 상위 개념이 〈육상교통수단〉인 것은 일관성이 있기에 성립이 가능하다.

아래 예시에서 계층관계속에 〈A〉에서 〈D〉까지 두가지 대체 경로가 있다.

Example 39 (consistent, 일관성 있음)
〈A〉 skos:broader 〈B〉 , 〈C〉.
〈B〉 skos:broader 〈D〉.
〈C〉 skos:broader 〈D〉.

[편집자]
〈강남01〉 skos:broader 〈마을버스〉 , 〈버스〉.
〈마을버스〉 skos:broader 〈육상교통수단〉.
〈버스〉 skos:broader 〈육상교통수단〉.

〈강남01〉의 상위개념이 〈마을버스〉이고, 〈강남01〉의 상위개념이 〈버스〉이면서, 〈마을버스〉의 상위개념이 〈육상교통수단〉이며, 〈버스〉의 상위개념이 〈육상교통수단〉인 것은 일관성이 있기에 성립이 가능하다.

이러한 패턴은 다중계층적 KOS에서 흔히 볼 수 있는 것이다.

둘 다 SKOS 데이터 모델과 일치하며 두 노드의 계층관계를 하나의 경로만으로 서술이 가능하다는 조건이 없다.

skos:related와 skos:broaderTransitive의 상호배타성
이 문서는 계층관계와 연관관계는 본질적으로 다른 것으로 간주한다. 따라서 계층관계와 연관관계가 서로 충돌하는 것이 SKOS 데이터 모델과 일치하지 않는다. 위 예시에서는 어떤 상황에서 서로 충돌한 것인지 제시하였다.

이러한 조건은 유의어사전 기준인 [ISO2788] [BS8723-2]에서 정의하는 계층관계와 연관관계를 따른 것이며 기존 많은 KOS에서 사용하고 있고 지원하고 있다.

이 문서에서는 연관관계와 직접적 계층관계가 상호배타적일 뿐만 아니라 나아가 연관관계와 간접적 계층관계도 상호배타적이라고 하였다. 무결성 조건에서 skos:related와 skos:broaderTransitive 서로 배타적 속성이라고 선언하는 서술을 찾아볼 수 있다.

skos:mappingRelation
Preamble
Vocabulary
Class & Property Definitions
Integrity Conditions
Examples
농작물 스키마
한국명절문화 스키마
중국명절문화 스키마
설날 스키마
추석 스키마
Example 49 (consistent, 일관성 있음)
Example 50 (consistent, 일관성 있음)
Example 51 (consistent, 일관성 있음)
Example 52 (not consistent, 일관성 없음)
Example 53 (not consistent, 일관성 없음)
Notes
매핑 속성, 시맨틱 릴레이션 속성과 컨셉 스키마
전체 관계 속성의 관계도
Example 54 (entailment, 상속됨)
Example 55 (entailment, 상속됨)
Example 56 (entailment, 상속됨)
Example 57 (entailment, 상속됨)
Example 58 (consistent, 일관성 있음)
계층적과 연관적 관계의 충돌
Example 59 (not consistent, 일관성 없음)
Example 60 (not consistent, 일관성 없음)
Example 61 (not consistent, 일관성 없음)
매핑 속성과 이행성
Example 62 (entailment, 상속됨)
Example 63 (non-entailment, 상속되지 않음)
Example 64 (non-entailment, 상속되지 않음)
Example 65 (non-entailment, 상속되지 않음)
매핑 속성과 재귀성
Example 66 (consistent, 일관성 있음)
skos:broadMatch에 관한 사이클과 대체 경로
학위, 교육, 원격교육 스키마
Example 67 (consistent, 일관성 있음)
Example 68 (consistent, 일관성 있음)
skos:exactMatch와 skos:closeMatch의 사이클
Example 69 (entailment, 일관성 있음)
skos:exactMatch의 하위 속성 체인
Example 70 (non-entailment, 상속되지 않음)
Example 71 (non-entailment, 상속되지 않음)
Example 72 (non-entailment, 상속되지 않음)
Example 73 (non-entailment, 상속되지 않음)
skos:closeMatch, skos:exactMatch, owl:sameAs, owl:equivalentClass, owl:equivalentProperty
Example 74 (entailment, 상속됨)
skos:mappingRelation
Preamble
SKOS 매핑 속성은 skos:closeMatch, skos:exactMatch, skos:broadMatch, skos:narrowMatch 와 skos:relatedMatch 등이 있다. 이 속성들은 서로 다른 컨셉 스키마의 SKOS 컨셉들간에 매핑(일치성) 관계가 어떨지 서술하는 것이다. 그 링크는 연결된 컨셉의 관계 의미에 내재되어 있다.

속성skos:broadMatch와 skos:narrowMatch는 두 컨셉간의 계층적 일치성을 서술하는 것이다.

속성 skos:relatedMatch는 두 컨셉간의 연관적 일치성을 서술하는 것이다.

속성 skos:closeMatch는 아주 비슷한 두 컨셉을 연결하는 것이다. 다른 정보 추출 어플리케이션에도 서로 대체할 수 있을 정도로 비슷하다. 2개 이상의 컨셉 스키마들을 매핑시켰을 때 “복합 에러”가 일어날 가능성을 피하기 위해 skos:closeMatch는 추이적 속성으로 선언하지 않았다.

속성 skos:exactMatch는 두 컨셉을 연결시키고 넓은 범주의 정보 추출 애플리케이션에서 서로 대체할 수 있다. skos:exactMatch는 이행성을 가지며 skos:closeMatch의 하위 속성이다.

Vocabulary
skos:mappingRelation
skos:closeMatch
skos:exactMatch
skos:broadMatch
skos:narrowMatch
skos:relatedMatch

Class & Property Definitions
S38 || skos:mappingRelation, skos:closeMatch, skos:exactMatch, skos:broadMatch, skos:narrowMatch와 skos:relatedMatch는 owl:ObjectProperty의 인스턴스다.
S39 || skos:mappingRelation는 skos:semanticRelation의 하위 속성이다.
S40 || skos:closeMatch, skos:broadMatch, skos:narrowMatch와 skos:relatedMatch는 skos:mappingRelation의 하위 속성이다.
S41 || skos:broadMatch가 skos:broader의 하위 속성이며 skos:narrowMatch는 skos:narrower의 하위 속성이다. 그리고 skos:relatedMatch는 skos:related의 하위 속성이다.
S42 || skos:exactMatch는 skos:closeMatch의 하위 속성이다.
S43 || skos:narrowMatch는 속성인 skos:broadMatch와 역관계(owl:inverseOf)다.
S44 || skos:relatedMatch, skos:closeMatch와 skos:exactMatch는 owl:SymmetricProperty의 인스턴스다.
S45 || skos:exactMatch는 owl:TransitiveProperty의 인스턴스다.

Integrity Conditions
S46 || skos:exactMatch는 속성 skos:broadMatch, skos:relatedMatch와 상호배타적이다.
skos:exactMatch가 대칭 속성이고 skos:broadMatch와 skos:narrowMatch가 서로 역관계이므로 skos:exactMatch와 skos:narrowMatch도 상호배타적인 것을 알 수 있다.

Examples
농작물, 한국/중국명절문화, 그리고 설날/추석 스키마를 대부분 예시로 삼는다. 5개 스키마는 전체 스키마 링크를 통해 볼 수 있다.

농작물 스키마


한국명절문화 스키마


중국명절문화 스키마


설날 스키마


추석 스키마


자세히 알아보기
머신러닝 및 인공지능
프로그래밍
컴퓨터 교육
아래 예시에서 〈A〉와 〈B〉의 일치한 매핑 관계를 선언하였다.

Example 49 (consistent, 일관성 있음)
〈A〉 skos:exactMatch 〈B〉.
[편집자]
〈공자〉 skos:exactMatch 〈孔子〉.

한국의〈공자〉와 중국의 〈孔子(공자)〉는 동일한 개념으로 모든 상황에서 서로 바꿔 쓸 수 있다.

아래 예시에서 〈A〉와 〈B〉의 비슷한 매핑 관계를 선언하였다.

Example 50 (consistent, 일관성 있음)
〈A〉 skos:closeMatch 〈B〉.
[편집자]
〈세뱃돈〉 skos:closeMatch 〈紅包〉.

한국의〈세뱃돈〉과 중국의 〈紅包(세뱃돈)〉은 행위 방식이 완전히 같지 않아서 일부만 바꿔 쓸 수 있다.

아래 예시에서 〈A〉와 〈B〉의 계층적 매핑 관계를 선언하였다(〈B〉의 범위가 〈A〉보다 큼). 그리고 〈A〉와 〈C〉의 연관된 매핑 관계를 선언하였다.

Example 51 (consistent, 일관성 있음)
〈A〉 skos:broadMatch 〈B〉 ; skos:relatedMatch 〈C〉.
[편집자]
〈배〉 skos:broadMatch 〈명절음식〉 .
〈배〉 skos:relatedMatch 〈차례〉.

농작물 스키마중 〈배〉의 상위 개념이 〈명절음식〉이면서, 〈배〉와 〈차례〉가 연관 관계에 있다고 기술하는 것은 일관성이 있다.

아래 예시에서 SKOS 데이터 모델과 일치하지 않은 이유는 일치한 매핑 관계와 계층적 매핑 관계가 서로 충돌하기 때문이다.

Example 52 (not consistent, 일관성 없음)
〈A〉 skos:exactMatch 〈B〉 ; skos:broadMatch 〈B〉.
[편집자]
〈공자〉 skos:exactMatch 〈孔子〉
X 〈공자〉skos:broadMatch 〈孔子〉.

한국의〈공자〉과 동일한 개념이 중국의〈孔子(공자)〉라고 했는데 〈공자〉의 상위 개념이 〈孔子(공자)〉라고 하는 것은 일관성이 없다.

아래 예시에서 SKOS 데이터 모델과 일치하지 않은 이유는 일치한 매핑 관계와 연관된 매핑 관계가 서로 충돌하기 때문이다.

Example 53 (not consistent, 일관성 없음)
〈A〉 skos:exactMatch 〈B〉 ; skos:relatedMatch 〈B〉.
[편집자]
〈공자〉 skos:exactMatch 〈孔子〉.
X 〈공자〉skos:relatedMatch 〈孔子〉.

한국의〈공자〉와 동일한 개념이 중국의〈孔子(공자)〉라고 했는데 한국의〈공자〉와 중국의〈孔子(공자)〉가 연관 관계라고 하는 것은 일관성이 없다.


Notes
매핑 속성, 시맨틱 릴레이션 속성과 컨셉 스키마
관례상 SKOS 매핑 속성은 서로 다른 컨셉 스키마에 속한 컨셉들을 연결시킬 때 쓰인다. 그러나 SKOS 시맨틱 릴레이션 속성들이(skos:broader, skos:narrower, skos:related) 다른 컨셉 스키마에 속한 컨셉들을 연결시켜도 SKOS 데이터 모델과 일치한다는 것을 유념해야 한다.

매핑 속성 skos:broadMatch, skos:narrowMatch와 skos:relatedMatch는 데이터의 출처를 밝힌 상황에서 쓰이며 컨셉 스키마 안의 관계인지 다른 컨셉 스키마의 매핑 관계인지 단번에 알아볼 수 있다.

하지만, SKOS 매핑 속성을 사용한다고 해서 RDF그래프 관리와 출처 메커니즘을 대체할 수 없다.

이렇게 설계하는 이유는 하나의 컨셉 스키마 안에 링크들과 컨셉 스키마들간의 매핑 링크의 명확한 차이를 구별하기 어렵기 때문이다. 특히 오픈된 환경에서 사람들이 어떤 컨셉을 분류하는데 각자 다른 컨셉 스키마로 분류할 수도 있다. 어떤 사람은 두 컨셉을 다른 컨셉 스키마로 보는가 하면 어떤 사람은 같은 컨셉 스키마로 분류한다. 이런 규정은 두가지 관점을 공존할 수 있게 한다. 따라서 웹상에서 SKOS 데이터를 재활용하는데 유연성과 창의성을 추진하기를 바란다.

이에 SKOS 시맨틱 릴레이션 속성과 SKOS 매핑 속성 사이에 긴밀한 관계가 있기 마련이다. skos:broadMatch는 skos:broader의 하위 속성, skos:narrowMatch는 skos:narrower의 하위 속성, skos:relatedMatch는 skos:related의 하위 속성이다. 전체 하위 속성 관계도는 아래 도식으로 정리한다. 빨간색으로 표기한 부분은 이번 매핑 속성(Mapping Properties) 장에서 새로 소개한 속성들이다. 검정색으로 표기한 부분은 앞장(Semantic Relations)에서 설명했던 속성들이다.

전체 관계 속성의 관계도
 아래 예시들이 위에 보여준 하위 속성 관계도를 따르며, skos:semanticRelation의 도메인과 레인지 등 관련 규정에 따른다.

Example 54 (entailment, 상속됨)
〈A〉 skos:broadMatch 〈B〉.
entails
〈A〉skos:mappingRelation 〈B〉.
〈A〉skos:broader 〈B〉.
〈A〉skos:broaderTransitive 〈B〉.
〈A〉skos:semanticRelation 〈B〉.
〈A〉rdf:type skos:Concept .
〈B〉rdf:type skos:Concept .
[편집자]
〈배〉 skos:broadMatch 〈명절음식〉.
entails(수반한다)
〈배〉 skos:mappingRelation 〈명절음식〉.
〈배〉 skos:broader 〈명절음식〉.
〈배〉 skos:broaderTransitive 〈명절음식〉.
〈배〉 skos:semanticRelation 〈명절음식〉.
〈배〉 rdf:type skos:Concept.
〈명절음식〉 rdf:type skos:Concept.

농작물 스키마중 〈배〉의 상위 개념이 〈명절음식〉이라고 할 때, 〈배〉와 〈명절음식〉이 매핑 릴레이션과 시멘틱 릴레이션의 관계가 있다고 할 수 있으며, 〈배〉의 직접적 또는 간적접 상위 계층이 〈명절음식〉이라고 할 수 있다. 뿐만 아니라 〈배〉와 〈명절음식〉은 skos:Concept라는 클래스에 속한다. 전체 관계 속성의 관계도를 보면 이상의 서술을 추론할 수 있다.

Example 55 (entailment, 상속됨)
〈A〉 skos:narrowMatch 〈B〉.
entails
〈A〉 skos:mappingRelation 〈B〉.
〈A〉 skos:narrower 〈B〉.
〈A〉 skos:narrowerTransitive 〈B〉.
〈A〉 skos:semanticRelation 〈B〉.
〈A〉 rdf:type skos:Concept .
〈B〉 rdf:type skos:Concept .
[편집자]
〈명절음식〉 skos:narrowMatch 〈배〉.
entails<수반한다>
〈명절음식〉 skos:mappingRelation 〈배〉.
〈명절음식〉 skos:narrower 〈배〉.
〈명절음식〉 skos:narrowerTransitive 〈배〉.
〈명절음식〉 skos:semanticRelation 〈배〉.
〈명절음식〉 rdf:type skos:Concept.
〈배〉 rdf:type skos:Concept.

〈명절음식〉의 하위 개념이 농작물 스키마의〈배〉라고 할 때, 〈명절음식〉과 〈배〉이 매핑 릴레이션과 시멘틱 릴레이션의 관계가 있다고 할 수 있으며, 〈명절음식〉의 직접적 또는 간적접 하위 계층이 〈배〉라고 할 수 있다. 뿐만 아니라 〈명절음식〉과 〈배〉은 skos:Concept라는 클래스에 속한다. 전체 관계 속성의 관계도를 보면 이상의 서술을 추론할 수 있다.

Example 56 (entailment, 상속됨)
〈A〉 skos:relatedMatch 〈B〉.
entails
〈A〉 skos:mappingRelation 〈B〉.
〈A〉 skos:related 〈B〉.
〈A〉 skos:semanticRelation 〈B〉.
〈A〉 rdf:type skos:Concept .
〈B〉 rdf:type skos:Concept .
[편집자]
〈배〉 skos:relatedMatch 〈차례〉.
entails(수반한다)
〈배〉 skos:mappingRelation 〈차례〉.
〈배〉 skos:related 〈차례〉.
〈배〉 skos:semanticRelation 〈차례〉.
〈배〉 rdf:type skos:Concept.
〈차례〉 rdf:type skos:Concept.

농작물 스키마의 〈배〉와 〈차례〉이 연관 관계라고 할 때, 〈배〉와 〈차례〉는 매핑 릴레이션과 시멘틱 릴레이션의 관계가 있다고 할 수 있으며 〈배〉와 〈차례〉은 skos:Concept라는 클래스에 속한다. 전체 관계 속성의 관계도를 보면 이상의 서술을 추론할 수 있다.

Example 57 (entailment, 상속됨)
〈A〉 skos:exactMatch〈B〉.
entails
〈A〉skos:closeMatch 〈B〉.
〈A〉skos:mappingRelation〈B〉.
〈A〉skos:semanticRelation〈B〉.
〈A〉rdf:type skos:Concept .
〈B〉rdf:type skos:Concept .
[편집자]
〈공자〉 skos:exactMatch 〈孔子〉.
entails(수반한다)
〈공자〉 skos:closeMatch 〈孔子〉.
〈공자〉 skos:mappingRelation 〈孔子〉.
〈공자〉 skos:semanticRelation 〈孔子〉.
〈공자〉 rdf:type skos:Concept.
〈孔子〉 rdf:type skos:Concept.

자세히 알아보기
딥러닝 교과서
IT 용어 위키
도서 및 문학
한국의〈공자〉와 중국의〈孔子(공자)〉가 동일한 개념이라고 할 때, 〈공자〉와 〈孔子(공자)〉가 매핑 릴레이션과 시멘틱 릴레이션의 관계가 있다고 할 수 있으며 〈공자〉와 〈孔子(공자)〉는 유사한 개념이라고 할 수 있다. 뿐만 아니라 〈공자〉와 〈孔子(공자)〉는 skos:Concept라는 클래스에 속한다. 전체 관계 속성의 관계도를 보면 이상의 서술을 추론할 수 있다.

사람들이 각자 다른 방식으로 컨셉을 분류할 수 있기 때문에 컨셉들을 같은 컨셉 스키마로 분류할 수 있다. 스키마가 같다고 해서 SKOS 데이터 모델과 불일치한다는 공식은 없다. 아래 그래프는 SKOS 데이터 모델과 일치한다. 그러나, 실제로 이러한 그래프는 다른 출처에서 가져온 두 개 이상의 컨셉들을 병합할 때만 발생한다.

Example 58 (consistent, 일관성 있음)
〈A〉 skos:broadMatch 〈B〉 ; skos:relatedMatch 〈C〉.
〈A〉 skos:inScheme 〈MyScheme〉.
〈B〉 skos:inScheme 〈MyScheme〉.
〈C〉 skos:inScheme 〈MyScheme〉.
[편집자]
〈배〉 skos:broadMatch 〈명절음식〉
〈배〉 skos:relatedMatch 〈차례〉.
〈배〉 skos:inScheme 〈한국추석〉.
〈명절음식〉 skos:inScheme 〈한국추석〉.
〈차례〉 skos:inScheme 〈한국추석〉.

농작물 스키마중 〈배〉의 상위 개념이〈명절음식〉이고, 〈배〉와 〈차례〉과 연관 관계이면서 〈배〉, 〈명절음식〉과 〈차례〉가 모두 〈한국추석〉스키마에 속한다고 하는 것은 일관성이 있다.

이들은 같은 "한국추석" 스키마에 속하는 것임에도 불구하고 SKOS 데이터 모델과 일치한다. 다만 매핑 속성일 경우 다른 스키마의 컨셉들을 연결시키는 목적으로 쓰이고 있어 권장하지 않는다.

계층적과 연관적 관계의 충돌
아래 예시에서는 계층 및 연관적 매핑 관계 사이의 충돌을 설명하였다. 이는 SKOS 데이터 모델과 일치하지 않는다. (이유는 앞서 정의한 하위 속성 관계나 SKOS 시맨틱 릴레이션 속성과 불일치하기 때문이다.)

Example 59 (not consistent, 일관성 없음)
〈A〉 skos:broadMatch 〈B〉 ; skos:relatedMatch 〈B〉.
[편집자]
〈배〉 skos:broadMatch 〈명절음식〉 .
X〈배〉skos:relatedMatch 〈명절음식〉.

농작물 스키마중〈배〉의 상위 개념이〈명절음식〉이라고 했는데, 〈배〉와 〈명절음식〉이 연관 관계라고 하는 것은 일관성이 없다.

Example 60 (not consistent, 일관성 없음)
〈A〉 skos:narrowMatch 〈B〉 ; skos:relatedMatch 〈B〉.
[편집자]
〈명절음식〉 skos:narrowMatch 〈배〉 .
X〈명절음식〉skos:relatedMatch 〈배〉.

〈명절음식〉의 하위 개념이 농작물 스키마의 〈배〉라고 했는데, 〈명절음식〉과 〈배〉가 연관 관계라고 하는 것은 일관성이 없다.

Example 61 (not consistent, 일관성 없음)
〈A〉 skos:broadMatch 〈B〉.
〈B〉 skos:broadMatch 〈C〉.
〈A〉 skos:relatedMatch 〈C〉.
[편집자]
〈배〉 skos:broadMatch 〈한국추석음식〉.
〈한국추석음식〉 skos:broadMatch 〈명절음식〉.
X〈배〉 skos:relatedMatch 〈명절음식〉.

농작물 스키마중 〈배〉의 상위 개념이〈한국추석음식〉이고 〈한국추석음식〉의 상위 개념이〈명절음식〉이라고 했을 때, 〈배〉와 〈명절음식〉이 연관 관계라고 하는 것은 일관성이 없다.

매핑 속성과 이행성
SKOS 매핑 속성중 유일하게 이행성만 가진 속성은 skos:exactMatch이다. 아래 예시로 설명한다.

Example 62 (entailment, 상속됨)
자세히 알아보기
book
언어 관련 자료
스크립트 언어
〈A〉 skos:exactMatch 〈B〉.
〈B〉 skos:exactMatch 〈C〉.
entails
〈A〉 skos:exactMatch 〈C〉.
[편집자]
〈사랑〉 skos:exactMatch 〈LOVE〉.
〈LOVE〉 skos:exactMatch 〈爱〉.
entails(수반한다)
〈사랑〉 skos:exactMatch 〈爱〉.

한국어의 〈사랑〉와 영어의〈LOVE〉가 동일한 개념이고 영어의 〈LOVE〉와 중국어의 〈爱〉가 동일한 개념이라고 할 때, 한국어의〈사랑〉과 중국어의 〈爱 〉는 동일한 개념이라고 할 수 있다.

나머지 SKOS 매핑 속성은 이행성이 없다. 따라서 아래 예시에서 추론된 것은 SKOS 데이터 모델로 지원할 수 없다.

Example 63 (non-entailment, 상속되지 않음)
〈A〉 skos:broadMatch 〈B〉.
〈B〉 skos:broadMatch 〈C〉.
does not entail
〈A〉 skos:broadMatch 〈C〉.
[편집자]
〈배〉 skos:broadMatch 〈한국추석음식〉.
〈한국추석음식〉 skos:broadMatch 〈명절음식〉.
does not entail(다음을 수반하지 않음)
〈배〉 skos:broadMatch 〈명절음식〉.

농작물 스키마중 〈배〉의 상위 개념이〈한국추석음식〉이고 〈한국추석음식〉의 상위 개념이 〈명절음식〉이라고 했을 때, 〈배〉의 상위 개념이 반드시 〈명절음식〉이라고는 할 수 없다. skos:broadMatch가 이행성을 가지지 않기 때문이다.

Example 64 (non-entailment, 상속되지 않음)
〈A〉 skos:relatedMatch 〈B〉.
〈B〉 skos:relatedMatch 〈C〉.
does not entail
〈A〉 skos:relatedMatch 〈C〉.
[편집자]
〈배〉 skos:relatedMatch 〈차례〉.
〈차례〉 skos:relatedMatch 〈유교〉.
does not entail(다음을 수반하지 않음)
〈배〉 skos:relatedMatch 〈유교〉.

〈차례〉는 각각 〈배〉및 〈유교〉와 연관 관계라고 했을 때, 〈배〉와 〈유교〉가 반드시 연관 관계라고 할 수 없다. skos:relatedMatch가 이행성을 가지지 않기 때문이다.

Example 65 (non-entailment, 상속되지 않음)
〈A〉 skos:closeMatch 〈B〉.
〈B〉 skos:closeMatch 〈C〉.
does not entail
〈A〉 skos:closeMatch 〈C〉.
[편집자]
〈유아〉 skos:closeMatch 〈아동〉.
〈아동〉 skos:closeMatch 〈청소년〉.
does not entail(다음을 수반하지 않음)
〈유아〉 skos:closeMatch 〈청소년〉.

〈유아〉(만 3세~초등학교 취학전)와 〈아동〉(18세 미만인) 유사하고, 〈청소년〉(만 9세~만 24세)와 〈아동〉유사했을 때, 〈유아〉의 유사한 개념이 반드시 〈청소년〉이라고는 할 수 없다.

매핑 속성과 재귀성
모든 SKOS 매핑 속성이 재귀적 속성 아니며 비재귀적 속성도 아니다.
왜냐하면 skos:exactMatch, skos:broadMatch와 skos:relatedMatch일 경우 비재귀적이라고 할 수 없다. 아래 예시는 SKOS 데이터 모델과 일치한다.

Example 66 (consistent, 일관성 있음)
〈A〉 skos:exactMatch 〈A〉.
〈B〉 skos:broadMatch 〈B〉.
〈C〉 skos:relatedMatch 〈C〉.
[편집자]
〈공자〉 skos:exactMatch 〈공자〉.
〈기독교〉 skos:broadMatch 〈기독교〉.
〈한화〉 skos:relatedMatch 〈한화〉.

한국의 〈공자〉와 유교스키마의 〈공자〉는 동일한 개념이다.
개신교만 포함하는 〈기독교〉의 상위 개념이 개신교와 가톨릭을 모두 포함하는 〈기독교〉이다.
중앙은행의〈한화〉와 외환시장의 〈한화〉는 연관 관계가 있다고 하는 것은 일관성 있다.

앞서 다뤘던 SKOS 시맨틱 릴레이션 속성들의 재귀성을 참고하기 바람.

skos:broadMatch에 관한 사이클과 대체 경로
공식 무결성 조건에 의해 계층적 매핑 관계에서 나타나는 사이클이나 대체 경로를 피하지 않았다.

자세히 알아보기
소프트웨어
도서
파이썬 프로그래밍 책
아래 예시는 skos:broadMatch의 두가지 사이클을 설명한다. SKOS 데이터 모델과 일치한다.
아래 예시는 학위, 교육, 원격교육 스키마를 참고할 것.

학위, 교육, 원격교육 스키마


Example 67 (consistent, 일관성 있음)
〈A〉 skos:broadMatch 〈B〉.
〈B〉 skos:broadMatch 〈A〉.

〈X〉 skos:broadMatch 〈Y〉.
〈Y〉 skos:broadMatch 〈Z〉.
〈Z〉 skos:broadMatch 〈X〉.
[편집자]
〈학사〉 skos:broadMatch 〈대학〉.
〈대학〉 skos:broadMatch 〈학사〉.

〈학사〉 skos:broadMatch 〈사이버대학〉.
〈사이버대학〉 skos:broadMatch 〈대학〉.
〈대학〉 skos:broadMatch 〈학사〉.

학위스키마의〈학사〉의 상위 개념이 고등교육스키마의〈대학〉이면서 〈대학〉의 상위 개념이 〈학사〉라고 하는 것은 일관성이 있다.

학위스키마의〈학사〉의 상위 개념이 원격교육스키마의〈사이버대학〉이면서, 〈사이버대학〉의 상위 개념이 교육스키마의〈대학〉이며, 〈대학〉의 상의 개념이 학위스키마의 〈학사〉라고 하는 것은 일관성이 있다.

아래 예시는 skos:broadMatch의 두가지 대체 경로를 설명한다. SKOS 데이터 모델과 일치한다.

Example 68 (consistent, 일관성 있음)
〈A〉 skos:broadMatch 〈B〉.
〈B〉 skos:broadMatch 〈C〉.
〈A〉 skos:broadMatch 〈C〉.
[편집자]
〈배〉 skos:broadMatch〈한국추석음식〉.
〈한국추석음식〉 skos:broadMatch 〈명절음식〉.
〈배〉 skos:broadMatch 〈명절음식〉.

농작물 스키마중 〈배〉 의 상위 개념이 〈한국추석음식〉이고, 〈한국추석음식〉의 상위 개념이 〈명절음식〉이면서, 〈배〉의 상위 개념이 〈명절음식〉이라고 하는 것은 일관성이 있다.

skos:exactMatch와 skos:closeMatch의 사이클
Example 69 (entailment, 일관성 있음)
〈A〉 skos:exactMatch 〈B〉.
entails
〈A〉 skos:exactMatch 〈A〉.
〈A〉 skos:closeMatch 〈A〉.
[편집자]
〈공자〉 skos:exactMatch 〈孔子〉.
entails(수반한다)
〈공자〉 skos:exactMatch 〈공자〉.
〈공자〉 skos:closeMatch 〈공자〉.

한국의 〈공자〉는 중국의 〈孔子(공자)〉와 동일한 개념이라고 한다면, 한국의 〈공자〉개념이 자신과 똑같은 개념이라고 할 수 있으며 자신과 유사한 개념이라고 할 수도 있다.

위 예시는 S42, S44, S45에 의해 추론하는 것이다. 어느 어플리케이션이든 skos:exactMatch와 skos:closeMatch의 사이클을 처리해야 한다.

skos:exactMatch의 하위 속성 체인
SKOS 데이터 모델에서 속성 skos:exactMatch 혹은 skos:closeMatch에 관해서 하위 속성 체인 원칙이 없다. 아래 예시에서 추론한 것을 지원할 수 없다.

자세히 알아보기
프로그래밍 전자책
신간 전자책 알림
책
Example 70 (non-entailment, 상속되지 않음)
〈A〉 skos:exactMatch 〈B〉.
〈B〉 skos:broadMatch 〈C〉.
does not entail
〈A〉 skos:broadMatch 〈C〉.
[편집자]
〈공자〉 skos:exactMatch 〈孔子〉.
〈孔子〉 skos:broadMatch 〈인물사전_중국어판〉.
does not entail(다음을 수반하지 않음)
〈공자〉 skos:broadMatch 〈인물사전_중국어판〉.

한국의 〈공자〉와 동일한 개념이 중국의 〈孔子(공자)〉이고, 중국의 〈孔子(공자)〉의 상위 개념이 〈인물사전_중국어판〉이라고 했을 때, 한국의 〈공자〉가 상위 개념이 〈인물사전_중국어판〉이라고 할 수 없다. skos:exactMatch 는 다른 관계 속성을 통해서 새로운 결과를 추론할 수 없기 때문이다.

Example 71 (non-entailment, 상속되지 않음)
〈A〉 skos:exactMatch 〈B〉 .
〈B〉 skos:relatedMatch 〈C〉 .
does not entail
〈A〉 skos:relatedMatch 〈C〉.
[편집자]
〈孔子〉 skos:exactMatch 〈공자〉 .
〈공자〉 skos:relatedMatch 〈성균관〉 .
does not entail(다음을 수반하지 않음)
〈孔子〉 skos:relatedMatch 〈성균관〉.

중국의 〈孔子(공자)〉개념과 한국의 〈공자〉개념이 동일하고, 한국의 〈공자〉가 〈성균관〉과 연관 관계라고 했을 때, 중국의 〈孔子(공자)〉가 반드시 〈성균관〉과 연관 관계라고 할 수 없다.

Example 72 (non-entailment, 상속되지 않음)
〈A〉 skos:closeMatch 〈B〉 .
〈B〉 skos:broadMatch 〈C〉 .
does not entail
〈A〉 skos:broadMatch 〈C〉.
[편집자]
〈세뱃돈〉 skos:closeMatch 〈紅包〉 .
〈紅包〉 skos:broadMatch 〈중국설날활동〉 .
does not entail(다음을 수반하지 않음)
〈세뱃돈〉 skos:broadMatch 〈중국설날활동〉.

한국의 〈세뱃돈〉 개념과 중국의 〈紅包(세뱃돈)〉 개념이 유사하고 중국〈紅包(세뱃돈)〉의 상위 개념이 〈중국설날활동〉이라고 했을 때, 한국〈세뱃돈〉의 상위 개념이 반드시 〈중국설날활동〉이라고는 할 수 없다.

Example 73 (non-entailment, 상속되지 않음)
〈A〉 skos:closeMatch 〈B〉 .
〈B〉 skos:relatedMatch 〈C〉 .
does not entail
〈A〉 skos:relatedMatch 〈C〉.
[편집자]
〈紅包〉 skos:closeMatch 〈세뱃돈〉 .
〈세뱃돈〉 skos:relatedMatch 〈덕담 나눔〉 .
does not entail(다음을 수반하지 않다)
〈紅包〉 skos:relatedMatch 〈덕담 나눔〉.

중국의 〈紅包(세뱃돈)〉개념과 한국의 〈세뱃돈〉개념이 유사하고 한국〈세뱃돈〉과 〈덕담 나눔〉이 연관 관계라고 했을 때, 중국의 〈紅包(세뱃돈)〉과 〈덕담 나눔〉이 반드시 연관 관계라고는 할 수 없다.

skos:closeMatch, skos:exactMatch, owl:sameAs, owl:equivalentClass, owl:equivalentProperty
OWL에서 제공한 3가지 속성은 얼핏 보면 skos:closeMatch나 skos:exactMatch와 비슷해 보인다. owl:sameAs는 온톨로지에 두 개체를 연결하고 두 개체가 같은 것을 표시한다. owl:equivalentClass는 온톨로지에 두 클래스를 연결하고 두 클래스가 같은 구조인 것을 표시한다. owl:equivalentProperty는 온톨로지에 두 속성을 연결하고 두 속성이 같은 구조인 것을 표시한다.

skos:closeMatch와 skos:exactMatch는 다른 스키마의 SKOS 컨셉을 연결시킨다. skos:closeMatch란 관계는 두 컨셉이 아주 비슷해서 일부 정보 추출 어플리케이션에서 서로 교체해서 쓸 수 있다. skos:exactMatch란 관계는 두 컨셉 싱크로율이 높아서 폭 넓은 어플리케이션에서 서로 교체해서 쓸 수 있다.

owl:sameAs, owl:equivalentClass 또는 owl:equivalentProperty는 서로 다른 개념 체계의 SKOS 개념을 연결하는 데 일반적으로 부적절할 것이다. 그렇게 하면 따라올 수 있는 형식적인 결과가 바람직하지 않을 수 있기 때문이다.

아래 예시는 owl:sameAs를 다음과 같이 사용하면 원하지 않은 추론 결과가 나온다는 것을 설명한다.

Example 74 (entailment, 상속됨)
〈A〉 rdf:type skos:Concept ;
skos:prefLabel "love"@en ;
skos:inScheme 〈MyScheme〉 .

〈B〉 rdf:type skos:Concept ;
skos:prefLabel "adoration"@en ;
skos:inScheme 〈AnotherScheme〉 .

〈A〉 owl:sameAs 〈B〉 .

entails(수반한다)

〈A〉
skos:prefLabel "love"@en;
skos:prefLabel "adoration"@en;
skos:inScheme 〈MyScheme〉;
skos:inScheme 〈AnotherScheme〉.

〈B〉
skos:prefLabel "love"@en;
skos:prefLabel "adoration"@en;
skos:inScheme 〈MyScheme〉;
skos:inScheme 〈AnotherScheme〉.

위 예시에서 owl:sameAs를 사용해서 서로 다른 컨셉 스키마에 속한 두 SKOS 컨셉을 연결시키는 것이 SKOS 데이터 모델과 불일치하는 결과가 나왔다. 왜냐하면 〈A〉와〈B〉는 선호한 라벨이 같은 언어로 두개를 가지기 때문이다. 하지만 이런 경우가 항상 맞는 것은 아니다.

Concept Collections
Preamble
Vocabulary
Class & Property Definitions
Integrity Conditions
Examples
skos:member와 skos:memberList의 도메인과 레인지
Example 40 (consistent, 일관성 있음)
Example 41 (consistent, 일관성 있음)
Notes
Ordered Collections에서 Collections를 추론한다
Example 42 (entailment, 상속됨)
skos:memberList의 무결성
Example 43 (entailment, 상속됨)
내재한 컬렉션 (Nested Collections)
Example 44 (consistent, 일관성 있음)
SKOS 컨셉, 컨셉 컬렉션과 시맨틱 릴레이션
Example 45 (not consistent, 일관성 없음)
Example 46 (not consistent, 일관성 없음)
Example 47 (not consistent, 일관성 없음)
Example 48 (consistent, 일관성 있음)
Concept Collections
Preamble
SKOS 컨셉 컬렉션은 라벨링되거나 순서대로 된 SKOS 컨셉들이다.
컬렉션은 컨셉들이 공통점이 있을 때 유용하다. 공통 라벨로 그룹핑하거나 컨셉들을 유의미한 순서대로 나열한다.

Vocabulary
skos:Collection
skos:OrderedCollection
skos:member
skos:memberList

Class & Property Definitions
S28 || skos:Collection와 skos:OrderedCollection는 모두 owl:Class의 인스턴스다.
S29 || skos:OrderedCollection는 skos:Collection의 하위 클래스다.
S30 || skos:member와 skos:memberList는 owl:ObjectProperty의 인스턴스다.
S31 || skos:member의 rdfs:domain는 클래스 skos:Collection에 속한다.
S32 || skos:member의 rdfs:range는 클래스 skos:Concept와 skos:Collection에 속한다.
S33 || skos:memberList의 rdfs:domain는 클래스 skos:OrderedCollection에 속한다.
S34 || skos:memberList의 rdfs:range는 클래스 class rdf:List에 속한다.
S35 || skos:memberList는 owl:FunctionalProperty의 인스턴스다.
S36 || 어떤 리소스이든, 리스트에 있는 아이템의 속성은 skos:memberList에 속한다면 skos:member라는 속성에도 속한다.

Integrity Conditions
S37 || skos:Collection는 skos:Concept 및 skos:ConceptScheme와 상호배타적이다.

Examples
skos:member와 skos:memberList의 도메인과 레인지


SKOS collection의 3가지 멤버가 아래와 같다.

Example 40 (consistent, 일관성 있음)
〈MyCollection〉 rdf:type skos:Collection ;
skos:member 〈X〉 , 〈Y〉 , 〈Z〉.
[편집자]
〈국가〉 rdf:type skos:Collection ;
skos:member 〈한국〉 , 〈중국〉 , 〈일본〉.

〈국가〉의 타입은 skos:Collection이며 이 컬렉션의 멤버는 〈한국〉 , 〈중국〉 , 〈일본〉등이 있다.

SKOS ordered collection의 3가지 멤버는 아래와 같다. Turtle 구법를 사용하여 RDF Collection (list)를 표현한다.

Example 41 (consistent, 일관성 있음)
〈MyOrderedCollection〉 rdf:type skos:OrderedCollection ;
skos:memberList ( 〈X〉 〈Y〉 〈Z〉 ) .
[편집자]
〈국가인구〉 rdf:type skos:OrderedCollection ;
skos:memberList ( 〈중국〉 〈일본〉 〈한국〉 ) .

〈국가인구〉의 타입은 skos:OrderedCollection이며 이 컬렉션의 멤버는 〈중국〉 , 〈일본〉 , 〈한국〉의 인구수 순서로 나열한다.

Notes
자세히 알아보기
기술 관련 뉴스
머신러닝 및 인공지능
도서 및 문학
Ordered Collections에서 Collections를 추론한다
S36가 서술한 내용은 속성 skos:memberList와 skos:member의 논리적 관계다. 이러한 관계는ordered collection를 통해 collection를 추론할 수 있는 것을 의미한다. 아래 예시에서 설명하도록 한다.

Example 42 (entailment, 상속됨)
〈MyOrderedCollection〉 rdf:type skos:OrderedCollection ;
skos:memberList ( 〈X〉 〈Y〉 〈Z〉 ).
entails
〈MyOrderedCollection〉 rdf:type skos:Collection ;
skos:member 〈X〉 , 〈Y〉 , 〈Z〉.
[편집자]
〈국가인구〉 rdf:type skos:OrderedCollection ;
skos:memberList ( 〈중국〉 〈일본〉 〈한국〉 ).
entails(수반한다)
〈국가인구〉 rdf:type skos:Collection ;
skos:member 〈중국〉 , 〈일본〉 , 〈한국〉.

〈국가인구〉란 순서대로 된 컬렉션에 멤버리스트가 〈중국〉 , 〈일본〉 , 〈한국〉순서대로 되어 있다. 순서대로 된 컬렉션(OrderedCollection)이 컬렉션(Collection)의 하위 클래스이므로 상속을 받는다. 즉, 〈국가인구〉란 컬렉션이 될 수 있으므로 멤버는 순서와 상관없이 〈중국〉 , 〈일본〉 , 〈한국〉이다.

〈국가인구〉의 타입이 skos:OrderedCollection이다. 앞서 정의에서 skos:OrderedCollection는 skos:Collection의 하위 클래스이므로 skos:Collection이기도 하다. skos:memberList 의 값은 ( 〈중국〉 〈일본〉 〈한국〉 )이다. 정의에 따르면 skos:memberList의 값은 skos:member의 값과 동일하다.

SKOS에서는 collection이 순서대로 되지 않는다고 명백히 서술하지 않는다. 이 점을 유념해야 한다.

skos:memberList의 무결성
skos:memberList가 기능적 속성(Funtional Property)이라는 것을 유념해야 한다. 바꿔 말해서, 값은 하나밖에 없다. 따라서 SKOS 데이터 모델에서 ordered collection가 하나 이상의 값(멤버리스트)을 가지는 것은 합당하지 않다. 아쉽게도 이런 조건은 두 리스트의 다름을 명확하게 서술하지 않으면 무결성 조건으로 사용할 수 없다. 즉, 아래 예시는 SKOS 데이터 모델과 일치하지만 아무 의미도 없다. (한 리스트에 2개의 첫번째 엘리멘트와 하나의 갈래 꼬리를 가짐)

Example 43 (entailment, 상속됨)
〈OrderedCollectionResource〉
skos:memberList ( 〈A〉 〈B〉 ) , ( 〈X〉 〈Y〉 ).
entails
〈OrderedCollectionResource〉
skos:memberList [ rdf:first 〈A〉 , 〈X〉 ; rdf:rest [ rdf:first 〈B〉 ; rdf:rest rdf:nil ] , [ rdf:first 〈Y〉 ; rdf:rest rdf:nil ] ] .
[편집자]
〈한국역사〉
skos:memberList ( 〈고려〉 〈조선〉 ) , ( 〈왕건〉 〈이성계〉 ).
entails(수반한다)
〈한국역사〉
skos:memberList [ rdf:first 〈고려〉 , 〈왕건〉 ; rdf:rest [ rdf:first 〈조선〉 ; rdf:rest rdf:nil ] , [ rdf:first 〈이성계〉 ; rdf:rest rdf:nil ] ] .

〈한국역사〉는 순서대로 된 컬렉션이며 두가지 리스트가 있다. 두 리스트의 첫 번째 멤버가 각각〈고려〉와 〈왕건〉이었고 나머지 멤버는 〈조선〉과 〈이성계〉였다.
여기서 rdf:first가 리스트에서 최초 나타난 자원이고 rdf:rest가 나머지 자원을 가리킨다. rdf:nil는 뒤에 더 이상 아무 자원도 나타나지 않으며 마지막임을 암시한다.

[RDF-SEMANTICS](https://www.w3.org/TR/rdf-mt/#collections) 섹션 3.3.3에서 기술하듯이, collection 관련 단어(rdf:first, rdf:rest, rdf:nil)를 사용하는 데 well-formed 구법 제한을 받을 수도 있으므로 위 상황을 배척하게 된다.

내재한 컬렉션 (Nested Collections)
아래 예시에서 하나의 컬렉션이 다른 컬렉션에 내재되어 있다.

Example 44 (consistent, 일관성 있음)
〈MyCollection〉 rdf:type skos:Collection ;
skos:member 〈A〉 , 〈B〉 , 〈MyNestedCollection〉.

〈MyNestedCollection〉 rdf:type skos:Collection ;
skos:member 〈X〉 , 〈Y〉 , 〈Z〉.
[편집자]
〈국가〉 rdf:type skos:Collection ;
skos:member 〈중국〉 , 〈한국〉 , 〈일본〉.

〈일본〉 rdf:type skos:Collection ;
skos:member 〈스시〉 , 〈애니메이션〉 , 〈온천〉.

〈국가〉란 컬렉션에 〈중국〉 , 〈한국〉 , 〈일본〉등 멤버가 있다. 멤버 중〈일본〉의 타입은 skos:Collection이며 해당 컬렉션의 멤버가 〈스시〉 , 〈애니메이션〉 , 〈온천〉등이 있다.

자세히 알아보기
딥러닝 전자책
전자책 플랫폼
AI 에이전트 전자책
skos:member의 레인지가 skos:Concept와 skos:Collection의 합집합(union)이기 때문에 위 예시는 SKOS 데이터 모델과 일치한다.

SKOS 컨셉, 컨셉 컬렉션과 시맨틱 릴레이션
SKOS 데이터 모델에서 클래스skos:Concept와 skos:Collection는 상호배타적다. SKOS semantic relation 속성들의 도메인과 레인지는 skos:Concept다. 따라서 SKOS semantic relation 속성들이 (예: skos:narrower) collection의 관계 속성에 쓰인다면 SKOS 데이터 모델과 일치하지 않는다.

아래 예시는 SKOS 데이터 모델과 일치하지 않는다.

Example 45 (not consistent, 일관성 없음)
〈A〉 skos:narrower 〈B〉.
〈B〉 rdf:type skos:Collection.
[편집자]
〈육상교통수단〉 skos:narrower 〈버스〉.
X〈버스〉 rdf:type skos:Collection.

〈육상교통수단〉와 〈버스〉는 모두 skos:Concept이다.

마찬가지로 아래 아래 예시는 SKOS 데이터 모델과 일치하지 않는다.

Example 46 (not consistent, 일관성 없음)
〈A〉 skos:broader 〈B〉.
〈B〉 rdf:type skos:Collection.
[편집자]
〈버스〉 skos:broader 〈육상교통수단〉.
X〈육상교통수단〉 rdf:type skos:Collection.

〈버스〉와 〈육상교통수단〉은 모두 skos:Concept이다.

마찬가지로 아래 아래 예시는 SKOS 데이터 모델과 일치하지 않는다.

Example 47 (not consistent, 일관성 없음)
〈A〉 skos:related 〈B〉.
〈B〉 rdf:type skos:Collection.
[편집자]
〈배〉 skos:related 〈차례〉.
X〈차례〉 rdf:type skos:Collection.

〈배〉와 〈차례〉는 모두 skos:Concept이다.

그러나 아래 예시는 SKOS 데이터 모델과 일치한다.

Example 48 (consistent, 일관성 있음)
〈A〉 skos:narrower 〈B〉 , 〈C〉 , 〈D〉.
〈ResourceCollection〉 rdfs:label "Resource Collection"@en ;
skos:member 〈B〉 , 〈C〉 , 〈D〉.
[편집자]
〈국가〉 skos:narrower 〈영토〉 , 〈국민〉 , 〈정부〉.
〈국가요소〉 rdfs:label "Resource Collection"@en ;
skos:member 〈영토〉 , 〈국민〉 , 〈정부〉.

〈국가〉의 하위 개념은 〈영토〉 , 〈국민〉 , 〈정부〉다. 만약에 skos:member라는 관계속성을 적용하고 싶다면 〈국가요소〉를 하나의 컬렉션 개념으로 정의하고 〈영토〉 , 〈국민〉 , 〈정부〉는 해당 컬렉션의 멤버라고 서술하면 된다.

유의어 사전과 다른 지식분류체계에서 노드 라벨이 체계화되어 사용하는 과정에서 적절한 SKOS 표현에 고민이 필요하다는 것을 의미한다. 뿐만 아니라 노드 라벨만이 체계화되었다고 해서 이것만으로 체계화된 SKOS를 완벽히 재구축할 수 있는 것은 아니다. 체계화된 유의어 사전이나 다른 지식분류체계는 디테일이 필요한데 SKOS만으로 부족한 것이 실정이다.