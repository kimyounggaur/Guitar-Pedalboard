# 웹 기반 기타 가상 페달보드 - 디스토션 개발 가이드

웹 오디오 API를 사용하여 디스토션 효과를 구현하는 구체적인 단계별 프롬프트를 제공합니다.

## 📋 Tone.js를 활용한 가장 빠른 방법

```javascript
// 1단계: Tone.js로 기본 디스토션 페달 구현
const prompt = `
다음 요구사항으로 Tone.js를 사용한 웹 기타 디스토션 페달을 구현해줘:

## 기본 구조
1. 마이크 입력 또는 오디오 파일 입력받기 (Tone.UserMedia 또는 Tone.Oscillator)
2. Distortion 효과 적용 (Tone.Distortion)
3. 출력 (Tone.Destination)

## 요구사항
- 디스토션 강도 조절: 0~100% 슬라이더
- 입출력 볼륨 미터
- 실시간 주파수 표시 (AnalyserNode 사용)
- 온/오프 토글 버튼
- 프리셋 3개 (Clean, Mild, Extreme)

## UI
- HTML5 슬라이더로 디스토션 양 조절
- 반응형 CSS 그래프로 현재 설정값 표시
- 파형 시각화 (Canvas)

코드는 모듈식으로 작성하고, 주석을 한국어로 달아줘.
`
```

---

## 🔧 Web Audio API를 사용한 깊이 있는 구현

```javascript
const detailedPrompt = `
Web Audio API를 사용하여 정교한 디스토션 이펙터를 개발해줘.

## 1단계: 오디오 입력 설정
- AudioContext 생성
- getUserMedia()로 마이크 입력
- MediaStreamAudioSourceNode 생성

## 2단계: 디스토션 알고리즘 구현
디스토션은 3가지 방식으로 구현:

### 방식 A) Soft Clipping (부드러운 왜곡)
- 입력 신호를 -1~1 범위로 정규화
- tanh() 함수 사용: output = Math.tanh(input * drive)
- drive 파라미터로 강도 조절 (1~50)

### 방식 B) Hard Clipping (딱딱한 왜곡)
- 임계값 설정 (threshold)
- 임계값 초과 신호는 강제로 자르기
- wet/dry 믹스로 원본 신호와 섞기

### 방식 C) Bit Crushing (디지털 왜곡)
- 샘플 해상도 감소
- quantize() 함수 구현

## 3단계: 신호 체인
마이크 → Gain → Distortion → Tone Control (LPF) → Output Gain → 출력

## 4단계: 컨트롤 파라미터
1. Drive (입력 게인): 0~100
2. Tone (저주파 필터): 0~10kHz
3. Level (출력 게인): 0~1
4. Mix (원본/이펙트): 0~100%

## 5단계: 시각화
- FFT 분석기로 주파수 대역 표시
- 입출력 파형 비교 표시
- 실시간 게인 미터

코드 구조:
- class Distortion {}
- class Pedalboard {}
- updatePedalboard() 실시간 업데이트 함수
`;
```

---

## 💡 실제 구현 프롬프트 (한 번에 실행 가능)

```javascript
const completeImplementation = `
웹 기타 페달보드용 "Distortion" 이펙터를 완성해줘.

### 필수 기능
1. **입력 처리**
   - 마이크 입력 또는 오디오 파일 업로드
   - 입력 신호 실시간 캡처

2. **디스토션 엔진** (Soft Clipping 기반)
   - ProcessorNode로 실시간 신호 처리
   - drive 파라미터로 비선형 왜곡 정도 조절
   - tone(LPF)로 고주파 제거

3. **UI 제어**
   - Drive 슬라이더 (0~100%)
   - Tone 슬라이더 (200Hz~10kHz)
   - Level 슬라이더 (0dB~-40dB)
   - ON/OFF 토글
   - 3개 프리셋 (Classic, Metal, Fuzz)

4. **피드백 시각화**
   - 입력/출력 VU 미터
   - 파형 표시 (Canvas)
   - 주파수 스펙트럼 분석기
   - 현재 설정값 디스플레이

### 기술 스펙
- 샘플 레이트: 44100 Hz 또는 48000 Hz
- 버퍼 크기: 2048 samples
- 지연시간(latency): < 100ms
- 호환성: Chrome, Firefox, Safari, Edge

### 코드 구조
\`\`\`
HTML: 슬라이더, 버튼, Canvas 요소
CSS: 어두운 테마, 기타 페달 디자인 스타일링
JavaScript:
  - AudioContext 초기화
  - AudioWorklet 또는 ScriptProcessorNode로 디스토션 처리
  - requestAnimationFrame으로 UI 업데이트
  - 파라미터 변경 시 실시간 반영
\`\`\`

반응형 디자인이고, 모바일에서도 작동해야 해. 코드는 깔끔하고 주석을 한국어로 달아줘.
`;
```

---

## 🎸 실전 팁: 프롬프트 작성 순서

### **1단계: 기초 버전 만들기**
```
"Tone.js를 사용해서 간단한 디스토션 이펙터를 만들어줘. 
슬라이더 하나로 강도를 0~100 사이에서 조절할 수 있어야 해."
```

### **2단계: 시각화 추가**
```
"위의 디스토션 코드에 Canvas를 사용한 파형 시각화를 추가해줘.
입력 신호와 출력 신호를 다른 색상으로 표시해."
```

### **3단계: 고급 기능 추가**
```
"디스토션에 Tone 컨트롤(저주파 필터)과 Output Level을 추가해줘.
그리고 Soft Clipping, Hard Clipping 두 가지 모드를 선택할 수 있게 해."
```

### **4단계: 페달보드 통합**
```
"이 디스토션 페달을 다른 이펙터(Reverb, Delay)와 연결할 수 있도록 
시그널 체인 구조로 리팩토링해줘."
```

---

## 🎯 핵심 디스토션 알고리즘 (프롬프트 시 포함)

```javascript
// Soft Clipping 디스토션의 핵심 공식
function distortionProcess(inputSample, drive) {
  const distorted = Math.tanh(inputSample * drive);
  return distorted; // -1 ~ 1 범위의 왜곡된 신호
}

// tone 조절 (간단한 LPF)
function applyTone(sample, toneFreq) {
  // toneFreq가 낮을수록 저음만 남김
  // 일반적으로 1kHz~10kHz 범위
}
```

---

## 📝 Claude Code에서 바로 실행할 프롬프트

이 프롬프트를 **Claude Code**의 `/code` 명령으로 넘기면 됩니다:

```
웹 기타 디스토션 페달 만들어줘

## 요구사항
- Tone.js 사용
- 마이크 또는 파일 입력
- Drive, Tone, Level 슬라이더
- 파형 시각화
- 3개 프리셋 (Clean, Crunch, Metal)
- 반응형 CSS 디자인
- 모바일 대응

## 파일 구조
- HTML: UI 레이아웃
- CSS: 기타 페달 테마
- JavaScript: 오디오 로직 + 파라미터 제어

# 웹 기타 페달보드 - 오버드라이브(Overdrive) 개발 가이드

오버드라이브는 **부드럽고 따뜻한 튜브 앰프의 포화감**을 표현합니다. 디스토션보다 덜 공격적이고 자연스럽습니다.

---

## 🎸 오버드라이브 vs 디스토션 (이해하기)

| 특성 | 오버드라이브 | 디스토션 |
|------|-----------|--------|
| 왜곡 강도 | 약~중 | 중~강 |
| 톤 특성 | 따뜻함, 부드러움 | 거침, 공격적 |
| 사용 상황 | 블루스, 클래식락 | 메탈, 하드락 |
| 클리핑 방식 | Soft + Asymmetric | Hard |
| 원본 신호 유지율 | 높음 (더 투명) | 낮음 |

---

## 🔧 기본 구현 프롬프트

```javascript
const overdrivBasic = `
Tone.js를 사용한 웹 기타 오버드라이브 페달을 만들어줘.

## 오버드라이브의 특징
- 디스토션보다 부드럽고 따뜻한 톤
- 튜브 앰프가 과부하되는 느낌
- 입력이 작을 때는 거의 변화 없음
- 입력이 증가하면서 점진적으로 왜곡

## 필수 컨트롤
1. Drive: 0~100% (포화도)
2. Tone: 0~10kHz (저주파 강조)
3. Level: 0~1 (출력 게인)
4. ON/OFF 토글

## UI
- 슬라이더 3개
- 파형 표시 (입출력 비교)
- 현재 설정값 표시

반응형 CSS, 한국어 주석으로 작성해줘.
`;
```

---

## 🎯 구체적이고 단계적인 완전 프롬프트

```javascript
const overdrivComplete = `
웹 기타 오버드라이브 페달을 Tone.js로 개발해줘.

## 1단계: 오버드라이브 알고리즘 이해
오버드라이브는 다음 특성을 가져:

### (1) Asymmetric Soft Clipping
- 양수와 음수를 다르게 처리
- 긍정적 신호: tanh(x * drive) 
- 부정적 신호: tanh(x * drive * 0.8) ← 약간 덜 왜곡
- 결과: 따뜻하고 비대칭적인 톤

### (2) Input Gain (Drive)
- 신호를 증폭한 후 클리핑
- Drive 0% = 원본 신호 (No Effect)
- Drive 100% = 강한 포화감
- 범위: 1.0 ~ 10.0 배수

### (3) Tone Control (3-band EQ)
- Bass: 50Hz~500Hz 부스트 (따뜻함)
- Mid: 500Hz~3kHz (현의 톤)
- Treble: 3kHz~15kHz (선명함)

### (4) Output Level
- 왜곡 후 출력 게인 조절
- 원래 볼륨 유지용

## 2단계: 신호 체인 구성
마이크 입력
  ↓
[Input Gain] × drive
  ↓
[Asymmetric Clipping] tanh 처리
  ↓
[Tone Stack] 3-band EQ
  ↓
[Output Level] 게인 조절
  ↓
스피커 출력

## 3단계: 파라미터 정의
- drive: 1.0 ~ 10.0 (슬라이더 0~100%에서 변환)
- bass: -12dB ~ +12dB
- mid: -12dB ~ +12dB  
- treble: -12dB ~ +12dB
- level: 0dB ~ -40dB
- mix: 0~100% (wet/dry 비율)

## 4단계: UI 컨트롤
1. Drive 슬라이더 (0~100%)
   - 라벨: "DRIVE"
   - 값 표시: 0~100

2. Tone Stack
   - Bass: -12~+12dB
   - Mid: -12~+12dB
   - Treble: -12~+12dB
   (또는 하나의 "Tone" 슬라이더로 단순화)

3. Level 슬라이더 (0~1)
   - 라벨: "OUTPUT"

4. 토글 버튼
   - ON/OFF

5. 프리셋 버튼 3개
   - "Blues" (Drive: 40%, Tone: Mid-focused)
   - "Classic" (Drive: 60%, Tone: Balanced)
   - "Crunch" (Drive: 85%, Tone: Bright)

## 5단계: 시각화
- 입력 신호 (파란색 파형)
- 출력 신호 (빨간색 파형)
- 입출력 레벨 미터 (dB 단위)
- 주파수 스펙트럼 (선택사항)
- 현재 Drive 강도 표시

## 6단계: 코드 구조
class Overdrive {
  constructor() {
    // Tone.js 초기화
    // 입력 게인, 왜곡 처리, 톤 컨트롤 설정
  }
  
  process(inputBuffer) {
    // Asymmetric clipping 알고리즘
    // 1. 입력에 drive 값 곱하기
    // 2. tanh() 클리핑 적용
    // 3. 출력 게인 적용
    return processedBuffer;
  }
  
  setDrive(value) { ... }
  setTone(bass, mid, treble) { ... }
  setLevel(value) { ... }
}

## 7단계: 디자인
- 어두운 테마 (페달보드 스타일)
- 노란색 또는 주황색 악센트
- 반응형 레이아웃
- 모바일 터치 친화적

## 추가 고려사항
1. 지연시간(Latency) < 100ms
2. 부드러운 파라미터 변환 (crackling 방지)
3. CPU 효율성
4. 호환성 (Chrome, Firefox, Safari, Edge)

코드는 모듈식으로, 주석을 한국어로 달아주고,
나중에 다른 이펙터(Reverb, Delay, Chorus)와 연결할 수 있도록 설계해줘.
`;
```

---

## 💻 핵심 알고리즘 (프롬프트에 포함 가능)

```javascript
// Asymmetric Soft Clipping 오버드라이브
function overdriveProcess(inputSample, drive) {
  // 입력을 drive 값으로 증폭
  const driven = inputSample * drive;
  
  // 비대칭 클리핑: 양수와 음수 다르게 처리
  let output;
  if (driven > 0) {
    // 양수: 더 강한 클리핑
    output = Math.tanh(driven);
  } else {
    // 음수: 약한 클리핑 (따뜻한 톤)
    output = Math.tanh(driven * 0.8);
  }
  
  return output;
}

// 간단한 Tone Stack (3-band EQ)
function applyToneStack(sample, bass, mid, treble) {
  // bass: 저주파 (50~500Hz)
  // mid: 중간주파 (500Hz~3kHz)
  // treble: 고주파 (3kHz~15kHz)
  
  // 각 대역을 개별 필터로 처리
  let output = sample;
  output += (sample * bass * 0.1);      // Bass 증폭
  output += (sample * mid * 0.05);      // Mid 증폭
  output += (sample * treble * 0.08);   // Treble 증폭
  
  return Math.max(-1, Math.min(1, output)); // -1~1 범위 유지
}

// Wet/Dry Mix
function mixWetDry(originalSample, processedSample, wetAmount) {
  // wetAmount: 0 = 100% 원본, 1 = 100% 처리
  return originalSample * (1 - wetAmount) + processedSample * wetAmount;
}
```

---

## 🎛️ 프리셋 정의 (프롬프트에 포함 가능)

```javascript
const overdrivePresets = {
  blues: {
    drive: 40,
    bass: 2,
    mid: 4,
    treble: 1,
    level: 0.7,
    description: "부드럽고 따뜻한 블루스 톤"
  },
  classic: {
    drive: 60,
    bass: 2,
    mid: 2,
    treble: 2,
    level: 0.8,
    description: "균형잡힌 클래식 오버드라이브"
  },
  crunch: {
    drive: 85,
    bass: 1,
    mid: 3,
    treble: 4,
    level: 0.9,
    description: "선명하고 강한 크런치 톤"
  }
};
```

---

## 📝 Claude Code에서 실행할 최종 프롬프트

```
웹 기타 오버드라이브 페달 만들어줘

## 주요 요구사항
- Tone.js 기반
- Asymmetric Soft Clipping 알고리즘
- Drive (0~100%), Tone, Level 슬라이더
- 3개 프리셋: Blues, Classic, Crunch
- 입출력 파형 시각화
- 반응형 CSS (어두운 테마, 주황색 악센트)
- 모바일 대응
- 한국어 주석

## 프리셋 특성
1. Blues: Drive 40%, 따뜻한 톤
2. Classic: Drive 60%, 균형잡힌 톤
3. Crunch: Drive 85%, 선명한 톤

## 신호 체인
마이크 → Drive Gain → Clipping → Tone Stack → Output Level → 출력
```

---

## 🔄 디스토션과의 차이점 강조 프롬프트

```javascript
const differencePrompt = `
오버드라이브는 디스토션과 다른 톤이야:

### 디스토션
- 강한 왜곡
- 공격적인 톤
- Drive를 높게 설정 (5~10배)

### 오버드라이브 ← 지금 만들 것
- 부드러운 왜곡
- 따뜻한 튜브 톤
- Drive를 낮게 설정 (1~5배)
- Asymmetric clipping으로 자연스러운 포화감

이 점을 코드에 반영해줘.
`;
```

---

## 🎯 다음 단계

1. **기본 오버드라이브** ✓ (위 프롬프트)
2. **다른 이펙터 추가**:
   - 리버브 (Reverb)
   - 딜레이 (Delay)
   - 코러스 (Chorus)
3. **페달보드 통합**: 여러 이펙터를 시리즈로 연결
4. **프리셋 저장/로드**: 로컬스토리지에 사용자 설정 저장

# 웹 기타 페달보드 - 크런치(Crunch) 개발 가이드

크런치는 **오버드라이브와 디스토션의 중간**으로, 거리낀 톤의 "갈리는" 느낌을 표현합니다.

---

## 🎸 크런치의 위치 파악

```
깨끗함  →  오버드라이브  →  크런치  →  디스토션  →  퍼즈
(Clean)    (부드러움)    (갈림)   (거침)      (극단)
```

| 특성 | 오버드라이브 | **크런치** | 디스토션 |
|------|-----------|---------|---------|
| 왜곡 강도 | 약~중 | **중~강** | 강 |
| 톤 특성 | 따뜻함 | **거친 갈림** | 공격적 |
| 클리핑 | Asymmetric Soft | **Mixed** | Hard |
| 사용 장르 | 블루스 | **얼터너티브, 펑크** | 메탈 |
| 원본 신호 유지율 | 높음 | **중간** | 낮음 |

---

## 🔧 기본 구현 프롬프트

```javascript
const crunchBasic = `
Tone.js를 사용한 웹 기타 크런치 페달을 만들어줘.

## 크런치의 특징
- 오버드라이브보다 더 거친 톤
- 디스토션보다는 덜 극단적
- 거리낀 "갈리는" 느낌
- 중저음이 강조되는 톤
- 컴프레션 효과로 다이나믹 제어

## 필수 컨트롤
1. Drive: 0~100% (왜곡 강도)
2. Tone: 0~10kHz (톤 밝기)
3. Level: 0~1 (출력 게인)
4. ON/OFF 토글

## UI
- 슬라이더 3개
- 파형 표시 (입출력 비교)
- 리드 미터 (컴프레션 시각화)

반응형 CSS, 한국어 주석으로 작성해줘.
`;
```

---

## 🎯 구체적이고 단계적인 완전 프롬프트

```javascript
const crunchComplete = `
웹 기타 크런치 페달을 Tone.js로 개발해줘.

## 1단계: 크런치 알고리즘 이해
크런치는 다음 요소들의 조합:

### (1) Mixed Clipping (하이브리드 클리핑)
- 50% Hard Clipping + 50% Soft Clipping
- Hard: 신호가 임계값(threshold)을 넘으면 강제로 자르기
- Soft: tanh() 함수로 부드럽게 포화시키기
- 결과: 날카로움과 부드러움의 혼합

코드:
\`\`\`javascript
function crunchClipping(input, drive, hardness) {
  // hardness: 0 = 100% Soft, 1 = 100% Hard
  const driven = input * drive;
  
  // Hard Clipping
  const hardClipped = Math.max(-1, Math.min(1, driven));
  
  // Soft Clipping
  const softClipped = Math.tanh(driven);
  
  // Mix
  return hardClipped * hardness + softClipped * (1 - hardness);
}
\`\`\`

### (2) Dynamic Compression (동적 압축)
- 큰 신호는 압축하고 작은 신호는 유지
- 게인 감소(Gain Reduction): 5dB ~ 15dB
- Attack: 5ms (빠른 반응)
- Release: 50ms (빠른 해제)
- 효과: "갈리는" 톤의 응축력

### (3) Tone Stack (톤 조절)
- Bass: 50Hz~200Hz 강조 (두터움)
- Mid: 1kHz~3kHz 약간 강조 (가시성)
- Treble: 5kHz~15kHz 감소 (거칠기 제거)
- 목표: 중저음이 두드러진 톤

### (4) Harmonic Distortion (조화 왜곡)
- 기본음(fundamental)에 홀수배 고조파 추가
- 2차: +5%, 3차: +8%, 5차: +3%
- 효과: 더 풍부한 크런치 톤

### (5) Output Compression (출력 압축)
- 최종 출력 레벨 정규화
- 피크 제한(Limiter): -0.1dB

## 2단계: 신호 체인 구성
마이크 입력
  ↓
[Input Gain] × drive (2.0 ~ 8.0)
  ↓
[Compression] 게인 감소 적용
  ↓
[Mixed Clipping] Hard + Soft 혼합
  ↓
[Harmonic Enhancement] 고조파 추가
  ↓
[Tone Stack] Bass 강조, Treble 감소
  ↓
[Output Limiter] 피크 제한
  ↓
[Output Level] 최종 게인
  ↓
스피커 출력

## 3단계: 파라미터 정의
- drive: 2.0 ~ 8.0 (슬라이더 0~100% 변환)
- hardness: 0.5 ~ 1.0 (Hard/Soft 믹스 비율)
- threshold: -20dB ~ -10dB (압축 시작점)
- ratio: 2:1 ~ 4:1 (압축 강도)
- attack: 5ms (고정)
- release: 50ms (고정)
- bass: -6dB ~ +6dB
- mid: 0dB ~ +3dB
- treble: -9dB ~ 0dB
- level: 0dB ~ -40dB

## 4단계: UI 컨트롤
1. Drive 슬라이더 (0~100%)
   - 라벨: "DRIVE"
   - 값 표시: 0~100
   - 심볼: 화살표 증가

2. Tone 슬라이더 (0~100%)
   - 라벨: "TONE"
   - 값 표시: Bright ← → Dark
   - 0% = 밝음, 100% = 어두움

3. Level 슬라이더 (0~1)
   - 라벨: "OUTPUT"

4. 토글 버튼
   - ON/OFF

5. 프리셋 버튼 3개
   - "Soft Crunch" (Drive: 40%, Tone: 40%, Compression: Mild)
   - "Standard" (Drive: 65%, Tone: 60%, Compression: Medium)
   - "Extreme Crunch" (Drive: 90%, Tone: 80%, Compression: Strong)

## 5단계: 시각화
- 입력 신호 (파란색 파형)
- 출력 신호 (빨간색 파형)
- Gain Reduction 미터 (dB 단위, 노란색)
  - 입력 크기에 따라 수직 바로 표시
  - 압축이 강할수록 길어짐
- 입출력 레벨 미터 (dB)
- 주파수 스펙트럼 (선택사항)

## 6단계: 코드 구조
class Crunch {
  constructor() {
    // Tone.js 초기화
    this.compressor = new Tone.Compressor({
      threshold: -20,
      ratio: 3,
      attack: 0.005,
      release: 0.05
    });
    
    this.drive = 1;
    this.hardness = 0.7;
    this.tone = 0.6;
    this.level = 0.8;
  }
  
  process(inputBuffer) {
    // 1. Drive 게인 적용
    // 2. Compression 적용
    // 3. Mixed Clipping (Hard + Soft)
    // 4. 고조파 추가 (선택)
    // 5. Tone Stack 적용
    // 6. Output Limiter 적용
    // 7. Output Level 적용
    return processedBuffer;
  }
  
  setDrive(value) { this.drive = 2 + (value * 6); }
  setTone(value) { this.tone = value; }
  setLevel(value) { this.level = value; }
}

## 7단계: 디자인
- 어두운 테마
- 빨간색/주황색 악센트 (공격성 표현)
- Gain Reduction 시각화는 노란색
- 반응형 레이아웃
- 모바일 터치 친화적

## 8단계: 성능 최적화
- AudioWorklet 사용 (또는 ScriptProcessorNode)
- 버퍼 크기: 2048 samples
- 샘플 레이트: 44100 Hz 또는 48000 Hz
- 지연시간(Latency): < 100ms
- Lookahead 압축: 5~10ms (선택사항)

## 추가 고려사항
1. Aliasing 방지: 오버샘플링 고려 (2배 또는 4배)
2. 부드러운 파라미터 변환 (crackling 방지)
3. CPU 효율성 모니터링
4. 호환성 (Chrome, Firefox, Safari, Edge)

코드는 모듈식으로, 주석을 한국어로 달아주고,
디스토션, 오버드라이브와 함께 페달보드에서 시리즈로 연결할 수 있도록 설계해줘.
`;
```

---

## 💻 핵심 알고리즘 (프롬프트에 포함 가능)

```javascript
// Mixed Clipping: Hard + Soft 조합
function crunchClipping(input, drive, hardness = 0.7) {
  // hardness 0 = 100% Soft, 1 = 100% Hard
  const driven = input * drive;
  
  // Hard Clipping (임계값 제한)
  const hardClipped = Math.max(-1, Math.min(1, driven));
  
  // Soft Clipping (tanh 함수)
  const softClipped = Math.tanh(driven * 0.8);
  
  // 두 방식을 혼합 (hardness 비율로)
  return hardClipped * hardness + softClipped * (1 - hardness);
}

// Dynamic Compression (크런치의 "갈림" 효과)
function compress(input, threshold = -20, ratio = 3, attack = 0.005) {
  const inputDb = 20 * Math.log10(Math.abs(input) + 1e-10);
  
  if (inputDb > threshold) {
    // 임계값 초과 시 압축
    const excessDb = inputDb - threshold;
    const outputDb = threshold + excessDb / ratio;
    return Math.pow(10, outputDb / 20) * Math.sign(input);
  }
  
  return input;
}

// 고조파 추가 (조화 왜곡)
function addHarmonics(input) {
  // 기본음에 고조파 추가
  const fundamental = input;
  const harmonic2nd = input * 0.05;      // 2차 (5%)
  const harmonic3rd = input * 0.08;      // 3차 (8%)
  const harmonic5th = input * 0.03;      // 5차 (3%)
  
  return fundamental + harmonic2nd + harmonic3rd + harmonic5th;
}

// Tone Stack (중저음 강조, 고음 감소)
function applyToneStack(sample, toneValue) {
  // toneValue: 0 = Bright, 1 = Dark
  
  let output = sample;
  
  // Bass 강조 (50Hz~200Hz): +6dB @ toneValue = 1
  output += sample * (6 * toneValue * 0.1);
  
  // Mid 살짝 강조 (1kHz~3kHz): +3dB
  output += sample * (3 * 0.05);
  
  // Treble 감소 (5kHz~15kHz): -9dB @ toneValue = 1
  output -= sample * (9 * toneValue * 0.08);
  
  return Math.max(-1, Math.min(1, output));
}

// Output Limiter (피크 제한)
function limitOutput(input, threshold = -0.1) {
  if (input > threshold) {
    return threshold;
  }
  if (input < -threshold) {
    return -threshold;
  }
  return input;
}
```

---

## 🎛️ 프리셋 정의 (프롬프트에 포함 가능)

```javascript
const crunchPresets = {
  softCrunch: {
    drive: 40,
    hardness: 0.5,
    threshold: -18,
    ratio: 2,
    tone: 40,
    level: 0.75,
    description: "부드럽고 미묘한 크런치"
  },
  standard: {
    drive: 65,
    hardness: 0.7,
    threshold: -20,
    ratio: 3,
    tone: 60,
    level: 0.85,
    description: "표준적인 크런치 톤"
  },
  extremeCrunch: {
    drive: 90,
    hardness: 0.9,
    threshold: -15,
    ratio: 4,
    tone: 80,
    level: 0.95,
    description: "극단적이고 공격적인 크런치"
  }
};
```

---

## 📝 Claude Code에서 실행할 최종 프롬프트

```
웹 기타 크런치 페달 만들어줘

## 주요 요구사항
- Tone.js 기반
- Mixed Clipping (Hard 50% + Soft 50%)
- Dynamic Compression (5~15dB 감소)
- Drive (0~100%), Tone, Level 슬라이더
- Gain Reduction 미터 표시
- 3개 프리셋: Soft Crunch, Standard, Extreme Crunch
- 입출력 파형 + GR 미터 시각화
- 반응형 CSS (어두운 테마, 빨간색/주황색 악센트)
- 모바일 대응
- 한국어 주석

## 신호 체인
마이크 → Drive → Compression → Clipping → Harmonics → Tone Stack → Limiter → Output → 출력

## 프리셋 특성
1. Soft Crunch: Drive 40%, 부드러운 갈림
2. Standard: Drive 65%, 표준 크런치
3. Extreme Crunch: Drive 90%, 극단적 갈림
```

---

## 🔄 세 이펙터 비교 프롬프트

```javascript
const comparisonPrompt = `
디스토션, 오버드라이브, 크런치를 한 번에 비교하고 싶어.

## 특성 비교
### 디스토션
- Drive: 강함 (5~10배)
- Clipping: Hard Clipping
- Tone: 공격적
- 압축: 없음

### 오버드라이브
- Drive: 약함 (1~5배)
- Clipping: Asymmetric Soft
- Tone: 따뜻함
- 압축: 없음

### 크런치 ← 중간
- Drive: 중간 (2~8배)
- Clipping: Mixed (Hard + Soft)
- Tone: 중저음 강조
- 압축: 있음 (3:1)

이 차이를 코드에 명확히 반영해줘.
`;
```

---

## 🎯 다음 단계

1. **기본 크런치** ✓ (위 프롬프트)
2. **페달 연결**: 디스토션 → 오버드라이브 → 크런치 시리즈
3. **타임 기반 이펙터**:
   - 딜레이 (Delay)
   - 리버브 (Reverb)
4. **모듈레이션 이펙터**:
   - 코러스 (Chorus)
   - 플랜저 (Flanger)
   - 트레모로 (Tremolo)

---

## 🎸 핵심 정리

| 요소 | 디스토션 | 오버드라이브 | 크런치 |
|------|---------|----------|-------|
| 입력 게인 | 매우 높음 | 낮음 | 중간 |
| 클리핑 방식 | Hard | Asymmetric Soft | Mixed |
| 압축 | ✗ | ✗ | ✓ (3:1) |
| 고조파 | 많음 | 적음 | 중간 |
| 사용처 | 메탈 | 블루스 | 펑크/얼터너티브 |

# 웹 기타 페달보드 - 퍼즈(Fuzz) 개발 가이드

퍼즈는 **극도의 하드 클리핑으로 신호를 사각형파(Square Wave)에 가까운 극단적 왜곡**을 만듭니다. 1960년대 록의 상징적 톤입니다.

---

## 🎸 퍼즈의 위치 파악

```
깨끗함  →  오버드라이브  →  크런치  →  디스토션  →  퍼즈
(Clean)    (부드러움)    (갈림)   (거침)      (극단)
```

| 특성 | 디스토션 | **퍼즈** |
|------|---------|---------|
| 왜곡 강도 | 강 | **극강** |
| 톤 특성 | 거침 | **무뚝뚝, 비트적** |
| 클리핑 | Hard Clipping | **Extreme Hard + Bit Crushing** |
| 원본 신호 유지율 | 낮음 | **거의 없음** |
| 고조파 | 많음 | **매우 많음** |
| 사용 장르 | 메탈 | **사이키델릭, 프로토펑크** |
| 출력 파형 | 거친 정현파 | **사각형파** |

---

## 🔧 기본 구현 프롬프트

```javascript
const fuzzBasic = `
Tone.js를 사용한 웹 기타 퍼즈 페달을 만들어줘.

## 퍼즈의 특징
- 극도의 하드 클리핑
- 신호를 사각형파처럼 변형
- 거의 비트처럼 들리는 극단적 톤
- 저해상도 (Lo-Fi) 느낌
- 심벌을 버링하는 듯한 효과

## 필수 컨트롤
1. Fuzz: 0~100% (왜곡 강도)
2. Tone: 0~100% (밝기 조절)
3. Volume: 0~1 (출력 게인)
4. ON/OFF 토글

## UI
- 슬라이더 3개
- 파형 표시 (입출력 극단 비교)
- 고조파 시각화

반응형 CSS, 한국어 주석으로 작성해줘.
`;
```

---

## 🎯 구체적이고 단계적인 완전 프롬프트

```javascript
const fuzzComplete = `
웹 기타 퍼즈 페달을 Tone.js로 개발해줘.

## 1단계: 퍼즈 알고리즘 이해
퍼즈는 다음 요소들의 극단적 조합:

### (1) Extreme Hard Clipping (극도의 하드 클리핑)
- 신호를 -1.0 또는 +1.0으로 강제 변환
- 임계값이 매우 낮음 (-0.2 ~ -0.1)
- 입력의 작은 변화도 즉시 포화
- 결과: 사각형파에 가까운 출력

코드:
\`\`\`javascript
function extremeClipping(input, threshold = -0.1) {
  if (input > threshold) return 1.0;
  if (input < -threshold) return -1.0;
  return (input / threshold); // Soft edge
}
\`\`\`

### (2) Bit Crushing (비트 감소/Lo-Fi 모드)
- 샘플의 해상도를 감소
- 16-bit → 8-bit → 4-bit 느낌
- 디지털 아티팩트 추가
- 효과: 더 뭉개진 느낌

코드:
\`\`\`javascript
function bitCrush(input, bitDepth = 8) {
  const levels = Math.pow(2, bitDepth);
  return Math.round(input * levels) / levels;
}
\`\`\`

### (3) Tone Stack (톤 조절)
- Bass: 50Hz~200Hz (중저음)
- Mid: 500Hz~2kHz (신체감)
- Treble: 5kHz~15kHz (고음 대폭 감소)
- 목표: 거의 모든 고음을 제거하여 무뚝뚝하고 비트적인 톤

### (4) Sustain/Compression (지속력)
- 신호를 강하게 압축하여 노트 지속력 증가
- Attack: 매우 빠름 (1ms)
- Release: 느림 (200ms)
- Ratio: 매우 강함 (8:1 이상)
- 효과: 각 노트가 길게 울리는 느낌

### (5) Pre-Emphasis & Post-EQ (주파수 조절)
- Pre: 입력 신호에 고주파 부스트
- Post: 출력에서 고주파 제거
- 차이: 내부적으로 강한 왜곡 생성

### (6) Fuzz Amount (퍼즈 양 조절)
- 0% = 약간의 왜곡
- 50% = 중간 퍼즈
- 100% = 극단적 사각형파

## 2단계: 신호 체인 구성
마이크 입력
  ↓
[Input Gain] × 1.5 ~ 3.0
  ↓
[Pre-Emphasis] 고주파 부스트
  ↓
[Extreme Clipping] 사각형파화
  ↓
[Bit Crushing] 해상도 감소 (선택)
  ↓
[Sustain Compression] 강한 압축
  ↓
[Tone Stack] 고음 제거
  ↓
[Output Limiter] 피크 제한
  ↓
[Volume] 최종 게인
  ↓
스피커 출력

## 3단계: 파라미터 정의
- fuzzAmount: 0.0 ~ 1.0 (슬라이더 0~100%)
- threshold: -0.2 ~ -0.05 (클리핑 임계값)
- bitDepth: 16, 12, 8, 4 (비트 크러싱)
- sustainRatio: 4:1 ~ 8:1
- sustainAttack: 1ms (고정)
- sustainRelease: 200ms (고정)
- bass: -6dB ~ +6dB
- mid: -12dB ~ 0dB
- treble: -18dB ~ -6dB (높게 감소)
- volume: 0dB ~ -40dB

## 4단계: UI 컨트롤
1. Fuzz 슬라이더 (0~100%)
   - 라벨: "FUZZ"
   - 값 표시: 0~100
   - 색상: 진한 빨간색 (극단성 표현)

2. Tone 슬라이더 (0~100%)
   - 라벨: "TONE"
   - 값 표시: Bright ← → Dark
   - 0% = 밝음, 100% = 매우 어두움
   - 거의 어두운 쪽으로 설정 권장

3. Volume 슬라이더 (0~1)
   - 라벨: "VOLUME"
   - 0dB ~ -40dB 범위

4. 토글 버튼
   - ON/OFF

5. 프리셋 버튼 3개
   - "Vintage Fuzz" (Fuzz: 60%, Tone: 70%, Bit: 12-bit)
   - "Silicon Fuzz" (Fuzz: 80%, Tone: 80%, Bit: 8-bit)
   - "Octave Fuzz" (Fuzz: 95%, Tone: 90%, Bit: 4-bit + 옥타브)

## 5단계: 시각화
- 입력 신호 (파란색, 부드러운 곡선)
- 출력 신호 (빨간색, 각진 사각형파)
- 고조파 스펙트럼 (주파수별 강도)
  - 기본음: 매우 강함
  - 3차, 5차, 7차: 차등적으로 감소
- Sustain Compression 미터
- 비트 감소 정도 시각화 (계단 형태)

## 6단계: 코드 구조
class Fuzz {
  constructor() {
    this.fuzzAmount = 0.5;
    this.threshold = -0.1;
    this.bitDepth = 8;
    this.tone = 0.7;
    this.volume = 0.8;
    
    // Sustain Compressor
    this.compressor = new Tone.Compressor({
      threshold: -10,
      ratio: 8,
      attack: 0.001,
      release: 0.2
    });
  }
  
  process(inputBuffer) {
    // 1. 입력 게인 적용
    // 2. Pre-Emphasis (고주파 부스트)
    // 3. Extreme Clipping 적용
    // 4. Bit Crushing 적용
    // 5. Sustain Compression 적용
    // 6. Tone Stack 적용 (고음 제거)
    // 7. Output Limiter 적용
    // 8. Volume 적용
    return processedBuffer;
  }
  
  setFuzzAmount(value) { this.fuzzAmount = value; }
  setTone(value) { this.tone = value; }
  setVolume(value) { this.volume = value; }
}

## 7단계: 디자인
- 매우 어두운 테마 (거의 검은색)
- 진한 빨간색/분홍색 악센트 (극단성)
- 흰색 텍스트 (고대비)
- 반응형 레이아웃
- 모바일 터치 친화적
- 심볼: 번개, 폭발 이미지

## 8단계: 고급 기능 (선택)
1. Octave Fuzz
   - 출력에 1옥타브 낮은 신호 추가
   - 더 두터운 톤

2. Frequency Doubler
   - 기본음 주파수의 2배 신호 추가

3. Random Modulation
   - Fuzz Amount를 살짝 변조
   - 더 유기적인 느낌

## 9단계: 성능 최적화
- AudioWorklet 필수 (CPU 부하 높음)
- 버퍼 크기: 512 samples (낮은 지연시간)
- 샘플 레이트: 44100 Hz
- 지연시간(Latency): < 50ms
- 오버샘플링: 2배 (Aliasing 방지, 선택)

## 추가 고려사항
1. 극단적 신호 처리로 인한 CPU 부하 모니터링
2. 부드러운 파라미터 변환 (crackling 방지)
3. 호환성 (Chrome, Firefox, Safari, Edge)
4. 사운드 카드 해상도에 따른 품질 변화

코드는 모듈식으로, 주석을 한국어로 달아주고,
다른 이펙터들(Distortion, Overdrive, Crunch)과 함께 
페달보드에서 시리즈로 연결할 수 있도록 설계해줘.
`;
```

---

## 💻 핵심 알고리즘 (프롬프트에 포함 가능)

```javascript
// Extreme Hard Clipping (사각형파 변형)
function extremeClipping(input, fuzzAmount = 0.5) {
  // fuzzAmount: 0 = 거의 클리핑 없음, 1 = 극도의 클리핑
  const threshold = -0.1 - (fuzzAmount * 0.15); // 임계값 감소
  
  if (input > threshold) {
    return 1.0;
  } else if (input < -threshold) {
    return -1.0;
  } else {
    // Soft edge (좀 더 부드럽게)
    return input / Math.abs(threshold);
  }
}

// Bit Crushing (저해상도 변환)
function bitCrush(input, bitDepth = 8) {
  // bitDepth: 16 = 원래, 8 = 거친 느낌, 4 = 매우 극단적
  const levels = Math.pow(2, bitDepth);
  const quantized = Math.round(input * levels) / levels;
  return quantized;
}

// Sustain Compression (강한 압축)
function sustainCompress(input, threshold = -10, ratio = 8) {
  const inputDb = 20 * Math.log10(Math.abs(input) + 1e-10);
  
  if (inputDb > threshold) {
    const excessDb = inputDb - threshold;
    const outputDb = threshold + excessDb / ratio;
    const output = Math.pow(10, outputDb / 20);
    return output * Math.sign(input);
  }
  
  return input;
}

// Pre-Emphasis (입력 고주파 부스트)
function preEmphasis(input) {
  // 간단한 하이패스 필터 역할
  // 고주파 강조로 내부적으로 강한 왜곡 생성
  return input * 1.3; // 30% 부스트
}

// Tone Stack (고음 극도로 감소)
function applyFuzzToneStack(sample, toneValue) {
  // toneValue: 0 = Bright, 1 = Very Dark
  
  let output = sample;
  
  // Bass: +3dB @ tone = 1
  output += sample * (3 * toneValue * 0.1);
  
  // Mid: -6dB @ tone = 1
  output -= sample * (6 * toneValue * 0.05);
  
  // Treble: -18dB @ tone = 1 (매우 감소)
  output -= sample * (18 * toneValue * 0.12);
  
  return Math.max(-1, Math.min(1, output));
}

// Octave Fuzz (옥타브 더하기, 선택사항)
function octaveFuzz(input, octaveAmount = 0.3) {
  // 1옥타브 낮은 신호 추가
  // 이는 시간 영역에서 구현하기 복잡하므로
  // 주파수 영역에서 처리하거나 lookup table 사용
  
  // 간단한 버전: 신호 절대값 사용 (옥타브 효과)
  const octave = Math.abs(input) * 0.5; // 낮은 주파수 근사
  return input + (octave * octaveAmount);
}

// Output Limiter (피크 제한)
function limitOutput(input, threshold = -0.05) {
  if (Math.abs(input) > threshold) {
    return threshold * Math.sign(input);
  }
  return input;
}
```

---

## 🎛️ 프리셋 정의 (프롬프트에 포함 가능)

```javascript
const fuzzPresets = {
  vintageFuzz: {
    fuzz: 60,
    threshold: -0.12,
    bitDepth: 12,
    sustainRatio: 4,
    tone: 70,
    volume: 0.75,
    description: "따뜻하고 빈티지한 퍼즈 (Fuzz Face 스타일)"
  },
  siliconFuzz: {
    fuzz: 80,
    threshold: -0.08,
    bitDepth: 8,
    sustainRatio: 6,
    tone: 80,
    volume: 0.85,
    description: "공격적이고 현대적인 퍼즈 톤"
  },
  octaveFuzz: {
    fuzz: 95,
    threshold: -0.05,
    bitDepth: 4,
    sustainRatio: 8,
    tone: 90,
    volume: 0.9,
    description: "극단적이고 비트적인 옥타브 퍼즈"
  }
};
```

---

## 📝 Claude Code에서 실행할 최종 프롬프트

```
웹 기타 퍼즈 페달 만들어줘

## 주요 요구사항
- Tone.js 기반
- Extreme Hard Clipping (사각형파화)
- Bit Crushing (8-bit 중심)
- Sustain Compression (8:1 강한 압축)
- Fuzz (0~100%), Tone, Volume 슬라이더
- 3개 프리셋: Vintage Fuzz, Silicon Fuzz, Octave Fuzz
- 입출력 파형 극단 비교 시각화
- 고조파 스펙트럼 분석
- 반응형 CSS (어두운 테마, 진한 빨간색 악센트)
- 모바일 대응
- 한국어 주석

## 신호 체인
마이크 → Pre-Emphasis → Extreme Clipping → Bit Crushing → Sustain Compression → Tone Stack → Limiter → Volume → 출력

## 프리셋 특성
1. Vintage Fuzz: Fuzz 60%, 따뜻한 톤
2. Silicon Fuzz: Fuzz 80%, 공격적 톤
3. Octave Fuzz: Fuzz 95%, 극단적 톤

## 시각화
- 입력: 부드러운 곡선 (파란색)
- 출력: 각진 사각형파 (빨간색)
- 고조파: 기본음, 3차, 5차 등 표시
```

---

## 🔄 네 이펙터 완전 비교 프롬프트```javascript
const comparisonPrompt = `
디스토션, 오버드라이브, 크런치, 퍼즈를 한 번에 비교하고 싶어.

## 완전 비교 테이블

### 오버드라이브 (따뜻함)
- Drive: 낮음 (1~5배)
- Clipping: Asymmetric Soft
- Tone: 따뜻한 튜브 톤
- 압축: 없음
- 용도: 블루스, 클래식락

### 크런치 (갈림)
- Drive: 중간 (2~8배)
- Clipping: Mixed (Hard + Soft)
- Tone: 거친 갈림
- 압축: 있음 (3:1)
- 용도: 펑크, 얼터너티브

### 디스토션 (거침)
- Drive: 높음 (5~10배)
- Clipping: Hard Clipping
- Tone: 공격적
- 압축: 약함 (~2:1)
- 용도: 메탈, 하드락

### 퍼즈 (극단)
- Drive: 매우 높음 (극도의 클리핑)
- Clipping: Extreme Hard + Bit Crushing
- Tone: 무뚝뚝한 사각형파
- 압축: 강함 (8:1)
- 용도: 사이키델릭, 프로토펑크

## 신호 체인 차이
- Overdrive: Asymmetric Soft Clipping
- Crunch: Mixed Clipping + Compression
- Distortion: Hard Clipping + Harmonics
- Fuzz: Extreme Hard Clipping + Bit Crushing + Strong Compression

이 차이를 UI와 알고리즘에 명확히 반영해줘.
`;
```

---

## 🎸 핵심 정리

| 요소 | 오버드라이브 | 크런치 | 디스토션 | **퍼즈** |
|------|----------|-------|--------|---------|
| 입력 게인 | 낮음 | 중간 | 높음 | **극높음** |
| 클리핑 | Asymmetric Soft | Mixed | Hard | **Extreme Hard** |
| 압축 | ✗ | ✓ (3:1) | ~✓ | **✓✓ (8:1)** |
| 비트 크러싱 | ✗ | ✗ | ✗ | **✓** |
| 출력 파형 | 부드러운 곡선 | 거친 곡선 | 각진 파형 | **사각형파** |
| 고조파 | 적음 | 중간 | 많음 | **매우 많음** |
| 사용처 | 블루스 | 펑크 | 메탈 | **사이키, 프로토펑크** |

---

## 🎯 다음 이펙터 (타임 기반)

1. **딜레이 (Delay)**
   - 신호를 지연시켜 메아리 효과
   - Feedback으로 반복 강도 조절

2. **리버브 (Reverb)**
   - 공간감 시뮬레이션
   - 여러 신호의 합성

3. **코러스 (Chorus)**
   - 신호를 약간 지연/변조
   - 합창 느낌

---

## 🎛️ 완전한 페달보드 구조

```
마이크 입력
  ↓
[오버드라이브] ← 기초 왜곡
  ↓
[크런치] ← 갈리는 감
  ↓
[디스토션] ← 강한 왜곡
  ↓
[퍼즈] ← 극도의 왜곡
  ↓
[EQ (3-band)] ← 최종 톤 조절
  ↓
[딜레이] ← 시간 효과
  ↓
[리버브] ← 공간 효과
  ↓
[마스터 볼륨] ← 최종 출력
  ↓
스피커
```

# 웹 기타 페달보드 - 딜레이(Delay) 개발 가이드

딜레이는 **신호를 시간만큼 지연시켜 메아리/에코 효과**를 만듭니다. 타임 기반 이펙터의 시작입니다.

---

## 🎸 딜레이의 특징

```
신호 흐름:
신호 → [지연] → [피드백 반복] → [드라이/웻 믹스] → 출력

예시 (500ms 딜레이, 3회 반복):
  입력: •
  100ms: (아무것도 없음)
  200ms: (아무것도 없음)
  ...
  500ms: • ← 첫 번째 반복
  1000ms: • ← 두 번째 반복
  1500ms: • ← 세 번째 반복 (약해짐)
```

| 특성 | 설명 |
|------|------|
| **Delay Time** | 지연 시간 (1ms ~ 2000ms) |
| **Feedback** | 반복 강도 (0~95%) |
| **Wet/Dry Mix** | 원본/이펙트 비율 |
| **타입** | Analog, Digital, Tape |
| **응용** | 리듬감, 공간감, 창의적 표현 |

---

## 🔧 기본 구현 프롬프트

```javascript
const delayBasic = `
Tone.js를 사용한 웹 기타 딜레이 페달을 만들어줘.

## 딜레이의 특징
- 신호를 시간 지연 후 재생
- 피드백으로 반복 증가
- 기본적인 타임 이펙터
- 리듬감 강조 용도

## 필수 컨트롤
1. Time: 1~2000ms (지연 시간)
2. Feedback: 0~95% (반복 강도)
3. Mix: 0~100% (웻 신호 비율)
4. ON/OFF 토글

## UI
- 슬라이더 3개
- 지연 시간 밀리초 표시
- 반복 횟수 시각화 (점 또는 막대)

반응형 CSS, 한국어 주석으로 작성해줘.
`;
```

---

## 🎯 구체적이고 단계적인 완전 프롬프트

```javascript
const delayComplete = `
웹 기타 딜레이 페달을 Tone.js로 개발해줘.

## 1단계: 딜레이 알고리즘 이해

### (1) Delay Buffer (지연 버퍼)
- 원형 버퍼(Circular Buffer) 사용
- 최대 지연: 2000ms (2초)
- 버퍼 크기: 샘플레이트 × 최대 지연시간
- 예: 44100 Hz × 2초 = 88200 samples

코드:
\`\`\`javascript
class DelayBuffer {
  constructor(sampleRate, maxDelayTime) {
    this.maxDelayTime = maxDelayTime;
    this.buffer = new Float32Array(sampleRate * maxDelayTime);
    this.writeIndex = 0;
  }
  
  write(sample) {
    this.buffer[this.writeIndex] = sample;
    this.writeIndex = (this.writeIndex + 1) % this.buffer.length;
  }
  
  read(delayTime) {
    const delayInSamples = (delayTime / 1000) * sampleRate;
    const readIndex = (this.writeIndex - delayInSamples) % this.buffer.length;
    return this.buffer[readIndex];
  }
}
\`\`\`

### (2) Feedback Loop (피드백 루프)
- 지연된 신호를 다시 입력에 섞기
- 피드백 강도: 0~0.95 (95%가 최대, 100%는 무한 반복)
- 공식: output = delayedSignal × feedback
- 반복 횟수: -20log10(1-feedback) / 20

예시:
- feedback = 0.5 → 약 3회 반복
- feedback = 0.7 → 약 6회 반복
- feedback = 0.9 → 약 10회 반복

### (3) Wet/Dry Mix (습식/건식 믹스)
- Dry: 원본 신호 (처리되지 않은)
- Wet: 지연된 신호 (이펙트 적용)
- Mix: 0 = 100% Dry, 1 = 100% Wet
- 공식: output = input × (1 - mix) + delayed × mix

### (4) Low Pass Filter (저주파 통과 필터)
- 지연된 신호의 고주파 감소
- 각 반복마다 밝기 감소
- Feedback Color: 0.3~0.8 (값이 낮을수록 어두움)

### (5) Delay Time Types (지연 시간 타입)
- Manual: 사용자 지정 (1~2000ms)
- Sync: 비트 싱크 (1/16, 1/8, 1/4 노트 등)
- Tap: 탭 템포

## 2단계: 신호 체인 구성
마이크 입력
  ↓
[Input Gain]
  ↓
[Distortion/Overdrive/등 - 선택]
  ↓
[Delay Engine]
  ├─ [Delay Buffer] (지연된 신호 생성)
  ├─ [LPF] (고주파 감소)
  ├─ [Feedback Mixer] (피드백 루프)
  └─ [Wet/Dry Mix]
  ↓
[Output Limiter]
  ↓
스피커 출력

## 3단계: 파라미터 정의
- delayTime: 1 ~ 2000 ms (스텝: 1ms)
- feedback: 0.0 ~ 0.95 (스텝: 0.01)
- mix: 0.0 ~ 1.0 (스텝: 0.01)
- feedbackColor: 0.3 ~ 0.9 (LPF 강도)
- tempo: BPM (싱크 모드용)

## 4단계: UI 컨트롤
1. Time 슬라이더 (1~2000ms)
   - 라벨: "TIME"
   - 값 표시: "125ms" 형식
   - 프리셋 버튼: 125ms, 250ms, 500ms, 1000ms

2. Feedback 슬라이더 (0~95%)
   - 라벨: "FEEDBACK"
   - 값 표시: 0~95 (%)
   - 심볼: 화살표 순환

3. Mix 슬라이더 (0~100%)
   - 라벨: "MIX" 또는 "DRY/WET"
   - 값 표시: Dry ← → Wet
   - 왼쪽: 건식, 오른쪽: 습식

4. 토글 버튼
   - ON/OFF

5. 동기화 모드 (선택)
   - Manual
   - Sync to BPM (1/16, 1/8, 1/4 노트)
   - Tap Tempo (탭 버튼)

## 5단계: 시각화
- 타임라인 (0~2000ms, 현재 위치 표시)
- Feedback 반복 점들 (점점 약해지는 모습)
- 입력 신호 (파란색)
- 지연된 신호 (초록색, 시간 뒤로)
- 최종 출력 (빨간색)
- 입출력 레벨 미터

예시:
\`\`\`
|입력
|
|           |지연1
|           |
|                   |지연2
|                   |
|                           |지연3
|
0ms   250ms   500ms   750ms   1000ms
\`\`\`

## 6단계: 코드 구조
class Delay {
  constructor(sampleRate = 44100) {
    this.sampleRate = sampleRate;
    this.delayBuffer = new DelayBuffer(sampleRate, 2.0); // 2초 최대
    this.delayTime = 500; // ms
    this.feedback = 0.5;
    this.mix = 0.5;
    this.feedbackColor = 0.7;
    
    // LPF 필터
    this.filterState = 0;
  }
  
  process(inputSample) {
    // 1. 지연 버퍼에서 신호 읽기
    const delayedSignal = this.delayBuffer.read(this.delayTime);
    
    // 2. LPF 적용 (피드백 색상)
    const filteredSignal = this.applyLPF(delayedSignal);
    
    // 3. 피드백 루프 (지연된 신호를 다시 입력에)
    const feedbackSignal = filteredSignal * this.feedback;
    const bufferInput = inputSample + feedbackSignal;
    
    // 4. 버퍼에 쓰기
    this.delayBuffer.write(bufferInput);
    
    // 5. Wet/Dry 믹스
    const output = inputSample * (1 - this.mix) + delayedSignal * this.mix;
    
    return output;
  }
  
  applyLPF(signal) {
    // 간단한 1차 LPF
    const alpha = 1 - this.feedbackColor;
    this.filterState = this.filterState * this.feedbackColor + signal * alpha;
    return this.filterState;
  }
  
  setDelayTime(time) { this.delayTime = time; }
  setFeedback(value) { this.feedback = Math.min(0.95, value); }
  setMix(value) { this.mix = value; }
}

## 7단계: 디자인
- 어두운 테마
- 파란색/청록색 악센트 (물처럼, 지연 느낌)
- 반응형 레이아웃
- 모바일 터치 친화적
- 타임라인 시각화

## 8단계: 고급 기능 (선택)
1. Analog Delay 시뮬레이션
   - 각 반복마다 살짝 높은음 감소
   - 부드러운 감쇠

2. Tape Delay 시뮬레이션
   - 약간의 왜곡 추가
   - 변속 현상 (WOW & Flutter)

3. Digital Delay 모드
   - 깔끔한 반복
   - 고주파 유지

4. Tempo Sync
   - BPM 입력
   - 음표 단위 동기화 (1/16, 1/8, 1/4, 등)

5. Tap Tempo
   - 탭 버튼 클릭 간격으로 템포 감지

## 9단계: 성능 최적화
- AudioWorklet 필수
- 원형 버퍼로 메모리 효율성
- 버퍼 크기: 4096 samples
- 지연시간(Latency): < 50ms

## 추가 고려사항
1. 최대 피드백: 95% (진동 방지)
2. 부드러운 파라미터 변환 (crackling 방지)
3. CPU 효율성
4. 호환성 (Chrome, Firefox, Safari, Edge)

코드는 모듈식으로, 주석을 한국어로 달아주고,
다른 이펙터들(Distortion, Overdrive, Reverb)과 함께 
페달보드에서 시리즈로 연결할 수 있도록 설계해줘.
`;
```

---

## 💻 핵심 알고리즘 (프롬프트에 포함 가능)

```javascript
// 원형 버퍼 (Circular Buffer)
class CircularDelayBuffer {
  constructor(sampleRate, maxDelaySeconds = 2.0) {
    this.sampleRate = sampleRate;
    this.maxDelaySamples = sampleRate * maxDelaySeconds;
    this.buffer = new Float32Array(this.maxDelaySamples);
    this.writeIndex = 0;
  }
  
  write(sample) {
    this.buffer[this.writeIndex] = sample;
    this.writeIndex = (this.writeIndex + 1) % this.maxDelaySamples;
  }
  
  read(delayTimeMs) {
    // 밀리초를 샘플 수로 변환
    const delayInSamples = (delayTimeMs / 1000) * this.sampleRate;
    
    // 읽기 인덱스 계산
    const readIndex = (this.writeIndex - delayInSamples + this.maxDelaySamples) 
                      % this.maxDelaySamples;
    
    // 선형 보간 (Linear Interpolation)으로 부드러운 읽기
    const integerPart = Math.floor(readIndex);
    const fractionalPart = readIndex - integerPart;
    
    const sample1 = this.buffer[integerPart];
    const sample2 = this.buffer[(integerPart + 1) % this.maxDelaySamples];
    
    return sample1 * (1 - fractionalPart) + sample2 * fractionalPart;
  }
}

// 딜레이 처리
function delayProcess(
  inputSample,
  delayBuffer,
  delayTimeMs,
  feedback,
  mix,
  filterState
) {
  // 1. 지연 버퍼에서 신호 읽기
  const delayedSignal = delayBuffer.read(delayTimeMs);
  
  // 2. LPF 필터 적용 (피드백 색상)
  const alpha = 0.3; // 필터 계수
  const filteredSignal = filterState * (1 - alpha) + delayedSignal * alpha;
  
  // 3. 피드백 루프
  const feedbackSignal = filteredSignal * feedback;
  
  // 4. 입력과 피드백 섞기
  const bufferInput = inputSample + feedbackSignal;
  
  // 5. 버퍼에 쓰기
  delayBuffer.write(bufferInput);
  
  // 6. Wet/Dry Mix
  const output = inputSample * (1 - mix) + delayedSignal * mix;
  
  return {
    output: output,
    filterState: filteredSignal
  };
}

// Feedback 값에서 반복 횟수 계산
function calculateRepetitions(feedback) {
  // dB = -20 * log10(1 - feedback)
  const dB = -20 * Math.log10(1 - feedback);
  const repetitions = Math.ceil(dB / 6); // 6dB = 약 1회 반복
  return repetitions;
}

// BPM과 음표 단위로 딜레이 시간 계산
function calculateDelayTimeFromTempo(bpm, noteValue) {
  // noteValue: "1/16", "1/8", "1/4", "1/2"
  const beatDurationMs = 60000 / bpm; // 1 beat = 1 quarter note
  
  const noteMap = {
    "1/16": beatDurationMs / 4,
    "1/8": beatDurationMs / 2,
    "1/4": beatDurationMs,
    "1/2": beatDurationMs * 2,
    "1": beatDurationMs * 4
  };
  
  return noteMap[noteValue] || beatDurationMs;
}

// Tap Tempo (탭 간격에서 BPM 계산)
function calculateBpmFromTaps(tapTimes) {
  // tapTimes: [t1, t2, t3, ...]
  if (tapTimes.length < 2) return null;
  
  let totalInterval = 0;
  for (let i = 1; i < tapTimes.length; i++) {
    totalInterval += (tapTimes[i] - tapTimes[i-1]);
  }
  
  const avgIntervalMs = totalInterval / (tapTimes.length - 1);
  const bpm = 60000 / avgIntervalMs;
  
  return Math.round(bpm);
}
```

---

## 🎛️ 프리셋 정의 (프롬프트에 포함 가능)

```javascript
const delayPresets = {
  slapback: {
    delayTime: 125,
    feedback: 0.0,
    mix: 0.5,
    description: "50년대 로큰롤 스타일, 피드백 없음"
  },
  rhythmic: {
    delayTime: 250,
    feedback: 0.4,
    mix: 0.5,
    description: "비트와 동기화된 리듬감"
  },
  ambient: {
    delayTime: 1000,
    feedback: 0.7,
    mix: 0.7,
    description: "오래된 반복과 공간감"
  },
  tapeEmulation: {
    delayTime: 500,
    feedback: 0.5,
    mix: 0.6,
    feedbackColor: 0.6,
    description: "따뜻한 테이프 딜레이 느낌"
  }
};
```

---

## 📝 Claude Code에서 실행할 최종 프롬프트

```
웹 기타 딜레이 페달 만들어줘

## 주요 요구사항
- Tone.js 기반
- 원형 버퍼 (Circular Buffer) 사용
- Time (1~2000ms), Feedback (0~95%), Mix 슬라이더
- 4개 프리셋: Slapback, Rhythmic, Ambient, Tape Emulation
- 입력/지연/출력 신호 타임라인 시각화
- 반복 횟수 점 표시 (점점 약해짐)
- 반응형 CSS (어두운 테마, 청록색 악센트)
- 모바일 대응
- 한국어 주석

## 신호 체인
마이크 → Input Gain → Delay Buffer → Feedback Loop → LPF → Mix → Output Limiter → 출력

## 프리셋 특성
1. Slapback: Time 125ms, Feedback 0% (피드백 없음)
2. Rhythmic: Time 250ms, Feedback 40% (리듬감)
3. Ambient: Time 1000ms, Feedback 70% (공간감)
4. Tape Emulation: Time 500ms, Feedback 50% (따뜻함)

## 시각화
- 타임라인: 0~2000ms
- 입력 신호 (파란색)
- 지연 신호 (초록색, 여러 개 표시)
- 최종 출력 (빨간색)
```

---

# 웹 기타 페달보드 - 리버브(Reverb) 개발 가이드

리버브는 **공간의 반향을 시뮬레이션**하여 신호에 깊이감을 더합니다.

---

## 🎸 리버브의 특징

```
신호 흐름:
신호 → [다중 지연 경로] → [감쇠] → [조기 반사] → [후기 울림] → 출력

공간 시뮬레이션:
작은방        →    중간방         →    대홀
(Early)    (Intermediate)    (Late)
빠른반사      |    여러경로       |    긴울림
```

| 특성 | 설명 |
|------|------|
| **Decay Time** | 음이 사라질 때까지 시간 (0.5~10초) |
| **Pre-Delay** | 첫 반사까지의 지연 (0~100ms) |
| **Damping** | 고주파 감쇠 (0~100%) |
| **Room Size** | 방의 크기 시뮬레이션 |
| **타입** | Hall, Room, Spring, Plate |

---

## 🔧 기본 구현 프롬프트

```javascript
const reverbBasic = `
Tone.js를 사용한 웹 기타 리버브 페달을 만들어줘.

## 리버브의 특징
- 공간의 반향 시뮬레이션
- 신호에 깊이감과 분위기 추가
- 여러 방식 (Hall, Room, Spring, Plate)
- 기본적인 공간 이펙터

## 필수 컨트롤
1. Decay: 0.5~10초 (음이 사라질 때까지)
2. Mix: 0~100% (드라이/웻 비율)
3. Damping: 0~100% (고주파 감쇠)
4. ON/OFF 토글

## UI
- 슬라이더 3개
- 공간 타입 선택 (Hall, Room)
- 음파 확산 시각화

반응형 CSS, 한국어 주석으로 작성해줘.
`;
```

---

## 🎯 구체적이고 단계적인 완전 프롬프트

```javascript
const reverbComplete = `
웹 기타 리버브 페달을 Tone.js로 개발해줘.

## 1단계: 리버브 알고리즘 이해

### (1) Comb Filter Bank (콤 필터 뱅크)
- 여러 개의 콤 필터 병렬 연결
- 각 필터는 다른 지연 시간
- 지연 시간: 25ms, 27ms, 29ms, 31ms (prime numbers)
- Feedback: 0.7 ~ 0.9 (음의 지속력)

목적: 초기 반사음 생성

코드:
\`\`\`javascript
class CombFilter {
  constructor(delayTime, feedback, damping) {
    this.delayTime = delayTime;
    this.feedback = feedback;
    this.damping = damping;
    this.bufferIndex = 0;
    this.buffer = new Float32Array(delayTime);
    this.filterState = 0;
  }
  
  process(input) {
    const readIndex = (this.bufferIndex - Math.round(this.delayTime)) 
                      % this.buffer.length;
    const bufferedSample = this.buffer[readIndex];
    
    // Damping filter (LPF)
    const alpha = this.damping;
    this.filterState = bufferedSample * (1 - alpha) + this.filterState * alpha;
    
    const feedback = bufferedSample * this.feedback;
    const output = input + feedback;
    
    this.buffer[this.bufferIndex] = output;
    this.bufferIndex = (this.bufferIndex + 1) % this.buffer.length;
    
    return this.filterState;
  }
}
\`\`\`

### (2) Allpass Filter (올패스 필터)
- 모든 주파수를 통과하지만 위상 변화
- 3개 또는 4개 연직렬 배치
- 지연 시간: 5ms, 17ms, (선택: 13ms, 11ms)
- Feedback: 0.5

목적: 신호 확산과 자연스러운 울림

### (3) Pre-Delay (사전 지연)
- 음이 벽에 도달하기까지의 시간
- 범위: 0~100ms
- 작은 방: 0~30ms
- 큰 홀: 50~100ms

### (4) Decay Time (감쇠 시간)
- RT60: 음이 60dB 감소할 때까지의 시간
- Feedback 값 조정으로 제어
- RT60 = -3 × log10(feedback) / log(time)

### (5) Damping (고주파 감쇠)
- 각 반사마다 고주파 제거
- 범위: 0~1 (0 = 조용함, 1 = 밝음)
- 목적: 자연스러운 감쇠

## 2단계: 신호 체인 구성
마이크 입력
  ↓
[Input Gain]
  ↓
[Pre-Delay] (0~100ms)
  ↓
[Comb Filter Bank] (4개 병렬)
  ├─ Comb 1 (25ms)
  ├─ Comb 2 (27ms)
  ├─ Comb 3 (29ms)
  └─ Comb 4 (31ms)
  ↓
[Allpass Filter 1] (5ms)
  ↓
[Allpass Filter 2] (17ms)
  ↓
[Allpass Filter 3] (13ms, 선택)
  ↓
[Allpass Filter 4] (11ms, 선택)
  ↓
[Wet/Dry Mix]
  ↓
[Output Limiter]
  ↓
스피커 출력

## 3단계: 파라미터 정의
- decayTime: 0.5 ~ 10.0 초 (스텝: 0.1초)
- preDelay: 0 ~ 100 ms (스텝: 1ms)
- damping: 0.0 ~ 1.0 (스텝: 0.01)
- mix: 0.0 ~ 1.0 (스텝: 0.01)
- roomSize: 0.5 ~ 1.0 (콤 필터 피드백)
- width: 0.0 ~ 1.0 (스테레오 확산)

## 4단계: UI 컨트롤
1. Decay 슬라이더 (0.5~10초)
   - 라벨: "DECAY"
   - 값 표시: "1.5s" 형식
   - 프리셋: 0.5s, 1s, 2s, 5s, 10s

2. Pre-Delay 슬라이더 (0~100ms)
   - 라벨: "PRE-DELAY"
   - 값 표시: "25ms" 형식
   - 프리셋: 10ms, 25ms, 50ms, 100ms

3. Damping 슬라이더 (0~100%)
   - 라벨: "DAMPING"
   - 값 표시: 0~100
   - 왼쪽: 따뜻함(어두움), 오른쪽: 밝음

4. Mix 슬라이더 (0~100%)
   - 라벨: "MIX"
   - 값 표시: Dry ← → Wet

5. 타입 선택 버튼
   - Hall (큰 홀, 밝은 톤)
   - Room (중간 방, 균형)
   - Spring (탄성 있는 톤)
   - Plate (판금 공명, 어두움)

6. 토글 버튼
   - ON/OFF

## 5단계: 시각화
- 폐곡선 공간 (방의 모양)
- 음파 확산 애니메이션 (입력점에서 퍼지는 원)
- Pre-Delay 표시 (시간 축)
- Decay Curve (음이 감소하는 곡선)
- 입력/출력 레벨 미터
- 타입별 색상 변화 (Hall: 파란색, Room: 회색, Spring: 보라색)

## 6단계: 코드 구조
class Reverb {
  constructor(sampleRate = 44100) {
    this.sampleRate = sampleRate;
    
    // Comb Filter Bank
    this.combFilters = [
      new CombFilter(Math.round(1116 * sampleRate / 44100)),
      new CombFilter(Math.round(1188 * sampleRate / 44100)),
      new CombFilter(Math.round(1277 * sampleRate / 44100)),
      new CombFilter(Math.round(1356 * sampleRate / 44100))
    ];
    
    // Allpass Filters
    this.allpassFilters = [
      new AllpassFilter(Math.round(556 * sampleRate / 44100)),
      new AllpassFilter(Math.round(441 * sampleRate / 44100)),
      new AllpassFilter(Math.round(341 * sampleRate / 44100)),
      new AllpassFilter(Math.round(225 * sampleRate / 44100))
    ];
    
    this.decayTime = 2.0;
    this.preDelay = 0;
    this.damping = 0.5;
    this.mix = 0.3;
    this.roomSize = 0.8;
  }
  
  process(inputSample) {
    // 1. Pre-Delay 적용
    // 2. Comb Filter Bank 통과
    // 3. Allpass Filter 연직렬 통과
    // 4. Wet/Dry Mix
    // 5. 출력
    return output;
  }
  
  setDecayTime(seconds) { this.decayTime = seconds; }
  setPreDelay(ms) { this.preDelay = ms; }
  setDamping(value) { this.damping = value; }
  setMix(value) { this.mix = value; }
}

## 7단계: 타입별 파라미터 (Presets)
- Hall: 큰 공간, damping 낮음, pre-delay 30~50ms
- Room: 중간 공간, damping 중간, pre-delay 10~30ms
- Spring: 특수, damping 높음, 약간의 변속 추가
- Plate: 판금, damping 높음, pre-delay 낮음

## 8단계: 디자인
- 어두운 테마
- 파란색/보라색 악센트 (공간감 표현)
- 폐곡선 공간 시각화
- 음파 애니메이션
- 반응형 레이아웃
- 모바일 터치 친화적

## 9단계: 성능 최적화
- AudioWorklet 필수
- 버퍼 크기: 4096 samples
- 지연시간(Latency): < 100ms
- CPU 효율성: Comb/Allpass 최소화

## 추가 고려사항
1. Freeverb 알고리즘 참고
2. 스테레오 리버브 (좌우 채널 다른 지연)
3. 부드러운 파라미터 변환
4. 호환성 (모든 브라우저)

코드는 모듈식으로, 주석을 한국어로 달아주고,
Delay, Distortion 등 다른 이펙터와 함께 
페달보드에서 시리즈로 연결할 수 있도록 설계해줘.
`;
```

---

## 💻 핵심 알고리즘 (프롬프트에 포함 가능)

```javascript
// Comb Filter
class CombFilter {
  constructor(delayInSamples, feedback, damping) {
    this.delayInSamples = delayInSamples;
    this.feedback = feedback;
    this.damping = damping;
    this.buffer = new Float32Array(delayInSamples);
    this.bufferIndex = 0;
    this.filterState = 0;
  }
  
  process(input) {
    // 읽기
    const readIndex = (this.bufferIndex - this.delayInSamples + this.buffer.length) 
                      % this.buffer.length;
    const bufferedSample = this.buffer[readIndex];
    
    // Damping filter (LPF)
    const alpha = this.damping;
    this.filterState = bufferedSample * (1 - alpha) + this.filterState * alpha;
    
    // Feedback
    const feedbackSignal = this.filterState * this.feedback;
    const output = input + feedbackSignal;
    
    // 쓰기
    this.buffer[this.bufferIndex] = output;
    this.bufferIndex = (this.bufferIndex + 1) % this.buffer.length;
    
    return this.filterState;
  }
}

// Allpass Filter
class AllpassFilter {
  constructor(delayInSamples, feedback = 0.5) {
    this.delayInSamples = delayInSamples;
    this.feedback = feedback;
    this.buffer = new Float32Array(delayInSamples);
    this.bufferIndex = 0;
  }
  
  process(input) {
    const readIndex = (this.bufferIndex - this.delayInSamples + this.buffer.length) 
                      % this.buffer.length;
    const bufferedSample = this.buffer[readIndex];
    
    // Allpass 알고리즘
    const output = -input + bufferedSample;
    const feedbackSignal = bufferedSample * this.feedback + input;
    
    this.buffer[this.bufferIndex] = feedbackSignal;
    this.bufferIndex = (this.bufferIndex + 1) % this.buffer.length;
    
    return output;
  }
}

// Decay Time에서 Feedback 계산
function calculateFeedbackFromDecay(decaySeconds, delayMs) {
  // RT60 공식 역변환
  // RT60 = -3 × ln(feedback) / ln(10) × delayMs
  const rt60Ms = decaySeconds * 1000;
  const feedback = Math.pow(10, -3 * delayMs / (rt60Ms * Math.log(10)));
  return Math.min(0.999, feedback); // 피드백 상한
}

// Freeverb Stereo (좌우 채널)
class StereoReverb {
  constructor(sampleRate = 44100) {
    this.leftComb = [/* 4개 */];
    this.rightComb = [/* 4개, 약간 다른 지연 */];
    this.leftAllpass = [/* 4개 */];
    this.rightAllpass = [/* 4개 */];
    this.width = 1.0; // 스테레오 확산
  }
  
  processLeft(input) { /* Comb + Allpass */ }
  processRight(input) { /* Comb + Allpass */ }
}
```

---

## 🎛️ 프리셋 정의 (프롬프트에 포함 가능)

```javascript
const reverbPresets = {
  hall: {
    decayTime: 3.5,
    preDelay: 50,
    damping: 0.4,
    roomSize: 0.9,
    mix: 0.4,
    description: "큰 콘서트 홀, 밝은 톤"
  },
  room: {
    decayTime: 1.5,
    preDelay: 20,
    damping: 0.6,
    roomSize: 0.7,
    mix: 0.3,
    description: "중간 방, 자연스러운 톤"
  },
  spring: {
    decayTime: 2.0,
    preDelay: 10,
    damping: 0.7,
    roomSize: 0.5,
    mix: 0.35,
    description: "탄성 있는 빈티지 톤"
  },
  plate: {
    decayTime: 2.5,
    preDelay: 5,
    damping: 0.8,
    roomSize: 0.85,
    mix: 0.38,
    description: "판금 공명, 어두운 톤"
  }
};
```

---

## 📝 Claude Code에서 실행할 최종 프롬프트

```
웹 기타 리버브 페달 만들어줘

## 주요 요구사항
- Tone.js 기반
- Freeverb 알고리즘 (Comb + Allpass)
- Decay (0.5~10초), Pre-Delay (0~100ms), Damping, Mix 슬라이더
- 4개 타입: Hall, Room, Spring, Plate
- 4개 프리셋 각 타입마다
- 공간 시각화 (폐곡선 + 음파 애니메이션)
- Decay 커브 표시
- 반응형 CSS (어두운 테마, 파란색/보라색 악센트)
- 모바일 대응
- 한국어 주석

## 신호 체인
마이크 → Input Gain → Pre-Delay → Comb Bank (4개) → Allpass (4개) → Mix → Output Limiter → 출력

## 타입별 특성
1. Hall: 큰 공간, 밝은 톤, pre-delay 50ms
2. Room: 중간 공간, 자연 톤, pre-delay 20ms
3. Spring: 특수, 탄성, pre-delay 10ms
4. Plate: 판금, 어두운 톤, pre-delay 5ms
```

---

# 웹 기타 페달보드 - 코러스(Chorus) 개발 가이드

코러스는 **신호를 약간 변조하고 지연시켜 여러 악기가 동시에 연주하는 느낌**을 만듭니다.

---

## 🎸 코러스의 특징

```
신호 흐름:
신호 → [지연 + LFO 변조] → [혼합] → 출력

효과:
단성 신호 → 합창(여러 악기) 느낌
```

| 특성 | 설명 |
|------|------|
| **Rate (LFO 속도)** | 0.5~10 Hz |
| **Depth (변조 깊이)** | 1~5ms |
| **Delay Time** | 기본 지연 시간 (15~50ms) |
| **Feedback** | 신호 자신에게 피드백 (선택) |
| **Mix** | 드라이/웻 비율 |

---

## 🔧 기본 구현 프롬프트

```javascript
const chorusBasic = `
Tone.js를 사용한 웹 기타 코러스 페달을 만들어줘.

## 코러스의 특징
- 신호를 여러 개 만드는 느낌
- LFO로 지연 시간 변조
- 부드럽고 풍부한 톤
- 합창 효과

## 필수 컨트롤
1. Rate: 0.5~10 Hz (LFO 속도)
2. Depth: 0~5ms (변조 깊이)
3. Mix: 0~100% (드라이/웻)
4. ON/OFF 토글

## UI
- 슬라이더 3개
- LFO 파형 시각화 (사인파)
- 지연 시간 변화 표시

반응형 CSS, 한국어 주석으로 작성해줘.
`;
```

---

## 🎯 구체적이고 단계적인 완전 프롬프트

```javascript
const chorusComplete = `
웹 기타 코러스 페달을 Tone.js로 개발해줘.

## 1단계: 코러스 알고리즘 이해

### (1) LFO (Low Frequency Oscillator)
- 지연 시간을 주기적으로 변조
- 주파수: 0.5~10 Hz
- 파형: 사인파 (sine wave), 삼각파 (triangle)
- 수식: delay(t) = baseDelay + depth × sin(2π × rate × t)

코드:
\`\`\`javascript
function generateLFO(rate, depth, time) {
  // rate: Hz, depth: ms, time: 현재 시각 (초)
  const modulation = Math.sin(2 * Math.PI * rate * time);
  return modulation * depth;
}
\`\`\`

### (2) Variable Delay Buffer (가변 지연)
- 실시간으로 지연 시간이 변함
- 선형 보간으로 부드러운 읽기
- 기본 지연: 15~50ms

### (3) Multi-Tap Delay (멀티탭)
- 여러 개의 탭(지연 포인트) 사용
- 스테레오 확산: 좌/우 채널 다른 위상
- 예: 좌 = 기본, 우 = 기본 + 90도 위상차

### (4) Feedback (선택)
- 지연된 신호를 입력에 섞기
- 0~0.3 (너무 높으면 어색해짐)

### (5) Wet/Dry Mix
- 원본 신호와 이펙트 섞기
- 보통 0.5 (50%) 권장

## 2단계: 신호 체인 구성
마이크 입력
  ↓
[Input Gain]
  ↓
[LFO 생성] (Rate 값으로)
  ↓
[Variable Delay Buffer 1] (Depth로 변조)
  ↓
[Variable Delay Buffer 2] (90도 위상차)
  ↓
[Feedback Mixer] (선택)
  ↓
[Wet/Dry Mix]
  ↓
[Output Limiter]
  ↓
스피커 출력

## 3단계: 파라미터 정의
- rate: 0.5 ~ 10.0 Hz (스텝: 0.1 Hz)
- depth: 0.0 ~ 5.0 ms (스텝: 0.1 ms)
- delay: 15 ~ 50 ms (고정 또는 조절)
- feedback: 0.0 ~ 0.3 (스텝: 0.05)
- mix: 0.0 ~ 1.0 (스텝: 0.05)
- lfoWaveform: "sine", "triangle"

## 4단계: UI 컨트롤
1. Rate 슬라이더 (0.5~10 Hz)
   - 라벨: "RATE"
   - 값 표시: "1.5 Hz" 형식
   - 프리셋: 0.5Hz, 1Hz, 2Hz, 5Hz, 10Hz

2. Depth 슬라이더 (0~5ms)
   - 라벨: "DEPTH"
   - 값 표시: "2.5ms" 형식
   - 프리셋: 1ms, 2ms, 3ms, 5ms

3. Mix 슬라이더 (0~100%)
   - 라벨: "MIX"
   - 값 표시: Dry ← → Wet
   - 추천: 약 50%

4. 토글 버튼
   - ON/OFF

5. 프리셋 버튼 3개
   - "Subtle" (Rate: 0.8 Hz, Depth: 1ms, Mix: 30%)
   - "Standard" (Rate: 1.5 Hz, Depth: 2.5ms, Mix: 50%)
   - "Lush" (Rate: 2.5 Hz, Depth: 4ms, Mix: 70%)

## 5단계: 시각화
- LFO 파형 실시간 표시 (사인파 또는 삼각파)
- 지연 시간 변화 그래프 (X: 시간, Y: ms)
  - 기본 지연선 (수평선)
  - LFO 변조 범위 (음영 영역)
- 입력/출력 신호 비교
- Rate 표시 (주기 밀리초 단위로도)
- 스테레오 분리 시각화 (L/R 채널)

예시 그래프:
\`\`\`
Delay(ms)
50 |     /\\        /\\
   |    /  \\      /  \\
30 |   /    \\    /    \\
   |  /      \\  /      \\
15 | /        \\/        \\
   +---------------------
   0    100   200   300 ms (시간)
\`\`\`

## 6단계: 코드 구조
class Chorus {
  constructor(sampleRate = 44100) {
    this.sampleRate = sampleRate;
    this.rate = 1.5; // Hz
    this.depth = 2.5; // ms
    this.baseDelay = 30; // ms
    this.feedback = 0.1;
    this.mix = 0.5;
    this.lfoPhase = 0;
    this.lfoWaveform = "sine";
    
    // 지연 버퍼 (좌/우 스테레오)
    this.delayBufferL = new Float32Array(2000); // 최대 50ms
    this.delayBufferR = new Float32Array(2000);
    this.writeIndex = 0;
  }
  
  process(inputSample) {
    // 1. LFO 값 생성
    const lfoValue = this.generateLFO(this.lfoPhase);
    this.lfoPhase += (this.rate / this.sampleRate) * 2 * Math.PI;
    
    // 2. 지연 시간 계산
    const delayTimeL = this.baseDelay + lfoValue * this.depth;
    const delayTimeR = this.baseDelay + lfoValue * this.depth + 1.25; // 90도 위상차
    
    // 3. 지연 버퍼에서 읽기
    const delayedL = this.readDelay(this.delayBufferL, delayTimeL);
    const delayedR = this.readDelay(this.delayBufferR, delayTimeR);
    
    // 4. 피드백 (선택)
    const feedbackL = delayedL * this.feedback;
    const feedbackR = delayedR * this.feedback;
    
    // 5. 버퍼에 쓰기
    this.writeDelay(this.delayBufferL, inputSample + feedbackL);
    this.writeDelay(this.delayBufferR, inputSample + feedbackR);
    
    // 6. Wet/Dry Mix
    const outputL = inputSample * (1 - this.mix) + delayedL * this.mix;
    const outputR = inputSample * (1 - this.mix) + delayedR * this.mix;
    
    return { L: outputL, R: outputR };
  }
  
  generateLFO(phase) {
    if (this.lfoWaveform === "sine") {
      return Math.sin(phase);
    } else if (this.lfoWaveform === "triangle") {
      // 삼각파
      return (Math.abs((phase % (2 * Math.PI)) - Math.PI) - Math.PI / 2) / (Math.PI / 2);
    }
    return 0;
  }
  
  readDelay(buffer, delayTimeMs) {
    // 선형 보간으로 부드럽게 읽기
  }
  
  writeDelay(buffer, sample) {
    buffer[this.writeIndex] = sample;
    this.writeIndex = (this.writeIndex + 1) % buffer.length;
  }
  
  setRate(hz) { this.rate = hz; }
  setDepth(ms) { this.depth = ms; }
  setMix(value) { this.mix = value; }
}

## 7단계: 디자인
- 어두운 테마
- 초록색/라임색 악센트 (상큼한 느낌)
- LFO 파형 애니메이션
- 부드러운 곡선
- 반응형 레이아웃
- 모바일 터치 친화적

## 8단계: 고급 기능 (선택)
1. Tri-Chorus
   - 3개의 코러스 신호 조합
   - 더 풍부한 톤

2. Flanger Mode
   - 더 얕은 지연 (1~10ms)
   - 빠른 Rate (2~10Hz)
   - 더 극적인 스윕 효과

3. Vibrato Mode
   - 피치(주파수) 변조
   - 기본 톤도 약간 변함

4. LFO Waveform 선택
   - Sine (부드러움)
   - Triangle (약간 각남)
   - Square (극단적)

## 9단계: 성능 최적화
- AudioWorklet 또는 ScriptProcessorNode
- 버퍼 크기: 2048 samples
- 지연시간(Latency): < 50ms

## 추가 고려사항
1. Stereo Spread (좌우 위상차)
2. Smooth Parameter Automation
3. Feedback 안정성 (폭주 방지)
4. 호환성 (모든 브라우저)

코드는 모듈식으로, 주석을 한국어로 달아주고,
Delay, Reverb 등 다른 이펙터와 함께 
페달보드에서 시리즈로 연결할 수 있도록 설계해줘.
`;
```

---

## 💻 핵심 알고리즘 (프롬프트에 포함 가능)

```javascript
// LFO 생성 (사인파)
function generateSineLFO(phase) {
  return Math.sin(phase);
}

// LFO 생성 (삼각파)
function generateTriangleLFO(phase) {
  const normalizedPhase = (phase % (2 * Math.PI)) / (2 * Math.PI);
  if (normalizedPhase < 0.5) {
    return normalizedPhase * 4 - 1; // 0 to 1
  } else {
    return (1 - normalizedPhase) * 4 - 1; // 1 to 0
  }
}

// 코러스 처리
function chorusProcess(
  inputSample,
  delayBuffer,
  baseDelayMs,
  depthMs,
  lfoValue,
  feedback,
  mix,
  sampleRate
) {
  // 1. 지연 시간 계산 (LFO 변조)
  const delayTimeMs = baseDelayMs + (lfoValue * depthMs);
  
  // 2. 버퍼에서 읽기 (선형 보간)
  const delayInSamples = (delayTimeMs / 1000) * sampleRate;
  const integerPart = Math.floor(delayInSamples);
  const fractionalPart = delayInSamples - integerPart;
  
  const sample1 = delayBuffer[integerPart % delayBuffer.length];
  const sample2 = delayBuffer[(integerPart + 1) % delayBuffer.length];
  const delayedSample = sample1 * (1 - fractionalPart) + sample2 * fractionalPart;
  
  // 3. 피드백
  const feedbackSignal = delayedSample * feedback;
  
  // 4. 버퍼에 쓰기
  // delayBuffer[writeIndex] = inputSample + feedbackSignal;
  
  // 5. Wet/Dry Mix
  const output = inputSample * (1 - mix) + delayedSample * mix;
  
  return output;
}

// 스테레오 위상차 (90도)
function generateStereoChorusL(lfo) {
  return lfo;
}

function generateStereoChorusR(lfo, lfoRate, sampleRate) {
  // 90도 위상차
  const phaseOffset = (Math.PI / 2) / (2 * Math.PI * lfoRate / sampleRate);
  return lfo; // lfo 계산 시 위상차 적용
}
```

---

## 🎛️ 프리셋 정의 (프롬프트에 포함 가능)

```javascript
const chorusPresets = {
  subtle: {
    rate: 0.8,
    depth: 1.0,
    baseDelay: 20,
    feedback: 0.0,
    mix: 0.3,
    description: "미묘한 공간감, 원음 유지"
  },
  standard: {
    rate: 1.5,
    depth: 2.5,
    baseDelay: 30,
    feedback: 0.1,
    mix: 0.5,
    description: "표준 코러스, 자연스러운 합창"
  },
  lush: {
    rate: 2.5,
    depth: 4.0,
    baseDelay: 35,
    feedback: 0.2,
    mix: 0.7,
    description: "풍부한 톤, 강한 공간감"
  },
  flanger: {
    rate: 5.0,
    depth: 3.0,
    baseDelay: 5,
    feedback: 0.5,
    mix: 0.6,
    description: "플랜저 느낌, 스윕 효과"
  }
};
```

---

## 📝 Claude Code에서 실행할 최종 프롬프트

```
웹 기타 코러스 페달 만들어줘

## 주요 요구사항
- Tone.js 기반
- LFO 변조 (사인파 기반)
- Rate (0.5~10 Hz), Depth (0~5ms), Mix 슬라이더
- 4개 프리셋: Subtle, Standard, Lush, Flanger
- LFO 파형 실시간 시각화 (사인파 그래프)
- 지연 시간 변화 그래프 (기본선 + 변조 범위)
- 스테레오 분리 표시
- 반응형 CSS (어두운 테마, 초록색/라임색 악센트)
- 모바일 대응
- 한국어 주석

## 신호 체인
마이크 → Input Gain → LFO 생성 → Variable Delay Buffer (좌/우) → Feedback → Mix → Output Limiter → 출력

## 프리셋 특성
1. Subtle: Rate 0.8Hz, Depth 1ms, Mix 30% (미묘한 공간)
2. Standard: Rate 1.5Hz, Depth 2.5ms, Mix 50% (자연스러운 합창)
3. Lush: Rate 2.5Hz, Depth 4ms, Mix 70% (풍부한 톤)
4. Flanger: Rate 5Hz, Depth 3ms, Mix 60% (스윕 효과)

## 시각화
- LFO 파형: 사인파 실시간 표시
- 지연 시간 그래프: baseDelay ± (depth × LFO 값)
- 입력/출력 신호 비교
```

---

## 🎸 다섯 이펙터 완전 정리

```
디스토션(Distortion) → 오버드라이브(Overdrive) → 크런치(Crunch) → 퍼즈(Fuzz)
         ↓                    ↓                    ↓
[극도의 하드]         [부드러운 Soft]         [혼합 클리핑]      [극도의 Hard + Bit Crush]
    
                            ↓
                    [톤 기반 이펙터 완성]
                    
        +─ 딜레이(Delay)     : 신호 지연 + 피드백
        +─ 리버브(Reverb)    : 공간 시뮬레이션
        └─ 코러스(Chorus)    : 여러 악기 느낌 (LFO 변조)
```

---

## 🎯 다음 이펙터 (추가 예정)

1. **플랜저 (Flanger)** - 코러스와 유사하지만 더 극적
2. **트레모로 (Tremolo)** - 볼륨 변조
3. **비브라토 (Vibrato)** - 피치 변조
4. **이펙트 루프** - 여러 이펙터를 한 번에 관리
5. **페달보드 UI** - 모든 이펙터를 통합하는 인터페이스


