// Node 테스트가 esbuild 로 앱 코드를 묶을 때 쓰는 공용 플러그인.
// 앱 코드의 `import url from './x.worklet.ts?worker&url'`(설계서 4.1절 규칙 6)은 Vite 만 풀 수 있다.
// 테스트는 오디오를 실제로 돌리지 않으므로 그 주소를 흉내 낸 문자열로 바꿔 준다(실제 파일 내용은 각 테스트가 따로 읽는다).
import { basename } from 'node:path';

export const workerUrlStub = {
  name: 'worker-url-stub',
  setup(build) {
    build.onResolve({ filter: /\?worker&url$/ }, (args) => ({ path: args.path, namespace: 'worker-url-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'worker-url-stub' }, (args) => {
      const file = basename(args.path.replace(/\?.*$/, '')).replace(/\.ts$/, '.js');
      return { contents: `export default ${JSON.stringify(`/assets/${file}`)};`, loader: 'js' };
    });
  },
};
