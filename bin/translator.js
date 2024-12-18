#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');

// Resolve o caminho correto para o script principal
const mainScriptPath = path.resolve(__dirname, '../src/index.js');

// Executa o script principal
execSync(`node ${mainScriptPath}`, { stdio: 'inherit' });
