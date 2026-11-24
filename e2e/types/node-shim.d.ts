// e2e 프로젝트가 쓰는 Node 기능만 최소로 선언한다.
// @types/node 를 넣으면 앱(src) 타입 검사의 setTimeout 반환형이 NodeJS.Timeout 으로 바뀌어
// AutoWahEffect.ts 가 깨지고, 앱 코드·설정은 이 Step 의 대상이 아니므로 필요한 만큼만 직접 선언했다(L-11).
// @types/node 가 들어오면 아래 선언이 겹쳐 오류가 나므로 이 파일을 지우면 된다.
declare module 'node:fs' {
  export function copyFileSync(source: string, destination: string): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readFileSync(path: string): Uint8Array;
  export function readdirSync(path: string): string[];
  export function writeFileSync(path: string, data: string): void;
}
declare module 'node:path' {
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
declare module 'node:http' {
  export interface IncomingMessage {
    url?: string;
  }
  export interface ServerResponse {
    statusCode: number;
    setHeader(name: string, value: string | number): void;
    end(data?: string | Uint8Array): void;
  }
  export interface Server {
    listen(port: number, host: string, callback?: () => void): Server;
    address(): { port: number } | string | null;
    close(callback?: (error?: Error) => void): Server;
    closeAllConnections(): void;
  }
  export function createServer(handler: (request: IncomingMessage, response: ServerResponse) => void): Server;
}
declare module 'node:child_process' {
  export function spawnSync(
    command: string,
    args: string[],
    options?: { cwd?: string; stdio?: 'inherit' | 'pipe' },
  ): { status: number | null; error?: Error };
}
declare const process: {
  env: Record<string, string | undefined>;
  execPath: string;
  cwd(): string;
};
