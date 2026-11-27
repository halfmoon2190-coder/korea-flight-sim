// 공항 데이터 — 활주로 좌표·길이·폭·표고: OurAirports (퍼블릭 도메인)
// 터미널·유도로 배치는 단순화한 근사값 (활주로 기준 좌표 u: 활주로 방향, v: 오른쪽)
export const AIRPORTS = [
  {
    icao: 'RKSI', iata: 'ICN', name: '인천국제공항', short: '인천', lat: 37.469101, lon: 126.450996, elevFt: 23,
    runways: [
      { le: '15L', he: '33R', a: [37.483898, 126.440002], b: [37.456402, 126.464996], lenFt: 12303, widFt: 197, twy: { side: -1, off: 200 } },
      { le: '15R', he: '33L', a: [37.481800, 126.435997], b: [37.454201, 126.460999], lenFt: 12303, widFt: 197, twy: { side: 1, off: 200 } },
      { le: '16L', he: '34R', a: [37.472740, 126.415631], b: [37.443432, 126.441697], lenFt: 13123, widFt: 197, twy: { side: -1, off: 200 } },
      { le: '16R', he: '34L', a: [37.468746, 126.413446], b: [37.441272, 126.437882], lenFt: 12303, widFt: 197, twy: { side: 1, off: 200 } },
    ],
    // 제1·제2 여객터미널 (15R/33L과 16L/34R 사이)
    terminals: [
      { ref: '15R', u: 650, v: 1050, len: 1100, wid: 130, h: 30, apron: 380 },
      { ref: '15R', u: -1500, v: 1050, len: 900, wid: 130, h: 30, apron: 380 },
    ],
    tower: { ref: '15R', u: -350, v: 1050 },
  },
  {
    icao: 'RKPK', iata: 'PUS', name: '김해국제공항', short: '김해', lat: 35.179501, lon: 128.938004, elevFt: 6,
    runways: [
      { le: '18L', he: '36R', a: [35.194099, 128.936996], b: [35.169498, 128.940994], lenFt: 9007, widFt: 150, twy: { side: -1, off: 190 } },
      { le: '18R', he: '36L', a: [35.193901, 128.934998], b: [35.165199, 128.938995], lenFt: 10499, widFt: 197, twy: { side: 1, off: 190 } },
    ],
    terminals: [
      { ref: '18R', u: -250, v: 650, len: 700, wid: 110, h: 24, apron: 300 },
    ],
    tower: { ref: '18R', u: 300, v: 560 },
    note: '북쪽 산지 때문에 18 방향은 36 방향 계기접근 후 선회접근(Circling)으로 착륙하는 경우가 많습니다.',
  },
  {
    icao: 'RKPC', iata: 'CJU', name: '제주국제공항', short: '제주', lat: 33.512058, lon: 126.492548, elevFt: 118,
    runways: [
      { le: '07', he: '25', a: [33.500401, 126.469002], b: [33.514500, 126.497002], lenFt: 10433, widFt: 148, twy: { side: 1, off: 180 } },
      { le: '13', he: '31', a: [33.515499, 126.486992], b: [33.505501, 126.503998], lenFt: 6268, widFt: 148, twy: null },
    ],
    terminals: [
      { ref: '07', u: 450, v: 430, len: 750, wid: 110, h: 24, apron: 280 },
    ],
    tower: { ref: '07', u: 50, v: 420 },
  },
];

export const findAirport = (icao) => AIRPORTS.find(a => a.icao === icao);
