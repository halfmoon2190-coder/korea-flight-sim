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
| 1 | 기본 비행 (비행 물리 · 이착륙 · 조이스틱) | 🧪 시험 중 |
| 2 | 한반도 지형 + 3개 공항 | ⏳ |
| 3 | 조종석 계기 · 오토파일럿 · ILS | ⏳ |
| 4 | 비행 계획 · 연료/무게 · 체크리스트 · 착륙 평가 | ⏳ |
| 5 | 날씨 · 야간 · ATC · 고장 훈련 | ⏳ |

## 구성

- `index.html` — 시작 화면
- `fly.html` — 비행 화면 (1단계 연습 비행)
- `check.html` — 0단계 환경 점검 도구
- `js/sim/` — 비행 물리(6자유도), A320급 데이터, 전자식 조종(FBW) 법칙, 대기 모델
- `js/world/` — 지형 · 활주로(표지 · 등화 · PAPI)
- `js/view/` — 기체 모델 · 카메라
- `js/ui/` — 계기(PFD · 엔진/시스템), 착륙 평가
- `js/input.js` — 키보드 · 조이스틱(디지털 램프 보정, 버튼 배정)
- `js/audio.js` — 엔진음 · 콜아웃
- `tools/simtest.js` — 비행 물리 자동 검증 (`node tools/simtest.js`)
- `css/` — 스타일
- `vendor/` — 외부 라이브러리 (three.js r170, MIT 라이선스)

## KF-320 (가상 기체)

A320급 협동체 쌍발기의 공개 성능 수준을 참고한 가상 기체입니다.
날개면적 122.6m², 최대이륙중량 78t, 엔진 2 × 120kN, 전자식 조종(정상 · 지상 · 플레어 법칙, 받음각 · 자세 · 과속 보호).

## 사용한 오픈소스

- [three.js](https://threejs.org/) — MIT License (`vendor/LICENSE-three.txt`)
