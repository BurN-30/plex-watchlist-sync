// utils/configLoader.js
// Configuration loader with validation and error handling

import fs from 'fs';
import path from 'path';

const CONFIG_FILE = './config.json';
const CONFIG_EXAMPLE = './config.example.json';

/**
 * Configuration validation schema
 */
const CONFIG_SCHEMA = {
  required: ['plexToken', 'plexUrl', 'discordBotToken', 'discordChannelId'],
  optional: ['rssUrls', 'rssUrl', 'excludeLibraries', 'tautulliUrl', 'tautulliApiKey', 'scanInterval'],
  defaults: {
    excludeLibraries: [],
    scanInterval: null
  }
};

/**
 * Validate loaded configuration
 */
function validateConfig(config) {
  const errors = [];

  for (const field of CONFIG_SCHEMA.required) {
    if (!config[field]) {
      errors.push(`Missing required field: '${field}'`);
    }
  }

  if (!config.rssUrls && !config.rssUrl) {
    errors.push("No RSS source configured. Add 'rssUrls' or 'rssUrl'.");
  }

  if (config.plexUrl && !config.plexUrl.startsWith('http')) {
    errors.push(`'plexUrl' must start with http:// or https://`);
  }

  if (config.discordChannelId && !/^\d+$/.test(config.discordChannelId)) {
    errors.push(`'discordChannelId' must be a numeric ID`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Mask tokens for display
 */
function maskToken(token) {
  if (!token || token.length < 10) return '***';
  return `${token.substring(0, 4)}...${token.substring(token.length - 4)}`;
}

/**
 * Load and validate configuration from config.json
 */
export function loadConfig() {
  console.log('[CONFIG] Loading configuration...');

  if (!fs.existsSync(CONFIG_FILE)) {
    console.error('');
    console.error('╔════════════════════════════════════════════════════════════╗');
    console.error('║  ERROR: config.json not found!                             ║');
    console.error('╠════════════════════════════════════════════════════════════╣');
    console.error('║  To create your configuration:                             ║');
    console.error('║  1. Copy config.example.json to config.json                ║');
    console.error('║  2. Fill in your Plex and Discord tokens                   ║');
    console.error('║  3. Add your RSS URLs                                      ║');
    console.error('╚════════════════════════════════════════════════════════════╝');
    console.error('');
    process.exit(1);
  }

  let config;
  try {
    const rawContent = fs.readFileSync(CONFIG_FILE, 'utf-8');
    config = JSON.parse(rawContent);
  } catch (e) {
    console.error('');
    console.error('╔════════════════════════════════════════════════════════════╗');
    console.error('║  ERROR: Unable to parse config.json!                       ║');
    console.error('╚════════════════════════════════════════════════════════════╝');
    console.error('');
    console.error(`Detail: ${e.message}`);
    console.error('Tip: Check JSON syntax at https://jsonlint.com');
    process.exit(1);
  }

  // Apply default values
  for (const [key, defaultValue] of Object.entries(CONFIG_SCHEMA.defaults)) {
    if (config[key] === undefined) {
      config[key] = defaultValue;
    }
  }

  // Normalize rssUrls
  if (!config.rssUrls && config.rssUrl) {
    config.rssUrls = [config.rssUrl];
  }

  // Validate
  const validation = validateConfig(config);
  if (!validation.valid) {
    console.error('');
    console.error('╔════════════════════════════════════════════════════════════╗');
    console.error('║  ERROR: Invalid configuration!                             ║');
    console.error('╠════════════════════════════════════════════════════════════╣');
    for (const error of validation.errors) {
      console.error(`║  • ${error.padEnd(55)} ║`);
    }
    console.error('╚════════════════════════════════════════════════════════════╝');
    process.exit(1);
  }

  // Summary
  console.log('[CONFIG] Configuration loaded successfully');
  console.log(`   Plex: ${config.plexUrl}`);
  console.log(`   Plex Token: ${maskToken(config.plexToken)}`);
  console.log(`   Discord Channel: ${config.discordChannelId}`);
  console.log(`   RSS Sources: ${config.rssUrls?.length || 0}`);
  if (config.tautulliUrl) console.log(`   Tautulli: ${config.tautulliUrl}`);
  if (config.scanInterval) {
    console.log(`   Interval: ${config.scanInterval} minutes`);
  } else {
    console.log(`   Mode: Daily scan at midnight`);
  }
  console.log('');

  return config;
}
