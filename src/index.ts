#!/usr/bin/env node

import { Command } from 'commander';
import { createConfigCommand } from './commands/config.js';
import { createStartCommand } from './commands/start.js';
import { createFSDCommand } from './fsd/command.js';

const program = new Command();

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

program
  .name('autotunez')
  .description('CLI assistant for vibe coding with Claude')
  .version(packageJson.version);

program.addCommand(createConfigCommand());
program.addCommand(createFSDCommand());
program.addCommand(createStartCommand(), { isDefault: true });

program.parse();
