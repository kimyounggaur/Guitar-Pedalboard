// `dist/` 를 `/Guitar-Pedalboard/` 아래에서 서비스하는 작은 서버 — 서비스 워커 교체 시험용(S2.4).
// `vite preview` 는 시험 도중에 sw.js 를 바꿔 끼울 수 없다. 서비스 워커는 출처(포트)마다 따로 등록되므로 시험마다 새 서버·새 포트를 쓴다.
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { BASE_PATH, repoRoot } from './env';

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  map: 'application/json',
  webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml',
  png: 'image/png',
  webp: 'image/webp',
  ico: 'image/x-icon',
};

function contentTypeOf(relativePath: string): string {
  const dot = relativePath.lastIndexOf('.');
  const extension = dot >= 0 ? relativePath.slice(dot + 1).toLowerCase() : '';
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

export interface DistServer {
  /** `http://127.0.0.1:<포트>/Guitar-Pedalboard/` */
  url: string;
  /**
   * 이제부터 sw.js 를 바이트가 다른 새 서비스 워커로 내려 준다(맨 끝에 주석 한 줄을 덧붙인다).
   * 앱 파일은 그대로이고 서비스 워커 스크립트만 달라지므로, 브라우저에게는 '새 버전이 배포된' 것과 같다.
   */
  publishNewServiceWorker(): void;
  close(): Promise<void>;
}

export async function startDistServer(): Promise<DistServer> {
  const distDir = join(repoRoot, 'dist');
  if (!existsSync(join(distDir, 'sw.js'))) throw new Error('dist/sw.js 가 없다. 먼저 npm run build 를 해야 한다.');
  let serviceWorkerVariant = 0;

  const server = createServer((request, response) => {
    const pathname = decodeURIComponent((request.url ?? '/').split('?')[0]);
    if (!pathname.startsWith(BASE_PATH) || pathname.includes('..')) {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    let relativePath = pathname.slice(BASE_PATH.length);
    if (relativePath === '' || relativePath.endsWith('/')) relativePath += 'index.html';
    const file = join(distDir, relativePath);
    if (!existsSync(file)) {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    response.setHeader('Content-Type', contentTypeOf(relativePath));
    response.setHeader('Cache-Control', 'no-cache');
    if (relativePath === 'sw.js') {
      const script = readFileSync(file, 'utf8');
      response.end(serviceWorkerVariant === 0 ? script : `${script}\n// e2e: 새 서비스 워커 #${serviceWorkerVariant}\n`);
      return;
    }
    response.end(readFileSync(file));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('서버 주소를 알 수 없다.');

  return {
    url: `http://127.0.0.1:${address.port}${BASE_PATH}`,
    publishNewServiceWorker() {
      serviceWorkerVariant += 1;
    },
    close() {
      return new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    },
  };
}
