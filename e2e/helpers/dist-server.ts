// `dist/` 를 `/Guitar-Pedalboard/` 아래에서 서비스하는 작은 서버 — 서비스 워커 교체 시험용(S2.4).
// `vite preview` 는 시험 도중에 sw.js 를 바꿔 끼울 수 없다. 서비스 워커는 출처(포트)마다 따로 등록되므로 시험마다 새 서버·새 포트를 쓴다.
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
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

/** 서버가 내려 준 응답 한 건(첫 방문 전송량 시험용, S4.1) */
export interface ServedRequest {
  /** base 경로를 뺀 파일 경로(`index.html`, `assets/index-….js`, `logo-520.webp` …) */
  path: string;
  /** 회선으로 나간 본문 크기(압축했으면 압축 뒤) */
  bytes: number;
  /** 압축 전 파일 크기 */
  rawBytes: number;
}

export interface DistServerOptions {
  /** true 면 글자 파일(html·js·css·svg·json)을 gzip 으로 내려 준다. GitHub Pages 가 그렇게 내려 주므로 배포와 같은 전송량을 잰다. 기본 false */
  gzip?: boolean;
  /** 서비스할 폴더. 기본은 이 저장소의 `dist/`. 옛 코드와 비교할 때만 바꾼다(E2E_DIST_DIR) */
  distDir?: string;
}

const COMPRESSIBLE = new Set(['html', 'js', 'css', 'json', 'svg', 'webmanifest', 'map']);

export interface DistServer {
  /** `http://127.0.0.1:<포트>/Guitar-Pedalboard/` */
  url: string;
  /** 지금까지 내려 준 응답(페이지와 서비스 워커의 요청 모두). 먼저 온 것부터 */
  requests: ServedRequest[];
  /**
   * 이제부터 sw.js 를 바이트가 다른 새 서비스 워커로 내려 준다(맨 끝에 주석 한 줄을 덧붙인다).
   * 앱 파일은 그대로이고 서비스 워커 스크립트만 달라지므로, 브라우저에게는 '새 버전이 배포된' 것과 같다.
   */
  publishNewServiceWorker(): void;
  close(): Promise<void>;
}

export async function startDistServer(options: DistServerOptions = {}): Promise<DistServer> {
  const distDir = options.distDir ?? join(repoRoot, 'dist');
  const requests: ServedRequest[] = [];
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
    const extension = relativePath.includes('.') ? relativePath.slice(relativePath.lastIndexOf('.') + 1).toLowerCase() : '';
    let body: Uint8Array;
    if (relativePath === 'sw.js') {
      const script = readFileSync(file, 'utf8');
      body = new TextEncoder().encode(serviceWorkerVariant === 0 ? script : `${script}\n// e2e: 새 서비스 워커 #${serviceWorkerVariant}\n`);
    } else {
      body = readFileSync(file);
    }
    const rawBytes = body.length;
    if (options.gzip === true && COMPRESSIBLE.has(extension)) {
      body = gzipSync(body, { level: 6 });
      response.setHeader('Content-Encoding', 'gzip');
    }
    response.setHeader('Content-Length', String(body.length));
    requests.push({ path: relativePath, bytes: body.length, rawBytes });
    response.end(body);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('서버 주소를 알 수 없다.');

  return {
    url: `http://127.0.0.1:${address.port}${BASE_PATH}`,
    requests,
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
