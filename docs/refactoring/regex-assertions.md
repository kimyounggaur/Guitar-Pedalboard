# 정규식 단언 위치 목록

> `node docs/refactoring/tools/list-regex-assertions.mjs` 로 생성한 파일이다(수정하지 말고 다시 생성한다). 줄 번호는 생성한 시점의 `scripts/` 기준이므로, 시험 파일을 고친 Step 뒤에는 다시 생성한다.
> 세는 대상은 `assert.match(` 와 `assert.doesNotMatch(` 호출이다. 보고서의 "337곳"은 기준 커밋 `4ac9cf7`에서 이 두 호출을 센 값과 같다(316 + 21).

**생성 시점 합계: 312곳** (match 293 + doesNotMatch 19)

| 파일 | match | doesNotMatch | 합계 |
|---|---:|---:|---:|
| auto-wah-regression.mjs | 26 | 3 | 29 |
| chorus-regression.mjs | 14 | 3 | 17 |
| graphic-eq-regression.mjs | 27 | 4 | 31 |
| midi-regression.mjs | 21 | 1 | 22 |
| peak-limiter-regression.mjs | 3 | 0 | 3 |
| preset-ab-regression.mjs | 23 | 0 | 23 |
| pwa-regression.mjs | 4 | 0 | 4 |
| recording-regression.mjs | 30 | 1 | 31 |
| responsive-a11y-regression.mjs | 87 | 4 | 91 |
| shortcuts-regression.mjs | 31 | 0 | 31 |
| tap-tempo-regression.mjs | 13 | 1 | 14 |
| tremolo-regression.mjs | 14 | 2 | 16 |
| **합계** | **293** | **19** | **312** |

## 파일별 위치

### auto-wah-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 23 | match | `effectSource` | `/new AudioWorkletNode\(context, 'envelope-follower-processor'/` |
| 24 | match | `effectSource` | `/numberOfOutputs: 2/` |
| 25 | match | `effectSource` | `/outputChannelCount: \[2, 1\]/` |
| 26 | match | `effectSource` | `/this\.follower\.connect\(this\.filter, 0, 0\)/` |
| 27 | match | `effectSource` | `/this\.follower\.connect\(this\.controlDepth, 1, 0\)/` |
| 28 | match | `effectSource` | `/this\.controlDepth\.connect\(this\.filter\.detune\)/` |
| 29 | match | `effectSource` | `/this\.filter\.connect\(this\.effectOutput\)/` |
| 30 | !match | `effectSource` | `/\.value\s*=/, 'AudioParam 직접 대입이 있습니다.'` |
| 36 | !match | `updateSource` | `/new\s+(?:AudioWorklet\|Gain\|BiquadFilter)Node/, 'update 중 오디오 노드를 재생` |
| 41 | match | `updateSource` | `/smoothParam\(this\.sensitivityParam/` |
| 42 | match | `updateSource` | `/smoothParam\([\s\S]*this\.filter\.frequency/` |
| 43 | match | `updateSource` | `/smoothParam\([\s\S]*this\.filter\.detune/` |
| 44 | match | `updateSource` | `/smoothParam\(this\.filter\.Q/` |
| 45 | match | `updateSource` | `/smoothParam\([\s\S]*this\.controlDepth\.gain/` |
| 46 | match | `effectSource` | `/this\.follower\.port\.postMessage\(\{ type: 'dispose' \}\)/` |
| 47 | match | `effectSource` | `/event\.data\?\.type === 'disposed'/` |
| 48 | match | `effectSource` | `/globalThis\.setTimeout\(/` |
| 49 | match | `effectSource` | `/if \(this\.disposed\) return;/` |
| 51 | match | `audioEngineSource` | `/import \{ AutoWahEffect \} from '.\/nodes\/AutoWahEffect';/,` |
| 55 | match | `audioEngineSource` | `/import \{ envelopeFollowerProcessorSource \} from '.\/worklets\/envel` |
| 59 | match | `audioEngineSource` | `/this\.createWorkletUrl\(envelopeFollowerProcessorSource\)/,` |
| 63 | match | `audioEngineSource` | `/case 'autoWah':[\s\S]*return new AutoWahEffect\(this\.context, pedal\` |
| 64 | match | `audioEngineSource` | `/this\.workletUrls\.push\(url\)/` |
| 65 | match | `audioEngineSource` | `/this\.workletUrls\.forEach\(\(url\) => URL\.revokeObjectURL\(url\)\)/` |
| 72 | match | `workletSource` | `/const ATTACK_SECONDS = 0\.005;/` |
| 73 | match | `workletSource` | `/const RELEASE_SECONDS = 0\.12;/` |
| 74 | match | `workletSource` | `/registerProcessor\('envelope-follower-processor'/` |
| 75 | match | `workletSource` | `/this\.port\.postMessage\(\{ type: 'disposed' \}\)/` |
| 85 | !match | `processSource` | `/new\s+\|Array\.from\|\.(?:map\|filter\|reduce)\(/, '오디오 렌더 루프에서 메모리를 ` |

### chorus-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 13 | match | `effectSource` | `/const MIN_DELAY_SECONDS = 0\.012;/` |
| 14 | match | `effectSource` | `/const MAX_DELAY_SECONDS = 0\.028;/` |
| 15 | match | `effectSource` | `/const MAX_MODULATION_SECONDS = 0\.004;/` |
| 16 | match | `effectSource` | `/export const CHORUS_VOICE_BANK_SIZE = 4;/` |
| 17 | match | `effectSource` | `/const SUPPORTED_VOICE_COUNTS = \[2, 3, 4\] as const;/` |
| 18 | !match | `effectSource` | `/\.value\s*=/, 'AudioParam 직접 대입이 있습니다.'` |
| 19 | !match | `effectSource` | `/setValueAtTime\|linearRampToValueAtTime/` |
| 25 | !match | `updateSource` | `/new\s+(?:Gain\|Delay\|Oscillator\|StereoPanner\|BiquadFilter)Node/, '` |
| 30 | match | `updateSource` | `/smoothParam\(lfo\.oscillator\.frequency/` |
| 31 | match | `updateSource` | `/smoothParam\(lfo\.depth\.gain/` |
| 32 | match | `effectSource` | `/oscillator\.start\(\` |
| 33 | match | `effectSource` | `/lfo\.oscillator\.stop\(\` |
| 34 | match | `effectSource` | `/if \(this\.disposed\) return;/` |
| 35 | match | `effectSource` | `/voice\.delay\.disconnect\(\` |
| 36 | match | `effectSource` | `/voice\.panner\.disconnect\(\` |
| 37 | match | `effectSource` | `/voice\.gain\.disconnect\(\` |
| 38 | match | `effectSource` | `/lfo\.depth\.disconnect\(\` |

### graphic-eq-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 19 | match | `effectSource` | `/GRAPHIC_EQ_FREQUENCIES = \[100, 200, 400, 800, 1600, 3200, 6400\] as ` |
| 23 | match | `effectSource` | `/export const GRAPHIC_EQ_Q = 1\.4;/` |
| 24 | match | `effectSource` | `/type: 'peaking'/` |
| 25 | match | `effectSource` | `/Q: GRAPHIC_EQ_Q/` |
| 26 | !match | `effectSource` | `/\.value\s*=/, 'AudioParam 직접 대입이 있습니다.'` |
| 27 | match | `effectSource` | `/this\.effectInput\.connect\(this\.filters\[0\]\)/` |
| 28 | match | `effectSource` | `/this\.filters\[index\]\.connect\(this\.filters\[index \+ 1\]\)/` |
| 29 | match | `effectSource` | `/this\.filters\[this\.filters\.length - 1\]\.connect\(this\.effectOutp` |
| 35 | !match | `updateSource` | `/new\s+(?:Gain\|BiquadFilter)Node/, 'update 중 노드를 재생성합니다.'` |
| 36 | match | `updateSource` | `/smoothParam\(filter\.gain, params\[GRAPHIC_EQ_BAND_KEYS\[index\]\], t` |
| 37 | match | `effectSource` | `/if \(this\.disposed\) return;/` |
| 38 | match | `effectSource` | `/this\.filters\.forEach\(\(filter\) => filter\.disconnect\(\)\)/` |
| 40 | match | `engineSource` | `/import \{ GraphicEQEffect \} from '.\/nodes\/GraphicEQEffect';/` |
| 41 | match | `engineSource` | `/case 'graphicEQ':[\s\S]*return new GraphicEQEffect\(this\.context, pe` |
| 44 | match | `pedalSource` | `/min=\{-12\}/` |
| 45 | match | `pedalSource` | `/max=\{12\}/` |
| 46 | match | `pedalSource` | `/step=\{0\.5\}/` |
| 47 | match | `pedalSource` | `/ariaValueText=\{'\$\{frequency\} 헤르츠, \$\{shownValue\}'\}/` |
| 48 | !match | `pedalSource` | `/SliderControl/, '기존 SliderControl을 재사용했습니다.'` |
| 49 | match | `faderSource` | `/type="range"/` |
| 50 | match | `faderSource` | `/aria-orientation="vertical"/` |
| 51 | match | `faderSource` | `/aria-valuetext=\{'\$\{label\} \$\{ariaValueText\}'\}/` |
| 52 | match | `faderSource` | `/onChange=\{\(event\) => onChange\(Number\(event\.currentTarget\.value` |
| 53 | !match | `faderSource` | `/tabIndex=\{-1\}/, '키보드 접근이 차단되었습니다.'` |
| 54 | match | `cardSource` | `/'graphicEQ'/` |
| 55 | match | `cardSource` | `/pedal-card-graphic-eq/` |
| 56 | match | `cardSource` | `/<GraphicEQPedal/` |
| 57 | match | `iconSource` | `/case 'graphicEQ':/` |
| 58 | match | `styleSource` | `/\.pedal-card-graphic-eq/` |
| 59 | match | `styleSource` | `/\.graphic-eq7-fader-bank/` |
| 60 | match | `styleSource` | `/\.vertical-fader input:focus-visible/` |

### midi-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 27 | match | `midiSource` | `/'guitar-pedalboard:midi'/, 'MIDI storage key'` |
| 36 | match | `audioStoreSource.slice(requestHelperStar` | `/navigator\.requestMIDIAccess\(\{ sysex: false \}\)/, 'MIDI 권한 요청이 Lea` |
| 44 | match | `messageHandlerSource` | `/if \(learningPedalId\)/` |
| 45 | match | `messageHandlerSource` | `/createMidiMapping\(message\)/` |
| 50 | match | `messageHandlerSource` | `/pedalStore\.setPedalBypass\(pedalId, bypassed\)/` |
| 51 | match | `messageHandlerSource` | `/audioEngine\.setPedalBypass\(pedalId, bypassed\)/` |
| 52 | match | `audioStoreSource` | `/midiAccess\.onstatechange = handleMidiStateChange/` |
| 53 | match | `audioStoreSource` | `/input\.onmidimessage = handleMidiMessage/` |
| 54 | match | `audioStoreSource` | `/input\.onmidimessage = null/` |
| 55 | match | `audioStoreSource` | `/midiAccess\.onstatechange = null/` |
| 57 | match | `toggleSource` | `/onContextMenu\?: MouseEventHandler<HTMLLabelElement>/` |
| 58 | match | `toggleSource` | `/<label className="toggle-switch" onContextMenu=\{onContextMenu\}>/` |
| 59 | match | `pedalCardSource` | `/role="menu"/` |
| 60 | match | `pedalCardSource` | `/role="menuitem"/` |
| 61 | match | `pedalCardSource` | `/>\s*MIDI 학습\s*<\/button>/` |
| 62 | match | `pedalCardSource` | `/className="midi-learn-button"/` |
| 63 | match | `pedalCardSource` | `/aria-live="polite"/` |
| 64 | match | `pedalCardSource` | `/<StompToggleSwitch label="효과" checked=\{pedal.enabled && !pedal.bypas` |
| 65 | match | `pedalCardSource` | `/aria-haspopup="menu"/` |
| 66 | !match | `pedalCardSource` | `/label="Bypass"/` |
| 68 | match | `appShellSource` | `/connectSavedMidi\(\)/` |
| 360 | match | `useAudioStore.getState().midiError` | `/이미 사용 중/` |

### peak-limiter-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 52 | match | `engine` | `/this\.howlGuard\.connect\(this\.limiter\)/` |
| 53 | match | `engine` | `/this\.limiter\.connect\(this\.context\.destination\)/` |
| 54 | match | `engine` | `/this\.limiter\?\.connect\(this\.recorderDestination\)/, 'recording ta` |

### preset-ab-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 16 | match | `presetStoreSource` | `/slotA: PedalState\[\] \\| null/` |
| 17 | match | `presetStoreSource` | `/slotB: PedalState\[\] \\| null/` |
| 18 | match | `presetStoreSource` | `/activeSlot: PresetComparisonSlot/` |
| 19 | match | `presetStoreSource` | `/captureCurrentToSlot: \(slot: PresetComparisonSlot\) => void/` |
| 20 | match | `presetStoreSource` | `/activateSlot: \(slot: PresetComparisonSlot\) => boolean/` |
| 21 | match | `presetStoreSource` | `/const capturedPedals = clonePedals\(usePedalStore\.getState\(\)\.peda` |
| 26 | match | `activateSource` | `/applyPresetPedals\(storedPedals\)/` |
| 27 | match | `presetStoreSource` | `/clearAllCabinetIrs\(\` |
| 28 | match | `panelSource` | `/applyPresetPedals\(preset\.pedals\)/` |
| 29 | match | `panelSource` | `/clearAllCabinetIrs\(\` |
| 31 | match | `midiSource` | `/applyPresetPedals\(preset\.pedals\)/` |
| 34 | match | `panelSource` | `/className="preset-ab-buttons"/` |
| 42 | match | `abButtonsSource` | `/disabled=\{!slotA\}/` |
| 43 | match | `abButtonsSource` | `/disabled=\{!slotB\}/` |
| 45 | match | `panelSource` | `/<p role="status" aria-live="polite">/` |
| 47 | match | `shortcutRoutingSource` | `/key === 't'/` |
| 48 | match | `shortcutRoutingSource` | `/key === 'a' \\|\\| key === 'b'/` |
| 49 | match | `shortcutRoutingSource` | `/slot: key === 'a' \? 'A' : 'B'/` |
| 50 | match | `shortcutRoutingSource` | `/event\.repeat/` |
| 51 | match | `shortcutRoutingSource` | `/event\.isComposing/` |
| 52 | match | `shortcutRoutingSource` | `/event\.(?:ctrlKey\|metaKey\|altKey\|shiftKey)/` |
| 53 | match | `keyboardSource` | `/input'[\s\S]*select'[\s\S]*textarea'[\s\S]*contenteditable/` |
| 54 | match | `keyboardSource` | `/activateSlot\(command\.slot\)/` |

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
| 17 | match | `engineSource` | `/createRecorderStream\(\): MediaStream/` |
| 18 | match | `engineSource` | `/this\.context\.createMediaStreamDestination\(\)/` |
| 19 | match | `engineSource` | `/this\.limiter\?\.connect\(this\.recorderDestination\)/` |
| 20 | match | `engineSource` | `/destination\.stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop` |
| 21 | match | `storeSource` | `/disposeRecordingRuntime[\s\S]*audioEngine\.disposeRecorderStream\(\)/` |
| 22 | match | `storeSource` | `/export type RecordingStatus = 'idle' \\| 'recording' \\| 'ready'/` |
| 23 | match | `storeSource` | `/let activeRecorder: MediaRecorder \\| null/` |
| 24 | match | `storeSource` | `/let recordingChunks: Blob\[\]/` |
| 25 | match | `storeSource` | `/let recordingTimer: number \\| null/` |
| 26 | match | `storeSource` | `/selectRecorderMimeType/` |
| 27 | match | `storeSource` | `/revokeRecordingUrl\(state\.recordedUrl\)/` |
| 28 | match | `storeSource` | `/setSelectedDevice:[\s\S]*finishActiveRecording\('finalize'\)/` |
| 29 | match | `storeSource` | `/startFile:[\s\S]*finishActiveRecording\('finalize'\)/` |
| 30 | match | `storeSource` | `/panic:[\s\S]*audioEngine\.panic\(\)[\s\S]*finishActiveRecording\('fin` |
| 31 | match | `storeSource` | `/audioEngine\.setHowlHandler/` |
| 32 | match | `appShellSource` | `/useEffect\(\(\) => \(\) => disposeRecording\(\)/` |
| 34 | match | `meterSource` | `new RegExp('>\\s*${label}\\s*<\\/button>')` |
| 36 | match | `meterSource` | `/disabled=\{!selectedRecordingSupported \\|\\| !isRunning/` |
| 37 | match | `meterSource` | `/disabled=\{recordingStatus !== 'recording'\}/` |
| 38 | match | `meterSource` | `/aria-live="polite"/` |
| 39 | match | `meterSource` | `/createRecordingFilename\(new Date\(\), recordedFormat\)/` |
| 40 | match | `cssSource` | `/\.recording-panel/` |
| 41 | match | `cssSource` | `/\.recording-actions/` |
| 69 | !match | `createRecordingFilename(new Date(2026, 8` | `/\.[a-z]+$/` |
| 91 | match | `createRecordingFilename(new Date(2026, 8` | `/\.wav$/` |
| 414 | match | `useAudioStore.getState().error` | `/피드백/` |
| 436 | match | `createdBlobs.at(-1).type` | `/^audio\/mp4/` |
| 437 | match | `createRecordingFilename(new Date(2026, 8` | `/\.m4a$/` |
| 453 | match | `createdBlobs.at(-1).type` | `/^audio\/ogg/` |
| 465 | match | `useAudioStore.getState().error` | `/WAV 녹음 제한/` |
| 485 | match | `useAudioStore.getState().error` | `/입력 장치 연결이 끊어져/` |

### responsive-a11y-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 53 | match | `appShellSource` | `/MOBILE_LAYOUT_QUERY = '\(max-width: 767px\)'/` |
| 54 | match | `appShellSource` | `/role="tablist"/` |
| 55 | match | `appShellSource` | `/role="tab"/` |
| 61 | match | `appShellSource` | `new RegExp('\\{ id: '${id}', label: '${label}' \\}')` |
| 66 | match | `appShellSource` | `/aria-selected=\{isActive\}/` |
| 67 | match | `appShellSource` | `/tabIndex=\{isActive \? 0 : -1\}/` |
| 72 | match | `appShellSource` | `/const inputPanel = <ConnectGuitarPanel isMobile=\{isMobileLayout\} \/` |
| 73 | match | `appShellSource` | `/const meterPanel = <Meter active=\{!isMobileLayout \\|\\| activeMobil` |
| 74 | match | `appShellSource` | `/inputPanel=\{isMobileLayout \? undefined : inputPanel\}/` |
| 75 | match | `appShellSource` | `/window\.addEventListener\('online', updateOnlineStatus\)/` |
| 76 | match | `appShellSource` | `/window\.addEventListener\('offline', updateOnlineStatus\)/` |
| 77 | match | `appShellSource` | `/window\.removeEventListener\('online', updateOnlineStatus\)/` |
| 78 | match | `appShellSource` | `/window\.removeEventListener\('offline', updateOnlineStatus\)/` |
| 79 | match | `appShellSource` | `/오프라인 상태입니다\./` |
| 80 | match | `appShellSource` | `/기타 실시간 입력은 사용할 수 없습니다\. 음원 파일 재생 모드로 톤을 확인해 주세요\./` |
| 81 | !match | `appShellSource` | `/addEventListener\('keydown'/` |
| 83 | match | `pedalBoardSource` | `/interface PedalBoardProps[\s\S]*inputPanel\?: ReactNode/` |
| 84 | match | `pedalBoardSource` | `/export function PedalBoard\(\{ inputPanel \}: PedalBoardProps\)/` |
| 85 | match | `pedalBoardSource` | `/\{inputPanel\}/` |
| 86 | match | `pedalBoardSource` | `/className="signal-chain-text"[\s\S]{0,100}role="region"/` |
| 87 | match | `pedalBoardSource` | `/aria-label="현재 신호 체인"/` |
| 88 | match | `pedalBoardSource` | `/aria-atomic="true"/` |
| 89 | match | `pedalBoardSource` | `/tabIndex=\{0\}/` |
| 91 | match | `mediaQuerySource` | `/window\.matchMedia\(query\)/` |
| 92 | match | `mediaQuerySource` | `/mediaQuery\.addEventListener\('change', updateMatch\)/` |
| 93 | match | `mediaQuerySource` | `/mediaQuery\.removeEventListener\('change', updateMatch\)/` |
| 95 | match | `meterSource` | `/interface MeterProps[\s\S]*active\?: boolean/` |
| 96 | match | `meterSource` | `/export function Meter\(\{ active = true \}: MeterProps\)/` |
| 102 | match | `meterSource` | `/\}, \[active, isRunning\]\` |
| 103 | match | `meterSource` | `/window\.setInterval\(update, STORE_REFRESH_INTERVAL_MS\)/` |
| 104 | match | `meterSource` | `/\}, \[isRunning, refreshMeters\]\` |
| 105 | match | `meterSource` | `/tunerStatus === 'in-tune'[\s\S]*'정확함'/` |
| 106 | match | `meterSource` | `/roundedCents > 0 \? '높음' : '낮음'/` |
| 107 | match | `meterSource` | `/const boundedCents = Math\.round\(Math\.min\(50, Math\.max\(-50, hasP` |
| 108 | match | `meterSource` | `/aria-valuenow=\{boundedCents\}/` |
| 109 | match | `meterSource` | `/aria-valuetext=\{tuningStatusLabel\}[\s\S]{0,120}role="meter"/` |
| 111 | match | `connectSource` | `/guitar-pedalboard:mobile-audio-notice-dismissed/` |
| 112 | match | `connectSource` | `/모바일은 입력 지연이 커서 실시간 연주에 적합하지 않습니다\./` |
| 113 | match | `connectSource` | `/음원 파일 재생 모드로 톤을 확인하거나, PC \+ 오디오 인터페이스 사용을 권장합니다\./` |
| 115 | match | `connectSource` | `/aria-label="모바일 오디오 안내 닫기"/` |
| 117 | match | `pedalCardSource` | `/<article[\s\S]*role="group"[\s\S]*aria-label=\{'\$\{pedal\.name\} 이펙터` |
| 118 | match | `delaySource` | `/ariaValueText=\{delayModeLabels\[params\.mode\]\}/` |
| 119 | match | `delaySource` | `/<div className="delay-led" aria-hidden="true" \/>/` |
| 120 | !match | `delaySource` | `/delay-led[^>]*aria-label/` |
| 121 | match | `noiseGateSource` | `/noise-gate-led[^>]*aria-hidden="true"/` |
| 122 | !match | `noiseGateSource` | `/noise-gate-led[^>]*aria-label/` |
| 123 | match | `fuzzSource` | `/ariaValueText=\{fuzzModeLabels\[params\.mode\]\}/` |
| 124 | match | `presetSource` | `/<ul className="preset-library-list" aria-label="프리셋 라이브러리">/` |
| 125 | match | `presetSource` | `/<li key=\{library\.id\}>/` |
| 126 | match | `presetSource` | `/<ul className="preset-list" aria-label="프리셋 목록">/` |
| 127 | match | `presetSource` | `/<li className=\{'preset-item/` |
| 128 | !match | `presetSource` | `/role="list"/` |
| 137 | match | `namedGenericTag` | `/\brole=/, '${componentFile}: 이름 있는 generic 요소에 유효한 role이 필요합니다.'` |
| 148 | match | `inputTag` | `/aria-label=/, '${componentFile}: range aria-label 누락'` |
| 149 | match | `inputTag` | `/aria-valuetext=/, '${componentFile}: range aria-valuetext 누락'` |
| 157 | match | `indexSource` | `/viewport-fit=cover/` |
| 158 | match | `responsiveCss` | `/@media \(min-width: 768px\) and \(max-width: 1279px\)/` |
| 159 | match | `pedalsCss` | `/grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 300px\), ` |
| 160 | match | `appShellSource` | `/useState\(false\)/` |
| 161 | match | `appShellSource` | `/aria-expanded=\{mobileDockOpen\}/` |
| 162 | match | `responsiveCss` | `/\.mobile-control-panels\[hidden\]/` |
| 163 | match | `responsiveCss` | `/@media \(max-width: 767px\)/` |
| 164 | match | `responsiveCss` | `/grid-auto-flow: column/` |
| 165 | match | `responsiveCss` | `/scroll-snap-type: x mandatory/` |
| 166 | match | `responsiveCss` | `/scroll-snap-align: start/` |
| 167 | match | `responsiveCss` | `/position: fixed[\s\S]*bottom: 0[\s\S]*\.mobile-bottom-tabs/` |
| 168 | match | `responsiveCss` | `/env\(safe-area-inset-bottom\)/` |
| 169 | match | `responsiveCss` | `/min-height: 44px/` |
| 170 | match | `responsiveCss` | `/\.chain-toast[\s\S]*bottom: calc\(82px \+ env\(safe-area-inset-bottom` |
| 171 | match | `responsiveCss` | `/\.app-shell[\s\S]*overflow-x: clip/` |
| 172 | match | `responsiveCss` | `/\.workspace[\s\S]*overflow-x: clip/` |
| 173 | match | `responsiveCss` | `/\.board-section[\s\S]*overflow-x: clip/` |
| 180 | match | `responsiveCss.slice(hiddenPanelRuleIndex` | `/display: none !important/,` |
| 184 | match | `responsiveCss` | `/@media \(prefers-reduced-motion: reduce\)/` |
| 185 | match | `responsiveCss` | `/\.sortable-pedal[\s\S]*\.stomp-toggle-led[\s\S]*\[class\$="-led"\]/` |
| 186 | match | `responsiveCss` | `/animation: none !important/` |
| 187 | match | `responsiveCss` | `/transition: none !important/` |
| 188 | match | `controlsCss` | `/:where\(button, a\[href\], input, select, textarea, \[tabindex\]\):fo` |
| 189 | match | `controlsCss` | `/\.toggle-switch:focus-within \.switch-track/` |
| 190 | match | `controlsCss` | `/\.effect-status\.state-closed\s*\{\s*color: var\(--danger\` |
| 191 | match | `layoutCss` | `/\.preset-library-list > li\s*\{\s*display: contents;/` |
| 192 | match | `layoutCss` | `/\.section-heading\s*\{[\s\S]{0,140}flex-direction: column;/` |
| 193 | match | `layoutCss` | `/\.header-tools\s*\{[\s\S]{0,180}width: 100%;/` |
| 194 | match | `layoutCss` | `/\.header-tools \.connect-panel \.audio-file-upload\s*\{[\s\S]{0,180}g` |
| 198 | match | `layoutCss` | `/\.signal-chain-hop\s*\{\s*flex: 0 0 auto;/` |
| 199 | match | `layoutCss` | `/\.chain-effect-pill\s*\{\s*flex: 0 0 auto;/` |
| 200 | match | `panelsCss` | `/\.mobile-audio-notice/` |
| 201 | match | `panelsCss` | `/\.tuner-status-text/` |
| 202 | match | `panelsCss` | `/\.primary-button\s*\{\s*background: #2f72cb;/` |
| 203 | match | `panelsCss` | `/\.primary-button:hover:not\(:disabled\)\s*\{\s*background: #2869bd;/` |
| 204 | match | `pedalsCss` | `/\.compressor-brand-panel\s*\{[\s\S]{0,180}background: #0878bf;/` |

### shortcuts-regression.mjs

| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |
|---:|---|---|---|
| 77 | match | `globalSource` | `/capture: true/` |
| 78 | match | `globalSource` | `/tagName === 'input'[\s\S]*tagName === 'select'[\s\S]*tagName === 'tex` |
| 79 | match | `globalSource` | `/tagName === 'button'/` |
| 80 | match | `globalSource` | `/tagName === 'a'[\s\S]*hasAttribute\('href'\)/` |
| 81 | match | `globalSource` | `/contenteditable/` |
| 82 | match | `globalSource` | `/\[role="button"\]/` |
| 83 | match | `globalSource` | `/\[tabindex\]:not/` |
| 90 | match | `globalSource` | `/const pedal = pedalStore\.pedals\[command\.index\]/` |
| 91 | match | `globalSource` | `/command\.index < 0 \\|\\| command\.index > 14/` |
| 92 | match | `globalSource` | `/if \(audioState\.isLoading\) return true/` |
| 93 | match | `globalSource` | `/audioState\.isRunning[\s\S]*audioState\.stop\(\)[\s\S]*audioState\.st` |
| 94 | match | `globalSource` | `/tapTempoTap\(\)/` |
| 95 | match | `globalSource` | `/activateSlot\(command\.slot\)/` |
| 96 | match | `globalSource` | `/getState\(\)\.panic\(\)/` |
| 101 | match | `globalSource.slice(modalBranch, globalEx` | `/command\?\.type === 'panic'[\s\S]*closeHelp\(\)[\s\S]*return/,` |
| 106 | match | `routingSource` | `/event\.repeat/` |
| 107 | match | `routingSource` | `/event\.ctrlKey \\|\\| event\.metaKey \\|\\| event\.altKey/` |
| 108 | match | `routingSource` | `/event\.shiftKey && !isHelpKey/` |
| 109 | match | `routingSource` | `/Digit0/` |
| 111 | match | `helpSource` | `/role="dialog"/` |
| 112 | match | `helpSource` | `/aria-modal="true"/` |
| 113 | match | `helpSource` | `/aria-labelledby="shortcut-help-title"/` |
| 114 | match | `helpSource` | `/closeButtonRef\.current\?\.focus\(\)/` |
| 115 | match | `helpSource` | `/previousFocus\?\.isConnected[\s\S]*previousFocus\.focus\(\)/` |
| 116 | match | `helpSource` | `/event\.key !== 'Tab'/` |
| 117 | match | `helpSource` | `/event\.shiftKey[\s\S]*firstElement[\s\S]*lastElement/` |
| 118 | match | `helpSource` | `/querySelectorAll<HTMLElement>\(FOCUSABLE_SELECTOR\)/` |
| 119 | match | `helpSource` | `/onKeyDown=\{handleKeyDown\}/` |
| 123 | match | `cssSource` | `/\.shortcut-help-backdrop/` |
| 124 | match | `cssSource` | `/\.shortcut-help-dialog:focus-visible/` |
| 125 | match | `cssSource` | `/@media \(prefers-reduced-motion: reduce\)/` |

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
| 13 | match | `effectSource` | `/export const TREMOLO_LFO_BANK_SIZE = TREMOLO_SHAPES\.length;/` |
| 14 | match | `effectSource` | `/export const TREMOLO_SQUARE_SLEW_SECONDS = 0\.001;/` |
| 15 | match | `effectSource` | `/type: 'lowpass'/` |
| 16 | match | `effectSource` | `/frequency: TREMOLO_SQUARE_SLEW_FREQUENCY/` |
| 17 | match | `effectSource` | `/oscillator\.connect\(slewFilter\` |
| 18 | match | `effectSource` | `/slewFilter\.connect\(modulationGain\` |
| 19 | match | `effectSource` | `/modulationGain\.connect\(this\.amplitude\.gain\` |
| 20 | !match | `effectSource` | `/\.value\s*=/, 'AudioParam 직접 대입이 있습니다.'` |
| 26 | !match | `updateSource` | `/new\s+(?:Gain\|Delay\|Oscillator\|StereoPanner\|BiquadFilter)Node/, '` |
| 31 | match | `updateSource` | `/smoothParam\(this\.amplitude\.gain/` |
| 32 | match | `updateSource` | `/smoothParam\(bank\.oscillator\.frequency/` |
| 33 | match | `updateSource` | `/smoothParam\([\s\S]*bank\.modulationGain\.gain/` |
| 34 | match | `effectSource` | `/const lfoStartTime = context\.currentTime;/` |
| 35 | match | `effectSource` | `/oscillator\.start\(lfoStartTime\` |
| 36 | match | `effectSource` | `/bank\.oscillator\.stop\(\` |
| 37 | match | `effectSource` | `/if \(this\.disposed\) return;/` |
