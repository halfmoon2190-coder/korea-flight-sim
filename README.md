# Korea Flight Sim

인천(RKSI) · 김해(RKPK) · 제주(RKPC) 세 공항을 오가는 브라우저 기반 여객기 운항 시뮬레이터입니다.

## 실행

- 온라인: GitHub Pages 주소 (`https://halfmoon2190-coder.github.io/korea-flight-sim/`)
- 로컬: 저장소 폴더에서 간단한 웹 서버를 띄운 뒤 브라우저로 접속합니다.
  (`python -m http.server 8000` → `http://localhost:8000`)
  ※ `index.html`을 더블클릭해 `file://`로 열면 모듈 로딩이 막혀 동작하지 않습니다.

## 진행 상황

| 단계 | 내용 | 상태 |
|---|---|---|
| 0 | 환경 점검 (PC 성능 · 조이스틱 인식) | ✅ |
| 1 | 기본 비행 (비행 물리 · 이착륙 · 조이스틱) | ⏳ |
| 2 | 한반도 지형 + 3개 공항 | ⏳ |
| 3 | 조종석 계기 · 오토파일럿 · ILS | ⏳ |
| 4 | 비행 계획 · 연료/무게 · 체크리스트 · 착륙 평가 | ⏳ |
| 5 | 날씨 · 야간 · ATC · 고장 훈련 | ⏳ |

## 구성

- `index.html` — 시작 화면
- `check.html` — 0단계 환경 점검 도구
- `css/` — 공통 스타일
- `vendor/` — 외부 라이브러리 (three.js r170, MIT 라이선스)

## 사용한 오픈소스

- [three.js](https://threejs.org/) — MIT License (`vendor/LICENSE-three.txt`)
