# Present

마크다운 파일을 애니메이션이 적용된 아름다운 HTML 또는 PDF 문서로 변환하는 CLI 도구입니다. 실시간 미리보기와 웹 에디터 기능을 지원하여 프레젠테이션 자료를 손쉽게 제작할 수 있습니다.

## Features

-   **마크다운 변환**: 마크다운을 동적인 HTML 또는 PDF 문서로 변환합니다.
-   **다양한 애니메이션**: 스크롤에 따라 제목, 본문, 하이라이트 효과가 순차적으로 나타납니다.
-   **PDF 출력**: 웹페이지와 동일한 스타일의 PDF 파일을 생성할 수 있습니다.
-   **라이브-리로딩 서버**: `--watch` 모드를 통해 파일 변경 시 브라우저가 자동 새로고침됩니다.
-   **웹 에디터**: `--editor` 모드를 통해 브라우저에서 직접 마크다운을 편집하고 저장할 수 있습니다.
-   **인터랙티브 기능**:
    -   클릭으로 열고 닫는 목차 (Table of Contents)
    -   `L`키 또는 아이콘으로 켜고 끄는 레이저 포인터

## 설치

먼저 프로젝트 저장소를 클론하고, 필요한 의존성을 설치합니다.

```bash
npm install
```

`present.js` 파일에 실행 권한을 부여해야 할 수도 있습니다.

```bash
chmod +x present.js
```

## 사용법

### 1. 파일 변환 (HTML/PDF)

마크다운 파일을 HTML 또는 PDF로 한 번만 변환할 때 사용합니다.

-   **HTML 생성**:
    ```bash
    ./present.js --template ./template.html --md ./source.md -o presentation.html
    ```
-   **PDF 생성**:
    ```bash
    ./present.js --template ./template.html --md ./source.md --pdf -o document.pdf
    ```

### 2. 라이브 개발 서버 (`--watch`)

마크다운이나 템플릿 파일을 수정하면서 실시간으로 변경사항을 확인하고 싶을 때 사용합니다.

```bash
./present.js --template ./template.html --md ./source.md --watch
```

서버가 실행되면 터미널에 표시된 주소(기본: `http://localhost:8090`)를 브라우저에서 열어주세요. 이제 파일을 저장할 때마다 브라우저가 자동으로 새로고침됩니다.

### 3. 웹 에디터 모드 (`--editor`)

브라우저에서 직접 마크다운을 편집하고 저장하고 싶을 때 사용합니다. 이 모드는 `--watch` 기능을 포함합니다.

```bash
./present.js --template ./template.html --md ./source.md --editor
```

서버 실행 후, 브라우저 우측 상단의 **연필 아이콘**을 클릭하여 에디터를 열 수 있습니다.

## CLI 옵션

-   `-t, --template <경로>`: (필수) 사용할 HTML 템플릿 파일의 경로.
-   `-m, --md <경로>`: (필수) 변환할 마크다운 파일의 경로.
-   `-o, --output <경로>`: (선택) 출력 파일의 경로 및 이름.
-   `--pdf`: (선택) HTML 대신 PDF 파일을 생성합니다. (`--watch` 모드에서는 동작하지 않음)
-   `--watch`: (선택) 파일 변경을 감지하여 자동 새로고침을 지원하는 개발 서버를 실행합니다.
-   `--editor`: (선택) `--watch` 모드에 더해, 웹 기반 에디터 기능을 활성화합니다.
-   `--port <숫자>`: (선택) 개발 서버의 포트 번호를 지정합니다. (기본: 8090) 