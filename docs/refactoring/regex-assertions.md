# 정규식 단언 위치 목록

> `node docs/refactoring/tools/list-regex-assertions.mjs` 로 생성한 파일이다(수정하지 말고 다시 생성한다). 줄 번호는 생성한 시점의 `scripts/` 기준이므로, 시험 파일을 고친 Step 뒤에는 다시 생성한다.
> 세는 대상은 `assert.match(` 와 `assert.doesNotMatch(` 호출이다. 보고서의 "337곳"은 기준 커밋 `4ac9cf7`에서 이 두 호출을 센 값과 같다(316 + 21).

**생성 시점 합계: 394곳** (match 360 + doesNotMatch 34)

| 파일 | match | doesNotMatch | 합계 |
|---|---:|---:|---:|
| auto-wah-regression.mjs | 26 | 3 | 29 |
| chorus-regression.mjs | 14 | 3 | 17 |
| graphic-eq-regression.mjs | 29 | 5 | 34 |
| howl-guard-regression.mjs | 9 | 5 | 14 |
| input-stage-regression.mjs | 2 | 0 | 2 |
| midi-regression.mjs | 22 | 2 | 24 |
| peak-limiter-regression.mjs | 17 | 2 | 19 |
| preset-ab-regression.mjs | 23 | 0 | 23 |
| pwa-regression.mjs | 4 | 0 | 4 |
| recording-regression.mjs | 35 | 2 | 37 |
| responsive-a11y-regression.mjs | 104 | 8 | 112 |
| safe-storage-regression.mjs | 13 | 1 | 14 |
| shortcuts-regression.mjs | 35 | 0 | 35 |
| tap-tempo-regression.mjs | 13 | 1 | 14 |
| tremolo-regression.mjs | 14 | 2 | 16 |
| **합계** | **360** | **34** | **394** |

## 파일별 위치

### auto-wah-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 24 | match | `effectSource` | `/new AudioWorkletNode\(context, 'envelope-follower-processor'/` |
| 25 | match | `effectSource` | `/numberOfOutputs: 2/` |
| 26 | match | `effectSource` | `/outputChannelCount: \[2, 1\]/` |
| 27 | match | `effectSource` | `/this\.follower\.connect\(this\.filter, 0, 0\)/` |
| 28 | match | `effectSource` | `/this\.follower\.connect\(this\.controlDepth, 1, 0\)/` |
| 29 | match | `effectSource` | `/this\.controlDepth\.connect\(this\.filter\.detune\)/` |
| 30 | match | `effectSource` | `/this\.filter\.connect\(this\.effectOutput\)/` |
| 31 | !match | `effectSource` | `/\.value\s*=/, 'AudioParam 직접 대입이 있습니다.'` |
| 37 | !match | `updateSource` | `/new\s+(?:AudioWorklet\|Gain\|BiquadFilter)Node/, 'update 중 오디오 노드를 재생` |
| 42 | match | `updateSource` | `/smoothParam\(this\.sensitivityParam/` |
| 43 | match | `updateSource` | `/smoothParam\([\s\S]*this\.filter\.frequency/` |
| 44 | match | `updateSource` | `/smoothParam\([\s\S]*this\.filter\.detune/` |
| 45 | match | `updateSource` | `/smoothParam\(this\.filter\.Q/` |
| 46 | match | `updateSource` | `/smoothParam\([\s\S]*this\.controlDepth\.gain/` |
| 47 | match | `effectSource` | `/this\.follower\.port\.postMessage\(\{ type: 'dispose' \}\)/` |
| 48 | match | `effectSource` | `/event\.data\?\.type === 'disposed'/` |
| 49 | match | `effectSource` | `/globalThis\.setTimeout\(/` |
| 50 | match | `effectSource` | `/if \(this\.disposed\) return;/` |
| 52 | match | `audioEngineSource` | `/import \{ AutoWahEffect \} from '.\/nodes\/AutoWahEffect';/,` |
| 56 | match | `audioEngineSource` | `/import \{ envelopeFollowerProcessorSource \} from '.\/worklets\/envel` |
| 60 | match | `audioEngineSource` | `/this\.createWorkletUrl\(envelopeFollowerProcessorSource\)/,` |
| 64 | match | `audioEngineSource` | `/case 'autoWah':[\s\S]*return new AutoWahEffect\(this\.context, pedal\` |
| 65 | match | `audioEngineSource` | `/this\.workletUrls\.push\(url\)/` |
| 66 | match | `audioEngineSource` | `/this\.workletUrls\.forEach\(\(url\) => URL\.revokeObjectURL\(url\)\)/` |
| 73 | match | `workletSource` | `/const ATTACK_SECONDS = 0\.005;/` |
| 74 | match | `workletSource` | `/const RELEASE_SECONDS = 0\.12;/` |
| 75 | match | `workletSource` | `/registerProcessor\('envelope-follower-processor'/` |
| 76 | match | `workletSource` | `/this\.port\.postMessage\(\{ type: 'disposed' \}\)/` |
| 86 | !match | `processSource` | `/new\s+\|Array\.from\|\.(?:map\|filter\|reduce)\(/, '오디오 렌더 루프에서 메모리를 ` |

### chorus-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 14 | match | `effectSource` | `/const MIN_DELAY_SECONDS = 0\.012;/` |
| 15 | match | `effectSource` | `/const MAX_DELAY_SECONDS = 0\.028;/` |
| 16 | match | `effectSource` | `/const MAX_MODULATION_SECONDS = 0\.004;/` |
| 17 | match | `effectSource` | `/export const CHORUS_VOICE_BANK_SIZE = 4;/` |
| 18 | match | `effectSource` | `/const SUPPORTED_VOICE_COUNTS = \[2, 3, 4\] as const;/` |
| 19 | !match | `effectSource` | `/\.value\s*=/, 'AudioParam 직접 대입이 있습니다.'` |
| 20 | !match | `effectSource` | `/setValueAtTime\|linearRampToValueAtTime/` |
| 26 | !match | `updateSource` | `/new\s+(?:Gain\|Delay\|Oscillator\|StereoPanner\|BiquadFilter)Node/, '` |
| 31 | match | `updateSource` | `/smoothParam\(lfo\.oscillator\.frequency/` |
| 32 | match | `updateSource` | `/smoothParam\(lfo\.depth\.gain/` |
| 33 | match | `effectSource` | `/oscillator\.start\(\` |
| 34 | match | `effectSource` | `/lfo\.oscillator\.stop\(\` |
| 35 | match | `effectSource` | `/if \(this\.disposed\) return;/` |
| 36 | match | `effectSource` | `/voice\.delay\.disconnect\(\` |
| 37 | match | `effectSource` | `/voice\.panner\.disconnect\(\` |
| 38 | match | `effectSource` | `/voice\.gain\.disconnect\(\` |
| 39 | match | `effectSource` | `/lfo\.depth\.disconnect\(\` |

### graphic-eq-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 20 | match | `effectSource` | `/GRAPHIC_EQ_FREQUENCIES = \[100, 200, 400, 800, 1600, 3200, 6400\] as ` |
| 24 | match | `effectSource` | `/export const GRAPHIC_EQ_Q = 1\.4;/` |
| 25 | match | `effectSource` | `/type: 'peaking'/` |
| 26 | match | `effectSource` | `/Q: GRAPHIC_EQ_Q/` |
| 27 | !match | `effectSource` | `/\.value\s*=/, 'AudioParam 직접 대입이 있습니다.'` |
| 28 | match | `effectSource` | `/this\.effectInput\.connect\(this\.filters\[0\]\)/` |
| 29 | match | `effectSource` | `/this\.filters\[index\]\.connect\(this\.filters\[index \+ 1\]\)/` |
| 30 | match | `effectSource` | `/this\.filters\[this\.filters\.length - 1\]\.connect\(this\.effectOutp` |
| 36 | !match | `updateSource` | `/new\s+(?:Gain\|BiquadFilter)Node/, 'update 중 노드를 재생성합니다.'` |
| 37 | match | `updateSource` | `/smoothParam\(filter\.gain, params\[GRAPHIC_EQ_BAND_KEYS\[index\]\], t` |
| 38 | match | `effectSource` | `/if \(this\.disposed\) return;/` |
| 39 | match | `effectSource` | `/this\.filters\.forEach\(\(filter\) => filter\.disconnect\(\)\)/` |
| 41 | match | `engineSource` | `/import \{ GraphicEQEffect \} from '.\/nodes\/GraphicEQEffect';/` |
| 42 | match | `engineSource` | `/case 'graphicEQ':[\s\S]*return new GraphicEQEffect\(this\.context, pe` |
| 45 | match | `pedalSource` | `/min=\{-12\}/` |
| 46 | match | `pedalSource` | `/max=\{12\}/` |
| 47 | match | `pedalSource` | `/step=\{0\.5\}/` |
| 48 | match | `pedalSource` | `/ariaValueText=\{'\$\{frequency\} 헤르츠, \$\{shownValue\}'\}/` |
| 49 | !match | `pedalSource` | `/SliderControl/, '기존 SliderControl을 재사용했습니다.'` |
| 50 | match | `faderSource` | `/type="range"/` |
| 51 | match | `faderSource` | `/aria-orientation="vertical"/` |
| 52 | match | `faderSource` | `/aria-valuetext=\{'\$\{label\} \$\{ariaValueText\}'\}/` |
| 53 | match | `faderSource` | `/onChange=\{\(event\) => onChange\(Number\(event\.currentTarget\.value` |
| 54 | !match | `faderSource` | `/tabIndex=\{-1\}/, '키보드 접근이 차단되었습니다.'` |
| 55 | match | `cardSource` | `/'graphicEQ'/` |
| 56 | match | `cardSource` | `/pedal-card-graphic-eq/` |
| 57 | match | `cardSource` | `/<GraphicEQPedal/` |
| 58 | match | `iconSource` | `/case 'graphicEQ':/` |
| 59 | match | `styleSource` | `/\.pedal-card-graphic-eq/` |
| 60 | match | `styleSource` | `/\.graphic-eq7-fader-bank/` |
| 61 | match | `styleSource` | `/\.vertical-fader-rail input:focus-visible/` |
| 63 | !match | `styleSource` | `/\.vertical-fader input\s*[,{]/, ''.vertical-fader input' 규칙이 숫자 입력까지 ` |
| 64 | match | `styleSource` | `/\.vertical-fader\s*\{\s*position:\s*relative;/, '.vertical-fader 가 숫자` |
| 65 | match | `styleSource` | `/\.vertical-fader > \.knob-number-input\s*\{[^}]*position:\s*absolute;` |

### howl-guard-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 908 | !match | `read('src/audio/monitor/MonitorService.t` | `/from '\.\.\/\.\.\/store\|from 'zustand'\|useMonitorStore/, 'MonitorSe` |
| 915 | !match | `code` | `forbidden, '${file}: 오디오 스레드 코드는 화면·시계 API 를 쓰지 않는다'` |
| 920 | match | `guardCode` | `/this\.analyze\(analysis, frames\)/, '판정기는 분석 입력(입력 1)을 먹는다'` |
| 921 | !match | `guardCode` | `/detector\.push\([^)]*program/, '프로그램(출력) 입력은 판정에 쓰지 않는다'` |
| 925 | match | `engine` | `/connect\(this\.outputGuard, 0, GUARD_ANALYSIS_INPUT\)/, '입력 트림 뒤 → 가드` |
| 926 | match | `engine` | `/createOutputGuard\(context, this\.currentGuardMode\(\)\)/, '가드는 만들 때 ` |
| 927 | match | `engine` | `/createLevelMeter\(context, 'in'\)[\s\S]{0,80}createLevelMeter\(contex` |
| 929 | match | `store` | `/audioEngine\.setHowlHandler\(\(freqHz\) => \{[\s\S]{0,400}stopSession` |
| 930 | match | `store` | `/audioEngine\.setMonitorSink\(monitorSink\)/, '엔진의 측정 결과는 monitorStore` |
| 932 | match | `workletModules` | `/levelMeterWorkletUrl[\s\S]*outputGuardWorkletUrl/, '오프라인 렌더에도 level-m` |
| 933 | !match | `workletModules` | `/howl-guard\|howlGuard/, '옛 이름은 남기지 않는다'` |
| 934 | match | `engine` | `/levelMeterWorkletUrl/, '라이브 엔진도 level-meter 를 등록한다'` |
| 935 | match | `engine` | `/outputGuardWorkletUrl/, '라이브 엔진도 output-guard 를 등록한다'` |
| 936 | !match | `engine` | `/howl-guard\|howlGuard/, '라이브 엔진에도 옛 이름이 없다'` |

### input-stage-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 146 | match | `describeDecision('sum')` | `/합쳐서 씁니다/` |
| 147 | match | `describeDecision('pending')` | `/자동으로 정합니다/` |

### midi-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 30 | match | `keysSource` | `/midi: 'guitar-pedalboard:midi'/, 'MIDI storage key'` |
| 31 | match | `audioStoreSource` | `/STORAGE_KEYS\.midi/` |
| 32 | !match | `midiSource` | `/localStorage\|guitar-pedalboard:midi/, 'MIDI 해석 모듈은 저장소와 키 문자열을 모른다'` |
| 41 | match | `audioStoreSource.slice(requestHelperStar` | `/navigator\.requestMIDIAccess\(\{ sysex: false \}\)/, 'MIDI 권한 요청이 Lea` |
| 49 | match | `messageHandlerSource` | `/if \(learningPedalId\)/` |
| 50 | match | `messageHandlerSource` | `/createMidiMapping\(message\)/` |
| 55 | match | `messageHandlerSource` | `/pedalStore\.setPedalBypass\(pedalId, bypassed\)/` |
| 56 | match | `messageHandlerSource` | `/audioEngine\.setPedalBypass\(pedalId, bypassed\)/` |
| 57 | match | `audioStoreSource` | `/midiAccess\.onstatechange = handleMidiStateChange/` |
| 58 | match | `audioStoreSource` | `/input\.onmidimessage = handleMidiMessage/` |
| 59 | match | `audioStoreSource` | `/input\.onmidimessage = null/` |
| 60 | match | `audioStoreSource` | `/midiAccess\.onstatechange = null/` |
| 62 | match | `toggleSource` | `/onContextMenu\?: MouseEventHandler<HTMLLabelElement>/` |
| 63 | match | `toggleSource` | `/<label className="toggle-switch" onContextMenu=\{onContextMenu\}>/` |
| 64 | match | `pedalCardSource` | `/role="menu"/` |
| 65 | match | `pedalCardSource` | `/role="menuitem"/` |
| 66 | match | `pedalCardSource` | `/>\s*MIDI 학습\s*<\/button>/` |
| 67 | match | `pedalCardSource` | `/className="midi-learn-button"/` |
| 68 | match | `pedalCardSource` | `/aria-live="polite"/` |
| 69 | match | `pedalCardSource` | `/<StompToggleSwitch label="효과" checked=\{pedal.enabled && !pedal.bypas` |
| 70 | match | `pedalCardSource` | `/aria-haspopup="menu"/` |
| 71 | !match | `pedalCardSource` | `/label="Bypass"/` |
| 73 | match | `appShellSource` | `/connectSavedMidi\(\)/` |
| 367 | match | `useAudioStore.getState().midiError` | `/이미 사용 중/` |

### peak-limiter-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 341 | match | `urls` | `/from '\.\/limiter\.worklet\.ts\?worker&url'/, '리미터는 별도 파일을 ?worker&ur` |
| 342 | match | `engine` | `/new OutputStage\(context, \{ guard: this\.outputGuard, levelMeter: th` |
| 343 | match | `engine` | `/this\.outputStage\.output\.connect\(context\.destination\)/` |
| 344 | match | `engine` | `/this\.outputStage\.output\.connect\(this\.outputMeter\.input\)/` |
| 345 | match | `engine` | `/this\.outputStage\?\.output\.connect\(this\.recorderDestination\)/, '` |
| 346 | match | `engine` | `/limiterWorkletUrl/, '엔진이 리미터 워클릿 파일을 등록한다'` |
| 347 | match | `modules` | `/limiterWorkletUrl/, '오프라인 렌더도 같은 파일을 등록한다'` |
| 348 | match | `renderChain` | `/new OutputStage\(context, \{ guard, levelMeter: outputTap \}\)/, '오프라` |
| 349 | match | `engine` | `/levelMeterWorkletUrl[\s\S]*outputGuardWorkletUrl/, '엔진이 레벨 미터·출력 가드 워` |
| 350 | match | `modules` | `/levelMeterWorkletUrl[\s\S]*outputGuardWorkletUrl/, '오프라인 렌더도 같은 파일들을 ` |
| 351 | match | `urls` | `/level-meter\.worklet\.ts\?worker&url/` |
| 352 | match | `urls` | `/output-guard\.worklet\.ts\?worker&url/` |
| 354 | match | `engine` | `/to: chainEnd/, '엔진은 체인 끝을 마스터 게인이 아니라 trim 에 잇는다'` |
| 355 | match | `engine` | `/this\.buildChainConnections\(\s*pedals,\s*nextEffects,\s*chainInput,\` |
| 356 | match | `engine` | `/presetTrim\.gain\.value = dbToGain\(clampTrimDb\(this\.getPresetTrimD` |
| 357 | match | `engine` | `/rampParam\(trim\.gain, dbToGain\(clampTrimDb\(db\)\), context, PRESET` |
| 358 | match | `renderChain` | `/previous\.connect\(presetTrim\)/, '오프라인 렌더도 체인 끝을 trim 에 잇는다'` |
| 359 | !match | `engine` | `/previous\.connect\(masterGain\)\|to: masterGain/, '체인 끝이 마스터 게인으로 곧장 ` |
| 360 | !match | `engine + modules + renderChain` | `/peak-limiter-processor\|peakLimiterProcessorSource/, '옛 리미터는 남기지 않는다'` |

### preset-ab-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 17 | match | `presetStoreSource` | `/slotA: PedalState\[\] \\| null/` |
| 18 | match | `presetStoreSource` | `/slotB: PedalState\[\] \\| null/` |
| 19 | match | `presetStoreSource` | `/activeSlot: PresetComparisonSlot/` |
| 20 | match | `presetStoreSource` | `/captureCurrentToSlot: \(slot: PresetComparisonSlot\) => void/` |
| 21 | match | `presetStoreSource` | `/activateSlot: \(slot: PresetComparisonSlot\) => boolean/` |
| 22 | match | `presetStoreSource` | `/const capturedPedals = clonePedals\(usePedalStore\.getState\(\)\.peda` |
| 27 | match | `activateSource` | `/applyPresetPedals\(storedPedals, storedTrimDb\)/, '슬롯을 켜면 슬롯에 담긴 음량 보` |
| 28 | match | `presetStoreSource` | `/clearAllCabinetIrs\(\` |
| 29 | match | `panelSource` | `/applyPresetPedals\(preset\.pedals, preset\.trimDb\)/` |
| 30 | match | `panelSource` | `/clearAllCabinetIrs\(\` |
| 32 | match | `midiSource` | `/applyPresetPedals\(preset\.pedals, preset\.trimDb\)/` |
| 35 | match | `panelSource` | `/className="preset-ab-buttons"/` |
| 43 | match | `abButtonsSource` | `/disabled=\{!slotA\}/` |
| 44 | match | `abButtonsSource` | `/disabled=\{!slotB\}/` |
| 46 | match | `panelSource` | `/<p role="status" aria-live="polite">/` |
| 48 | match | `shortcutRoutingSource` | `/key === 't'/` |
| 49 | match | `shortcutRoutingSource` | `/key === 'a' \\|\\| key === 'b'/` |
| 50 | match | `shortcutRoutingSource` | `/slot: key === 'a' \? 'A' : 'B'/` |
| 51 | match | `shortcutRoutingSource` | `/event\.repeat/` |
| 52 | match | `shortcutRoutingSource` | `/event\.isComposing/` |
| 53 | match | `shortcutRoutingSource` | `/event\.(?:ctrlKey\|metaKey\|altKey\|shiftKey)/` |
| 54 | match | `keyboardSource` | `/input'[\s\S]*select'[\s\S]*textarea'[\s\S]*contenteditable/` |
| 55 | match | `keyboardSource` | `/activateSlot\(command\.slot\)/` |

### pwa-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 39 | match | `builtIndex` | `/manifest\.webmanifest/` |
| 40 | match | `builtIndex` | `/registerSW\.js/` |
| 43 | match | `serviceWorker` | `/NetworkFirst/` |
| 44 | match | `serviceWorker` | `/guitar-pedalboard-runtime/` |

### recording-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 18 | match | `engineSource` | `/createRecorderStream\(\): MediaStream/` |
| 19 | match | `engineSource` | `/this\.context\.createMediaStreamDestination\(\)/` |
| 21 | match | `engineSource` | `/this\.outputStage\?\.output\.connect\(this\.recorderDestination\)/` |
| 22 | match | `engineSource` | `/destination\.stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop` |
| 23 | match | `storeSource` | `/disposeRecordingRuntime[\s\S]*audioEngine\.disposeRecorderStream\(\)/` |
| 24 | match | `storeSource` | `/export type RecordingStatus = 'idle' \\| 'recording' \\| 'ready'/` |
| 25 | match | `storeSource` | `/let activeRecorder: MediaRecorder \\| null/` |
| 26 | match | `storeSource` | `/let recordingChunks: Blob\[\]/` |
| 27 | match | `storeSource` | `/let recordingTimer: number \\| null/` |
| 28 | match | `storeSource` | `/selectRecorderMimeType/` |
| 29 | match | `storeSource` | `/revokeRecordingUrl\(state\.recordedUrl\)/` |
| 30 | match | `storeSource` | `/setSelectedDevice:[\s\S]*finishActiveRecording\('finalize'\)/` |
| 31 | match | `storeSource` | `/startFile:[\s\S]*finishActiveRecording\('finalize'\)/` |
| 34 | match | `storeSource` | `/panic:[\s\S]*stopSession\('panic'\)/` |
| 35 | match | `storeSource` | `/async function finalizeRecordingForStop\(\)[\s\S]*finishActiveRecordi` |
| 36 | match | `storeSource` | `/finalizeRecording: finalizeRecordingForStop/` |
| 37 | !match | `storeSource` | `/audioEngine\.panic\(\|AudioEngine\.getInstance\(\)\.stop\(/` |
| 38 | match | `storeSource` | `/audioEngine\.setHowlHandler/` |
| 39 | match | `appShellSource` | `/useEffect\(\(\) => \(\) => disposeRecording\(\)/` |
| 41 | match | `meterSource` | `new RegExp('>\\s*${label}\\s*<\\/button>')` |
| 43 | match | `meterSource` | `/disabled=\{!selectedRecordingSupported \\|\\| !isRunning/` |
| 44 | match | `meterSource` | `/disabled=\{recordingStatus !== 'recording'\}/` |
| 45 | match | `meterSource` | `/aria-live="polite"/` |
| 46 | match | `meterSource` | `/createRecordingFilename\(new Date\(\), recordedFormat\)/` |
| 47 | match | `cssSource` | `/\.recording-panel/` |
| 48 | match | `cssSource` | `/\.recording-actions/` |
| 77 | !match | `createRecordingFilename(new Date(2026, 8` | `/\.[a-z]+$/` |
| 99 | match | `createRecordingFilename(new Date(2026, 8` | `/\.wav$/` |
| 460 | match | `toastMessages()[0]` | `/긴급 정지했습니다\. 마이크와 오디오를 모두 껐습니다\./` |
| 461 | match | `toastMessages()[0]` | `/녹음은 저장했습니다\./` |
| 475 | match | `toastMessages()[0]` | `/하울링이 감지되어 정지했습니다\. 스피커 음량을 줄이거나 헤드폰을 쓰세요\./` |
| 476 | match | `toastMessages()[0]` | `/녹음은 저장했습니다\./` |
| 499 | match | `createdBlobs.at(-1).type` | `/^audio\/mp4/` |
| 500 | match | `createRecordingFilename(new Date(2026, 8` | `/\.m4a$/` |
| 516 | match | `createdBlobs.at(-1).type` | `/^audio\/ogg/` |
| 528 | match | `useAudioStore.getState().error` | `/WAV 녹음 제한/` |
| 551 | match | `toastMessages()[0]` | `/입력 장치 연결이 끊겼습니다\. 장치를 다시 연결한 뒤 연결하기를 누르세요\./` |

### responsive-a11y-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 52 | match | `appShellSource` | `/MOBILE_LAYOUT_QUERY = '\(max-width: 767px\)'/` |
| 53 | match | `appShellSource` | `/role="tablist"/` |
| 54 | match | `appShellSource` | `/role="tab"/` |
| 63 | match | `appShellSource` | `new RegExp('\\{ id: '${id}', label: '${label}' \\}')` |
| 71 | match | `appShellSource` | `/useState<MobileTabId>\('pedals'\)/, "기본 선택 탭은 '페달' 이어야 합니다."` |
| 76 | match | `appShellSource` | `/PEDAL_BOARD_SECTION_ID = 'pedal-board-section'/` |
| 77 | match | `pedalBoardSource` | `/<section id="pedal-board-section" className="board-section"/` |
| 83 | match | `appShellSource` | `/const mobileDockOpen = isMobileLayout && activeMobileTab !== 'pedals'` |
| 84 | match | `appShellSource` | `/setActiveMobileTab\(\(current\) => \(current === tabId \? 'pedals' : ` |
| 85 | !match | `appShellSource` | `/setMobileDockOpen\|mobile-dock-toggle/, '도크 토글/별도 열림 상태가 되살아났습니다.'` |
| 86 | match | `appShellSource` | `/useDockHeight\(dockElement\)/` |
| 87 | match | `appShellSource` | `/<section ref=\{setDockElement\} className="mobile-control-dock"/` |
| 88 | match | `dockHeightSource` | `/DOCK_HEIGHT_VAR = '--dock-h'/` |
| 89 | match | `dockHeightSource` | `/new ResizeObserver\(publish\)/` |
| 90 | match | `dockHeightSource` | `/observer\.disconnect\(\)/` |
| 91 | match | `dockHeightSource` | `/removeProperty\(DOCK_HEIGHT_VAR\)/` |
| 92 | match | `appShellSource` | `/aria-selected=\{isActive\}/` |
| 93 | match | `appShellSource` | `/tabIndex=\{isActive \? 0 : -1\}/` |
| 98 | match | `appShellSource` | `/const inputPanel = <ConnectGuitarPanel isMobile=\{isMobileLayout\} \/` |
| 99 | match | `appShellSource` | `/const meterPanel = <Meter active=\{!isMobileLayout \\|\\| activeMobil` |
| 100 | match | `appShellSource` | `/inputPanel=\{isMobileLayout \? undefined : inputPanel\}/` |
| 101 | match | `appShellSource` | `/window\.addEventListener\('online', updateOnlineStatus\)/` |
| 102 | match | `appShellSource` | `/window\.addEventListener\('offline', updateOnlineStatus\)/` |
| 103 | match | `appShellSource` | `/window\.removeEventListener\('online', updateOnlineStatus\)/` |
| 104 | match | `appShellSource` | `/window\.removeEventListener\('offline', updateOnlineStatus\)/` |
| 105 | match | `appShellSource` | `/오프라인 상태입니다\./` |
| 106 | match | `appShellSource` | `/기타 실시간 입력은 사용할 수 없습니다\. 음원 파일 재생 모드로 톤을 확인해 주세요\./` |
| 107 | !match | `appShellSource` | `/addEventListener\('keydown'/` |
| 109 | match | `pedalBoardSource` | `/interface PedalBoardProps[\s\S]*inputPanel\?: ReactNode/` |
| 110 | match | `pedalBoardSource` | `/export function PedalBoard\(\{ inputPanel \}: PedalBoardProps\)/` |
| 111 | match | `pedalBoardSource` | `/\{inputPanel\}/` |
| 112 | match | `pedalBoardSource` | `/className="signal-chain-text"[\s\S]{0,100}role="region"/` |
| 113 | match | `pedalBoardSource` | `/aria-label="현재 신호 체인"/` |
| 114 | match | `pedalBoardSource` | `/aria-atomic="true"/` |
| 115 | match | `pedalBoardSource` | `/tabIndex=\{0\}/` |
| 117 | match | `mediaQuerySource` | `/window\.matchMedia\(query\)/` |
| 118 | match | `mediaQuerySource` | `/mediaQuery\.addEventListener\('change', updateMatch\)/` |
| 119 | match | `mediaQuerySource` | `/mediaQuery\.removeEventListener\('change', updateMatch\)/` |
| 121 | match | `meterSource` | `/interface MeterProps[\s\S]*active\?: boolean/` |
| 122 | match | `meterSource` | `/export function Meter\(\{ active = true \}: MeterProps\)/` |
| 128 | match | `meterSource` | `/\}, \[active, isRunning\]\` |
| 129 | match | `meterSource` | `/window\.setInterval\(update, STORE_REFRESH_INTERVAL_MS\)/` |
| 130 | match | `meterSource` | `/\}, \[isRunning, refreshMeters\]\` |
| 131 | match | `meterSource` | `/tunerStatus === 'in-tune'[\s\S]*'정확함'/` |
| 132 | match | `meterSource` | `/roundedCents > 0 \? '높음' : '낮음'/` |
| 133 | match | `meterSource` | `/const boundedCents = Math\.round\(Math\.min\(50, Math\.max\(-50, hasP` |
| 134 | match | `meterSource` | `/aria-valuenow=\{boundedCents\}/` |
| 135 | match | `meterSource` | `/aria-valuetext=\{tuningStatusLabel\}[\s\S]{0,120}role="meter"/` |
| 137 | match | `connectSource` | `/STORAGE_KEYS\.mobileAudioNotice/` |
| 138 | match | `keysSource` | `/mobileAudioNotice: 'guitar-pedalboard:mobile-audio-notice-dismissed'/` |
| 139 | match | `connectSource` | `/모바일은 입력 지연이 커서 실시간 연주에 적합하지 않습니다\./` |
| 140 | match | `connectSource` | `/음원 파일 재생 모드로 톤을 확인하거나, PC \+ 오디오 인터페이스 사용을 권장합니다\./` |
| 142 | !match | `connectSource` | `/localStorage/` |
| 143 | match | `connectSource` | `/safeStorage\.getRaw\(STORAGE_KEYS\.mobileAudioNotice\)/` |
| 144 | match | `connectSource` | `/safeStorage\.setRaw\(STORAGE_KEYS\.mobileAudioNotice, 'true'\)/` |
| 145 | match | `connectSource` | `/aria-label="모바일 오디오 안내 닫기"/` |
| 147 | match | `pedalCardSource` | `/<article[\s\S]*role="group"[\s\S]*aria-label=\{'\$\{pedal\.name\} 이펙터` |
| 148 | match | `delaySource` | `/ariaValueText=\{delayModeLabels\[params\.mode\]\}/` |
| 149 | match | `delaySource` | `/<div className="delay-led" aria-hidden="true" \/>/` |
| 150 | !match | `delaySource` | `/delay-led[^>]*aria-label/` |
| 151 | match | `noiseGateSource` | `/noise-gate-led[^>]*aria-hidden="true"/` |
| 152 | !match | `noiseGateSource` | `/noise-gate-led[^>]*aria-label/` |
| 153 | match | `fuzzSource` | `/ariaValueText=\{fuzzModeLabels\[params\.mode\]\}/` |
| 154 | match | `presetSource` | `/<ul className="preset-library-list" aria-label="프리셋 라이브러리">/` |
| 155 | match | `presetSource` | `/<li key=\{library\.id\}>/` |
| 156 | match | `presetSource` | `/<ul className="preset-list" aria-label="프리셋 목록">/` |
| 157 | match | `presetSource` | `/<li className=\{'preset-item/` |
| 158 | !match | `presetSource` | `/role="list"/` |
| 167 | match | `namedGenericTag` | `/\brole=/, '${componentFile}: 이름 있는 generic 요소에 유효한 role이 필요합니다.'` |
| 178 | match | `inputTag` | `/aria-label=/, '${componentFile}: range aria-label 누락'` |
| 179 | match | `inputTag` | `/aria-valuetext=/, '${componentFile}: range aria-valuetext 누락'` |
| 187 | match | `indexSource` | `/viewport-fit=cover/` |
| 188 | match | `responsiveCss` | `/@media \(min-width: 768px\) and \(max-width: 1279px\)/` |
| 189 | match | `pedalsCss` | `/grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 300px\), ` |
| 190 | match | `responsiveCss` | `/\.mobile-control-panels\[hidden\]/` |
| 192 | match | `responsiveCss` | `/\.mobile-control-dock \{[^}]*max-height: 50dvh;/` |
| 193 | match | `responsiveCss` | `/\.mobile-control-panel \{[^}]*max-height: calc\(50dvh - var\(--dock-t` |
| 194 | match | `responsiveCss` | `/padding: 12px [^;]*calc\(var\(--dock-h, 0px\) \+ env\(safe-area-inset` |
| 195 | match | `responsiveCss` | `/grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/` |
| 196 | !match | `responsiveCss` | `/66dvh\|min\(66dvh\|mobile-dock-toggle/` |
| 197 | match | `pedalsCss` | `/\.stomp-toggle-switch \{[^}]*min-height: 44px;/, '스톰프 스위치 터치 영역은 44×4` |
| 198 | match | `responsiveCss` | `/@media \(max-width: 767px\)/` |
| 199 | match | `responsiveCss` | `/grid-auto-flow: column/` |
| 200 | match | `responsiveCss` | `/scroll-snap-type: x mandatory/` |
| 201 | match | `responsiveCss` | `/scroll-snap-align: start/` |
| 202 | match | `responsiveCss` | `/position: fixed[\s\S]*bottom: 0[\s\S]*\.mobile-bottom-tabs/` |
| 203 | match | `responsiveCss` | `/env\(safe-area-inset-bottom\)/` |
| 204 | match | `responsiveCss` | `/min-height: 44px/` |
| 206 | match | `responsiveCss` | `/\.chain-toast \{[^}]*bottom: calc\(var\(--dock-h, 58px\) \+ 12px\` |
| 207 | !match | `responsiveCss` | `/bottom: calc\(82px/` |
| 208 | match | `responsiveCss` | `/\.app-shell[\s\S]*overflow-x: clip/` |
| 209 | match | `responsiveCss` | `/\.workspace[\s\S]*overflow-x: clip/` |
| 210 | match | `responsiveCss` | `/\.board-section[\s\S]*overflow-x: clip/` |
| 217 | match | `responsiveCss.slice(hiddenPanelRuleIndex` | `/display: none !important/,` |
| 221 | match | `responsiveCss` | `/@media \(prefers-reduced-motion: reduce\)/` |
| 222 | match | `responsiveCss` | `/\.sortable-pedal[\s\S]*\.stomp-toggle-led[\s\S]*\[class\$="-led"\]/` |
| 223 | match | `responsiveCss` | `/animation: none !important/` |
| 224 | match | `responsiveCss` | `/transition: none !important/` |
| 225 | match | `controlsCss` | `/:where\(button, a\[href\], input, select, textarea, \[tabindex\]\):fo` |
| 226 | match | `controlsCss` | `/\.toggle-switch:focus-within \.switch-track/` |
| 227 | match | `controlsCss` | `/\.effect-status\.state-closed\s*\{\s*color: var\(--danger\` |
| 228 | match | `layoutCss` | `/\.preset-library-list > li\s*\{\s*display: contents;/` |
| 229 | match | `layoutCss` | `/\.section-heading\s*\{[\s\S]{0,140}flex-direction: column;/` |
| 230 | match | `layoutCss` | `/\.header-tools\s*\{[\s\S]{0,180}width: 100%;/` |
| 231 | match | `layoutCss` | `/\.header-tools \.connect-panel \.audio-file-upload\s*\{[\s\S]{0,180}g` |
| 235 | match | `layoutCss` | `/\.signal-chain-hop\s*\{\s*flex: 0 0 auto;/` |
| 236 | match | `layoutCss` | `/\.chain-effect-pill\s*\{\s*flex: 0 0 auto;/` |
| 237 | match | `panelsCss` | `/\.mobile-audio-notice/` |
| 238 | match | `panelsCss` | `/\.tuner-status-text/` |
| 239 | match | `panelsCss` | `/\.primary-button\s*\{\s*background: #2f72cb;/` |
| 240 | match | `panelsCss` | `/\.primary-button:hover:not\(:disabled\)\s*\{\s*background: #2869bd;/` |
| 241 | match | `pedalsCss` | `/\.compressor-brand-panel\s*\{[\s\S]{0,180}background: #0878bf;/` |

### safe-storage-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 266 | match | `notices[0].message` | `/kimyounggaur\.github\.io/` |
| 652 | match | `lines[3]` | `/^브라우저: /` |
| 682 | match | `boundarySource` | `/getDerivedStateFromError/` |
| 683 | match | `boundarySource` | `/componentDidCatch[\s\S]*void stopSessionForError\(\)/, '오류가 나면 먼저 소리를` |
| 687 | match | `boundarySource` | `/role="alert"/` |
| 688 | match | `boundarySource` | `/safeStorage\.clearAppSettings\(\` |
| 689 | !match | `boundarySource` | `/confirmReset[\s\S]*\blocalStorage\b/` |
| 692 | match | `appSource` | `/<AppErrorBoundary>[\s\S]*<AppShell \/>[\s\S]*<\/AppErrorBoundary>/, '` |
| 693 | match | `appSource` | `/<ToastRegion \/>/` |
| 696 | match | `mainSource` | `/installGlobalErrorHandlers\(\)/` |
| 697 | match | `mainSource` | `/try \{[\s\S]*createRoot\(rootElement\)\.render\([\s\S]*\} catch \(err` |
| 700 | match | `auditSource` | `/export function stopSessionForError\(\)[\s\S]*stopSession\('error'\)/` |
| 703 | match | `indexSource` | `/앱을 시작하지 못했습니다/, 'React 가 뜨기 전 실패에 대한 정적 안내'` |
| 704 | match | `indexSource` | `/<script type="module" src="\/src\/main\.tsx"><\/script>/` |

### shortcuts-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 79 | match | `globalSource` | `/capture: true/` |
| 80 | match | `globalSource` | `/tagName === 'input'[\s\S]*tagName === 'select'[\s\S]*tagName === 'tex` |
| 81 | match | `globalSource` | `/tagName === 'button'/` |
| 82 | match | `globalSource` | `/tagName === 'a'[\s\S]*hasAttribute\('href'\)/` |
| 83 | match | `globalSource` | `/contenteditable/` |
| 84 | match | `globalSource` | `/\[role="button"\]/` |
| 85 | match | `globalSource` | `/\[tabindex\]:not/` |
| 92 | match | `globalSource` | `/const pedal = pedalStore\.pedals\[command\.index\]/` |
| 93 | match | `globalSource` | `/command\.index < 0 \\|\\| command\.index > 14/` |
| 94 | match | `globalSource` | `/if \(audioState\.isLoading\) return true/` |
| 95 | match | `globalSource` | `/audioState\.isRunning[\s\S]*audioState\.stop\(\)[\s\S]*audioState\.st` |
| 96 | match | `globalSource` | `/tapTempoTap\(\)/` |
| 97 | match | `globalSource` | `/activateSlot\(command\.slot\)/` |
| 98 | match | `globalSource` | `/getState\(\)\.panic\(\)/` |
| 100 | match | `globalSource` | `/export function isEscapeOwnedByTarget/` |
| 101 | match | `globalSource` | `/export function isShortcutBlockedByTarget/` |
| 102 | match | `globalSource` | `/command\.type === 'panic'\) return event\.isComposing \\|\\| isEscape` |
| 106 | match | `globalSource` | `/!command \\|\\| isShortcutBlockedByTarget\(command, event\)/` |
| 111 | match | `globalSource.slice(modalBranch, globalEx` | `/command\?\.type === 'panic'[\s\S]*closeHelp\(\)[\s\S]*return/,` |
| 116 | match | `routingSource` | `/event\.repeat/` |
| 117 | match | `routingSource` | `/event\.ctrlKey \\|\\| event\.metaKey \\|\\| event\.altKey/` |
| 118 | match | `routingSource` | `/event\.shiftKey && !isHelpKey/` |
| 119 | match | `routingSource` | `/Digit0/` |
| 121 | match | `helpSource` | `/role="dialog"/` |
| 122 | match | `helpSource` | `/aria-modal="true"/` |
| 123 | match | `helpSource` | `/aria-labelledby="shortcut-help-title"/` |
| 124 | match | `helpSource` | `/closeButtonRef\.current\?\.focus\(\)/` |
| 125 | match | `helpSource` | `/previousFocus\?\.isConnected[\s\S]*previousFocus\.focus\(\)/` |
| 126 | match | `helpSource` | `/event\.key !== 'Tab'/` |
| 127 | match | `helpSource` | `/event\.shiftKey[\s\S]*firstElement[\s\S]*lastElement/` |
| 128 | match | `helpSource` | `/querySelectorAll<HTMLElement>\(FOCUSABLE_SELECTOR\)/` |
| 129 | match | `helpSource` | `/onKeyDown=\{handleKeyDown\}/` |
| 133 | match | `cssSource` | `/\.shortcut-help-backdrop/` |
| 134 | match | `cssSource` | `/\.shortcut-help-dialog:focus-visible/` |
| 135 | match | `cssSource` | `/@media \(prefers-reduced-motion: reduce\)/` |

### tap-tempo-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 82 | match | `audioStoreSource` | `/tapTempo:\s*\{\s*taps:\s*number\[\];\s*bpm:\s*number\s*\}/` |
| 83 | match | `applySource` | `/!pedal\.params\.sync/` |
| 84 | match | `applySource` | `/pedalStore\.setPedals\(pedals\` |
| 85 | !match | `applySource` | `/rebuildChain/` |
| 86 | match | `audioStoreSource` | `/setGlobalBpm:[\s\S]*applyGlobalBpmToSyncedPedals\(bpm\)/` |
| 87 | match | `audioStoreSource` | `/setTempoSync:[\s\S]*applyTempoSyncToPedal/` |
| 93 | match | `shortcutRoutingSource` | `/key === 't'/` |
| 94 | match | `shortcutRoutingSource` | `/event\.repeat/` |
| 95 | match | `shortcutRoutingSource` | `/event\.isComposing/` |
| 96 | match | `shortcutRoutingSource` | `/event\.(?:ctrlKey\|metaKey\|altKey\|shiftKey)/` |
| 97 | match | `keyboardSource` | `/input'[\s\S]*select'[\s\S]*textarea'[\s\S]*contenteditable/` |
| 98 | match | `keyboardSource` | `/addEventListener\('keydown',[\s\S]*capture: true/` |
| 105 | match | `source` | `/<TapTempoControl \/>/` |
| 106 | match | `source` | `/setTempoSync\(pedalId, checked\)/` |

### tremolo-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 14 | match | `effectSource` | `/export const TREMOLO_LFO_BANK_SIZE = TREMOLO_SHAPES\.length;/` |
| 15 | match | `effectSource` | `/export const TREMOLO_SQUARE_SLEW_SECONDS = 0\.001;/` |
| 16 | match | `effectSource` | `/type: 'lowpass'/` |
| 17 | match | `effectSource` | `/frequency: TREMOLO_SQUARE_SLEW_FREQUENCY/` |
| 18 | match | `effectSource` | `/oscillator\.connect\(slewFilter\` |
| 19 | match | `effectSource` | `/slewFilter\.connect\(modulationGain\` |
| 20 | match | `effectSource` | `/modulationGain\.connect\(this\.amplitude\.gain\` |
| 21 | !match | `effectSource` | `/\.value\s*=/, 'AudioParam 직접 대입이 있습니다.'` |
| 27 | !match | `updateSource` | `/new\s+(?:Gain\|Delay\|Oscillator\|StereoPanner\|BiquadFilter)Node/, '` |
| 32 | match | `updateSource` | `/smoothParam\(this\.amplitude\.gain/` |
| 33 | match | `updateSource` | `/smoothParam\(bank\.oscillator\.frequency/` |
| 34 | match | `updateSource` | `/smoothParam\([\s\S]*bank\.modulationGain\.gain/` |
| 35 | match | `effectSource` | `/const lfoStartTime = context\.currentTime;/` |
| 36 | match | `effectSource` | `/oscillator\.start\(lfoStartTime\` |
| 37 | match | `effectSource` | `/bank\.oscillator\.stop\(\` |
| 38 | match | `effectSource` | `/if \(this\.disposed\) return;/` |
