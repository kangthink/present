#!/usr/bin/env node

require('dotenv').config();
const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');
const mdAnchor = require('markdown-it-anchor');
const mdTable = require('markdown-it-multimd-table');
const puppeteer = require('puppeteer');
const slug = require('slug');
const chokidar = require('chokidar');
const express = require('express');
const WebSocket = require('ws');
const multer = require('multer');
const os = require('os');
const OpenAI = require('openai');
const crypto = require('crypto');

const PRESET_DIR = process.env.PRESENT_STORAGE_DIR || path.join(os.homedir(), '.preset');
const LOCK_METADATA_FILE = path.join(PRESET_DIR, 'file_locks.json');

// 세션별 임시 접근 권한 저장 (메모리)
const temporaryAccess = new Map(); // sessionId -> Set(filenames)

// OpenAI 설정
const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
}) : null;

// package.json에서 버전 읽기
const packageJson = require('./package.json');

program
  .version(packageJson.version)
  .description('A markdown presentation tool with web and CLI modes.')
  .option('--md <path>', 'Path to the input markdown file (CLI mode)')
  .option('--template <path>', 'Path to the HTML template file (CLI mode)', 'template.html')
  .option('--output <path>', 'Path for the output HTML file (CLI mode)', 'output.html')
  .option('--pdf', 'Generate a PDF file from the output (CLI mode)')
  .option('--web', 'Run in web server mode')
  .option('--port <number>', 'Port for the web server', '8090')
  .parse(process.argv);

const options = program.opts();

// --- Helper Functions ---

function createMarkdownParser() {
  const toc = [];
  const md = new MarkdownIt({ html: true })
    .use(mdAnchor, {
      slugify: s => slug(s, { lower: true }),
      callback: (token, { slug, title }) => {
        if (token.tag === 'h1' || token.tag === 'h2' || token.tag === 'h3') {
          toc.push({ level: parseInt(token.tag.substring(1)), slug: slug, title: title });
        }
      }
    })
    .use(mdTable, {
      multiline: true,
      rowspan: true,
      headerless: true,
      multibody: true
    });
  return { md, toc };
}

function generateTocHtml(toc) {
  let html = '<ul>';
  toc.forEach(item => {
    html += `<li class="toc-level-${item.level}"><a href="#${item.slug}">${item.title}</a></li>`;
  });
  html += '</ul>';
  return html;
}

// --- CLI Mode ---

async function runCli(options) {
  const { md: mdPath, template: templatePath, output: outputPath, pdf: createPdf } = options;

  if (!fs.existsSync(mdPath)) {
    console.error(`Error: Markdown file not found at ${mdPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(templatePath)) {
    console.error(`Error: Template file not found at ${templatePath}`);
    process.exit(1);
  }

  const markdownContent = fs.readFileSync(mdPath, 'utf8');
  const templateContent = fs.readFileSync(templatePath, 'utf8');
  
  const { md, toc } = createMarkdownParser();
  const contentHtml = md.render(markdownContent);
  const tocHtml = generateTocHtml(toc);

  const bodyClass = createPdf ? 'export-mode pdf-export-mode' : 'export-mode';
  let finalHtml = templateContent
    .replace('{{TOC_HTML}}', tocHtml)
    .replace('{{CONTENT}}', contentHtml)
    .replace('<body>', `<body class="${bodyClass}">`) // Use export styles
    .replace(
        '</body>',
        '<script>window.IS_EXPORTED=true;</script></body>'
    );

  if (createPdf) {
    // PDF 모드에서는 HTML 파일을 저장하지 않고 직접 PDF 생성
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    
    // HTML 콘텐츠를 직접 설정 (파일 저장 없이)
    await page.setContent(finalHtml, { waitUntil: 'networkidle0' });
    
    // 애니메이션 완료 대기
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const pdfOutputPath = outputPath.replace(/\.html$/, '.pdf');
    await page.pdf({ path: pdfOutputPath, format: 'A4', printBackground: false });
    await browser.close();
    console.log(`Successfully generated PDF file at: ${pdfOutputPath}`);
  } else {
    // HTML 모드에서만 HTML 파일 저장
    fs.writeFileSync(outputPath, finalHtml, 'utf8');
    console.log(`Successfully generated HTML file at: ${outputPath}`);
  }
}

// --- Web Server Mode ---

function serveApp(options) {
  // Ensure .preset directory exists for web mode
  if (!fs.existsSync(PRESET_DIR)) {
    fs.mkdirSync(PRESET_DIR);
  }

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, PRESET_DIR),
    filename: (req, file, cb) => cb(null, file.originalname)
  });
  const upload = multer({ storage: storage });

  const port = parseInt(options.port, 10);
  const app = express();
  app.use(express.json());
  app.use(express.static(__dirname));
  
  // 세션 관리를 위한 간단한 세션 ID 생성
  function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
  }
  
  // 쿠키 파서 미들웨어
  app.use((req, res, next) => {
    req.cookies = {};
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      cookieHeader.split(';').forEach(cookie => {
        const [name, value] = cookie.trim().split('=');
        req.cookies[name] = value;
      });
    }
    next();
  });
  
  // 세션 ID 미들웨어
  app.use((req, res, next) => {
    if (!req.cookies.sessionId) {
      req.sessionId = generateSessionId();
      res.setHeader('Set-Cookie', `sessionId=${req.sessionId}; HttpOnly; Path=/; Max-Age=86400`);
    } else {
      req.sessionId = req.cookies.sessionId;
    }
    next();
  }); 
  // 마크다운 파일 직접 접근 제한 미들웨어
  app.use('/storage', (req, res, next) => {
    if (req.path.endsWith('.md')) {
      return res.status(403).json({ 
        error: 'Direct access to markdown files is not allowed. Use /api/get-file endpoint instead.' 
      });
    }
    next();
  });
  
  app.use('/storage', express.static(PRESET_DIR)); 

  app.get('/', (req, res) => {
    const files = fs.readdirSync(PRESET_DIR).filter(file => file.endsWith('.md'));
    const lockMetadata = loadFileLockMetadata();
    
    let fileList = files.map(file => {
      const isLocked = lockMetadata[file] && lockMetadata[file].isLocked;
      const lockIcon = isLocked ? '<span style="color: #ff6b35; margin-left: 8px;">🔒</span>' : '';
      const lockClass = isLocked ? 'locked-file' : '';
      
      return `<li class="${lockClass}">
        <a href="/view?file=${file}">${file}</a>${lockIcon}
        ${isLocked ? '<span style="color: #666; font-size: 12px; margin-left: 8px;">(잠김)</span>' : ''}
      </li>`;
    }).join('');
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Presentations</title>
        <style>
          body { font-family: sans-serif; padding: 2em; } 
          .container { max-width: 800px; margin: auto; }
          ul { list-style: none; padding: 0; } 
          li { padding: 0.8em; border-bottom: 1px solid #eee; display: flex; align-items: center; }
          li.locked-file { background-color: #fff8f0; border-left: 3px solid #ff6b35; }
          a { text-decoration: none; color: #0366d6; flex-grow: 1; }
          a:hover { text-decoration: underline; }
          .actions { margin-top: 2em; display: flex; gap: 1em; }
          .actions form { display: flex; gap: 0.5em; }
          .actions input[type="file"], .actions input[type="text"] { padding: 0.3em; }
          .actions button { padding: 0.3em 0.8em; background: #0366d6; color: white; border: none; border-radius: 3px; cursor: pointer; }
          .actions button:hover { background: #0256cc; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>📄 Presentations</h1>
          <ul>${fileList}</ul>
          <div class="actions">
            <form action="/upload" method="post" enctype="multipart/form-data">
              <input type="file" name="markdown" accept=".md" required>
              <button type="submit">📤 Upload</button>
            </form>
            <form action="/create" method="post">
              <input type="text" name="filename" placeholder="new-presentation.md" required>
              <button type="submit">➕ Create New</button>
            </form>
          </div>
        </div>
      </body>
      </html>
    `);
  });

  app.get('/view', (req, res) => {
    const file = req.query.file;
    if (!file || !fs.existsSync(path.join(PRESET_DIR, file))) {
      return res.status(404).send('File not found.');
    }
    
    // 웹 모드에서는 빈 template을 보내고 JavaScript에서 동적으로 콘텐츠 로드
    const templatePath = path.join(__dirname, 'template.html');
    let templateContent = fs.readFileSync(templatePath, 'utf8');
    
    // 플레이스홀더를 빈 값으로 치환 (JavaScript에서 동적으로 채울 예정)
    templateContent = templateContent
      .replace('{{CONTENT}}', '')
      .replace('{{TOC_HTML}}', '');
    
    res.send(templateContent);
  });

  app.post('/upload', upload.single('markdown'), (req, res) => {
    console.log(`Uploaded: ${req.file.filename}`);
    res.redirect('/');
  });

  app.post('/create', express.urlencoded({ extended: true }), (req, res) => {
    let filename = req.body.filename;
    if (!filename.endsWith('.md')) filename += '.md';
    const filepath = path.join(PRESET_DIR, filename);
    if (!fs.existsSync(filepath)) {
      fs.writeFileSync(filepath, '# New Presentation\n\nStart writing here.', 'utf8');
      console.log(`Created: ${filename}`);
    }
    res.redirect('/');
  });

  app.post('/api/render', (req, res) => {
    try {
      const { markdown } = req.body;
      if (typeof markdown !== 'string') return res.status(400).json({ error: 'Invalid content.' });
      const { md, toc } = createMarkdownParser();
      const contentHtml = md.render(markdown);
      const tocHtml = generateTocHtml(toc);
      res.json({ contentHtml, tocHtml });
    } catch (error) {
      console.error('Error in /api/render:', error);
      res.status(500).json({ error: 'Server failed to render markdown.' });
    }
  });

  app.post('/save-md', (req, res) => {
    const { content, file } = req.body;
    if (typeof content !== 'string' || !file) return res.status(400).send('Invalid request.');
    
    // 파일 잠금 상태 확인
    const metadata = loadFileLockMetadata();
    const fileMetadata = metadata[file];
    
    // 세션별 임시 접근 권한 확인
    const sessionAccess = temporaryAccess.get(req.sessionId) || new Set();
    const hasTemporaryAccess = sessionAccess.has(file);
    
    if (fileMetadata && fileMetadata.isLocked && !hasTemporaryAccess) {
      return res.status(403).json({ error: 'File is locked. Please unlock it first.' });
    }
    
    fs.writeFile(path.join(PRESET_DIR, file), content, 'utf8', (err) => {
      if (err) return res.status(500).send('Error saving file.');
      res.status(200).send('File saved.');
    });
  });

  // 파일 내용 가져오기 (잠금 상태 확인 포함)
  app.get('/api/get-file', (req, res) => {
    try {
      const { filename } = req.query;
      console.log('파일 요청:', { filename, sessionId: req.sessionId });
      
      if (!filename) {
        return res.status(400).json({ error: 'Filename is required' });
      }

      const filePath = path.join(PRESET_DIR, filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
      }

      // 파일 잠금 상태 확인
      let metadata = {};
      try {
        if (fs.existsSync(LOCK_METADATA_FILE)) {
          const data = fs.readFileSync(LOCK_METADATA_FILE, 'utf8');
          metadata = JSON.parse(data);
        }
      } catch (error) {
        console.error('파일 잠금 메타데이터 로드 오류:', error);
      }
      
      const fileMetadata = metadata[filename];
      
      // 세션별 임시 접근 권한 확인
      const sessionAccess = temporaryAccess.get(req.sessionId) || new Set();
      const hasTemporaryAccess = sessionAccess.has(filename);
      
      if (fileMetadata && fileMetadata.isLocked && !hasTemporaryAccess) {
        // 잠긴 파일의 경우 비밀번호 입력 UI 반환
        return res.json({ 
          content: '', 
          isLocked: true, 
          needsPassword: true,
          filename: filename
        });
      }

      // 잠기지 않은 파일이거나 임시 접근 권한이 있는 경우 실제 내용 반환
      const content = fs.readFileSync(filePath, 'utf8');
      res.json({ content: content, isLocked: false });
      
    } catch (error) {
      console.error('Error in /api/get-file:', error);
      res.status(500).json({ error: 'Failed to load file' });
    }
  });

  // 임시 접근 권한 부여 (비밀번호 확인)
  app.post('/api/temporary-access', (req, res) => {
    try {
      const { filename, password } = req.body;
      if (!filename || !password) {
        return res.status(400).json({ error: 'Filename and password are required' });
      }

      // 파일 잠금 메타데이터 로드
      let metadata = {};
      try {
        if (fs.existsSync(LOCK_METADATA_FILE)) {
          const data = fs.readFileSync(LOCK_METADATA_FILE, 'utf8');
          metadata = JSON.parse(data);
        }
      } catch (error) {
        console.error('파일 잠금 메타데이터 로드 오류:', error);
        return res.status(500).json({ error: 'Failed to load file metadata' });
      }

      const fileMetadata = metadata[filename];
      if (!fileMetadata || !fileMetadata.isLocked) {
        return res.status(400).json({ error: 'File is not locked' });
      }

      // 비밀번호 확인
      function hashPassword(password, salt) {
        return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
      }
      
      const providedHash = hashPassword(password, fileMetadata.salt);
      if (providedHash !== fileMetadata.passwordHash) {
        return res.status(401).json({ error: 'Invalid password' });
      }

      // 세션에 임시 접근 권한 부여
      if (!temporaryAccess.has(req.sessionId)) {
        temporaryAccess.set(req.sessionId, new Set());
      }
      temporaryAccess.get(req.sessionId).add(filename);

      res.json({ success: true, message: 'Temporary access granted' });
      
    } catch (error) {
      console.error('Error in /api/temporary-access:', error);
      res.status(500).json({ error: 'Failed to grant temporary access' });
    }
  });

  app.post('/export-pdf', async (req, res) => {
    try {
        const { markdown } = req.body;
        if (typeof markdown !== 'string') return res.status(400).send('Invalid content.');

        const { md, toc } = createMarkdownParser();
        const templatePath = path.resolve(__dirname, 'template.html');
        const templateContent = fs.readFileSync(templatePath, 'utf8');

        const htmlContent = md.render(markdown);
        const tocHtml = generateTocHtml(toc);

        let finalHtml = templateContent
            .replace('{{CONTENT}}', htmlContent)
            .replace('{{TOC_HTML}}', tocHtml);
        
        // Add a class to the body for PDF export to hide all interactive elements
        finalHtml = finalHtml.replace('<body>', '<body class="export-mode pdf-export-mode">');
        // Inject a flag to prevent client-side re-rendering in Puppeteer
        finalHtml = finalHtml.replace(
            '</body>',
            '<script>window.IS_PDF_EXPORT = true;</script></body>'
        );

        const browser = await puppeteer.launch({ headless: "new" });
        const page = await browser.newPage();
        
        await page.setContent(finalHtml, { waitUntil: 'networkidle0' });
        await new Promise(resolve => setTimeout(resolve, 1000));
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: false });
        await browser.close();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=presentation.pdf');
        res.send(pdfBuffer);
    } catch (error) {
        console.error('Error exporting PDF:', error);
        res.status(500).send('Error generating PDF.');
    }
  });

  app.post('/api/ai-suggest', async (req, res) => {
    try {
      const { 
        text, 
        cursorPosition, 
        mode = 'continue', 
        selectedText = '', 
        apiKey = '',
        provider = 'openai',
        model = 'gpt-4o-mini',
        endpoint = '',
        customContinuePrompt = '',
        customImprovePrompt = ''
      } = req.body;
      
      console.log('\n=== AI 추천 요청 시작 ===');
      console.log('🔧 요청 정보:', { 
        모드: mode,
        제공자: provider,
        모델: model,
        전체문서길이: text?.length,
        커서위치: cursorPosition,
        선택된텍스트길이: selectedText?.length,
        API키있음: !!apiKey
      });
      
      // 디버깅용: 커서 위치 확인
      const beforeCursorText = text.substring(0, cursorPosition);
      const afterCursorText = text.substring(cursorPosition);
      
      console.log('📍 컨텍스트 분석:', {
        전체문서미리보기: text.length > 200 ? text.substring(0, 100) + '...' + text.substring(text.length - 100) : text,
        커서앞텍스트: beforeCursorText.slice(-100), // 커서 바로 앞 100자
        커서뒤텍스트: afterCursorText.slice(0, 100)  // 커서 바로 뒤 100자
      });
      
      // API 키가 제공되지 않은 경우
      if (!apiKey && !process.env.OPENAI_API_KEY) {
        console.log('API 키가 제공되지 않음');
        const fallbackSuggestions = mode === 'improve' 
          ? ['더 명확하게 표현', '구체적인 설명 추가', '간결하게 정리']
          : ['계속 작성하세요...', '더 자세히 설명', '예시를 추가'];
        
        return res.status(400).json({ 
          error: 'API key required',
          suggestions: fallbackSuggestions
        });
      }
      
      // 현재는 OpenAI와 OpenAI 호환 API만 지원
      if (provider !== 'openai' && provider !== 'openai-compatible') {
        console.log(`지원하지 않는 제공자: ${provider}. OpenAI로 대체합니다.`);
        // 다른 제공자는 추후 구현
        const fallbackSuggestions = mode === 'improve' 
          ? ['더 명확하게 표현', '구체적인 설명 추가', '간결하게 정리']
          : ['계속 작성하세요...', '더 자세히 설명', '예시를 추가'];
        
        return res.json({ 
          suggestions: fallbackSuggestions,
          message: `${provider} 제공자는 아직 지원하지 않습니다. OpenAI를 사용해주세요.`
        });
      }
      
      // OpenAI 클라이언트 설정
      let currentOpenai;
      if (provider === 'openai-compatible' && endpoint) {
        // OpenAI 호환 API 사용
        currentOpenai = new OpenAI({ 
          apiKey: apiKey,
          baseURL: endpoint.endsWith('/v1') ? endpoint : endpoint + '/v1'
        });
      } else {
        // 기본 OpenAI API 사용
        currentOpenai = apiKey ? new OpenAI({ apiKey }) : openai;
      }

      if (typeof text !== 'string' || typeof cursorPosition !== 'number') {
        return res.status(400).json({ error: 'Invalid request parameters.' });
      }

      const beforeCursor = text.substring(0, cursorPosition);
      const afterCursor = text.substring(cursorPosition);
      
      // 모드에 따라 다른 프롬프트 생성
      let prompt;
      
      if (mode === 'improve') {
        // 개선 모드 프롬프트 (커스텀 프롬프트가 있으면 사용)
        const basePrompt = customImprovePrompt || `당신은 전문적인 글쓰기 도구입니다. 선택된 텍스트의 핵심 의도와 메시지를 보존하면서 더 효과적인 표현으로 개선해주세요.

<선택된텍스트>
{selectedText}
</선택된텍스트>

<전체문서>
{text}
</전체문서>

위 정보를 참고하여 선택된 텍스트를 개선해주세요. 원본의 의도와 포맷을 반드시 유지하면서 문법, 명확성, 표현력만 개선해주세요.`;
        
        // 변수 치환 (커스텀 프롬프트든 기본 프롬프트든 항상 수행)
        const userPrompt = basePrompt
          .replace(/{text}/g, text)
          .replace(/{selectedText}/g, selectedText)
          .replace(/{beforeCursor}/g, beforeCursor)
          .replace(/{afterCursor}/g, afterCursor);

        // 항상 동일한 구조로 프롬프트 생성 (출력 형식 보장)
        prompt = userPrompt + `

글쓰기 개선 지침:
1. **원본의 의도와 핵심 메시지를 절대 변경하지 마세요**
2. **원본과 동일한 톤, 문체, 격식 수준을 유지**하세요 (존댓말/반말, 어조 등)
3. **마크다운 포맷을 완전히 보존**하세요 (헤딩, 리스트, 굵기, 링크 등)
4. **원본과 비슷한 길이를 유지**하며 문법, 명확성, 표현력만 개선하세요
5. **불필요한 장식이나 과도한 표현은 피하고** 자연스럽게 개선하세요
6. 전체 문서의 **맥락과 일관성**을 고려하여 적절한 수준으로 개선하세요
7. **3-5개의 다양한 개선 버전을 제공**하되, 모두 원본의 성격을 유지해야 합니다
8. 반드시 순수 JSON 배열 형태로만 반환하세요 (코드 블록이나 설명 없이)

응답 형식 (이 형태 그대로):
["개선된 표현 1", "개선된 표현 2", "개선된 표현 3", "개선된 표현 4", "개선된 표현 5"]`;
      } else {
        // 연속 작성 모드 프롬프트 (커스텀 프롬프트가 있으면 사용)
        const basePrompt = customContinuePrompt || `당신은 전문적인 글쓰기 도구입니다. 커서 위치의 구조적 맥락을 정확히 파악하고, 그에 맞는 적절한 내용을 제안해주세요.

<커서앞내용>
{beforeCursor}
</커서앞내용>

<커서뒤내용>
{afterCursor}
</커서뒤내용>

<전체문서>
{text}
</전체문서>

위 정보를 참고하여 커서 위치에 적절한 내용을 제안해주세요. 커서 앞 내용의 구조와 맥락을 면밀히 분석하여 가장 자연스러운 후속 내용을 생성하세요.`;
        
        // 변수 치환 (커스텀 프롬프트든 기본 프롬프트든 항상 수행)
        const userPrompt = basePrompt
          .replace(/{text}/g, text)
          .replace(/{beforeCursor}/g, beforeCursor)
          .replace(/{afterCursor}/g, afterCursor);

        // 항상 동일한 구조로 프롬프트 생성 (출력 형식 보장)
        prompt = userPrompt + `

글쓰기 지원 지침:
1. **커서 위치의 구조적 맥락을 정확히 파악**하세요:
   - 리스트 중간 → 리스트 항목 완성/추가
   - 문단 중간 → 문장 완성/연결
   - 섹션 끝 → 다음 섹션 또는 내용 확장
   - 테이블/코드블록 → 해당 형식 유지
2. **기존 문체와 톤을 완전히 유지**하며 자연스럽게 이어지는 내용을 생성하세요
3. **기존 마크다운 포맷을 정확히 따라**하세요 (헤딩 레벨, 리스트 형식, 굵기 등)
4. 각 제안은 **간결하고 핵심적인 내용**으로 작성하세요 (20-150자 정도)
5. 현재 문단/섹션의 **주제와 목적에 정확히 맞는** 내용을 제안하세요
6. **커서 앞 마지막 부분의 맥락**을 우선 고려하여 자연스럽게 이어지도록 하세요
7. **번화하거나 불필요한 내용은 피하고** 핵심만 간결하게 표현하세요
8. 전체 문서의 **구조와 일관성**을 고려하여 적절한 내용을 생성하세요
9. **5개 정도의 다양한 제안을 제공**하되, 모두 유용하고 구체적이어야 합니다
10. 반드시 순수 JSON 배열 형태로만 반환하세요 (코드 블록이나 설명 없이)

응답 형식 (이 형태 그대로):
["제안 1", "제안 2", "제안 3", "제안 4", "제안 5"]`;
      }

      console.log('\n📤 AI에게 전송할 프롬프트:');
      console.log('---BEGIN PROMPT---');
      console.log(prompt);
      console.log('---END PROMPT---');
      
      // 변수 치환 확인
      console.log('\n🔍 변수 치환 확인:', {
        프롬프트길이: prompt.length,
        text변수포함: prompt.includes('{text}'),
        beforeCursor변수포함: prompt.includes('{beforeCursor}'),
        afterCursor변수포함: prompt.includes('{afterCursor}'),
        selectedText변수포함: prompt.includes('{selectedText}')
      });
      
      console.log('\n🤖 AI 호출 중...', `${provider} (${model})`);
      
      // 디버깅용: 프롬프트 변수 확인
      if (mode === 'continue') {
        console.log('📝 연속 작성 모드 세부 정보:', {
          커서앞마지막줄: beforeCursor.split('\n').pop(),
          커서뒤첫줄: afterCursor.split('\n')[0],
          변수치환여부: customContinuePrompt ? '사용자정의' : '기본'
        });
      } else if (mode === 'improve') {
        console.log('✨ 개선 모드 세부 정보:', {
          선택된텍스트: selectedText.slice(0, 100) + (selectedText.length > 100 ? '...' : ''),
          변수치환여부: customImprovePrompt ? '사용자정의' : '기본'
        });
      }

      const completion = await currentOpenai.chat.completions.create({
        model: model,
        messages: [
          { 
            role: "system", 
            content: "당신은 전문적인 글쓰기 도구입니다. 사용자의 요청에 따라 적절한 개수의 제안을 JSON 배열 형식으로만 응답하세요. 다른 어떤 텍스트, 설명, 마크다운도 포함하지 마세요. 오직 [\"제안1\", \"제안2\", \"제안3\", \"제안4\", \"제안5\"] 형식처럼 순수한 JSON 배열만 반환하세요." 
          },
          { role: "user", content: prompt + "\n\n중요: 사용자가 프롬프트에서 요청한 개수만큼 항목을 가진 JSON 배열만 반환하세요. 개수가 명시되지 않으면 3-5개를 기본으로 하되, 품질을 위해 유용한 만큼 제안하세요." }
        ],
        max_completion_tokens: 1000,
        temperature: 0.3
      });

      const rawResponse = completion.choices[0].message.content;
      console.log('\n📥 AI 원본 응답:');
      console.log('---BEGIN RESPONSE---');
      console.log(rawResponse);
      console.log('---END RESPONSE---');
      
      console.log('\n🔍 응답 파싱 중...');

      let suggestions;
      try {
        let responseContent = rawResponse.trim();
        
        console.log('📊 응답 정보:', {
          길이: responseContent.length,
          타입: typeof responseContent,
          첫100자: responseContent.substring(0, 100)
        });
        
        // 1. 마크다운 코드 블록 제거
        responseContent = responseContent.replace(/^```(?:json)?\s*/gm, '').replace(/\s*```$/gm, '');
        
        // 2. JSON 배열 패턴 찾기 (더 강력한 정규식)
        const jsonArrayPattern = /\[\s*"[^"]*"(?:\s*,\s*"[^"]*")*\s*\]/;
        let jsonMatch = responseContent.match(jsonArrayPattern);
        
        if (!jsonMatch) {
          // 3. 대안: 더 유연한 패턴으로 시도 (따옴표가 섞여있을 수 있음)
          const flexiblePattern = /\[[\s\S]*?\]/;
          jsonMatch = responseContent.match(flexiblePattern);
        }
        
        if (jsonMatch) {
          responseContent = jsonMatch[0];
        } else {
          // 4. JSON 배열이 없는 경우: 텍스트에서 문장을 추출해서 배열로 만들기
          console.log('JSON 패턴을 찾을 수 없음. 텍스트에서 추출 시도...');
          
          // 텍스트를 줄바꿈으로 분리하여 처리
          const lines = responseContent.split('\n').filter(line => line.trim().length > 0);
          const extractedSuggestions = [];
          
          for (const line of lines) {
            const cleanLine = line.replace(/^[-*\d\.)\s]+/, '').trim(); // 리스트 마커 제거
            if (cleanLine.length > 5 && cleanLine.length < 200) { // 적절한 길이의 문장만
              extractedSuggestions.push(cleanLine);
              if (extractedSuggestions.length >= 3) break;
            }
          }
          
          if (extractedSuggestions.length >= 3) {
            suggestions = extractedSuggestions.slice(0, 3);
          } else {
            throw new Error('텍스트에서 적절한 제안을 추출할 수 없음');
          }
        }
        
        // 5. JSON 파싱 시도 (위에서 배열을 만들지 않은 경우)
        if (!suggestions) {
          console.log('🔍 JSON 파싱 시도:', responseContent);
          
          // 불완전한 JSON 수정 시도
          let fixedJson = responseContent;
          
          // 끝이 잘린 경우 수정
          if (!fixedJson.endsWith(']')) {
            const lastQuoteIndex = fixedJson.lastIndexOf('"');
            if (lastQuoteIndex > 0) {
              fixedJson = fixedJson.substring(0, lastQuoteIndex + 1) + ']';
            }
          }
          
          console.log('🔧 수정된 JSON:', fixedJson);
          suggestions = JSON.parse(fixedJson);
        }
        
        if (!Array.isArray(suggestions) || suggestions.length === 0) {
          throw new Error('Invalid response format');
        }
        
        // 최대 10개로 제한 (너무 많으면 UI가 복잡해짐)
        suggestions = suggestions.slice(0, 10);
        
        console.log('\n✅ 파싱 성공!');
        
      } catch (parseError) {
        console.log('\n❌ JSON 파싱 실패:', parseError.message);
        console.log('🔄 기본 추천으로 대체');
        
        // 파싱 실패 시 모드에 따른 기본 추천 제공
        if (mode && mode === 'improve') {
          suggestions = [
            "더 명확하게 표현",
            "구체적인 설명으로 개선", 
            "간결하고 효과적으로 수정"
          ];
        } else {
          suggestions = [
            "을 계속 작성하세요",
            "에 대한 자세한 설명", 
            "의 구체적인 예시"
          ];
        }
      }

      console.log('\n🎯 최종 추천 결과:');
      console.log('개수:', suggestions.length);
      console.log('내용:', suggestions);
      console.log('=== AI 추천 요청 완료 ===\n');
      
      res.json({ suggestions });
      
    } catch (error) {
      console.log('\n💥 AI 추천 요청 실패:', error.message);
      console.log('=== AI 추천 요청 완료 (실패) ===\n');
      
      const errorSuggestions = (mode && mode === 'improve')
        ? ["더 명확하게 표현", "구체적인 설명 추가", "간결하게 정리"]
        : ["계속 작성하기...", "더 자세히 설명", "예시 추가하기"];
        
      res.status(500).json({ 
        error: 'Failed to generate suggestions',
        suggestions: errorSuggestions
      });
    }
  });

  // === 파일 잠금 관련 헬퍼 함수들 ===
  
  // 파일 메타데이터 로드
  function loadFileLockMetadata() {
    try {
      if (fs.existsSync(LOCK_METADATA_FILE)) {
        const data = fs.readFileSync(LOCK_METADATA_FILE, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('파일 잠금 메타데이터 로드 오류:', error);
    }
    return {};
  }
  
  // 파일 메타데이터 저장
  function saveFileLockMetadata(metadata) {
    try {
      // PRESET_DIR이 없으면 생성
      if (!fs.existsSync(PRESET_DIR)) {
        fs.mkdirSync(PRESET_DIR, { recursive: true });
      }
      fs.writeFileSync(LOCK_METADATA_FILE, JSON.stringify(metadata, null, 2));
    } catch (error) {
      console.error('파일 잠금 메타데이터 저장 오류:', error);
    }
  }
  
  // 비밀번호 해시 생성
  function hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  }
  
  // 랜덤 salt 생성
  function generateSalt() {
    return crypto.randomBytes(32).toString('hex');
  }
  
  // 파일 내용 암호화
  function encryptFileContent(content, password) {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(password, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(algorithm, key);
    
    let encrypted = cipher.update(content, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return {
      encrypted: encrypted,
      iv: iv.toString('hex')
    };
  }
  
  // 파일 내용 복호화
  function decryptFileContent(encryptedData, password) {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(password, 'salt', 32);
    const decipher = crypto.createDecipher(algorithm, key);
    
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  // === 파일 잠금 API 엔드포인트들 ===
  
  // 파일 잠금 상태 확인
  app.get('/api/check-file-lock', (req, res) => {
    try {
      const { filename } = req.query;
      if (!filename) {
        return res.status(400).json({ error: 'Filename is required' });
      }
      
      const metadata = loadFileLockMetadata();
      const isLocked = metadata[filename] && metadata[filename].isLocked;
      
      res.json({ isLocked: !!isLocked });
    } catch (error) {
      console.error('파일 잠금 상태 확인 오류:', error);
      res.status(500).json({ error: 'Failed to check file lock status' });
    }
  });
  
  // 파일 잠금 설정
  app.post('/api/set-file-lock', (req, res) => {
    try {
      const { filename, password } = req.body;
      
      if (!filename || !password) {
        return res.status(400).json({ error: 'Filename and password are required' });
      }
      
      if (password.length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters' });
      }
      
      const metadata = loadFileLockMetadata();
      const salt = generateSalt();
      const hashedPassword = hashPassword(password, salt);
      
      // 파일이 존재하는지 확인하고 내용 읽기
      const filePath = path.join(PRESET_DIR, filename);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const encryptedData = encryptFileContent(content, password);
        
        // 암호화된 내용으로 파일 저장
        fs.writeFileSync(filePath + '.encrypted', JSON.stringify(encryptedData));
        
        // 원본 파일 삭제 (선택적)
        // fs.unlinkSync(filePath);
      }
      
      // 메타데이터 업데이트
      metadata[filename] = {
        isLocked: true,
        passwordHash: hashedPassword,
        salt: salt,
        createdAt: new Date().toISOString(),
        hasEncryptedFile: true
      };
      
      saveFileLockMetadata(metadata);
      
      res.json({ success: true, message: 'File locked successfully' });
    } catch (error) {
      console.error('파일 잠금 설정 오류:', error);
      res.status(500).json({ error: 'Failed to set file lock' });
    }
  });
  
  // 파일 잠금 해제
  app.post('/api/remove-file-lock', (req, res) => {
    try {
      const { filename } = req.body;
      
      if (!filename) {
        return res.status(400).json({ error: 'Filename is required' });
      }
      
      const metadata = loadFileLockMetadata();
      
      if (metadata[filename]) {
        // 암호화된 파일 삭제
        const encryptedFilePath = path.join(PRESET_DIR, filename + '.encrypted');
        if (fs.existsSync(encryptedFilePath)) {
          fs.unlinkSync(encryptedFilePath);
        }
        
        // 메타데이터에서 제거
        delete metadata[filename];
        saveFileLockMetadata(metadata);
      }
      
      res.json({ success: true, message: 'File lock removed successfully' });
    } catch (error) {
      console.error('파일 잠금 해제 오류:', error);
      res.status(500).json({ error: 'Failed to remove file lock' });
    }
  });
  
  // 파일 잠금 해제 (비밀번호로)
  app.post('/api/unlock-file', (req, res) => {
    try {
      const { filename, password } = req.body;
      
      if (!filename || !password) {
        return res.status(400).json({ error: 'Filename and password are required' });
      }
      
      const metadata = loadFileLockMetadata();
      const fileMetadata = metadata[filename];
      
      if (!fileMetadata || !fileMetadata.isLocked) {
        return res.status(400).json({ error: 'File is not locked' });
      }
      
      // 비밀번호 검증
      const hashedPassword = hashPassword(password, fileMetadata.salt);
      if (hashedPassword !== fileMetadata.passwordHash) {
        return res.json({ success: false, message: 'Incorrect password' });
      }
      
      // 암호화된 파일 내용 복호화
      const encryptedFilePath = path.join(PRESET_DIR, filename + '.encrypted');
      if (fs.existsSync(encryptedFilePath)) {
        const encryptedData = JSON.parse(fs.readFileSync(encryptedFilePath, 'utf8'));
        const decryptedContent = decryptFileContent(encryptedData, password);
        
        // 복호화된 내용을 원본 파일로 복원
        const originalFilePath = path.join(PRESET_DIR, filename);
        fs.writeFileSync(originalFilePath, decryptedContent);
      }
      
      res.json({ success: true, message: 'File unlocked successfully' });
    } catch (error) {
      console.error('파일 잠금 해제 오류:', error);
      res.status(500).json({ error: 'Failed to unlock file' });
    }
  });

  app.post('/export-html', async (req, res) => {
    try {
        const { markdown, file } = req.body;
        if (typeof markdown !== 'string') return res.status(400).send('Invalid content.');

        const { md, toc } = createMarkdownParser();
        const templatePath = path.resolve(__dirname, 'template.html');
        const templateContent = fs.readFileSync(templatePath, 'utf8');

        const contentHtml = md.render(markdown);
        const tocHtml = generateTocHtml(toc);

        let finalHtml = templateContent
            .replace('{{TOC_HTML}}', tocHtml)
            .replace('{{CONTENT}}', contentHtml);
        
        // Add a class to the body for HTML export to hide elements via CSS
        // and remove the live-reload script.
        finalHtml = finalHtml
            .replace('<body>', '<body class="export-mode">')
            .replace(
                '</body>', 
                '<script>window.IS_EXPORTED=true;</script></body>'
            );

        const filename = file ? path.basename(file, '.md') + '.html' : 'presentation.html';
        
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        res.send(finalHtml);
    } catch (error) {
        console.error('Error exporting HTML:', error);
        res.status(500).send('Error generating HTML file.');
    }
  });

  app.post('/export-markdown', async (req, res) => {
    try {
        const { markdown, file } = req.body;
        if (typeof markdown !== 'string') return res.status(400).send('Invalid content.');

        const filename = file ? path.basename(file) : 'presentation.md';
        
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        res.send(markdown);
    } catch (error) {
        console.error('Error exporting Markdown:', error);
        res.status(500).send('Error generating Markdown file.');
    }
  });

  const server = app.listen(port, () => console.log(`Server started on http://localhost:${port}`));
  
  const wss = new WebSocket.Server({ server });
  wss.on('connection', ws => console.log('Client connected for live reload.'));
  const broadcastReload = () => wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send('reload'));
  
  chokidar.watch(PRESET_DIR).on('all', (event, path) => {
    if (['add', 'change', 'unlink'].includes(event)) {
      console.log(`${path} has been ${event}`);
      broadcastReload();
    }
  });
}

// --- Main Execution Logic ---

if (options.web) {
  serveApp(options);
} else if (options.md) {
  runCli(options);
} else {
  // If no relevant options are provided, show help.
  program.help();
} 