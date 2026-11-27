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
| 1 | 기본 비행 (비행 물리 · 이착륙 · 조이스틱) | ✅ |
| 2 | 한반도 지형 + 3개 공항 (노선 비행, 지도, 시간 가속) | ✅ |
| 3 | 오토파일럿 · 오토스로틀 · FD · ND · 간이 FMS · ILS 자동착륙 · 3D 경로 링 | 🧪 시험 중 |
| 4 | 비행 계획 · 연료/무게 · 체크리스트 · 착륙 평가 | ⏳ |
| 5 | 날씨 · 야간 · ATC · 고장 훈련 | ⏳ |

## 구성

- `index.html` — 시작 화면
- `fly.html` — 비행 화면 (1단계 연습 비행)
- `check.html` — 0단계 환경 점검 도구
- `js/sim/` — 비행 물리(6자유도), A320급 데이터, 전자식 조종(FBW) 법칙, 대기 모델, 자동비행(AP · A/THR · FD)
- `js/nav/` — 간이 FMS (경유지 · 수직 프로파일 · 강하 시작점)
- `js/world/` — 연습 월드, 한반도 지형(LOD 청크 · 공항 평탄화 · 도시), 활주로(표지 · 등화 · PAPI)
- `js/geo/` — 람베르트 정각원추 투영, 자북 편차, 공항 데이터
- `data/terrain/` — 높이맵 (`node tools/build-terrain.mjs`로 재생성)
- `js/view/` — 기체 모델 · 카메라
- `js/ui/` — 계기(PFD · 엔진/시스템), 착륙 평가
- `js/input.js` — 키보드 · 조이스틱(디지털 램프 보정, 버튼 배정)
- `js/audio.js` — 엔진음 · 콜아웃
- `tools/simtest.js` — 비행 물리 자동 검증 (`node tools/simtest.js`)
- `tools/aptest.js` — 자동비행 검증 (`node tools/aptest.js --route`: 인천→김해 실제 지형 자동비행 · 자동착륙)
- `css/` — 스타일
- `vendor/` — 외부 라이브러리 (three.js r170, MIT 라이선스)

## KF-320 (가상 기체)

A320급 협동체 쌍발기의 공개 성능 수준을 참고한 가상 기체입니다.
날개면적 122.6m², 최대이륙중량 78t, 엔진 2 × 120kN, 전자식 조종(정상 · 지상 · 플레어 법칙, 받음각 · 자세 · 과속 보호).

## 사용한 오픈소스 · 데이터 (출처)

- [three.js](https://threejs.org/) — MIT License (`vendor/LICENSE-three.txt`)
- 지형 고도: [AWS Open Data Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen/Tilezen Terrarium).
  포함 자료: SRTM (NASA), GMTED2010 (USGS), ETOPO1 (NOAA) 등 — 각 자료의 출처 표기 조건에 따름
- 공항 · 활주로 좌표: [OurAirports](https://ourairports.com/data/) — 퍼블릭 도메인
- 터미널 · 유도로 배치와 도시 위치는 단순화한 근사값이며 실제와 다를 수 있습니다. 항공 운항에 사용할 수 없습니다.
