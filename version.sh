#!/bin/bash

# 버전 관리 스크립트
set -e

# 사용법 표시
show_usage() {
    echo "Usage: $0 [patch|minor|major]"
    echo ""
    echo "Examples:"
    echo "  $0 patch    # 1.0.0 -> 1.0.1"
    echo "  $0 minor    # 1.0.0 -> 1.1.0" 
    echo "  $0 major    # 1.0.0 -> 2.0.0"
    echo ""
    echo "Current version: $(node -p "require('./package.json').version")"
}

# 인자 확인
if [ $# -ne 1 ]; then
    show_usage
    exit 1
fi

case $1 in
    patch|minor|major)
        VERSION_TYPE=$1
        ;;
    *)
        echo "❌ Invalid version type: $1"
        show_usage
        exit 1
        ;;
esac

echo "🔖 Current version: $(node -p "require('./package.json').version")"

# 버전 업데이트
echo "📈 Updating $VERSION_TYPE version..."
npm version $VERSION_TYPE --no-git-tag-version

NEW_VERSION=$(node -p "require('./package.json').version")
echo "✅ New version: $NEW_VERSION"

# Git 커밋 생성 (선택사항)
read -p "🤔 Do you want to commit this version change? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    git add package.json
    git commit -m "chore: bump version to $NEW_VERSION"
    
    read -p "🏷️  Do you want to create a git tag? (y/N): " -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git tag "v$NEW_VERSION"
        echo "✅ Created git tag: v$NEW_VERSION"
        echo "📤 Don't forget to push: git push && git push --tags"
    fi
else
    echo "ℹ️  Version updated in package.json only"
fi

echo ""
echo "📋 Next steps:"
echo "  1. Review the changes"
echo "  2. Run tests if available"
echo "  3. Run './publish.sh' to publish to npm" 