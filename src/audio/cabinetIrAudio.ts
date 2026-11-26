import type { CabinetIrAudio } from './cabinetIrLibrary';
import { channelsOf, type CabinetIrChannels } from './utils/cabinetIr';

/**
 * 브라우저의 Web Audio 로 IR 을 디코딩·리샘플한다(설계서 S5.4).
 * 디코딩은 오디오를 시작하지 않아도 되도록 OfflineAudioContext 로 한다. decodeAudioData 는 결과를 그 컨텍스트의
 * 샘플레이트로 맞춰 주므로, 실제 컨텍스트가 있으면 같은 샘플레이트를 넘겨 리샘플이 필요 없게 한다.
 */
export function createBrowserCabinetIrAudio(): CabinetIrAudio {
  return {
    async decode(bytes, sampleRate) {
      const offline = new OfflineAudioContext(1, 1, sampleRate);
      return channelsOf(await offline.decodeAudioData(bytes));
    },

    async resample(source, targetRate): Promise<CabinetIrChannels> {
      const length = source.channels[0]?.length ?? 0;
      const frames = Math.max(1, Math.round((length * targetRate) / source.sampleRate));
      const offline = new OfflineAudioContext(source.channels.length, frames, targetRate);
      const input = new AudioBuffer({ length, numberOfChannels: source.channels.length, sampleRate: source.sampleRate });
      source.channels.forEach((channel, index) => input.copyToChannel(channel as Float32Array<ArrayBuffer>, index));
      const node = offline.createBufferSource();
      node.buffer = input;
      node.connect(offline.destination);
      node.start();
      return channelsOf(await offline.startRendering());
    },

    createBuffer(source) {
      const length = source.channels[0]?.length ?? 0;
      const buffer = new AudioBuffer({ length, numberOfChannels: source.channels.length, sampleRate: source.sampleRate });
      source.channels.forEach((channel, index) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, index));
      return buffer;
    },
  };
}
