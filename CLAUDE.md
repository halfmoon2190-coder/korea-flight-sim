# Korea Flight Sim — 작업 인수인계 (Claude용)

브라우저 기반 여객기 운항 시뮬레이터. 인천(RKSI)·김해(RKPK)·제주(RKPC) 노선, A320급 가상 기체 KF-320.
배포: GitHub Pages (`main` 브랜치 루트) → https://halfmoon2190-coder.github.io/korea-flight-sim/

## 사용자에 대해
- 한국어로 대화. 회계·재무 전문가이며 코딩은 잘 모름(바이브 코딩). 항공 운항 경험도 많지 않음.
- 선택지가 있으면 **대안을 표로 제시하고 추천안을 명확히** 말한 뒤, 승인받으면 진행하는 방식을 선호.
- 결과 보고는 쉬운 말로, 무엇을 확인했고 무엇을 확인하지 못했는지 정직하게.
- PC: Windows 11 노트북, i5-1335U, 16GB, Intel Iris Xe(내장), 화면 1536×864(배율 1.25), 60Hz, Chrome.
  - 2D 계기판 모드 60fps, 3D 조종석 모드 약 35fps → **2D가 기본**, 3D 조종석은 선택(기본 끔).
- 조이스틱: 오락실형 **디지털 8방향** 스틱(DragonRise 0079:0006). 브라우저에 **장치 2개로 인식**되어 입력을 합산함.
  축 0/1 = 방향, 버튼 0~7 사용. 기본 배정: 0 추력+, 1 추력−, 2 플랩↑, 3 플랩↓, 4 기어, 5 브레이크, 6 스피드브레이크, 7 시점.
- 지금까지 피드백: 스틱 반응이 약간 느렸음(기본값 상향함), 3D 조종석 계기는 너무 작아 잘 안 씀, 조종석 아래 시야 → 계기판 크기 선택(Q 키)으로 해결. 전반적으로 만족.

## 구조
- `fly.html` + `js/main.js`: 비행 화면, 모든 모듈 연결과 메인 루프(물리 120Hz 고정 스텝, 시간 가속)
- `js/sim/`: `aircraft.js`(6자유도 물리·FBW 정상/지상/플레어 법칙·엔진 2개·기어·오토브레이크·FLEX·고장), `a320.js`(기체 데이터),
  `autopilot.js`(AP·A/THR·FD 모드, 복행, 자동착륙), `perf.js`(연료표·이륙 성능 시뮬·착륙거리), `weather.js`, `atmo.js`
- `js/nav/fms.js`: 경로(DEP→BASE→IAF→FAF→활주로), 수직 프로파일, T/D
- `js/world/`: `world.js`(환경·시간대·연습 월드), `korea.js`·`terrain.js`(지형 LOD 청크, 공항 평탄화, 도시), `runway.js`, `clouds.js`
- `js/geo/`: `proj.js`(LCC 투영, 자오선 수렴각, 자북 편차 8.5°W), `airports.js`(OurAirports 활주로 좌표 + 근사 터미널 배치)
- `js/ui/`: `instruments.js`(PFD·엔진/시스템), `nd.js`, `minimap.js`, `ops.js`(운항 준비·체크리스트창·평가서·기록부), `landing.js`
- `js/ops/`: `checklists.js`, `monitor.js`(단계 감시·안정접근·평가), `atc.js`, `failures.js`
- `js/view/`: `model.js`(외부 기체), `cockpit.js`(3D 조종석), `camera.js`, `routeguide.js`(3D 링)
- `data/terrain/`: 높이맵 PNG(값 = (고도+500)×4, R상위·G하위 바이트). `node tools/build-terrain.mjs`로 재생성(AWS Terrain Tiles)
- `vendor/three.module.min.js`: three.js r170 (빌드 도구 없음, ES 모듈 직접 로드)

## 좌표 · 단위 규칙
- 월드: x=동, y=위, z=남(북=−z), m. 기체 로컬: x=오른쪽, y=위, z=꼬리(기수=−z). 각속도 로컬 w=(q, −r, −p).
- `ac.heading`은 **지도 격자 기준**, 화면 표시는 `ac.dispHeading`(= 격자 + 수렴각 + 자북편차). FCU HDG는 자북 기준.
- 바람은 `ac.wind`(월드 벡터, 공기 이동 방향)로 매 스텝 주입. IAS/TAS는 공기 상대속도.
- 평지(연습) 월드의 지면 층은 depthTest 없이 renderOrder로 그림. 한반도 월드는 로그 깊이 버퍼 + 높이 오프셋.

## 검증 (변경 후 반드시 실행)
```
npm install            # pngjs (지형 빌드 · 노선 테스트용)
node tools/simtest.js  # 비행 물리 18항목
node tools/aptest.js --route   # 자동비행·날씨·고장·관제·인천→김해 실제 지형 자동비행 (약 28항목, 수 초)
```
브라우저 확인은 로컬 서버(`python -m http.server`)를 띄운 뒤 Playwright로 `window.__kfs` 디버그 API를 사용
(`setRoute`, `setScenario`, `setEnv`, `startFlight`, `ff(초)` 빨리 감기, `rig.set(view)` 등).
헤드리스 SwiftShader는 약 10fps이므로 시간 의존 테스트는 `ff()`를 쓸 것.

## 작업 방식
- 커밋 메시지는 한국어 요약 + 항목. `main`에 직접 커밋·푸시(Pages 자동 배포).
- 개인정보(이메일 등)는 저장소에 넣지 않음. 관제 주파수·터미널 배치는 가상/근사임을 유지.
- 실제 항공사·제조사 로고와 상표는 쓰지 않음(기체명 KF-320, 가상 도색).

## 남은 아이디어 (사용자에게 제안한 것)
공항 추가(김포·청주 등), 실시간 날씨 연동, 승객 안내방송·만족도, 3D 조종석 개선(성능·가독성).
측풍 자동착륙은 중심선에서 최대 약 11m 벗어날 수 있음(개선 여지). 착륙거리는 공식 기반(이륙거리만 물리 시뮬).
