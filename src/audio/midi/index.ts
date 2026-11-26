// MIDI 모듈의 입구. 해석·매핑(mapping)은 화면·저장소·브라우저를 모르는 순수 함수이고,
// 연결(MidiService)과 메시지 처리(MidiRouter)는 각자 한 가지 일만 한다(S2.9, 설계서 4.11).
export * from './mapping';
export * from './MidiRouter';
export * from './MidiService';
