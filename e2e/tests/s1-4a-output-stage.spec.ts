// S1.4a 출력 단계(마스터 리미터) + S1.5 출력 가드·레벨 미터. 소리 레벨만으로는 알 수 없는 연결 모양을 실제 브라우저에서 확인한다.
//   마스터 게인 → 출력 가드(입력 0) → 리미터 → 출력 레벨 미터 → [스피커, 파형 분석, 녹음]
//   입력 트림(inputGain) → 출력 가드(입력 1, 하울링 분석 전용. 마이크 입력일 때만)
// 스피커로 나가는 소리·화면의 출력 미터·녹음 파일이 모두 같은 지점(리미터 뒤)에서 갈라져야 같은 피크 제한을 지난다.
// 리미터의 소리 자체(천장 −1 dBFS)는 오디오 렌더 프로브 P-03 이, 오프라인에서도 불러와지는지는 E-23 이 본다.
// 가드가 실제로 하울링을 잘라내는 시간(1.5초 이내)은 E-03(e03-howl.spec.ts)이 본다.
import { connectGuitar, disconnectButton, openApp, openAudioInputMenu } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { readAudioEdges, trackAudioGraph, type GraphEdge } from '../helpers/mocks';

const LIMITER = 'worklet:limiter-processor';
const GUARD = 'worklet:output-guard';
/** 입력용(소스 바로 뒤)과 출력용(리미터 바로 뒤) 레벨 미터는 같은 처리기 이름을 쓴다. 어느 쪽인지는 이어진 상대로 가려낸다. */
const METER = 'worklet:level-meter';

/** `to` 로 들어오는 연결의 출발 노드 이름들(중복 제거). `input` 을 주면 그 입력 번호로 들어오는 연결만 본다. */
function sourcesInto(edges: GraphEdge[], to: string, input?: number): string[] {
  return [...new Set(edges.filter((edge) => edge.to === to && (input === undefined || edge.input === input)).map((edge) => edge.from))];
}

/** `from` 에서 나가는 연결의 도착 노드 이름들(중복 제거) */
function destinationsFrom(edges: GraphEdge[], from: string): string[] {
  return [...new Set(edges.filter((edge) => edge.from === from).map((edge) => edge.to))];
}

test.describe('S1.4a·S1.5 출력 단계', () => {
  test('스피커·미터·녹음이 모두 리미터 뒤의 출력 레벨 미터에서 갈라진다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic();
    await trackAudioGraph(page);
    await openApp(page);
    await openAudioInputMenu(page);
    await connectGuitar(page);

    let edges = await readAudioEdges(page);
    // 가드: 입력 0 은 마스터 게인(프로그램), 입력 1 은 입력 트림(분석 전용, 마이크일 때만).
    expect(sourcesInto(edges, GUARD, 0), '마스터 게인(GainNode)이 가드의 프로그램 입력(0)으로 들어간다').toEqual(['GainNode']);
    expect(sourcesInto(edges, GUARD, 1), '입력 트림(GainNode)이 가드의 분석 전용 입력(1)으로 들어간다').toEqual(['GainNode']);
    expect(edges.filter((edge) => edge.to === GUARD).length, '가드로 들어오는 연결은 프로그램 입력과 분석 입력, 딱 둘이다').toBe(2);
    // 리미터: 가드의 출력만 받고, 그 출력은 출력 레벨 미터로만 간다.
    expect(sourcesInto(edges, LIMITER), '리미터는 가드의 출력만 받는다').toEqual([GUARD]);
    expect(destinationsFrom(edges, LIMITER), '리미터 출력은 출력 레벨 미터로만 간다').toEqual([METER]);
    expect([...sourcesInto(edges, METER)].sort(), '레벨 미터는 둘이다: 입력용(마이크 소스 뒤)과 출력용(리미터 뒤)').toEqual(
      [LIMITER, 'MediaStreamAudioSourceNode'].sort(),
    );
    // 스피커와 화면의 파형 분석은 같은 출력 레벨 미터에서 나온다. 리미터나 가드에서 곧바로 나가지 않는다.
    expect(sourcesInto(edges, 'AudioDestinationNode'), '스피커는 출력 레벨 미터의 출력만 받는다').toEqual([METER]);
    expect(edges.filter((edge) => edge.from === METER && edge.to === 'AnalyserNode').length, '출력 미터도 출력 레벨 미터의 출력을 받는다').toBeGreaterThan(0);
    expect(sourcesInto(edges, 'MediaStreamAudioDestinationNode'), '녹음을 시작하기 전에는 녹음 단자가 없다').toEqual([]);

    // 녹음을 시작하면 녹음 단자가 생기고, 그것도 같은 출력 레벨 미터를 받는다.
    await page.locator('.recording-start-button').click();
    await expect(page.locator('.recording-stop-button')).toBeEnabled();
    edges = await readAudioEdges(page);
    expect(sourcesInto(edges, 'MediaStreamAudioDestinationNode'), '녹음 파일도 리미터를 지난 같은 소리다').toEqual([METER]);

    await page.locator('.recording-stop-button').click();
    await expect(page.locator('.recording-stop-button')).toBeDisabled();
    await disconnectButton(page).click();
  });

  test('다시 연결해도 새 연결마다 같은 모양이다(옛 그래프가 남지 않음)', async ({ launchWithMic }) => {
    const { page } = await launchWithMic();
    await trackAudioGraph(page);
    await openApp(page);
    await openAudioInputMenu(page);
    await connectGuitar(page);
    await disconnectButton(page).click();
    await expect(page.getByRole('button', { name: '기타 연결하기' })).toBeVisible();
    await connectGuitar(page);

    const edges = await readAudioEdges(page);
    // 두 번 연결했으므로 스피커로 가는 연결은 출력 레벨 미터에서만, 두 개(연결마다 하나)다.
    const speaker = edges.filter((edge) => edge.to === 'AudioDestinationNode');
    expect(speaker.map((edge) => edge.from)).toEqual([METER, METER]);
    // 가드도 연결마다 하나씩 새로 만들어져 프로그램 입력(0)과 분석 입력(1)을 각각 두 번씩 받는다.
    expect(edges.filter((edge) => edge.to === GUARD && edge.input === 0).length).toBe(2);
    expect(edges.filter((edge) => edge.to === GUARD && edge.input === 1).length).toBe(2);
    await disconnectButton(page).click();
  });
});
