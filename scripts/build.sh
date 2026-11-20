#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

npm run check
npm test

rm -rf dist
mkdir -p dist/macros/assets
cp module.json ui.js defaults.json help.json web_ui.html LICENSE dist/macros/
cp assets/editor.js assets/editor.css dist/macros/assets/
COPYFILE_DISABLE=1 tar -czf dist/macros-module.tar.gz -C dist macros

printf '%s\n' 'Built dist/macros-module.tar.gz'
