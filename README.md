# Present

![npm version](https://img.shields.io/npm/v/@present/markdown-presentation.svg)
![license](https://img.shields.io/npm/l/@present/markdown-presentation.svg)

마크다운 파일을 아름다운 애니메이션 프레젠테이션으로 변환하는 강력한 도구입니다. CLI와 웹 기반 편집기를 모두 지원하여 프레젠테이션 제작을 위한 완전한 솔루션을 제공합니다.

## ✨ 주요 기능

### 🎬 애니메이션 효과
- **제목 슬라이드**: 스크롤 시 제목이 아래에서 위로 부드럽게 나타남
- **단어별 텍스트 애니메이션**: 텍스트가 단어 단위로 순차적으로 나타남
- **하이라이트 효과**: 강조 텍스트(`**bold**`)에 노란색 형광펜 애니메이션
- **TOC 네비게이션**: 클릭 시 부드러운 스크롤 및 플래시 하이라이트

### 📱 인터랙티브 기능
- **목차(TOC)**: 좌측 사이드바, 토글 가능
- **레이저 포인터**: 'L' 키 또는 버튼으로 활성화, 마우스 트레일 효과
- **실시간 편집**: 웹 기반 마크다운 에디터
- **라이브 리로드**: 파일 변경 시 자동 새로고침

### 📄 내보내기 옵션
- **HTML**: 인터랙티브 웹 프레젠테이션
- **PDF**: 인쇄용 정적 문서 (애니메이션 비활성화)
- **다운로드**: 웹에서 직접 HTML/PDF 내보내기

### 🌐 두 가지 모드
- **CLI 모드**: 단일 파일 변환용
- **웹 서버 모드**: 다중 파일 관리 및 실시간 편집

## 🚀 설치

### npm으로 전역 설치 (권장)
```bash
npm install -g @present/markdown-presentation
```

### 또는 로컬 설치
```bash
git clone https://github.com/kangthink/present.git
cd present
npm install
```

## 📖 사용법

### CLI 모드

#### HTML 생성
```bash
present --md presentation.md --output slides.html
```

#### PDF 생성 (HTML 파일 없이 PDF만)
```bash
present --md presentation.md --pdf --output slides.pdf
```

#### 커스텀 템플릿 사용
```bash
present --md presentation.md --template custom.html --output slides.html
```

### 웹 서버 모드

#### 대시보드 실행
```bash
present --web
```

브라우저에서 `http://localhost:8090`을 열면 프레젠테이션 관리 대시보드가 표시됩니다.

#### 다른 포트 사용
```bash
present --web --port 3000
```

### 환경 변수

#### 스토리지 디렉토리 변경
```bash
export PRESENT_STORAGE_DIR=/path/to/presentations
present --web
```

기본값: `~/.preset`

## 🎯 CLI 옵션

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `--md <path>` | 입력 마크다운 파일 경로 | - |
| `--template <path>` | HTML 템플릿 파일 경로 | `template.html` |
| `--output <path>` | 출력 파일 경로 | `output.html` |
| `--pdf` | PDF 형식으로 출력 | false |
| `--web` | 웹 서버 모드 실행 | false |
| `--port <number>` | 웹 서버 포트 | 8090 |

## 🌟 웹 기능

### 대시보드
- 모든 프레젠테이션 파일 목록 보기
- 새 빈 프레젠테이션 생성
- 기존 마크다운 파일 업로드
- 프레젠테이션 미리보기 및 편집

### 프레젠테이션 뷰어
- **홈 버튼**: 대시보드로 돌아가기
- **TOC 토글**: 목차 사이드바 열기/닫기
- **레이저 포인터**: 프레젠테이션용 마우스 트레일
- **편집기**: 실시간 마크다운 편집
- **내보내기**: HTML/PDF 다운로드

### 단축키
- `L`: 레이저 포인터 토글
- `Escape`: 편집기 닫기

## 📝 마크다운 문법

기본 마크다운 문법을 모두 지원하며, 다음과 같은 특별한 효과가 적용됩니다:

```markdown
# 제목 (슬라이드 업 애니메이션)

일반 텍스트는 단어별로 순차 등장합니다.

**강조 텍스트는 형광펜 효과**가 적용됩니다.

## 부제목도 애니메이션 적용

- 리스트 항목
- 각 항목도 애니메이션
```

## 🎨 폰트

기본 폰트:
- **제목**: BMEULJIRO (한글 전용)
- **본문**: ChosunGs (한글 전용)
- **영문**: 시스템 폰트 fallback

## 🔧 개발

### 로컬 개발 서버 실행
```bash
npm run dev
# 또는
node present.js --web
```

### 테스트
```bash
npm test
```

### 빌드
```bash
npm run build
```

## 📁 파일 구조

```
present/
├── present.js          # 메인 실행 파일
├── template.html       # HTML 템플릿
├── package.json        # npm 설정
├── README.md          # 문서
└── .preset/           # 프레젠테이션 파일 저장소 (기본)
```

## 🤝 기여

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 라이선스

MIT License - 자세한 내용은 [LICENSE](LICENSE) 파일을 참고하세요.

## 📞 지원

- 이슈 리포트: [GitHub Issues](https://github.com/kangthink/present/issues)
- 기능 요청: [GitHub Discussions](https://github.com/kangthink/present/discussions)

---

**Present**로 아름다운 마크다운 프레젠테이션을 만들어보세요! 🎉 