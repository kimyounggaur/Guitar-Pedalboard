// S1.4a 출력 단계(마스터 리미터). 소리 레벨만으로는 알 수 없는 연결 모양을 실제 브라우저에서 확인한다.
//   마스터 게인 → 하울링 가드 → 리미터 → [스피커, 출력 미터, 녹음]
// 스피커로 나가는 소리·화면의 출력 미터·녹음 파일이 모두 같은 리미터 출력을 받아야 같은 피크 제한을 지난다.
// 리미터의 소리 자체(천장 −1 dBFS)는 오디오 렌더 프로브 P-03 이, 오프라인에서도 불러와지는지는 E-23 이 본다.
import { activate, connectGuitar, disconnectButton, openApp } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { readAudioEdges, trackAudioGraph, type GraphEdge } from '../helpers/mocks';

const LIMITER = 'worklet:limiter-processor';
const GUARD = 'worklet:howl-guard';

/** `to` 로 들어오는 연결의 출발 노드 이름들(중복 제거) */
function sourcesInto(edges: GraphEdge[], to: string): string[] {
  return [...new Set(edges.filter((edge) => edge.to === to).map((edge) => edge.from))];
}

test.describe('S1.4a 출력 단계', () => {
  test('스피커·미터·녹음이 모두 리미터 출력에서 갈라진다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic();
    await trackAudioGraph(page);
    await openApp(page);
    await connectGuitar(page);

    let edges = await readAudioEdges(page);
    expect(sourcesInto(edges, GUARD), '마스터 게인(GainNode)이 가드로 들어간다').toContain('GainNode');
    expect(sourcesInto(edges, LIMITER), '리미터는 가드의 출력만 받는다').toEqual([GUARD]);
    expect(sourcesInto(edges, 'AudioDestinationNode'), '스피커는 리미터 출력만 받는다').toEqual([LIMITER]);
    expect(edges.filter((edge) => edge.from === LIMITER && edge.to === 'AnalyserNode').length, '출력 미터도 리미터 출력을 받는다').toBeGreaterThan(0);
    expect(sourcesInto(edges, 'MediaStreamAudioDestinationNode'), '녹음을 시작하기 전에는 녹음 단자가 없다').toEqual([]);

    // 녹음을 시작하면 녹음 단자가 생기고, 그것도 같은 리미터 출력을 받는다.
    await activate(page, page.locator('.recording-start-button'));
    await expect(page.locator('.recording-stop-button')).toBeEnabled();
    edges = await readAudioEdges(page);
    expect(sourcesInto(edges, 'MediaStreamAudioDestinationNode'), '녹음 파일도 리미터를 지난 소리다').toEqual([LIMITER]);

    await activate(page, page.locator('.recording-stop-button'));
    await expect(page.locator('.recording-stop-button')).toBeDisabled();
    await activate(page, disconnectButton(page));
  });

  test('다시 연결해도 새 연결마다 같은 모양이다(옛 리미터가 남지 않음)', async ({ launchWithMic }) => {
    const { page } = await launchWithMic();
    await trackAudioGraph(page);
    await openApp(page);
    await connectGuitar(page);
    await activate(page, disconnectButton(page));
    await expect(page.getByRole('button', { name: '기타 연결하기' })).toBeVisible();
    await connectGuitar(page);

    const edges = await readAudioEdges(page);
    // 두 번 연결했으므로 스피커로 가는 연결은 리미터에서만, 두 개(연결마다 하나)다.
    const speaker = edges.filter((edge) => edge.to === 'AudioDestinationNode');
    expect(speaker.map((edge) => edge.from)).toEqual([LIMITER, LIMITER]);
    await activate(page, disconnectButton(page));
  });
});
