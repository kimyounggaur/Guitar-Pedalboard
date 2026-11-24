import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'dist-probe/**', 'assets/**', 'Source/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // 브라우저 저장소는 SafeStorage 하나로만 쓴다(S1.7, 보고서 R2-1). 직접 쓰면 사이트 데이터 차단·저장 공간 가득 참에서
    // 던져진 예외가 화면을 깨뜨린다. e2e·scripts 는 브라우저 밖에서 저장소를 시험하므로 이 규칙의 대상이 아니다.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message: 'localStorage 를 직접 쓰지 마세요. src/persistence 의 safeStorage 를 쓰세요(S1.7).',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'localStorage',
          message: 'window.localStorage 를 직접 쓰지 마세요. src/persistence 의 safeStorage 를 쓰세요(S1.7).',
        },
        {
          object: 'globalThis',
          property: 'localStorage',
          message: 'globalThis.localStorage 를 직접 쓰지 마세요. src/persistence 의 safeStorage 를 쓰세요(S1.7).',
        },
        {
          object: 'self',
          property: 'localStorage',
          message: 'self.localStorage 를 직접 쓰지 마세요. src/persistence 의 safeStorage 를 쓰세요(S1.7).',
        },
      ],
    },
  },
  {
    // 유일한 예외: localStorage 에 닿는 곳.
    files: ['src/persistence/SafeStorage.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
    },
  },
);
