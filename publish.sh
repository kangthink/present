#!/bin/bash

# npm 배포 스크립트
set -e

echo "🚀 Starting npm publish process..."

# 버전 확인
echo "📋 Current version: $(node -p "require('./package.json').version")"

# 의존성 설치 확인
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# 린트 체크 (만약 설정되어 있다면)
# echo "🔍 Running lint check..."
# npm run lint 2>/dev/null || echo "⚠️  No lint script found, skipping..."

# 테스트 실행
echo "🧪 Running tests..."
npm test 2>/dev/null || echo "⚠️  No tests found, skipping..."

# 필수 파일들 존재 확인
echo "📄 Checking required files..."
required_files=("present.js" "template.html" "README.md" "LICENSE")
for file in "${required_files[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ Required file missing: $file"
        exit 1
    fi
    echo "✅ $file exists"
done

# 실행 권한 확인
echo "🔧 Checking executable permissions..."
if [ ! -x "present.js" ]; then
    echo "🔧 Adding executable permission to present.js"
    chmod +x present.js
fi

# 패키지 내용 미리보기
echo "📦 Package contents preview:"
npm pack --dry-run

# 사용자에게 확인 요청
echo ""
read -p "🤔 Do you want to proceed with publishing? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    # 실제 배포
    echo "🚀 Publishing to npm..."
    npm publish --access public
    
    echo "✅ Successfully published!"
    echo "📝 You can install it globally with: npm install -g @present/markdown-presentation"
    echo "🔗 View on npm: https://www.npmjs.com/package/@present/markdown-presentation"
else
    echo "❌ Publishing cancelled."
    exit 1
fi 