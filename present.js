#!/usr/bin/env node

const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');
const mdAnchor = require('markdown-it-anchor');
const puppeteer = require('puppeteer');
const slug = require('slug');
const chokidar = require('chokidar');
const express = require('express');
const WebSocket = require('ws');
const multer = require('multer');

const PRESET_DIR = '.preset';

program
  .version('1.0.0')
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
  const md = new MarkdownIt({ html: true }).use(mdAnchor, {
    slugify: s => slug(s, { lower: true }),
    callback: (token, { slug, title }) => {
      if (token.tag === 'h1' || token.tag === 'h2' || token.tag === 'h3') {
        toc.push({ level: parseInt(token.tag.substring(1)), slug: slug, title: title });
      }
    }
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
  app.use('/storage', express.static(PRESET_DIR)); 

  app.get('/', (req, res) => {
    const files = fs.readdirSync(PRESET_DIR).filter(file => file.endsWith('.md'));
    let fileList = files.map(file => `<li><a href="/view?file=${file}">${file}</a></li>`).join('');
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Presentations</title>
        <style>
          body { font-family: sans-serif; padding: 2em; } .container { max-width: 800px; margin: auto; }
          ul { list-style: none; padding: 0; } li { padding: 0.5em; border-bottom: 1px solid #eee; }
          a { text-decoration: none; color: #0366d6; } .actions { margin-top: 2em; display: flex; gap: 1em; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Presentations</h1><ul>${fileList}</ul>
          <div class="actions">
            <form action="/upload" method="post" enctype="multipart/form-data">
              <input type="file" name="markdown" accept=".md" required><button type="submit">Upload</button>
            </form>
            <form action="/create" method="post">
              <input type="text" name="filename" placeholder="new-presentation.md" required><button type="submit">Create New</button>
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
    fs.writeFile(path.join(PRESET_DIR, file), content, 'utf8', (err) => {
      if (err) return res.status(500).send('Error saving file.');
      res.status(200).send('File saved.');
    });
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